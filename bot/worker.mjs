/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

import { COMMANDS, parsePrefix, parseSlash, slashCommands } from "./commands.mjs";
import { discordApi, embed, inviteUrl, isId } from "./discord.mjs";
import { runDueJobs } from "./jobs.mjs";
import { executeCommand } from "./moderation.mjs";
import { maintainJail } from "./restrictions.mjs";
import { botStore } from "./store.mjs";

export function controlAuthorized(request, secret) {
    if (typeof secret !== "string" || secret.length < 32) return false;
    const supplied = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${secret}`);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url), configured = isId(env.DISCORD_APPLICATION_ID) && !!env.DISCORD_BOT_TOKEN;
        const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
        if (request.method === "GET" && url.pathname === "/health") return Response.json({ service: "Sonata Bot", configured }, { headers });
        if (request.method === "GET" && url.pathname === "/commands") return Response.json(slashCommands(), { headers });
        if (request.method === "GET" && url.pathname === "/invite") return configured ? new Response(null, { status: 302, headers: { ...headers, Location: inviteUrl(env.DISCORD_APPLICATION_ID) } }) : Response.json({ error: "Sonata Bot is not configured yet." }, { status: 503, headers });
        if (!url.pathname.startsWith("/control/")) return Response.json({ error: "Not found." }, { status: 404, headers });
        if (!controlAuthorized(request, env.BOT_CONTROL_SECRET)) return Response.json({ error: "Not authorized." }, { status: 401, headers });
        if (!configured) return Response.json({ error: "Configure the bot application and token first." }, { status: 503, headers });
        if (!((request.method === "GET" && url.pathname === "/control/status") || (request.method === "POST" && ["/control/start", "/control/stop"].includes(url.pathname)))) return Response.json({ error: "Not found." }, { status: 404, headers });
        return env.BOT.getByName("sonata").fetch(`https://bot.internal/${url.pathname.slice(9)}`, { method: request.method });
    },
    async scheduled(_event, env, ctx) {
        if (isId(env.DISCORD_APPLICATION_ID) && env.DISCORD_BOT_TOKEN) ctx.waitUntil(env.BOT.getByName("sonata").fetch("https://bot.internal/tick", { method: "POST" }));
    },
};

export class SonataBot {
    constructor(ctx, env) {
        this.ctx = ctx; this.env = env;
        this.store = botStore(ctx.storage);
        this.api = discordApi(env.DISCORD_BOT_TOKEN);
        this.responses = discordApi(env.DISCORD_BOT_TOKEN);
        this.socket = null; this.connecting = null; this.heartbeat = null; this.retryTimer = null;
        this.ready = false; this.acked = true; this.session = {}; this.paused = false; this.nextConnect = 0; this.failures = 0;
        this.tasks = Promise.resolve(); this.queued = 0; this.cooldowns = new Map(); this.lastJobs = 0;
        this.prefixes = new Map();
        ctx.blockConcurrencyWhile(async () => {
            this.session = await ctx.storage.get("session") ?? {};
            this.paused = await ctx.storage.get("paused") ?? false;
            this.nextConnect = await ctx.storage.get("nextConnect") ?? 0;
            this.failures = await ctx.storage.get("failures") ?? 0;
        });
    }

    status() { return { connected: this.ready, paused: this.paused, queued: this.queued, commandCount: COMMANDS.length, applicationId: this.env.DISCORD_APPLICATION_ID, botId: this.session.userId ?? null, nextConnectionAttempt: this.nextConnect || null, lastOpcode: this.lastOpcode ?? null, heartbeatAcknowledged: this.acked }; }

    close(socket, reason) { this.localCloseReason = reason; socket.close(4000, reason); }

    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/stop") {
            this.paused = true; await this.ctx.storage.put("paused", true);
            clearTimeout(this.retryTimer); clearTimeout(this.heartbeat);
            this.socket?.close(1000, "Owner stopped the bot"); this.socket = null; this.ready = false;
            this.session = {}; await this.ctx.storage.delete("session");
        }
        if (path === "/start") {
            this.paused = false; this.nextConnect = 0;
            await this.ctx.storage.put("paused", false); await this.ctx.storage.put("fatal", "");
            await this.connect();
        }
        if (path === "/tick") {
            await this.connect();
            if (this.ready && Date.now() - this.lastJobs > 30_000) { this.lastJobs = Date.now(); this.enqueue(() => runDueJobs(this.store, this.api, this.session.userId)); }
            if (Math.random() < 0.02) this.store.cleanup();
        }
        return Response.json({ ...this.status(), error: await this.ctx.storage.get("fatal") ?? null, lastDisconnect: await this.ctx.storage.get("disconnect") ?? null }, { headers: { "Cache-Control": "no-store" } });
    }

    enqueue(task) {
        this.queued++;
        const next = this.tasks.then(task);
        this.tasks = next.catch(() => null).finally(() => { this.queued--; });
        this.ctx.waitUntil(this.tasks);
        return next;
    }

    async connect() {
        if (this.paused || this.socket || Date.now() < this.nextConnect) return;
        if (this.connecting) return this.connecting;
        this.connecting = this.open().catch(async () => { await this.reconnectLater(); }).finally(() => { this.connecting = null; });
        return this.connecting;
    }

    async open() {
        let hostname = "gateway.discord.gg";
        if (this.session.resumeUrl) {
            const url = new URL(this.session.resumeUrl);
            if (url.protocol === "wss:" && /^gateway(?:-[a-z0-9-]+)?\.discord\.gg$/.test(url.hostname)) hostname = url.hostname;
        }
        this.nextConnect = Date.now() + 6000;
        await this.ctx.storage.put("nextConnect", this.nextConnect);
        const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15_000);
        let response;
        try { response = await fetch(`https://${hostname}/?v=10&encoding=json`, { headers: { Upgrade: "websocket" }, redirect: "manual", signal: controller.signal }); }
        finally { clearTimeout(timeout); }
        const socket = response.webSocket;
        if (response.status !== 101 || !socket) throw new Error("Gateway unavailable.");
        this.socket = socket; socket.accept(); this.acked = true; this.localCloseReason = "";
        socket.addEventListener("message", event => {
            if (this.socket !== socket || typeof event.data !== "string" || event.data.length > 4_000_000) return;
            let packet;
            try { packet = JSON.parse(event.data); } catch { this.close(socket, "Invalid gateway response"); return; }
            this.ctx.waitUntil(this.packet(packet, socket).catch(() => { if (this.socket === socket) this.close(socket, "Gateway event failed"); }));
        });
        socket.addEventListener("close", event => {
            if (this.socket !== socket) return;
            this.ctx.waitUntil(this.ctx.storage.put("disconnect", { code: event.code, at: Date.now(), reason: (this.localCloseReason || event.reason || "Discord closed the connection").replaceAll(this.env.DISCORD_BOT_TOKEN, "[redacted]").slice(0, 200), lastOpcode: this.lastOpcode ?? null, heartbeatAcknowledged: this.acked }));
            this.socket = null; this.ready = false; clearTimeout(this.heartbeat);
            if ([4004, 4010, 4011, 4012, 4013, 4014].includes(event.code)) {
                this.paused = true;
                this.ctx.waitUntil(Promise.all([this.ctx.storage.put("paused", true), this.ctx.storage.put("fatal", event.code === 4014 ? "Enable Message Content Intent and Server Members Intent in the Discord Developer Portal, then start the bot again." : `Discord stopped the connection (${event.code}). Check the token, application and Gateway settings.`)]));
            } else if (!this.paused) this.ctx.waitUntil((async () => {
                if ([4007, 4009].includes(event.code)) { this.session = {}; await this.ctx.storage.delete("session"); }
                await this.reconnectLater();
            })());
        });
        socket.addEventListener("error", () => { if (this.socket === socket) this.close(socket, "Gateway connection error"); });
    }

    async reconnectLater() {
        if (this.paused) return;
        const delay = Math.min(300_000, 30_000 * 2 ** Math.min(this.failures++, 4));
        this.nextConnect = Date.now() + delay;
        await this.ctx.storage.put("nextConnect", this.nextConnect);
        await this.ctx.storage.put("failures", this.failures);
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.ctx.waitUntil(this.connect()), delay + 1000);
    }

    send(socket, value) { if (socket === this.socket && socket.readyState === 1) socket.send(JSON.stringify(value)); }

    async packet(packet, socket) {
        if (socket !== this.socket) return;
        this.lastOpcode = packet.op;
        if (Number.isInteger(packet.s)) this.session.seq = packet.s;
        if (packet.op === 10) {
            const interval = packet.d?.heartbeat_interval;
            if (!Number.isFinite(interval) || interval < 1000 || interval > 120_000) { this.close(socket, "Invalid heartbeat interval"); return; }
            const beat = async () => {
                if (socket !== this.socket) return;
                if (!this.acked) { this.close(socket, "Heartbeat not acknowledged"); return; }
                this.acked = false; this.send(socket, { op: 1, d: this.session.seq ?? null });
                await this.ctx.storage.put("session", this.session);
                this.heartbeat = setTimeout(() => this.ctx.waitUntil(beat()), interval);
            };
            if (this.session.id) this.send(socket, { op: 6, d: { token: this.env.DISCORD_BOT_TOKEN, session_id: this.session.id, seq: this.session.seq ?? null } });
            else this.send(socket, { op: 2, d: { token: this.env.DISCORD_BOT_TOKEN, intents: 33283, properties: { os: "linux", browser: "Sonata", device: "Sonata" }, large_threshold: 50 } });
            clearTimeout(this.heartbeat); this.heartbeat = setTimeout(() => this.ctx.waitUntil(beat()), Math.random() * interval);
        }
        if (packet.op === 11) this.acked = true;
        if (packet.op === 1) { this.acked = false; this.send(socket, { op: 1, d: this.session.seq ?? null }); }
        if (packet.op === 7) this.close(socket, "Reconnect requested");
        if (packet.op === 9) { if (!packet.d) { this.session = {}; await this.ctx.storage.delete("session"); } this.close(socket, "Session must reconnect"); }
        if (packet.op !== 0) return;
        if (packet.t === "READY") {
            this.session = { id: packet.d.session_id, resumeUrl: packet.d.resume_gateway_url, seq: packet.s, userId: packet.d.user.id };
            this.ready = true; this.nextConnect = 0; this.failures = 0;
            await this.ctx.storage.put("session", this.session); await this.ctx.storage.put("fatal", "");
            await this.ctx.storage.put("failures", 0);
        }
        if (packet.t === "RESUMED") { this.ready = true; this.nextConnect = 0; this.failures = 0; await this.ctx.storage.put("failures", 0); }
        if (packet.t === "MESSAGE_CREATE" && packet.d.guild_id && !packet.d.author.bot && !packet.d.webhook_id) this.ctx.waitUntil(this.command(packet.d, false));
        if (packet.t === "INTERACTION_CREATE" && packet.d.type === 2 && packet.d.guild_id) this.ctx.waitUntil(this.command(packet.d, true));
        if (["CHANNEL_CREATE", "GUILD_MEMBER_ADD"].includes(packet.t) && packet.d.guild_id) this.enqueue(() => maintainJail(packet.t, packet.d, this.store, this.api, this.session.userId));
    }

    async command(data, slash) {
        if (!this.ready) return;
        const actor = slash ? data.member?.user?.id : data.author.id;
        if (!isId(actor) || !isId(data.guild_id) || !isId(data.channel_id)) return;
        let parsed, parsingError;
        try {
            if (!this.prefixes.has(data.guild_id)) this.prefixes.set(data.guild_id, this.store.settings(data.guild_id).prefix);
            parsed = slash ? parseSlash(data.data, data.data.resolved?.attachments) : parsePrefix(data.content ?? "", this.prefixes.get(data.guild_id), data.attachments);
        } catch (error) { parsingError = error.message; }
        if (!parsed && !parsingError) return;
        if (this.store.get("SELECT id FROM requests WHERE id=?", data.id)) return;
        const key = `${data.guild_id}:${actor}`, now = Date.now(), previous = this.cooldowns.get(key);
        if (previous && previous.until > now && previous.n >= 5) {
            if (slash) try { await this.responses(`/interactions/${data.id}/${data.token}/callback`, { method: "POST", body: { type: 4, data: { ...embed("Slow down", "Wait a few seconds before using another command."), flags: 64 } } }); } catch { return; }
            return;
        }
        this.cooldowns.set(key, previous && previous.until > now ? { until: previous.until, n: previous.n + 1 } : { until: now + 10_000, n: 1 });
        for (const [key, value] of this.cooldowns) if (value.until < now) this.cooldowns.delete(key);
        let reply;
        try {
            if (slash) await this.responses(`/interactions/${data.id}/${data.token}/callback`, { method: "POST", body: { type: 5, data: { flags: 64 } } });
            else reply = await this.responses(`/channels/${data.channel_id}/messages`, { method: "POST", body: { ...embed("Sonata", "Checking this command…"), message_reference: { message_id: data.id, fail_if_not_exists: false } } });
        } catch { return; }
        const respond = body => slash ? this.responses(`/webhooks/${this.env.DISCORD_APPLICATION_ID}/${data.token}/messages/@original`, { method: "PATCH", body }) : this.responses(`/channels/${data.channel_id}/messages/${reply.id}`, { method: "PATCH", body });
        if (parsingError || this.queued >= 25) { try { await respond(embed("Command not completed", parsingError ?? "Sonata is busy. Try again shortly.")); } catch { return; } return; }
        const command = { ...parsed, id: data.id, reply: reply?.id, actor, guild: data.guild_id, channel: data.channel_id };
        this.enqueue(async () => {
            let response;
            try { response = await executeCommand(command, this.store, this.api, this.session.userId); }
            catch (error) { response = embed("Command not completed", error.message); }
            if (command.name === "settings" && command.sub === "prefix") this.prefixes.set(command.guild, this.store.settings(command.guild).prefix);
            try { await respond(response); } catch { return; }
        });
    }
}
