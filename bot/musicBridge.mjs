/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fail, isId } from "./discord.mjs";
import { VIDEO_MAX_BYTES, videoLimit, socialAuthor } from "./music/videoSource.mjs";
import { captionOptions, imageFormat, imageUrl, IMAGE_OUTPUT_LIMIT } from "./music/imageSource.mjs";

export class MusicBridge {
    constructor() { this.generation = crypto.randomUUID(); this.lastPoll = 0; this.jobs = new Map(); this.events = []; this.channels = new Map(); this.active = new Set(); this.waiter = null; }
    online() { return Date.now() - this.lastPoll < 20_000; }
    submit(job) {
        if (job.kind === "caption") { job.source = imageUrl(job.source); job.style = captionOptions(job.style); }
        if (job.kind === "video" && ((job.limit !== undefined && ![20, 50, 100].some(value => job.limit === value * 1024 * 1024)) || (job.mode !== undefined && !["gif", "video"].includes(job.mode)))) fail("Invalid video options.");
        if (!this.online()) fail("The music service is offline. Try again after it reconnects.");
        if (this.jobs.size >= 15) fail("The music service is busy. Try again shortly.");
        if (this.jobs.has(job.id)) fail("This music request is already being handled.");
        const voice = !["video", "caption"].includes(job.kind), previous = this.channels.get(job.guild);
        if (voice && previous && previous !== job.channel) fail("Sonata is already using another voice channel in this server.");
        if (voice) this.channels.set(job.guild, job.channel);
        return new Promise(resolve => {
            const timer = setTimeout(() => { this.jobs.delete(job.id); if (voice && !this.active.has(job.guild) && ![...this.jobs.values()].some(value => value.job.guild === job.guild && !["video", "caption"].includes(value.job.kind))) this.channels.delete(job.guild); resolve({ title: "Request timed out", description: "The service did not confirm this request. Try again shortly." }); }, job.kind === "video" ? 120_000 : 60_000);
            this.jobs.set(job.id, { job: { ...job, expires: Date.now() + (job.kind === "video" ? 115_000 : 55_000) }, resolve, timer, sent: false });
            this.waiter?.();
        });
    }
    poll(botId, ready) {
        this.lastPoll = Date.now();
        const jobs = [];
        for (const value of this.jobs.values()) if (!value.sent) { value.sent = true; jobs.push(value.job); }
        const events = this.events.splice(0).filter(value => Date.now() - value.at < 60_000).map(value => ({ type: value.type, data: value.data }));
        return { generation: this.generation, botId, ready, jobs, events };
    }
    async waitPoll(state) {
        const batch = this.poll(...state());
        if (!batch.ready || batch.jobs.length || batch.events.length) return batch;
        this.waiter?.();
        return new Promise(resolve => {
            const done = () => { clearTimeout(timer); if (this.waiter === done) this.waiter = null; resolve(this.poll(...state())); };
            const timer = setTimeout(done, 10_000); this.waiter = done;
        });
    }
    event(type, data, botId) {
        if (!this.channels.has(data.guild_id) || (type === "VOICE_STATE_UPDATE" && data.user_id !== botId)) return;
        this.events.push({ type, data: type === "VOICE_STATE_UPDATE" ? { guild_id: data.guild_id, user_id: data.user_id, session_id: data.session_id, channel_id: data.channel_id } : { guild_id: data.guild_id, token: data.token, endpoint: data.endpoint }, at: Date.now() });
        if (this.events.length > 100) this.events.shift();
        if (type === "VOICE_STATE_UPDATE") {
            if (data.channel_id) { this.channels.set(data.guild_id, data.channel_id); this.active.add(data.guild_id); }
            else { this.channels.delete(data.guild_id); this.active.delete(data.guild_id); }
        }
        this.waiter?.();
    }
    complete(body, binary) {
        if (!isId(body.id) || typeof body.title !== "string" || typeof body.description !== "string" || body.title.length > 250 || body.description.length > 1800) fail("Invalid music result.");
        const pending = this.jobs.get(body.id);
        if (!pending) return;
        if (pending.job.kind === "caption") {
            if (binary !== undefined && (!(binary instanceof Uint8Array) || binary.length > IMAGE_OUTPUT_LIMIT || body.format !== pending.job.style.format || imageFormat(binary) !== body.format || (body.format === "gif" && binary.at(-1) !== 59))) fail("Invalid rendered image.");
            clearTimeout(pending.timer); this.jobs.delete(body.id);
            pending.resolve({ title: body.title, description: body.description, ...(binary ? { image: binary, format: body.format } : {}) });
            return;
        }
        const gif = body.format === "gif";
        if (binary !== undefined && (pending.job.kind !== "video" || !(binary instanceof Uint8Array) || binary.length < 12 || binary.length > Math.min(VIDEO_MAX_BYTES, pending.job.limit ?? videoLimit()) || (gif ? binary[0] !== 71 || binary[1] !== 73 || binary[2] !== 70 || binary[3] !== 56 || ![55, 57].includes(binary[4]) || binary[5] !== 97 || binary.at(-1) !== 59 : binary[4] !== 102 || binary[5] !== 116 || binary[6] !== 121 || binary[7] !== 112))) fail("Invalid video file.");
        clearTimeout(pending.timer); this.jobs.delete(body.id);
        if (pending.job.kind !== "video" && body.disconnected === true && ![...this.jobs.values()].some(value => value.job.guild === pending.job.guild && !["video", "caption"].includes(value.job.kind))) this.channels.delete(pending.job.guild);
        if (body.video != null && (pending.job.kind !== "video" || typeof body.video !== "string" || body.video.length > 11_184_812 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.video))) { pending.resolve({ title: "Video not completed", description: "The video service returned an invalid file." }); return; }
        const stats = {};
        for (const key of ["views", "likes", "comments", "shares"]) {
            const value = body.stats?.[key];
            if ((Number.isSafeInteger(value) && value >= 0) || (typeof value === "string" && value.length <= 24 && /^\d[\d,.]*[KMB]?$/i.test(value))) stats[key] = value;
        }
        const date = typeof body.published === "string" && body.published.length <= 30 ? Date.parse(body.published) : NaN;
        const author = socialAuthor(body.author);
        const p = body.pagination;
        const pagination = pending.job.name === "queue" && Number.isInteger(p?.page) && Number.isInteger(p.pages) && p.page >= 1 && p.page <= p.pages && p.pages <= 7 ? { page: p.page, pages: p.pages } : undefined;
        pending.resolve({ title: body.title, description: body.description, ...(pending.job.kind === "video" && body.noMedia === true && !binary && !body.video ? { noMedia: true } : {}), ...(pagination ? { pagination } : {}), ...(pending.job.kind === "video" && (binary || body.video) ? { video: binary || body.video, format: gif && binary ? "gif" : "mp4", isGif: body.isGif === true || (gif && !!binary), stats, ...(author ? { author } : {}), ...(Number.isFinite(date) && date >= 946684800000 && date <= Date.now() + 86400000 ? { published: new Date(date).toISOString() } : {}) } : {}) });
    }
    voice(body, send) {
        const d = body.d;
        if (body.op !== 4 || !isId(d?.guild_id) || !this.channels.has(d.guild_id) || (d.channel_id !== null && this.channels.get(d.guild_id) !== d.channel_id) || d.self_mute !== false || d.self_deaf !== true) fail("Invalid music voice request.");
        send({ op: 4, d: { guild_id: d.guild_id, channel_id: d.channel_id, self_mute: false, self_deaf: true } });
    }
    reset() {
        this.generation = crypto.randomUUID(); this.events = []; this.channels.clear(); this.active.clear(); this.lastPoll = 0;
        for (const value of this.jobs.values()) { clearTimeout(value.timer); value.resolve({ title: "Music disconnected", description: "Sonata's voice connection restarted. Start playback again once the service reconnects." }); }
        this.jobs.clear();
        this.waiter?.(); this.lastPoll = 0;
    }
}
