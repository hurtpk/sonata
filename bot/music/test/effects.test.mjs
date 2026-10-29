/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { audioFilter } from "../effects.mjs";
import { VoiceMusic } from "../player.mjs";
import { createAudioPlayer } from "@discordjs/voice";

test("Effects use fixed filters and reject arbitrary FFmpeg expressions", () => {
    for (const name of ["off", "bassboost", "nightcore", "vaporwave"]) assert.match(audioFilter(name, 70), /alimiter/);
    for (const name of ["constructor", "__proto__", "amovie=/etc/passwd", "off;anull"]) assert.throws(() => audioFilter(name, 70));
    assert.throws(() => audioFilter("off", 101));
});

test("Changing effects keeps source position, pause state and votes, and the next track uses the same effect", async () => {
    const music = new VoiceMusic(async () => {}), player = createAudioPlayer(), room = { guild: "g", channel: "c", current: { duration: 100 }, queue: [], volume: 70, effect: "nightcore", rate: 1.25, offset: 10, resource: { playbackDuration: 8000 }, player, votes: new Set(["a"]), voteTrack: "track" };
    let paused = false; player.pause = () => { paused = true; return true; }; Object.defineProperty(player, "state", { get: () => ({ status: "paused" }) }); music.rooms.set("g", room);
    let offset; music.stream = async (current, track, position = 0) => { offset = position; current.effectUsed = current.effect; current.rate = current.effect === "vaporwave" ? 0.8 : 1; current.current = track; current.offset = position; current.resource = { playbackDuration: 0 }; current.votes = new Set(); };
    await music.command({ guild: "g", channel: "c", name: "filter", options: { preset: "vaporwave" } }); assert.equal(offset, 20); assert(paused); assert(room.votes.has("a")); assert.equal(room.effectUsed, "vaporwave");
    room.queue.push({ duration: 50 }); await music.advance(room, true); assert.equal(room.effectUsed, "vaporwave");
    await assert.rejects(music.command({ guild: "g", channel: "c", name: "filter", options: { preset: "unsafe" } }));
});

test("Skip votes deduplicate listeners, discard departed votes, reset for a new track and skip only at the threshold", async () => {
    const music = new VoiceMusic(async () => {}), room = { guild: "g", channel: "c", current: { duration: 100, title: "Track", url: "https://soundcloud.com/test/track" }, votes: new Set(), player: createAudioPlayer() }; music.rooms.set("g", room);
    let skips = 0; music.advance = async current => { skips++; current.votes = new Set(); };
    const vote = (actor, listeners = ["a", "b", "c"]) => music.command({ guild: "g", channel: "c", actor, name: "voteskip", listeners, threshold: 60, options: {} });
    assert.match((await vote("a")).description, /1 \/ 2/); await vote("a"); assert.equal(skips, 0);
    await vote("b"); assert.equal(skips, 1); await vote("c"); assert.equal(room.votes.size, 1);
    await vote("a", ["a", "b", "d"]); assert.equal(skips, 1); assert(!room.votes.has("c"));
});

test("Installed FFmpeg produces the expected nightcore and vaporwave speeds and bass gain", t => {
    if (spawnSync("ffmpeg", ["-version"]).error?.code === "ENOENT") { t.skip("FFmpeg is verified separately on the voice host."); return; }
    const samples = name => { const run = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=55:sample_rate=48000:duration=1", "-af", audioFilter(name, 70), "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"], { maxBuffer: 2_000_000 }); assert.equal(run.status, 0, run.stderr?.toString()); return new Float32Array(run.stdout.buffer.slice(run.stdout.byteOffset, run.stdout.byteOffset + run.stdout.byteLength)); };
    const off = samples("off"), bass = samples("bassboost"), fast = samples("nightcore"), slow = samples("vaporwave"), rms = value => Math.sqrt(value.reduce((sum, n) => sum + n * n, 0) / value.length);
    assert(Math.abs(fast.length / off.length - 0.8) < 0.02); assert(Math.abs(slow.length / off.length - 1.25) < 0.02); assert(rms(bass) > rms(off) * 1.5);
});
