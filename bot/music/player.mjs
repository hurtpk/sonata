/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "node:child_process";
import { AudioPlayerStatus, createAudioPlayer, createAudioResource, entersState, joinVoiceChannel, NoSubscriberBehavior, StreamType, VoiceConnectionStatus } from "@discordjs/voice";
import { resolveTrack } from "./source.mjs";
import { audioFilter, EFFECTS } from "./effects.mjs";

const clock = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
const link = track => `[${track.title.replace(/[\[\]\\]/g, "")}](${track.url})`;

export class VoiceMusic {
    constructor(send, limit = 1) { this.send = send; this.limit = limit; this.rooms = new Map(); this.generation = 0; }
    event(type, data) {
        const room = this.rooms.get(data.guild_id);
        if (!room?.adapter) return;
        if (type === "VOICE_SERVER_UPDATE") room.adapter.onVoiceServerUpdate(data);
        if (type === "VOICE_STATE_UPDATE") { room.adapter.onVoiceStateUpdate(data); if (data.channel_id && data.channel_id !== room.channel) room.channel = data.channel_id; if (!data.channel_id) this.close(room); }
    }
    close(room) {
        if (this.rooms.get(room.guild) !== room) return;
        this.rooms.delete(room.guild); clearTimeout(room.idle); clearTimeout(room.retry); room.process?.kill(); room.player.stop(true); room.connection?.destroy();
    }
    closeAll() { this.generation++; for (const room of [...this.rooms.values()]) this.close(room); }
    async open(job) {
        if (this.rooms.size >= this.limit) throw new Error("All music slots are in use. Try again after another server finishes.");
        const room = { guild: job.guild, channel: job.channel, queue: [], current: null, volume: 70, effect: "off", rate: 1, loop: "off", offset: 0, changing: false, player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } }), issue: "" };
        this.rooms.set(job.guild, room);
        room.player.on(AudioPlayerStatus.Idle, () => { if (!room.changing && this.rooms.get(room.guild) === room) this.advance(room).catch(() => { room.issue = "The next track could not be played. Use skip or play to continue."; }); });
        room.player.on("error", () => { room.issue = "Audio playback failed. Try skipping to another track."; });
        room.connection = joinVoiceChannel({ guildId: job.guild, channelId: job.channel, selfDeaf: true, selfMute: false, adapterCreator: methods => {
            room.adapter = methods;
            return { sendPayload: payload => { this.send(payload).catch(() => { room.issue = "The voice connection could not be updated."; }); return true; }, destroy: () => { room.adapter = null; } };
        } });
        room.connection.on(VoiceConnectionStatus.Disconnected, () => {
            clearTimeout(room.retry);
            room.retry = setTimeout(() => { if (room.connection.state.status !== VoiceConnectionStatus.Ready) this.close(room); }, 20_000);
        });
        room.connection.on("error", () => { room.issue = "Discord disconnected the audio connection."; this.close(room); });
        room.connection.subscribe(room.player);
        try { await entersState(room.connection, VoiceConnectionStatus.Ready, 20_000); }
        catch { this.close(room); throw new Error("Discord could not connect Sonata to this voice channel."); }
        return room;
    }
    position(room) { return room.current ? room.offset + (room.resource?.playbackDuration ?? 0) / 1000 * (room.rate ?? 1) : 0; }
    async stream(room, track, offset = 0) {
        if (Date.now() - track.resolved > 15 * 60_000) track = { ...await resolveTrack(track.url), actor: track.actor };
        if (this.rooms.get(room.guild) !== room) throw new Error("The voice connection ended.");
        room.changing = true; room.process?.kill(); room.player.stop(true);
        const process = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-protocol_whitelist", "https,tls,tcp,crypto", "-rw_timeout", "15000000", "-ss", String(offset), "-i", track.audio, "-vn", "-af", audioFilter(room.effect ?? "off", room.volume), "-ac", "2", "-ar", "48000", "-c:a", "libopus", "-b:a", "96k", "-f", "ogg", "pipe:1"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
        process.on("error", () => { room.issue = "The server could not start its audio encoder."; });
        room.process = process; room.current = track; room.offset = offset; room.rate = EFFECTS[room.effect ?? "off"].rate; room.issue = ""; room.votes = new Set();
        room.resource = createAudioResource(process.stdout, { inputType: StreamType.OggOpus });
        room.player.play(room.resource); clearTimeout(room.idle);
        try { await entersState(room.player, AudioPlayerStatus.Playing, 10_000); }
        catch { room.process?.kill(); room.current = null; room.idle = setTimeout(() => this.close(room), 120_000); throw new Error("This track could not start playing. Try a different video."); }
        finally { room.changing = false; }
    }
    async advance(room, skip = false) {
        const previous = room.current;
        if (previous && room.loop === "queue") room.queue.push(previous);
        const next = previous && room.loop === "track" && !skip ? previous : room.queue.shift();
        room.current = null;
        if (next) await this.stream(room, next);
        else { room.process?.kill(); room.process = null; room.idle = setTimeout(() => this.close(room), 120_000); }
    }
    async command(job) {
        const generation = this.generation;
        let room = this.rooms.get(job.guild);
        const o = job.options;
        if (job.name === "filter" && !Object.hasOwn(EFFECTS, o.preset)) throw new Error("Choose off, bassboost, nightcore or vaporwave.");
        if (room && room.channel !== job.channel) throw new Error("Join Sonata's current voice channel to control music.");
        if (job.name === "play") {
            if (room?.queue.length >= 50) throw new Error("The queue is full. Remove a track before adding more.");
            const track = { ...await resolveTrack(o.query), actor: job.actor };
            if (generation !== this.generation || Date.now() >= job.expires) throw new Error("This request expired or the voice service restarted. Try playback again.");
            if (!room) room = await this.open(job);
            if (this.rooms.get(job.guild) !== room) throw new Error("The voice connection ended. Try playback again.");
            if (room.current) { room.queue.push(track); return { title: "Added to queue", description: `${link(track)} · ${clock(track.duration)}\nUpcoming position: ${room.queue.length}` }; }
            await this.stream(room, track);
            return { title: "Now playing", description: `${link(track)} · ${clock(track.duration)}` };
        }
        if (!room) throw new Error("No music is playing in this server. Use play first.");
        if (job.name === "stop") { this.close(room); return { title: "Music stopped", description: "The queue was cleared and Sonata left voice." }; }
        if (job.name === "queue") return { title: "Music queue", description: `${room.current ? `Playing: ${link(room.current)}` : "No current track."}\n\n${room.queue.slice(0, 8).map((track, i) => `${i + 1}. ${link(track)}`).join("\n") || "No upcoming tracks."}\n\n${room.queue.length} upcoming · Loop: ${room.loop}${room.issue ? `\n${room.issue}` : ""}`.slice(0, 1800) };
        if (job.name === "nowplaying") return { title: "Now playing", description: room.current ? `${link(room.current)}\n${clock(this.position(room))} / ${clock(room.current.duration)} · Volume ${room.volume}% · Effect ${room.effect ?? "off"}\n${room.player.state.status === AudioPlayerStatus.Paused ? "Paused" : "Playing"}${room.issue ? `\n${room.issue}` : ""}` : "No current track." };
        if (job.name === "voteskip") {
            if (!room.current || !Array.isArray(job.listeners) || !job.listeners.includes(job.actor)) throw new Error("Join the current track's voice channel to vote.");
            room.votes ??= new Set(); room.votes = new Set([...room.votes].filter(id => job.listeners.includes(id))); room.votes.add(job.actor);
            const required = Math.max(1, Math.ceil(job.listeners.length * (job.threshold ?? 50) / 100));
            if (room.votes.size < required) return { title: "Skip vote recorded", description: `${room.votes.size} / ${required} votes needed. Each current listener gets one vote.` };
            job = { ...job, name: "skip" };
        }
        if (job.name === "pause" && !room.player.pause()) throw new Error("Music is not currently playing.");
        if (job.name === "resume" && !room.player.unpause()) throw new Error("Music is not paused.");
        if (job.name === "skip") { room.changing = true; room.process?.kill(); room.player.stop(true); room.changing = false; await this.advance(room, true); }
        if (job.name === "shuffle") for (let i = room.queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [room.queue[i], room.queue[j]] = [room.queue[j], room.queue[i]]; }
        if (job.name === "remove") { if (!room.queue[o.position - 1]) throw new Error("Choose a valid upcoming track number from the queue."); room.queue.splice(o.position - 1, 1); }
        if (job.name === "loop") room.loop = o.mode;
        if (job.name === "seek") { if (!room.current || o.seconds >= room.current.duration) throw new Error("Choose a position inside the current track."); await this.stream(room, room.current, o.seconds); }
        if (["volume", "filter"].includes(job.name)) { const position = this.position(room), paused = room.player.state.status === AudioPlayerStatus.Paused; if (job.name === "volume") room.volume = o.percent; else room.effect = o.preset; if (room.current) { const votes = room.votes; await this.stream(room, room.current, Math.min(position, room.current.duration - 1)); room.votes = votes; if (paused) room.player.pause(); } }
        return { title: "Music updated", description: `${job.name === "skip" ? room.current ? `Now playing ${link(room.current)}` : "The queue is finished." : job.name === "volume" ? `Volume: ${room.volume}%` : job.name === "filter" ? `Effect: ${room.effect}. Current position and pause state were kept.` : job.name === "loop" ? `Loop: ${room.loop}` : `Done: ${job.name}.`}` };
    }
}
