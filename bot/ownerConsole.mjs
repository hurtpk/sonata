/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { COMMANDS } from "./commands.mjs";
import { FEATURE_GROUPS } from "./featureGroups.mjs";
import { channelPermissions, fail, isId, memberPermissions, PERMS } from "./discord.mjs";

const restoreKeys = ["aliases", "disabledCommands", "dm", "templates", "logChannel", "videoEmbeds", "videoEmbedsAll", "videoEmbedRoles"];
export function requireBotUser(store, id) {
    if (store.get("SELECT id FROM user_blacklist WHERE id=?", id)) throw Object.assign(new Error("This account is blocked from Sonata Bot."), { status: 403, outcome: "denied" });
}
export const ownerPolicy = store => JSON.parse(store.get("SELECT data FROM owner_controls WHERE id='policy'")?.data ?? '{"maintenance":[],"rollouts":[]}');
const matches = (target, command) => target === "all" || target === command.name || target === `${command.name} ${command.sub}` || FEATURE_GROUPS.some(group => group.id === target && group.commands.split(" ").includes(command.name));
export function checkOperations(store, command) {
    if (["help", "dashboard", "ping", "stop", "unban", "untimeout", "unjail", "unlock", "unhide"].includes(command.name) || command.name === "lockdown" && command.sub === "restore" || command.name === "ticket" && ["close", "archive", "transcript"].includes(command.sub)) return;
    const policy = ownerPolicy(store);
    const paused = policy.maintenance.find(rule => matches(rule.target, command));
    if (paused) throw Object.assign(new Error(`Temporarily unavailable. ${paused.message}`), { outcome: "denied", publicNotice: paused.message });
    const rollout = policy.rollouts.find(rule => matches(rule.target, command) && !rule.guilds.includes(command.guild));
    if (rollout) fail("This command is being tested in selected servers and is not available here yet.", "denied");
}

export async function serverHealth(bot, guild) {
    const [info, roles, member, channels] = await Promise.all([bot.api(`/guilds/${guild}`), bot.api(`/guilds/${guild}/roles`), bot.api(`/guilds/${guild}/members/${bot.session.userId}`), bot.api(`/guilds/${guild}/channels`)]);
    const settings = bot.store.settings(guild), checks = [], permission = memberPermissions(member, roles, info), botPosition = Math.max(0, ...roles.filter(role => member.roles.includes(role.id)).map(role => role.position));
    checks.push({ name: "Administrator", ok: !!(permission & PERMS.ADMIN), detail: permission & PERMS.ADMIN ? "Sonata has Administrator." : "Enable Administrator on Sonata's role." });
    const higher = roles.filter(role => role.id !== guild && !role.managed && role.position >= botPosition);
    checks.push({ name: "Role hierarchy", ok: higher.length === 0, detail: higher.length ? `${higher.length} ordinary roles are at or above Sonata; members with these roles cannot be moderated by it.` : "Sonata is above all ordinary roles." });
    for (const [name, id] of [["Moderation log", settings.logChannel], ["Jail channel", settings.jailChannel], ["Ticket log", settings.tickets?.log]]) if (id) {
        const channel = channels.find(value => value.id === id), bits = channel ? channelPermissions(member, roles, info, channel) : 0n;
        checks.push({ name, ok: !!channel && !!(bits & PERMS.VIEW) && !!(bits & PERMS.SEND), detail: channel ? `#${channel.name} · ${id}` : `Configured channel ${id} no longer exists.` });
    }
    for (const [name, id] of [["Jail role", settings.jailRole], ["Verification role", settings.verification?.role], ["DJ role", settings.music?.role]]) if (id) {
        const role = roles.find(value => value.id === id);
        checks.push({ name, ok: !!role && !role.managed && role.position < botPosition, detail: role ? `${role.name} · position ${role.position}` : `Configured role ${id} no longer exists.` });
    }
    if (Object.keys(settings.automod ?? {}).length) {
        const rules = await bot.api(`/guilds/${guild}/auto-moderation/rules`);
        for (const [name, id] of Object.entries(settings.automod)) checks.push({ name: `AutoMod: ${name}`, ok: rules.some(rule => rule.id === id && rule.creator_id === bot.session.userId), detail: rules.some(rule => rule.id === id) ? `Rule ${id} is ${rules.find(rule => rule.id === id).enabled ? "enabled" : "paused"}.` : `Configured rule ${id} no longer exists.` });
    }
    checks.push({ name: "Pending releases", ok: true, detail: `${bot.store.get("SELECT COUNT(*) AS n FROM jobs WHERE guild=? AND state='pending'", guild).n} scheduled releases. Feature pauses do not cancel them.` });
    return { guild, name: info.name, checkedAt: Date.now(), checks };
}

export async function ownerConsole(path, request, input, bot, actor) {
    const store = bot.store, guild = input.guild;
    if (path === "owner/messages") {
        if (!isId(guild) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", guild) || store.get("SELECT id FROM guild_blacklist WHERE id=?", guild)) fail("Choose an installed, allowed server.");
        const [info, roles, member, channels] = await Promise.all([bot.api(`/guilds/${guild}`), bot.api(`/guilds/${guild}/roles`), bot.api(`/guilds/${guild}/members/${bot.session.userId}`), bot.api(`/guilds/${guild}/channels`)]);
        const available = channels.filter(channel => [0, 5].includes(channel.type) && (channelPermissions(member, roles, info, channel) & (PERMS.VIEW | PERMS.SEND)) === (PERMS.VIEW | PERMS.SEND));
        if (request.method === "POST") {
            if (!isId(input.channel) || !available.some(channel => channel.id === input.channel)) fail("Choose a text channel Sonata can view and send messages in.");
            if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 2000) fail("Enter a message of 1 to 2,000 characters.");
            const message = await bot.api(`/channels/${input.channel}/messages`, { method: "POST", body: { content: input.content, allowed_mentions: { parse: [] } } });
            store.run("INSERT INTO owner_messages VALUES (?,?,?,?,?)", message.id, actor, guild, input.channel, Date.now());
            store.run("DELETE FROM owner_messages WHERE id NOT IN (SELECT id FROM owner_messages ORDER BY at DESC,rowid DESC LIMIT 500)");
            return { id: message.id, url: `https://discord.com/channels/${guild}/${input.channel}/${message.id}` };
        }
        return { channels: available.map(({ id, name }) => ({ id, name })), recent: store.all("SELECT * FROM owner_messages WHERE guild=? ORDER BY at DESC,rowid DESC LIMIT 20", guild) };
    }
    if (path === "owner/userblocks") {
        if (request.method === "POST") {
            if (!isId(input.id) || typeof input.blocked !== "boolean" || typeof input.reason !== "string" || input.reason.length > 300) fail("Choose a Discord user ID, block state and a note of up to 300 characters.");
            if (input.blocked && String(bot.env.DASHBOARD_OWNER_IDS ?? "779172192461783110").split(",").includes(input.id)) fail("A configured Sonata owner cannot be blocked from the bot.");
            if (input.blocked) store.run("INSERT INTO user_blacklist VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET actor=excluded.actor,reason=excluded.reason,at=excluded.at", input.id, actor, input.reason.trim(), Date.now());
            else store.run("DELETE FROM user_blacklist WHERE id=?", input.id);
        }
        return { users: store.all("SELECT * FROM user_blacklist ORDER BY at DESC LIMIT 500") };
    }
    if (path === "owner/operations") {
        if (request.method === "GET") return { ...ownerPolicy(store), targets: [...new Set(["all", ...FEATURE_GROUPS.map(group => group.id), ...COMMANDS.map(command => command.name)])] };
        if (!Array.isArray(input.maintenance) || !Array.isArray(input.rollouts) || input.maintenance.length > 30 || input.rollouts.length > 30) fail("Choose up to 30 maintenance and rollout rules.");
        const valid = target => target === "all" || FEATURE_GROUPS.some(group => group.id === target) || COMMANDS.some(command => command.name === target || command.options.some(sub => sub.type === 1 && `${command.name} ${sub.name}` === target));
        for (const rule of input.maintenance) if (!rule || !valid(rule.target) || typeof rule.message !== "string" || !rule.message.trim() || rule.message.length > 300) fail("Choose an existing command or group and a notice of 1–300 characters.");
        for (const rule of input.rollouts) if (!rule || !valid(rule.target) || rule.target === "all" || !Array.isArray(rule.guilds) || !rule.guilds.length || rule.guilds.length > 100 || !rule.guilds.every(isId)) fail("Choose a command or group and 1–100 test server IDs.");
        const previous = ownerPolicy(store), value = { maintenance: input.maintenance.map(rule => ({ target: rule.target, message: rule.message.trim() })), rollouts: input.rollouts.map(rule => ({ target: rule.target, guilds: [...new Set(rule.guilds)] })) };
        store.run("INSERT INTO config_history VALUES (?,?,?,?,?,?,?)", crypto.randomUUID(), "global", actor, "Owner command controls", JSON.stringify(previous), JSON.stringify(value), Date.now());
        store.run("DELETE FROM config_history WHERE guild='global' AND id NOT IN (SELECT id FROM config_history WHERE guild='global' ORDER BY at DESC,rowid DESC LIMIT 50)");
        store.run("INSERT INTO owner_controls VALUES ('policy',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", JSON.stringify(value));
        return { ok: true, ...value };
    }
    if (path === "owner/resources") {
        if (request.method === "POST") {
            const keys = ["dailyCommands", "dailyVideoMiB", "storageMiB", "averageMs"];
            if (!input.budgets || typeof input.budgets !== "object" || !keys.every(key => Number.isFinite(input.budgets[key]) && input.budgets[key] >= 0 && input.budgets[key] <= 1_000_000_000)) fail("Enter nonnegative numeric alert thresholds, or zero to disable one.");
            store.run("INSERT INTO owner_controls VALUES ('budgets',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", JSON.stringify(Object.fromEntries(keys.map(key => [key, input.budgets[key]]))));
        }
        const budgets = JSON.parse(store.get("SELECT data FROM owner_controls WHERE id='budgets'")?.data ?? '{}'), today = store.get("SELECT * FROM resource_usage WHERE day=?", new Date().toISOString().slice(0, 10)), databaseBytes = store.databaseSize();
        const measured = { dailyCommands: today?.commands ?? 0, dailyVideoMiB: (today?.video_bytes ?? 0) / 1048576, storageMiB: databaseBytes === null ? null : databaseBytes / 1048576, averageMs: today?.commands ? today.processing_ms / today.commands : 0 };
        return {
        budgets, databaseBytes, alerts: Object.entries(measured).filter(([key, value]) => budgets[key] > 0 && value !== null && value >= budgets[key]).map(([key, value]) => ({ key, current: Math.round(value * 10) / 10, limit: budgets[key] })),
        measuredSince: store.get("SELECT MIN(day) AS day FROM resource_usage").day,
        days: store.all("SELECT * FROM resource_usage ORDER BY day DESC LIMIT 30"),
        storedConfigurationBytes: store.get("SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) AS n FROM settings").n,
        historyBytes: store.get("SELECT COALESCE(SUM(length(CAST(before_data AS BLOB))+length(CAST(after_data AS BLOB))),0) AS n FROM config_history").n,
        pendingJobs: store.get("SELECT COUNT(*) AS n FROM jobs WHERE state='pending'").n,
        activeMusicServers: bot.music?.channels.size ?? 0, queuedRequests: bot.music?.jobs.size ?? 0,
        hostQuotas: "Cloudflare and Oracle billing quotas are not exposed to this service. These are Sonata's measured counters, not a hosting bill.",
        };
    }
    if (path === "owner/lookup") {
        if (!isId(input.id)) fail("Enter a Discord user ID.");
        const rows = store.all("SELECT id,data FROM bot_guilds WHERE active=1 ORDER BY id"), page = Math.max(0, Number(input.page) || 0), selected = rows.slice(page * 20, (page + 1) * 20), access = [];
        for (const row of selected) {
            const info = JSON.parse(row.data), policy = store.settings(row.id).dashboardAccess ?? { administrators: true, users: [] };
            const member = await bot.api(`/guilds/${row.id}/members/${input.id}`, { optional: true });
            if (!member) continue;
            const roles = await bot.api(`/guilds/${row.id}/roles`), administrator = !!(memberPermissions(member, roles, info) & (PERMS.ADMIN | PERMS.GUILD));
            access.push({ guild: row.id, name: info.name, serverOwner: info.owner_id === input.id, explicitlyAllowed: policy.users.includes(input.id), administratorsAllowed: policy.administrators, allowed: info.owner_id === input.id || policy.users.includes(input.id) || administrator && policy.administrators });
        }
        return { id: input.id, access, page, more: rows.length > (page + 1) * 20 };
    }
    if (path === "owner/history") {
        if (guild !== "global" && !isId(guild)) fail("Choose a server ID.");
        if (request.method === "GET") return { entries: store.all("SELECT * FROM config_history WHERE guild=? ORDER BY at DESC,rowid DESC LIMIT 50", guild).map(row => {
            const before = JSON.parse(row.before_data), after = JSON.parse(row.after_data), keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
            return { id: row.id, actor: row.actor, source: row.source, at: row.at, changes: keys.map(key => ({ key, before: before[key] ?? null, after: after[key] ?? null, restorable: restoreKeys.includes(key) })) };
        }) };
        const row = store.get("SELECT * FROM config_history WHERE id=? AND guild=?", input.id, guild);
        if (!row || !Array.isArray(input.keys) || !input.keys.length || !input.keys.every(key => restoreKeys.includes(key))) fail("Choose a saved revision and its restorable settings.");
        const before = JSON.parse(row.before_data), after = JSON.parse(row.after_data), current = store.settings(guild);
        for (const key of input.keys) {
            if (JSON.stringify(current[key]) !== JSON.stringify(after[key])) fail("This setting changed again after that revision. Refresh and review the latest change before restoring it.");
            if (Object.hasOwn(before, key)) current[key] = before[key]; else delete current[key];
        }
        store.saveSettings(guild, current, actor, "Owner restored settings"); return { ok: true };
    }
    if (!isId(guild) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", guild)) fail("Choose an installed server.");
    if (path === "owner/check") return serverHealth(bot, guild);
    if (path === "owner/notes") {
        if (request.method === "POST") {
            if (typeof input.note !== "string" || input.note.length > 4000 || !Array.isArray(input.labels) || input.labels.length > 10 || !input.labels.every(label => typeof label === "string" && label.trim().length && label.length <= 30)) fail("Use a note of up to 4,000 characters and at most ten labels of 1–30 characters.");
            store.run("INSERT INTO owner_server_notes VALUES (?,?,?,?,?) ON CONFLICT(guild) DO UPDATE SET note=excluded.note,labels=excluded.labels,actor=excluded.actor,at=excluded.at", guild, input.note, JSON.stringify([...new Set(input.labels.map(label => label.trim()))]), actor, Date.now());
        }
        const row = store.get("SELECT * FROM owner_server_notes WHERE guild=?", guild);
        return row ? { ...row, labels: JSON.parse(row.labels) } : { guild, note: "", labels: [] };
    }
    throw Object.assign(new Error("Owner tool not found."), { status: 404 });
}
