/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

import { COMMANDS, expandAlias, parsePrefix, parseSlash, slashCommands } from "./commands.mjs";
import { communityEvent } from "./communityEvents.mjs";
import { discordApi, embed, inviteUrl, isId, replyPayload } from "./discord.mjs";
import { helpInteraction } from "./help.mjs";
import { runDueJobs } from "./jobs.mjs";
import { executeCommand, perform } from "./moderation.mjs";
import { honeypotEvent } from "./honeypot.mjs";
import { voiceRoomEvent } from "./voiceRooms.mjs";
import { maintainJail } from "./restrictions.mjs";
import { botStore } from "./store.mjs";
import { MusicBridge } from "./musicBridge.mjs";
import { MUSIC_NAMES } from "./musicCommands.mjs";
import { protectionEvent } from "./protection.mjs";
import { actorId, genuineControl } from "./interactionUI.mjs";
import { featureAction, featureForm } from "./featureInteractions.mjs";
import { memberActivity } from "./levels.mjs";
import { dashboardRequest, enforceGuildBlock, guildEvent } from "./dashboard.mjs";
import { recoveryEvent } from "./roleRecovery.mjs";
import { musicAudienceEvent } from "./musicPolicy.mjs";
import { eventLog, rememberLogEvent } from "./eventLogs.mjs";
import { stickyEvent } from "./sticky.mjs";
import { videoSource } from "./videoEmbeds.mjs";
import { nicknameEvent } from "./nicknamePolicy.mjs";

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
        if (url.pathname.startsWith("/dashboard/")) {
            if (!controlAuthorized(request, env.BOT_DASHBOARD_SECRET)) return Response.json({ error: "Not authorized." }, { status: 401, headers });
            return env.BOT.getByName("sonata").fetch(request);
        }
        if (url.pathname.startsWith("/music/")) {
            if (!controlAuthorized(request, env.MUSIC_BRIDGE_SECRET)) return Response.json({ error: "Not authorized." }, { status: 401, headers });
            if (!((request.method === "GET" && url.pathname === "/music/poll") || (request.method === "POST" && ["/music/voice", "/music/result"].includes(url.pathname)))) return Response.json({ error: "Not found." }, { status: 404, headers });
            return env.BOT.getByName("sonata").fetch(request);
        }
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
        this.presenceTimer = null; this.presenceSentAt = 0; this.presenceCount = -1;
        this.ready = false; this.acked = true; this.session = {}; this.paused = false; this.nextConnect = 0; this.failures = 0;
        this.eventCache = { messages: new Map(), channels: new Map() };
        this.tasks = Promise.resolve(); this.queued = 0; this.cooldowns = new Map(); this.lastJobs = 0;
        this.music = new MusicBridge();
        ctx.blockConcurrencyWhile(async () => {
            this.session = await ctx.storage.get("session") ?? {};
            this.paused = await ctx.storage.get("paused") ?? false;
            this.nextConnect = await ctx.storage.get("nextConnect") ?? 0;
            this.failures = await ctx.storage.get("failures") ?? 0;
        });
    }

    presence() {
        const count = this.store.get("SELECT COUNT(*) AS n FROM bot_guilds WHERE active=1").n;
        return { since: null, activities: [{ name: "Custom Status", type: 4, state: `harmonizing ${count} server${count === 1 ? "" : "s"}` }], status: "dnd", afk: false };
    }
    updatePresence(force = false) {
        if (!this.ready) return;
        const count = this.store.get("SELECT COUNT(*) AS n FROM bot_guilds WHERE active=1").n;
        if (!force && count === this.presenceCount) return;
        const delay = Math.max(0, 5000 - (Date.now() - this.presenceSentAt));
        if (!force && delay) { if (!this.presenceTimer) this.presenceTimer = setTimeout(() => { this.presenceTimer = null; this.updatePresence(); }, delay); return; }
        clearTimeout(this.presenceTimer); this.presenceTimer = null;
        this.send(this.socket, { op: 3, d: this.presence() }); this.presenceCount = count; this.presenceSentAt = Date.now();
    }
    status() { return { version: this.env.VERSION?.id || "local", connected: this.ready, paused: this.paused, queued: this.queued, commandCount: COMMANDS.length, nicknamePolicies: true, commandInsights: true, botRoleGrants: true, mediaReplies: true, interactiveHelp: true, prefixReplyMode: "final", musicOnline: this.music.online(), activity: this.ready ? this.presence().activities[0] : null, presenceStatus: this.ready ? "dnd" : null, applicationId: this.env.DISCORD_APPLICATION_ID, botId: this.session.userId ?? null, nextConnectionAttempt: this.nextConnect || null, lastOpcode: this.lastOpcode ?? null, heartbeatAcknowledged: this.acked }; }

    close(socket, reason) { this.localCloseReason = reason; socket.close(4000, reason); }

    async execute(command) {
        const response = await executeCommand(command, this.store, this.api, this.session.userId, this.music);
        if (this.ready && command.name === "role" && command.sub === "recovery" && response.embeds?.[0]?.title === "Role recovery saved" && this.store.settings(command.guild).roleRecovery) this.send(this.socket, { op: 8, d: { guild_id: command.guild, query: "", limit: 0 } });
        return response;
    }

    async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path.startsWith("/dashboard/")) {
            try { return Response.json(await dashboardRequest(request, this, command => this.enqueue(() => this.execute(command))), { headers: { "Cache-Control": "no-store" } }); }
            catch (error) { return Response.json({ error: error.message }, { status: error.status || 400, headers: { "Cache-Control": "no-store" } }); }
        }
        if (path.startsWith("/music/")) {
            const headers = { "Cache-Control": "no-store" };
            if (path === "/music/poll") return Response.json(this.music.poll(this.session.userId, this.ready), { headers });
            try {
                let raw = "", size = 0;
                if (request.body) for await (const part of request.body) { size += part.length; if (size > (path === "/music/result" ? 12_000_000 : 8192)) return new Response("Request too large.", { status: 413, headers }); raw += new TextDecoder().decode(part); }
                const body = JSON.parse(raw);
                if (path === "/music/result") this.music.complete(body);
                if (path === "/music/voice") { if (!this.ready) throw new Error("Gateway offline."); this.music.voice(body, value => this.send(this.socket, value)); }
                return Response.json({ ok: true }, { headers });
            } catch { return Response.json({ error: "Invalid music request." }, { status: 400, headers }); }
        }
        if (path === "/stop") {
            this.paused = true; await this.ctx.storage.put("paused", true);
            clearTimeout(this.retryTimer); clearTimeout(this.heartbeat); clearTimeout(this.presenceTimer); this.presenceTimer = null;
            this.socket?.close(1000, "Owner stopped the bot"); this.socket = null; this.ready = false;
            this.session = {}; await this.ctx.storage.delete("session");
            this.music.reset();
        }
        if (path === "/start") {
            this.paused = false; this.nextConnect = 0;
            await this.ctx.storage.put("paused", false); await this.ctx.storage.put("fatal", "");
            await this.connect();
        }
        if (path === "/tick") {
            await this.connect();
            if (this.ready) for (const row of this.store.all("SELECT guild_blacklist.id FROM guild_blacklist JOIN bot_guilds ON bot_guilds.id=guild_blacklist.id WHERE bot_guilds.active=1")) await enforceGuildBlock(this, row.id);
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
            this.socket = null; this.ready = false; clearTimeout(this.heartbeat); clearTimeout(this.presenceTimer); this.presenceTimer = null;
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
                this.acked = false; this.heartbeatSent = Date.now(); this.send(socket, { op: 1, d: this.session.seq ?? null });
                await this.ctx.storage.put("session", this.session);
                this.heartbeat = setTimeout(() => this.ctx.waitUntil(beat()), interval);
            };
            if (this.session.id) this.send(socket, { op: 6, d: { token: this.env.DISCORD_BOT_TOKEN, session_id: this.session.id, seq: this.session.seq ?? null } });
            else this.send(socket, { op: 2, d: { token: this.env.DISCORD_BOT_TOKEN, intents: 33415, properties: { os: "ios", browser: "Discord iOS", device: "Discord iOS" }, large_threshold: 50, presence: this.presence() } });
            clearTimeout(this.heartbeat); this.heartbeat = setTimeout(() => this.ctx.waitUntil(beat()), Math.random() * interval);
        }
        if (packet.op === 11) { this.acked = true; if (Number.isFinite(this.heartbeatSent)) this.gatewayLatency = Date.now() - this.heartbeatSent; }
        if (packet.op === 1) { this.acked = false; this.heartbeatSent = Date.now(); this.send(socket, { op: 1, d: this.session.seq ?? null }); }
        if (packet.op === 7) this.close(socket, "Reconnect requested");
        if (packet.op === 9) { if (!packet.d) { this.session = {}; await this.ctx.storage.delete("session"); } this.close(socket, "Session must reconnect"); }
        if (packet.op !== 0) return;
        if (["READY", "GUILD_CREATE", "GUILD_UPDATE", "GUILD_DELETE"].includes(packet.t)) guildEvent(packet.t, packet.d, this.store);
        if (["GUILD_CREATE", "GUILD_UPDATE"].includes(packet.t) && await enforceGuildBlock(this, packet.d.id)) return;
        if (packet.d.guild_id && this.store.get("SELECT id FROM guild_blacklist WHERE id=?", packet.d.guild_id)) return;
        if (["READY", "GUILD_CREATE", "GUILD_DELETE", "VOICE_STATE_UPDATE"].includes(packet.t)) musicAudienceEvent(packet.t, packet.d, this.store);
        if (["GUILD_CREATE", "GUILD_DELETE", "GUILD_MEMBER_ADD", "GUILD_MEMBER_UPDATE", "GUILD_MEMBER_REMOVE", "GUILD_MEMBERS_CHUNK"].includes(packet.t)) recoveryEvent(packet.t, packet.d, this.store);
        if (packet.t === "GUILD_CREATE" && this.store.settings(packet.d.id).roleRecovery) this.send(socket, { op: 8, d: { guild_id: packet.d.id, query: "", limit: 0 } });
        if (["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(packet.t)) this.music.event(packet.t, packet.d, this.session.userId);
        if (packet.t === "READY") {
            this.session = { id: packet.d.session_id, resumeUrl: packet.d.resume_gateway_url, seq: packet.s, userId: packet.d.user.id };
            this.ready = true; this.nextConnect = 0; this.failures = 0;
            for (const guild of packet.d.guilds) await enforceGuildBlock(this, guild.id);
            await this.ctx.storage.put("session", this.session); await this.ctx.storage.put("fatal", "");
            await this.ctx.storage.put("failures", 0);
        }
        if (packet.t === "RESUMED") { this.ready = true; this.nextConnect = 0; this.failures = 0; await this.ctx.storage.put("failures", 0); for (const row of this.store.all("SELECT id FROM bot_guilds WHERE active=1")) if (this.store.settings(row.id).roleRecovery) this.send(socket, { op: 8, d: { guild_id: row.id, query: "", limit: 0 } }); }
        if (["READY", "RESUMED", "GUILD_CREATE", "GUILD_DELETE"].includes(packet.t)) this.updatePresence(["READY", "RESUMED"].includes(packet.t));
        if (["GUILD_CREATE","MESSAGE_CREATE","MESSAGE_UPDATE","CHANNEL_CREATE","CHANNEL_UPDATE","CHANNEL_DELETE"].includes(packet.t)) {
            const guildId=packet.t==="GUILD_CREATE"?packet.d.id:packet.d.guild_id;
            if(guildId)rememberLogEvent(packet.t,packet.d,this.store.settings(guildId),this.eventCache);
        }
        if (["MESSAGE_DELETE","MESSAGE_DELETE_BULK","GUILD_MEMBER_ADD","GUILD_MEMBER_REMOVE","GUILD_AUDIT_LOG_ENTRY_CREATE"].includes(packet.t)&&packet.d.guild_id&&this.queued<100) {
            const logs=this.store.settings(packet.d.guild_id).eventlogs;
            if(logs&&Object.keys(logs).length)this.enqueue(()=>eventLog(packet.t,{...packet.d,eventId:`${this.session.id}:${packet.s}`},this.store,this.api,this.eventCache,this.session.userId));
        }
        if (packet.t === "MESSAGE_CREATE" && packet.d.guild_id && !packet.d.author.bot && !packet.d.webhook_id) {
            this.ctx.waitUntil(this.command(packet.d, false));
            if (this.queued < 25 && this.store.get("SELECT channel FROM sticky_messages WHERE channel=?", packet.d.channel_id)) this.enqueue(() => stickyEvent(packet.d, this.store, this.api));
        }
        if (packet.t === "INTERACTION_CREATE" && packet.d.type === 2 && packet.d.guild_id) this.ctx.waitUntil(this.command(packet.d, true));
        if (packet.t === "INTERACTION_CREATE" && [3, 5].includes(packet.d.type)) this.ctx.waitUntil(this.component(packet.d));
        if (packet.t === "MESSAGE_CREATE" && packet.d.guild_id && !packet.d.author.bot && !packet.d.webhook_id && this.queued < 50) this.enqueue(() => memberActivity(packet.d, this.store, this.api, this.session.userId, this.cooldowns));
        if (packet.t === "GUILD_MEMBER_REMOVE") this.store.run("DELETE FROM afk WHERE guild=? AND user=?", packet.d.guild_id, packet.d.user.id);
        if (["GUILD_CREATE", "GUILD_MEMBER_ADD", "GUILD_AUDIT_LOG_ENTRY_CREATE", "VOICE_STATE_UPDATE"].includes(packet.t)) {
            const guildId = packet.t === "GUILD_CREATE" ? packet.d.id : packet.d.guild_id, settings = this.store.settings(guildId);
            if (this.queued < 100 && ((packet.t === "GUILD_MEMBER_ADD" && settings.antiraid?.enabled) || (packet.t === "GUILD_AUDIT_LOG_ENTRY_CREATE" && (settings.antinuke?.enabled || Object.keys(settings.eventlogs ?? {}).length)) || (["GUILD_CREATE", "VOICE_STATE_UPDATE"].includes(packet.t) && settings.eventlogs?.voice))) this.enqueue(async () => {
                try { await protectionEvent(packet.t, packet.d, this.store, this.api, this.session.userId, perform); }
                catch { const current = this.store.settings(guildId); current.securityError = "A configured protection could not complete. Review the current member state and Sonata's permissions."; this.store.saveSettings(guildId, current); }
            });
        }
        if (["CHANNEL_CREATE", "GUILD_MEMBER_ADD"].includes(packet.t) && packet.d.guild_id) this.enqueue(() => maintainJail(packet.t, packet.d, this.store, this.api, this.session.userId));
        if (["GUILD_CREATE", "VOICE_STATE_UPDATE", "CHANNEL_DELETE"].includes(packet.t) && (packet.d.guild_id || packet.t === "GUILD_CREATE")) this.enqueue(() => voiceRoomEvent(packet.t, packet.d, this.store, this.api, this.session.userId, this.cooldowns));
        if (packet.t === "MESSAGE_CREATE" && packet.d.guild_id && !packet.d.author.bot && !packet.d.webhook_id && this.store.settings(packet.d.guild_id).honeypots?.[packet.d.channel_id] && this.queued < 25) this.enqueue(() => honeypotEvent(packet.d, this.store, this.api, this.session.userId, perform));
        if ((["MESSAGE_CREATE", "GUILD_MEMBER_ADD", "GUILD_MEMBER_REMOVE"].includes(packet.t) || (packet.t === "GUILD_MEMBER_UPDATE" && packet.d.pending === false && this.store.get("SELECT target FROM onboarding WHERE guild=? AND target=?", packet.d.guild_id, packet.d.user.id))) && packet.d.guild_id && this.queued < 25) {
            const data = packet.d;
            if (packet.t !== "MESSAGE_CREATE" || (!data.author.bot && !data.webhook_id && typeof data.content === "string" && data.content.length <= 100 && Object.hasOwn(this.store.settings(data.guild_id).replies ?? {}, data.content.trim().toLowerCase()))) this.enqueue(() => communityEvent(packet.t, data, this.store, this.api, this.session.userId, this.cooldowns, `event:${this.session.id}:${packet.s}`));
        }
        if (["GUILD_MEMBER_ADD", "GUILD_MEMBER_UPDATE"].includes(packet.t) && packet.d.guild_id && this.store.settings(packet.d.guild_id).nicknamePolicy?.enabled && this.queued < 25) this.enqueue(() => nicknameEvent(packet.d, this.store, this.api, this.session.userId, `nickname:${this.session.id}:${packet.s}`, perform));
    }

    async component(data) {
        if (!this.ready || !isId(actorId(data)) || !isId(data.channel_id)) return;
        const now = Date.now(), key = `help:${data.guild_id ?? "dm"}:${actorId(data)}`, previous = this.cooldowns.get(key);
        const limited = previous && previous.until > now && previous.n >= 10;
        this.cooldowns.set(key, previous && previous.until > now ? { until: previous.until, n: previous.n + 1 } : { until: now + 10_000, n: 1 });
        for (const [key, value] of this.cooldowns) if (value.until < now) this.cooldowns.delete(key);
        if (!data.data.custom_id?.startsWith("snhelp:")) {
            const immediate = body => this.responses(`/interactions/${data.id}/${data.token}/callback`, { method: "POST", body });
            let form;
            try {
                if (limited || this.queued >= 25) throw new Error("Sonata is busy. Wait a few seconds before trying this control again.");
                if (data.type === 3 && !genuineControl(data, this.session.userId)) throw new Error("This control is no longer available.");
                form = featureForm(data, this.store);
            } catch (error) { try { await immediate({ type: 4, data: { ...embed("Control not available", error.message), flags: 64 } }); } catch { return; } return; }
            if (form) { try { await immediate(form); } catch { return; } return; }
            const player = data.data.custom_id?.startsWith("snmusic:"), logs = data.data.custom_id?.startsWith("snlogs:");
            try { await immediate(player || logs ? { type: 6 } : { type: 5, data: { flags: 64 } }); } catch { return; }
            const run = async () => {
                try {
                    if (this.store.get("SELECT id FROM guild_blacklist WHERE id=?", data.guild_id)) throw new Error("This server is blacklisted from Sonata Bot.");
                    const body = await featureAction(data, this.store, this.api, this.session.userId, this.music);
                    await this.responses(`/webhooks/${this.env.DISCORD_APPLICATION_ID}/${data.token}/messages/@original`, { method: "PATCH", body });
                } catch (error) {
                    const body = { ...embed("Control not completed", error.message), ...(player || logs ? { flags: 64 } : {}) };
                    try { await this.responses(`/webhooks/${this.env.DISCORD_APPLICATION_ID}/${data.token}${player || logs ? "" : "/messages/@original"}`, { method: player || logs ? "POST" : "PATCH", body }); } catch { return; }
                }
            };
            if (player) this.ctx.waitUntil(run()); else this.enqueue(run);
            return;
        }
        if (!isId(data.guild_id)) return;
        const body = limited ? { type: 4, data: { ...embed("Slow down", "Wait a few seconds before browsing again."), flags: 64 } } : helpInteraction(data, this.session.userId);
        try { await this.responses(`/interactions/${data.id}/${data.token}/callback`, { method: "POST", body }); } catch { return; }
    }

    async command(data, slash) {
        if (!this.ready) return;
        const actor = slash ? data.member?.user?.id : data.author.id;
        if (!isId(actor) || !isId(data.guild_id) || !isId(data.channel_id)) return;
        let parsed, parsingError, parsingName, automaticVideo = false;
        try {
            if (slash) parsed = parseSlash(data.data, data.data.resolved?.attachments);
            else {
                const settings = this.store.settings(data.guild_id);
                const personal = this.store.get("SELECT prefix FROM user_prefixes WHERE user=?", actor)?.prefix;
                const prefix = [personal, settings.prefix].filter(Boolean).sort((a, b) => b.length - a.length).find(prefix => (data.content ?? "").startsWith(prefix));
                if (!prefix && /^sonata\s+https:\/\//i.test(data.content || "")) parsed = parsePrefix(data.content, "", data.attachments);
                if (prefix) parsed = parsePrefix(expandAlias(data.content ?? "", prefix, settings.aliases), prefix, data.attachments);
            }
        } catch (error) { parsingError = error.message; parsingName = error.commandName; }
        const videoSettings = this.store.settings(data.guild_id);
        if (!parsed && !parsingError && !slash && (videoSettings.videoEmbeds?.[data.channel_id] ?? videoSettings.videoEmbedsAll)) {
            const matches = [...(data.content || "").matchAll(/https:\/\/[^\s<>]+/g)];
            for (const match of matches.slice(0, 3)) { try { const url = videoSource(match[0]); parsed = parseSlash({ name: "sonata", options: [{name:"url",value:url}] }); automaticVideo = true; break; } catch { continue; } }
        }
        if (!parsed && !parsingError) return;
        if (this.store.get("SELECT id FROM requests WHERE id=?", data.id)) return;
        const key = `${data.guild_id}:${actor}`, now = Date.now(), previous = this.cooldowns.get(key);
        if (previous && previous.until > now && previous.n >= 5) {
            if ((parsed || parsingName) && this.store.claim(data.id)) { this.store.usage(data.guild_id, parsed?.name ?? parsingName); this.store.outcome(data.guild_id, parsed ? [parsed.name, parsed.sub].filter(Boolean).join(" ") : parsingName, "rate_limited"); }
            if (slash) try { await this.responses(`/interactions/${data.id}/${data.token}/callback`, { method: "POST", body: { type: 4, data: { ...embed("Slow down", "Wait a few seconds before using another command."), flags: 64 } } }); } catch { return; }
            return;
        }
        this.cooldowns.set(key, previous && previous.until > now ? { until: previous.until, n: previous.n + 1 } : { until: now + 10_000, n: 1 });
        for (const [key, value] of this.cooldowns) if (value.until < now) this.cooldowns.delete(key);
        let apiLatency;
        try {
            const responseStarted = Date.now();
            if (slash) await this.responses(`/interactions/${data.id}/${data.token}/callback`, { method: "POST", body: { type: 5, data: { flags: 64 } } });
            else if (parsed?.name === "ping") await this.responses("/users/@me");
            if (slash || parsed?.name === "ping") apiLatency = Date.now() - responseStarted;
        } catch { return; }
        const respond = body => slash ? this.responses(`/webhooks/${this.env.DISCORD_APPLICATION_ID}/${data.token}/messages/@original`, { method: "PATCH", ...replyPayload(body) }) : this.responses(`/channels/${data.channel_id}/messages`, { method: "POST", ...replyPayload({ ...body, ...(!(parsed?.name === "sonata" && body.files?.length) ? { message_reference: { message_id: data.id, fail_if_not_exists: false } } : {}) }) });
        if (parsingError || this.queued >= 25) {
            if ((parsed || parsingName) && this.store.claim(data.id)) { this.store.usage(data.guild_id, parsed?.name ?? parsingName); this.store.outcome(data.guild_id, parsed ? [parsed.name, parsed.sub].filter(Boolean).join(" ") : parsingName, parsingError ? "invalid" : "busy"); }
            try { await respond(embed("Command not completed", parsingError ?? "Sonata is busy. Try again shortly.")); } catch { return; } return;
        }
        const command = { ...parsed, id: data.id, prefix: !slash, evidence: !slash && ["warn","kick","ban"].includes(parsed.name) ? data.attachments : undefined, reply: !slash ? data.message_reference : undefined, actor, guild: data.guild_id, channel: data.channel_id, latency: { api: apiLatency, gateway: this.gatewayLatency } };
        const run = async () => {
            let response;
            try { response = await this.execute(command); }
            catch (error) { response = embed("Command not completed", error.message); }
            try {
                const { silent, ...payload } = response;
                if (silent && !slash) return;
                const sent = await respond(payload);
                if (!slash && command.name === "sonata" && payload.files?.length && !data.attachments?.length) {
                    const links = [...(data.content || "").matchAll(/https:\/\/[^\s<>]+/g)];
                    if (links.length !== 1 || (automaticVideo && data.content.trim().replace(/^<|>$/g, "") !== links[0][0])) return;
                    try {
                        const original = await this.api(`/channels/${data.channel_id}/messages/${data.id}`, { optional: true });
                        if (original?.author.id === actor && original.content === data.content && !original.attachments?.length) await this.api(`/channels/${data.channel_id}/messages/${data.id}`, { method: "DELETE", optional: true, reason: "Sonata uploaded this video." });
                    } catch {
                        payload.embeds[0].footer.text += " • Original link could not be removed";
                        await this.responses(`/channels/${data.channel_id}/messages/${sent.id}`, { method: "PATCH", body: { embeds: payload.embeds } });
                    }
                }
            } catch { return; }
        };
        if (MUSIC_NAMES.includes(command.name) || command.name === "sonata") this.ctx.waitUntil(run());
        else this.enqueue(run);
    }
}
