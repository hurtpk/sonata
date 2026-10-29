/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fail, isId } from "./discord.mjs";

export class MusicBridge {
    constructor() { this.generation = crypto.randomUUID(); this.lastPoll = 0; this.jobs = new Map(); this.events = []; this.channels = new Map(); this.active = new Set(); }
    online() { return Date.now() - this.lastPoll < 20_000; }
    submit(job) {
        if (!this.online()) fail("The music service is offline. Try again after it reconnects.");
        if (this.jobs.size >= 15) fail("The music service is busy. Try again shortly.");
        if (this.jobs.has(job.id)) fail("This music request is already being handled.");
        const previous = this.channels.get(job.guild);
        if (job.kind !== "video" && previous && previous !== job.channel) fail("Sonata is already using another voice channel in this server.");
        if (job.kind !== "video") this.channels.set(job.guild, job.channel);
        return new Promise(resolve => {
            const timer = setTimeout(() => { this.jobs.delete(job.id); if (!this.active.has(job.guild) && ![...this.jobs.values()].some(value => value.job.guild === job.guild)) this.channels.delete(job.guild); resolve({ title: "Music request timed out", description: "The voice service did not confirm this request. Check the queue before trying again." }); }, 60_000);
            this.jobs.set(job.id, { job: { ...job, expires: Date.now() + 55_000 }, resolve, timer, sent: false });
        });
    }
    poll(botId, ready) {
        this.lastPoll = Date.now();
        const jobs = [];
        for (const value of this.jobs.values()) if (!value.sent) { value.sent = true; jobs.push(value.job); }
        const events = this.events.splice(0).filter(value => Date.now() - value.at < 60_000).map(value => ({ type: value.type, data: value.data }));
        return { generation: this.generation, botId, ready, jobs, events };
    }
    event(type, data, botId) {
        if (!this.channels.has(data.guild_id) || (type === "VOICE_STATE_UPDATE" && data.user_id !== botId)) return;
        this.events.push({ type, data: type === "VOICE_STATE_UPDATE" ? { guild_id: data.guild_id, user_id: data.user_id, session_id: data.session_id, channel_id: data.channel_id } : { guild_id: data.guild_id, token: data.token, endpoint: data.endpoint }, at: Date.now() });
        if (this.events.length > 100) this.events.shift();
        if (type === "VOICE_STATE_UPDATE") {
            if (data.channel_id) { this.channels.set(data.guild_id, data.channel_id); this.active.add(data.guild_id); }
            else { this.channels.delete(data.guild_id); this.active.delete(data.guild_id); }
        }
    }
    complete(body) {
        if (!isId(body.id) || typeof body.title !== "string" || typeof body.description !== "string" || body.title.length > 250 || body.description.length > 1800) fail("Invalid music result.");
        const pending = this.jobs.get(body.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.jobs.delete(body.id);
        if (pending.job.kind !== "video" && body.disconnected === true && ![...this.jobs.values()].some(value => value.job.guild === pending.job.guild)) this.channels.delete(pending.job.guild);
        if (body.video != null && (pending.job.kind !== "video" || typeof body.video !== "string" || body.video.length > 11_184_812 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.video))) { pending.resolve({ title: "Video not completed", description: "The video service returned an invalid file." }); return; }
        const stats = {};
        for (const key of ["views", "likes", "comments", "shares"]) {
            const value = body.stats?.[key];
            if ((Number.isSafeInteger(value) && value >= 0) || (typeof value === "string" && value.length <= 24 && /^\d[\d,.]*[KMB]?$/i.test(value))) stats[key] = value;
        }
        const date = typeof body.published === "string" && body.published.length <= 30 ? Date.parse(body.published) : NaN;
        pending.resolve({ title: body.title, description: body.description, ...(pending.job.kind === "video" && body.video ? { video: body.video, stats, ...(Number.isFinite(date) && date >= 946684800000 && date <= Date.now() + 86400000 ? { published: new Date(date).toISOString() } : {}) } : {}) });
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
    }
}
