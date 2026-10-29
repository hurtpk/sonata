/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Buffer } from "node:buffer";
import { COMMANDS, parseSlash } from "./commands.mjs";
import { channelPermissions, fail, isId, memberPermissions, PERMS } from "./discord.mjs";
import { moderationStats } from "./memberTools.mjs";
import { dashboardAccess, dashboardExtra } from "./dashboardAccess.mjs";
import { commandInsights } from "./commandInsights.mjs";

export const DASHBOARD_ACTIONS = {
    nicknamepolicy: ["setup", "block", "unblock", "exempt", "check", "off", "view"], fakepermissions: ["grant", "revoke", "view"], commandsettings: ["disable", "enable", "view"], commandstats: ["summary", "commands", "failures"],
    musicsettings: ["djrole", "cleardj", "mode", "votes"], role: ["recovery", "restore"],
    settings: ["prefix", "modlog", "dm", "videoembeds"], antiraid: ["setup", "off", "clear"], antinuke: ["setup", "off", "trust", "restore"], eventlog: ["set", "off"], escalation: ["set", "remove", "expiry", "exempt"], appeals: ["setup", "off"],
    verification: ["setup", "panel", "approve", "off"], levels: ["enable", "disable", "reward", "unreward", "reset"], alias: ["set", "remove"], automod: ["wordsadd", "wordsremove", "mentions", "spam", "regexadd", "regexremove", "profileadd", "profileremove", "preview", "exemptrole", "exemptchannel"],
    ticket: ["setup", "panel", "off", "claim", "close", "reopen", "transcript", "archive", "categoryadd", "categoryremove", "priority", "assign", "idle"], lockdown: ["start", "restore"],
};
export async function requestJson(request) {
    const chunks = []; let size = 0;
    if (request.body) for await (const chunk of request.body) { size += chunk.length; if (size > 16_384) fail("This request is too large."); chunks.push(chunk); }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail("Send a valid JSON object."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Send a JSON object.");
    return value;
}
export function guildEvent(type, data, store) {
    if (type === "READY") {
        store.run("UPDATE bot_guilds SET active=0");
        for (const guild of data.guilds) {
            const old = store.get("SELECT * FROM bot_guilds WHERE id=?", guild.id);
            store.run("INSERT INTO bot_guilds VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET active=1", guild.id, old?.data || JSON.stringify({ id: guild.id, name: "Loading server", unavailable: true }), old?.joined || Date.now(), Date.now());
        }
        return;
    }
    const old = store.get("SELECT * FROM bot_guilds WHERE id=?", data.id), details = old ? JSON.parse(old.data) : { id: data.id };
    if (type === "GUILD_DELETE") { if (data.unavailable) { details.unavailable = true; store.run("UPDATE bot_guilds SET data=?,seen=? WHERE id=?", JSON.stringify(details), Date.now(), data.id); } else store.run("UPDATE bot_guilds SET active=0,seen=? WHERE id=?", Date.now(), data.id); return; }
    for (const key of ["id", "name", "icon", "owner_id", "member_count", "features", "premium_tier", "verification_level", "preferred_locale", "description"]) if (Object.hasOwn(data, key)) details[key] = data[key];
    details.unavailable = !!data.unavailable;
    store.run("INSERT INTO bot_guilds VALUES (?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,seen=excluded.seen,active=1", data.id, JSON.stringify(details), old?.joined || Date.now(), Date.now());
}
const servers = store => store.all("SELECT * FROM bot_guilds WHERE active=1 ORDER BY joined DESC").map(row => ({ ...JSON.parse(row.data), firstSeen: row.joined, lastUpdated: row.seen }));

async function leaveServer(bot, id) {
    await bot.api(`/users/@me/guilds/${id}`, { method: "DELETE", optional: true });
    bot.store.run("UPDATE bot_guilds SET active=0,seen=? WHERE id=?", Date.now(), id);
    bot.store.run("UPDATE jobs SET state='cancelled',detail='Bot removed from this server by its owner.' WHERE guild=? AND state='pending'", id);
    bot.store.run("UPDATE guild_blacklist SET last_error='' WHERE id=?", id);
    bot.music?.event("VOICE_STATE_UPDATE", { guild_id: id, user_id: bot.session.userId, session_id: "", channel_id: null }, bot.session.userId);
}

export async function enforceGuildBlock(bot, id) {
    if (!bot.store.get("SELECT id FROM guild_blacklist WHERE id=?", id)) return false;
    try { await leaveServer(bot, id); }
    catch (error) { bot.store.run("UPDATE guild_blacklist SET last_error=? WHERE id=?", String(error.message).slice(0, 500), id); }
    return true;
}

export async function dashboardRequest(request, bot, execute) {
    const url = new URL(request.url), path = url.pathname.slice(11), actor = request.headers.get("x-sonata-user"), store = bot.store, api = bot.api;
    if (!isId(actor)) throw Object.assign(new Error("Sign in with Discord first."), { status: 401 });
    const grants = (request.headers.get("x-sonata-permissions") || "").split(",");
    const owner = String(bot.env.DASHBOARD_OWNER_IDS ?? "779172192461783110").split(",").includes(actor);
    const scope = path === "owner/users" ? "users" : path === "owner/health" ? "health" : path === "owner/action" ? "serverAccess" : "servers";
    if (path.startsWith("owner") && !owner && !grants.includes(scope)) throw Object.assign(new Error("Only the bot owner can access this view."), { status: 403 });
    if (path === "owner/health" && request.method === "GET") return { status: bot.status(), error: await bot.ctx?.storage.get("fatal") || "", lastDisconnect: await bot.ctx?.storage.get("disconnect") || null, failures: store.all("SELECT name,SUM(n) AS n FROM command_results WHERE outcome IN ('failed','needs_review') AND day>=? GROUP BY name ORDER BY n DESC LIMIT 10", new Date(Date.now()-86400000).toISOString().slice(0,10)), pendingJobs: store.get("SELECT COUNT(*) AS n FROM jobs WHERE state='pending'").n, stickyErrors: store.all("SELECT guild,channel,error FROM sticky_messages WHERE error<>'' LIMIT 10") };
    if (path === "owner/users" && request.method === "GET") {
        const ids = [...new Set((url.searchParams.get("ids") || "").split(","))];
        if (!ids.length || ids.length > 20 || !ids.every(isId)) throw Object.assign(new Error("Choose up to 20 valid Discord user IDs."), { status: 400 });
        const users = [];
        for (const id of ids) {
            try {
                const user = await api(`/users/${id}`, { optional: true });
                users.push({ id, avatar: /^(?:a_)?[a-f0-9]{32}$/i.test(user?.avatar ?? "") ? user.avatar : "", discriminator: /^\d{1,4}$/.test(user?.discriminator ?? "") ? user.discriminator : "0" });
            } catch { continue; }
        }
        return { users };
    }
    if (path === "owner" && request.method === "GET") return { status: bot.status(), servers: servers(store), blacklist: store.all("SELECT guild_blacklist.*,bot_guilds.data AS server_data FROM guild_blacklist LEFT JOIN bot_guilds ON bot_guilds.id=guild_blacklist.id ORDER BY at DESC").map(({ server_data, ...row }) => ({ ...row, name: server_data ? JSON.parse(server_data).name : "Unknown server" })), totals: { commands: store.get("SELECT COALESCE(SUM(uses),0) AS n FROM command_usage").n, cases: store.get("SELECT COUNT(*) AS n FROM cases").n, openTickets: store.get("SELECT COUNT(*) AS n FROM tickets WHERE state='open'").n }, commands: COMMANDS.length };
    if (path === "owner/action" && request.method === "POST") {
        const input = await requestJson(request);
        if (!isId(input.guild) || !["leave", "blacklist", "unblacklist"].includes(input.action) || (input.reason != null && (typeof input.reason !== "string" || input.reason.length > 300))) throw Object.assign(new Error("Choose a server ID, an action and a note of up to 300 characters."), { status: 400 });
        if (input.action === "unblacklist") { store.run("DELETE FROM guild_blacklist WHERE id=?", input.guild); return { ok: true }; }
        if (input.action === "blacklist") {
            store.run("INSERT INTO guild_blacklist (id,actor,reason,at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET actor=excluded.actor,reason=excluded.reason,at=excluded.at", input.guild, actor, input.reason?.trim() || "", Date.now());
            if (store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", input.guild)) await enforceGuildBlock(bot, input.guild);
            return { ok: true, warning: store.get("SELECT last_error FROM guild_blacklist WHERE id=?", input.guild).last_error };
        }
        if (!store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", input.guild)) throw Object.assign(new Error("Sonata is not currently in this server."), { status: 404 });
        await leaveServer(bot, input.guild);
        return { ok: true };
    }
    if (["access", "designer"].includes(path)) {
        const input = request.method === "POST" ? await requestJson(request) : { guild: url.searchParams.get("guild") };
        if (!isId(input.guild) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", input.guild) || store.get("SELECT id FROM guild_blacklist WHERE id=?", input.guild)) fail("Choose an installed, allowed server.");
        const context = await dashboardAccess(api, input.guild, actor, store);
        return dashboardExtra(path, request, input, context, bot);
    }
    if (path === "servers" && request.method === "GET") {
        const allowed = [];
        for (const server of servers(store)) try { await dashboardAccess(api, server.id, actor, store); allowed.push(server); } catch { continue; }
        return { servers: allowed };
    }
    if (path === "forms" && request.method === "GET") return { forms: COMMANDS.filter(value => DASHBOARD_ACTIONS[value.name]).map(value => ({ name: value.name, options: value.options.filter(sub => DASHBOARD_ACTIONS[value.name].includes(sub.name)) })) };
    if (["server", "owner/server"].includes(path) && request.method === "GET") {
        const id = url.searchParams.get("guild");
        if (!isId(id) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", id)) throw Object.assign(new Error("Sonata is not currently in this server."), { status: 404 });
        let context;
        try { context = await dashboardAccess(api, id, actor, store); } catch (error) { if (path !== "owner/server") throw error; }
        const guild = context?.guild ?? await api(`/guilds/${id}?with_counts=true`), botMember = await api(`/guilds/${id}/members/${bot.session.userId}`), data = { guild, botJoined: botMember.joined_at, manageable: !!context, stats: moderationStats(store, id), insights: commandInsights(store, id), status: bot.status() };
        if (context) {
            const channels = await api(`/guilds/${id}/channels`), permission = memberPermissions(context.actor, context.roles, guild), moderation = !!(permission & (PERMS.ADMIN | PERMS.TIMEOUT | PERMS.BAN));
            data.channels = channels.filter(channel => channelPermissions(context.actor, context.roles, guild, channel) & PERMS.VIEW).map(({ id, name, type }) => ({ id, name, type })); data.roles = context.roles.map(({ id, name, position }) => ({ id, name, position })); data.settings = store.settings(id);
            data.serverOwner = actor === guild.owner_id; data.dashboardAccess = data.serverOwner ? context.policy : undefined; data.administrator = !!(permission & PERMS.ADMIN); data.commandNames = COMMANDS.flatMap(value => [value.name, ...value.options.filter(sub => sub.type === 1).map(sub => `${value.name} ${sub.name}`)]);
            data.cases = moderation ? store.all("SELECT * FROM cases WHERE guild=? ORDER BY n DESC LIMIT 30", id) : [];
            const visible = new Set(data.channels.map(value => value.id));
            data.tickets = store.all("SELECT tickets.*,ticket_details.data AS details FROM tickets LEFT JOIN ticket_details ON ticket_details.id=tickets.id WHERE guild=? ORDER BY at DESC LIMIT 50", id).filter(row => visible.has(row.channel));
        }
        return data;
    }
    if (path === "action" && request.method === "POST") {
        const input = await requestJson(request);
        if (!isId(input.guild) || !isId(input.channel) || !DASHBOARD_ACTIONS[input.name]?.includes(input.sub)) throw Object.assign(new Error("Choose an available dashboard action and server channel."), { status: 400 });
        if (store.get("SELECT id FROM guild_blacklist WHERE id=?", input.guild)) throw Object.assign(new Error("This server is blacklisted from Sonata Bot."), { status: 403 });
        await dashboardAccess(api, input.guild, actor, store);
        if (!input.options || typeof input.options !== "object" || Array.isArray(input.options)) fail("Choose the action options.");
        const command = { ...parseSlash({ name: input.name, options: [{ name: input.sub, options: Object.entries(input.options).map(([name, value]) => ({ name, value })) }] }), id: `dashboard:${crypto.randomUUID()}`, guild: input.guild, channel: input.channel, actor };
        return { result: await execute(command) };
    }
    throw Object.assign(new Error("This dashboard action was not found."), { status: 404 });
}
