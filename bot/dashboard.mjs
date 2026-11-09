/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ticketPanel } from "./tickets.mjs";
import { identifyModerator, withModerator } from "./actionAttribution.mjs";
import { ROLE_BODY_LIMIT, serverManager } from "./serverManager.mjs";
import { perform } from "./moderation.mjs";
import { setupLogging } from "./loggingSetup.mjs";
import { embed, withEmbedColor } from "./discord.mjs";
import { featureGroupRequest } from "./featureGroups.mjs";
import { commandConflicts, setupPreset } from "./setupTools.mjs";
import { checkOperations, ownerConsole, requireBotUser } from "./ownerConsole.mjs";
import { reference } from "./commandReference.mjs";
import { Buffer } from "node:buffer";
import { COMMANDS, parseSlash, slashName } from "./commands.mjs";
import { channelPermissions, fail, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { moderationStats } from "./memberTools.mjs";
import { dashboardAccess, dashboardExtra } from "./dashboardAccess.mjs";
import { commandInsights } from "./commandInsights.mjs";
import { commandFailures, submittedCommand } from "./commandFailures.mjs";
import { PROFILE_BODY_LIMIT, readGuildProfile, writeGuildProfile } from "./guildProfile.mjs";

export const DASHBOARD_ACTIONS = {
    prefix: ["set", "remove", "view"], honeypot: ["add", "remove", "exempt", "exemptions", "list"],
    welcome: ["add", "remove", "test", "view", "list", "variables"], goodbye: ["add", "remove", "test", "view", "list", "variables"], autorole: ["add", "remove", "list", "enable", "disable"], autonick: ["set", "off", "view"], joinlogs: ["set", "off", "view"], autoresponder: ["add", "update", "remove", "view", "list"],
    ban: ["run"], tempban: ["run"], unban: ["run"], kick: ["run"], timeout: ["run"], untimeout: ["run"], warn: ["run"], warnings: ["run"], jailsetup: ["run"], jail: ["run"], unjail: ["run"],
    nicknamepolicy: ["setup", "block", "unblock", "exempt", "check", "off", "view"], fakepermissions: ["grant", "revoke", "view"], commandsettings: ["disable", "enable", "view", "rule", "unrule", "rules"], commandstats: ["summary", "commands", "failures"],
    musicsettings: ["djrole", "cleardj", "mode", "votes"], role: ["recovery", "restore", "temp", "audit", "auditbaseline"], rolemenu: ["create", "add", "remove", "post", "list", "delete"], case: ["approvalrule", "approvals", "approve", "reject"],
    settings: ["embedcolor", "prefix", "modlog", "dm", "message", "videoembeds", "starboard", "starboardoff", "snipe", "view"], antiraid: ["setup", "off", "clear"], antinuke: ["setup", "off", "trust", "restore"], eventlog: ["set", "off", "view"], escalation: ["set", "remove", "expiry", "exempt"], appeals: ["setup", "off"],
    verification: ["setup", "panel", "approve", "off"], levels: ["enable", "disable", "reward", "unreward", "reset"], alias: ["set", "remove", "list"], automod: ["filteradd", "filterreply", "filteraction", "filterremove", "filterlist", "filterexempt", "wordsadd", "wordsremove", "allowadd", "allowremove", "mentions", "spam", "regexadd", "regexremove", "profileadd", "profileremove", "preview", "exemptrole", "exemptchannel", "config", "words", "list"],
    ticket: ["setup", "panel", "off", "intake", "claim", "close", "reopen", "transcript", "archive", "rename", "categoryadd", "categoryremove", "priority", "assign", "idle"], lockdown: ["start", "restore"],
};
export async function requestJson(request, limit = 16_384) {
    const chunks = []; let size = 0;
    if (request.body) for await (const chunk of request.body) { size += chunk.length; if (size > limit) throw Object.assign(new Error("This request is too large."), { status: 413 }); chunks.push(chunk); }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { fail("Send a valid JSON object."); }
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Send a JSON object.");
    return value;
}

async function createTicketSpace(input, actorId, bot) {
    const { api, store } = bot;
    if (!isId(input.guild) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", input.guild) || store.get("SELECT id FROM guild_blacklist WHERE id=?", input.guild)) fail("Choose an installed, allowed server.");
    const { guild, roles, actor } = await dashboardAccess(api, input.guild, actorId, store);
    checkOperations(store, { name: "ticket", sub: "create-channel", guild: guild.id });
    const permissions = memberPermissions(actor, roles, guild);
    requirePermission(permissions, PERMS.GUILD | PERMS.CHANNELS);

    const { sub, options } = input;
    const name = typeof options?.name === "string" ? options.name.trim() : "";
    if (!["category", "text"].includes(sub) || !name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
        fail("Enter a channel or category name between 1 and 100 characters.");
    }
    const body = { type: sub === "category" ? 4 : 0, name };
    if (sub === "text" && options.parent) {
        if (!isId(options.parent)) fail("Choose a category in this server.");
        const parent = await api(`/channels/${options.parent}`);
        if (parent.guild_id !== guild.id || parent.type !== 4) fail("Choose a category in this server.");
        requirePermission(channelPermissions(actor, roles, guild, parent), PERMS.VIEW | PERMS.CHANNELS);
        body.parent_id = parent.id;
        body.permission_overwrites = parent.permission_overwrites;
    }
    if (sub === "text" && options.visibility === "staff") {
        requirePermission(permissions, PERMS.ROLES);
        const role = options.role;
        if (!role || role === guild.id || !roles.some(entry => entry.id === role)) fail("Choose a staff role in this server.");
        if (!(permissions & PERMS.ADMIN) && !actor.roles.includes(role)) fail("Choose a staff role you belong to.");
        body.permission_overwrites = [
            { id: guild.id, type: 0, allow: "0", deny: PERMS.VIEW.toString() },
            { id: role, type: 0, allow: (PERMS.VIEW | PERMS.HISTORY).toString(), deny: "0" },
        ];
    } else if (sub === "text" && options.visibility !== "inherit") fail("Choose who can see the channel.");

    const member = await api(`/guilds/${guild.id}/members/${bot.session.userId ?? bot.env.DISCORD_APPLICATION_ID}`);
    requirePermission(memberPermissions(member, roles, guild), PERMS.ADMIN);
    const channel = await api(`/guilds/${guild.id}/channels`, { method: "POST", reason: `Sonata Ticket Master by ${actorId}`, body });
    return { channel: { id: channel.id, name: channel.name, type: channel.type } };
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
    const actor = request.headers.get("x-sonata-user");
    return withModerator(actor, undefined, () => dashboardRequestInternal(request, bot, execute));
}

async function dashboardRequestInternal(request, bot, execute) {
    const url = new URL(request.url), path = url.pathname.slice(11), actor = request.headers.get("x-sonata-user"), store = bot.store, api = bot.api;
    if (!isId(actor)) throw Object.assign(new Error("Sign in with Discord first."), { status: 401 });
    if (request.method === "POST" && !path.startsWith("owner")) requireBotUser(store, actor);
    if (path === "server-manager" && ["GET", "POST"].includes(request.method)) return serverManager(request, request.method === "POST" ? await requestJson(request, ROLE_BODY_LIMIT) : Object.fromEntries(url.searchParams), actor, bot, perform);
    const grants = (request.headers.get("x-sonata-permissions") || "").split(",");
    const owner = String(bot.env.DASHBOARD_OWNER_IDS ?? "779172192461783110").split(",").includes(actor);
    if (["owner/messages", "owner/userblocks", "owner/operations", "owner/resources", "owner/lookup", "owner/history", "owner/check", "owner/notes"].includes(path)) {
        if (!owner) throw Object.assign(new Error("Only the Sonata owner can use these tools."), { status: 403 });
        if (!["GET", "POST"].includes(request.method)) throw Object.assign(new Error("Use GET or POST."), { status: 405 });
        if (request.method === "POST" && ["owner/lookup", "owner/check"].includes(path)) throw Object.assign(new Error("This tool is read only."), { status: 405 });
        if (request.method === "POST") identifyModerator({ user: await api(`/users/${actor}`, { optional: true }).catch(() => null) });
        return ownerConsole(path, request, request.method === "POST" ? await requestJson(request) : Object.fromEntries(url.searchParams), bot, actor);
    }
    const scope = path === "owner/users" ? "users" : ["owner/health", "owner/failures"].includes(path) ? "health" : path === "owner/action" || (path === "owner/profile" && request.method === "POST") ? "serverAccess" : "servers";
    if (path.startsWith("owner") && !owner && !grants.includes(scope)) throw Object.assign(new Error("Only the bot owner can access this view."), { status: 403 });
    if (path.startsWith("owner") && request.method === "POST") identifyModerator({ user: await api(`/users/${actor}`, { optional: true }).catch(() => null) });
    if (path === "owner/failures" && request.method === "GET") return commandFailures(store, url.searchParams);
    if (["profile", "owner/profile"].includes(path) && ["GET", "POST"].includes(request.method)) {
        const input = request.method === "POST" ? await requestJson(request, path === "profile" ? PROFILE_BODY_LIMIT : 16_384) : { guild: url.searchParams.get("guild") };
        if (!isId(input.guild) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", input.guild) || store.get("SELECT id FROM guild_blacklist WHERE id=?", input.guild)) throw Object.assign(new Error("Choose an installed, allowed server."), { status: 404 });
        let editable = false;
        if (path === "profile") {
            const context = await dashboardAccess(api, input.guild, actor, store);
            editable = !!(memberPermissions(context.actor, context.roles, context.guild) & (PERMS.ADMIN | PERMS.GUILD));
            if (request.method === "POST") {
                if (!editable) throw Object.assign(new Error("Manage Server is required to change Sonata's profile."), { status: 403 });
            }
        }
        if (request.method === "POST") {
            if (path === "owner/profile" && input.action !== "reset") fail("Choose the profile reset action.");
            await writeGuildProfile(store, api, input.guild, actor, input, path === "owner/profile");
        }
        return { profile: { ...await readGuildProfile(store, api, input.guild, bot.session.userId), editable } };
    }
    if (path === "owner/health" && request.method === "GET") return { status: bot.status(), error: await bot.ctx?.storage.get("fatal") || "", lastDisconnect: await bot.ctx?.storage.get("disconnect") || null, failures: store.all("SELECT name,SUM(n) AS n FROM command_results WHERE outcome IN ('failed','needs_review') AND day>=? GROUP BY name ORDER BY n DESC LIMIT 10", new Date(Date.now()-86400000).toISOString().slice(0,10)), pendingJobs: store.get("SELECT COUNT(*) AS n FROM jobs WHERE state='pending'").n, stickyErrors: store.all("SELECT guild,channel,error FROM sticky_messages WHERE error<>'' LIMIT 10") };
    if (path === "owner/users" && request.method === "GET") {
        const ids = [...new Set((url.searchParams.get("ids") || "").split(","))];
        const includeNames = owner && url.searchParams.get("profile") === "1";
        if (!ids.length || ids.length > 20 || !ids.every(isId)) throw Object.assign(new Error("Choose up to 20 valid Discord user IDs."), { status: 400 });
        const users = [];
        for (const id of ids) {
            try {
                const user = await api(`/users/${id}`, { optional: true });
                users.push({ id, avatar: /^(?:a_)?[a-f0-9]{32}$/i.test(user?.avatar ?? "") ? user.avatar : "", discriminator: /^\d{1,4}$/.test(user?.discriminator ?? "") ? user.discriminator : "0", ...(includeNames && user ? { username: user.username, name: user.global_name || user.username } : {}) });
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
    if (["access", "designer", "features"].includes(path) || path === "setup-presets" && request.method === "POST" || path === "command-conflicts" && request.method === "GET") {
        const input = request.method === "POST" ? await requestJson(request) : { guild: url.searchParams.get("guild") };
        if (!isId(input.guild) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", input.guild) || store.get("SELECT id FROM guild_blacklist WHERE id=?", input.guild)) fail("Choose an installed, allowed server.");
        const context = await dashboardAccess(api, input.guild, actor, store);
        if (path === "setup-presets") return setupPreset(input, context, bot);
        if (path === "command-conflicts") return commandConflicts(store.settings(input.guild));
        if (path === "features") return featureGroupRequest(request, input, context, bot);
        return dashboardExtra(path, request, input, context, bot);
    }
    if (path === "servers" && request.method === "GET") {
        const allowed = [];
        const installed = servers(store);
        for (let index = 0; index < installed.length; index += 3) {
            const checked = await Promise.allSettled(installed.slice(index, index + 3).map(async server => (await dashboardAccess(api, server.id, actor, store, { listing: true })) && server));
            for (const check of checked) if (check.status === "fulfilled" && check.value) allowed.push(check.value);
        }
        return { servers: allowed };
    }
    if (path === "forms" && request.method === "GET") return { forms: dashboardForms() };
    if (["server", "owner/server"].includes(path) && request.method === "GET") {
        const id = url.searchParams.get("guild");
        if (!isId(id) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", id)) throw Object.assign(new Error("Sonata is not currently in this server."), { status: 404 });
        let context;
        try { context = await dashboardAccess(api, id, actor, store, { counts: true }); } catch (error) { if (path !== "owner/server") throw error; }
        const [guild, botMember, channels] = await Promise.all([
            context?.guild ?? api(`/guilds/${id}?with_counts=true`, { parallelRead: true }),
            api(`/guilds/${id}/members/${bot.session.userId}`, { parallelRead: true }),
            context && api(`/guilds/${id}/channels`, { parallelRead: true }),
        ]);
        const data = { guild, botJoined: botMember.joined_at, manageable: !!context, stats: moderationStats(store, id), insights: commandInsights(store, id), status: bot.status() };
        if (context) {
            const permission = memberPermissions(context.actor, context.roles, guild), moderation = !!(permission & (PERMS.ADMIN | PERMS.TIMEOUT | PERMS.BAN));
            data.canCreateTicketSpace = !!(permission & PERMS.ADMIN) || (permission & (PERMS.GUILD | PERMS.CHANNELS)) === (PERMS.GUILD | PERMS.CHANNELS);
            data.canCreatePrivateTicketSpace = data.canCreateTicketSpace && !!(permission & (PERMS.ADMIN | PERMS.ROLES));
            data.channels = channels.filter(channel => channelPermissions(context.actor, context.roles, guild, channel) & PERMS.VIEW).map(({ id, name, type }) => ({ id, name, type })); data.roles = context.roles.map(({ id, name, position }) => ({ id, name, position })); data.settings = store.settings(id);
            data.canManageCommands = !!(permission & (PERMS.ADMIN | PERMS.GUILD));
            data.serverOwner = actor === guild.owner_id; data.dashboardAccess = data.serverOwner ? context.policy : undefined; data.administrator = !!(permission & PERMS.ADMIN); data.commandNames = COMMANDS.flatMap(value => [value.name, ...value.options.filter(sub => sub.type === 1).map(sub => `${value.name} ${sub.name}`)]);
            data.cases = moderation ? store.all("SELECT * FROM cases WHERE guild=? ORDER BY n DESC LIMIT 30", id) : [];
            const visible = new Set(data.channels.map(value => value.id));
            data.tickets = store.all("SELECT tickets.*,ticket_details.data AS details FROM tickets LEFT JOIN ticket_details ON ticket_details.id=tickets.id WHERE guild=? ORDER BY (state='open') DESC, at DESC LIMIT 100", id).filter(row => visible.has(row.channel));
        }
        return data;
    }
    if (path === "action" && request.method === "POST") {
        const input = await requestJson(request);
        if (input.name === "ticket-space") return createTicketSpace(input, actor, bot);
        if (input.name === "logging-setup") return setupLogging(input, actor, bot);
        if (input.name === "ticket-manage") {
            if (!isId(input.guild) || !["panel-update", "panel-delete", "reset"].includes(input.sub) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", input.guild) || store.get("SELECT id FROM guild_blacklist WHERE id=?", input.guild)) fail("Choose an installed server and ticket action.");
            const context = await dashboardAccess(api, input.guild, actor, store);
            requirePermission(memberPermissions(context.actor, context.roles, context.guild), PERMS.GUILD | PERMS.CHANNELS);
            const settings = store.settings(input.guild), config = settings.tickets;
            if (!config) fail("This server has no saved ticket setup.");
            const panels = config.panels ?? (config.panel ? [config.panel] : []);
            if (input.sub === "reset") {
                if (panels.length) fail("Remove the saved ticket panels before deleting this setup.");
                if (store.get("SELECT id FROM tickets WHERE guild=? AND state<>'archived' LIMIT 1", input.guild)) fail("Archive existing ticket conversations before deleting this setup.");
                delete settings.tickets;
            } else {
                const panel = panels.find(panel => panel.message === input.options?.message);
                if (!panel || !isId(panel.channel) || !isId(panel.message)) fail("Choose a saved ticket panel.");
                const channel = await api(`/channels/${panel.channel}`, { optional: input.sub === "panel-delete" });
                if (channel) {
                    if (channel.guild_id !== input.guild) fail("Choose a panel in this server.");
                    requirePermission(channelPermissions(context.actor, context.roles, context.guild, channel), PERMS.VIEW | PERMS.SEND);
                    await api(`/channels/${panel.channel}/messages/${panel.message}`, { method: input.sub === "panel-delete" ? "DELETE" : "PATCH", optional: input.sub === "panel-delete", ...(input.sub === "panel-update" ? { body: withEmbedColor(settings, () => ticketPanel(input.guild, config)) } : {}) });
                }
                if (input.sub === "panel-delete") {
                    config.panels = panels.filter(value => value.message !== panel.message);
                    config.panel = config.panels.at(-1);
                }
            }
            store.saveSettings(input.guild, settings, actor, `Dashboard: ticket ${input.sub}`);
            return { result: embed("Ticket manager updated", input.sub === "reset" ? "Saved ticket setup removed. Existing ticket channels, records and transcripts are kept." : input.sub === "panel-delete" ? "Ticket panel removed." : "Ticket panel updated with the saved form and queues.") };
        }
        if (!isId(input.guild) || !isId(input.channel) || !DASHBOARD_ACTIONS[input.name]?.includes(input.sub)) throw Object.assign(new Error("Choose an available dashboard action and server channel."), { status: 400 });
        if (store.get("SELECT id FROM guild_blacklist WHERE id=?", input.guild)) throw Object.assign(new Error("This server is blacklisted from Sonata Bot."), { status: 403 });
        if (!input.options || typeof input.options !== "object" || Array.isArray(input.options)) fail("Choose the action options.");
        const options = Object.entries(input.options).map(([name, value]) => ({ name, value }));
        const command = { ...parseSlash({ name: input.name, options: input.sub === "run" ? options : [{ name: input.sub, options }] }), id: `dashboard:${crypto.randomUUID()}`, guild: input.guild, channel: input.channel, actor, dashboard: true };
        const [root, action] = slashName([command.name, command.sub].filter(Boolean).join(" ")).split(" ");
        command.raw = submittedCommand({ data: { name: root, options: action ? [{ type: 1, name: action, options }] : options } }, true);
        return { result: await execute(command), settings: store.settings(input.guild) };
    }
    throw Object.assign(new Error("This dashboard action was not found."), { status: 404 });
}

export function dashboardForms() {
    return COMMANDS.filter(command => DASHBOARD_ACTIONS[command.name]).map(command => ({ name: command.name, options: (command.options[0]?.type === 1 ? command.options : [{ name: "run", description: command.description, options: command.options }]).filter(sub => DASHBOARD_ACTIONS[command.name].includes(sub.name)).map(sub => ({ ...sub, documentation: reference(command, sub.name === "run" ? command : sub) })) }));
}
