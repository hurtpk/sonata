/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EXTRA_COMMANDS, extraCommand } from "./actions.mjs";
import { parseDuration } from "./commands.mjs";
import { canManage, channelPermissions, clean, embed, fail, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { help, information } from "./information.mjs";
import { channelAction, jailAction, releaseJail } from "./restrictions.mjs";

export const caseMarker = (guild, n) => `[Sonata case ${guild}-${n}]`;
const caseTarget = (kind, id) => kind === "role created" ? `Server ${id}` : `${["lock", "unlock", "hide", "unhide", "slowmode", "purge", "pin", "unpin"].includes(kind) || kind.startsWith("channel ") ? `<#${id}>` : kind.startsWith("role ") && !["role add", "role remove"].includes(kind) ? `<@&${id}>` : `<@${id}>`} (${id})`;
const recentCases = rows => rows.length ? rows.map(row => `**#${row.n} · ${row.kind} · ${row.status}**\nTarget: ${caseTarget(row.kind, row.target)} · Moderator: <@${row.actor}>\n${clean(row.reason)}${row.detail ? `\n${clean(row.detail)}` : ""}`).join("\n\n").slice(0, 1750) : "No cases found.";

export async function commandContext(command, botId, api) {
    const [guild, roles, actor, bot, channel] = await Promise.all([
        api(`/guilds/${command.guild}`), api(`/guilds/${command.guild}/roles`), api(`/guilds/${command.guild}/members/${command.actor}`), api(`/guilds/${command.guild}/members/${botId}`), api(`/channels/${command.channel}`),
    ]);
    if (channel.guild_id !== command.guild) fail("Use a channel in this server.");
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW);
    const channelCommand = ["purge", "slowmode", "lock", "unlock", "hide", "unhide", "channel", "pin", "unpin"].includes(command.name);
    const permission = command.name === "channel" && command.sub === "userlimit" ? 0n : command.definition.permission;
    requirePermission(channelCommand ? channelPermissions(actor, roles, guild, channel) : memberPermissions(actor, roles, guild), permission);
    return { command, guild, roles, actor, bot, channel, api,
        async target(id, optional = false) {
            if (!isId(id) || [guild.owner_id, command.actor, botId].includes(id)) fail("You cannot moderate the server owner, yourself, or Sonata Bot.");
            const target = await api(`/guilds/${guild.id}/members/${id}`, { optional });
            if (target) canManage(actor, target, bot, roles, guild);
            return target;
        },
        botPermission(permission, inChannel = false) { requirePermission(inChannel ? channelPermissions(bot, roles, guild, channel) : memberPermissions(bot, roles, guild), permission); },
    };
}

export async function caseLog(store, api, guild, n) {
    const row = store.case(guild, n), settings = store.settings(guild);
    if (!settings.logChannel) return;
    await api(`/channels/${settings.logChannel}/messages`, { method: "POST", body: embed(`Case #${n} · ${row.kind}`, `Target: ${caseTarget(row.kind, row.target)}\nModerator: <@${row.actor}>\nStatus: **${row.status}**\nReason: ${row.reason}${row.duration ? `\nDuration: ${Math.round(row.duration / 60_000)} minutes` : ""}${row.detail ? `\n${row.detail}` : ""}`) });
}

async function perform(context, store, kind, target, reason, duration, action) {
    const command = context.command, n = store.begin(command, kind, target, reason, duration);
    let detail = "";
    try { const result = await action(n, `${caseMarker(command.guild, n)} ${reason}`); if (typeof result === "string") detail = result; }
    catch (error) { store.status(command.guild, n, "needs_review", error.message); return embed(`Case #${n} needs review`, `${error.message}\nThe action may not have completed. Check the member's current state before repeating it.`); }
    store.status(command.guild, n, "completed", detail);
    const notices = [];
    try { await caseLog(store, context.api, command.guild, n); } catch { notices.push("The action succeeded, but its log message could not be posted."); }
    const settings = store.settings(command.guild);
    if (settings.dm && ["ban", "tempban", "softban", "kick", "timeout", "untimeout", "warn", "jail", "unjail"].includes(kind) && settings.templates[kind] !== "off") {
        try {
            const template = settings.templates[kind] || "{user}, a moderator used {action} in {server}. Reason: {reason}. Case #{case}.";
            const values = { user: target, moderator: command.actor, action: kind, server: context.guild.name, reason, case: String(n), duration: duration ? `${Math.round(duration / 60_000)} minutes` : "Not timed" };
            const text = template.replace(/\{(user|moderator|action|server|reason|case|duration)\}/g, (_, key) => values[key]);
            const dm = await context.api("/users/@me/channels", { method: "POST", body: { recipient_id: target } });
            await context.api(`/channels/${dm.id}/messages`, { method: "POST", body: embed("Sonata moderation notice", text) });
        } catch { notices.push("The action succeeded, but the member could not receive a DM."); }
    }
    if (notices.length) store.status(command.guild, n, "completed", [detail, ...notices].filter(Boolean).join(" "));
    return embed(`Case #${n} · ${kind}`, `Target: ${caseTarget(kind, target)}\nReason: ${reason}${detail ? `\n${detail}` : ""}${notices.length ? `\n\n${notices.join("\n")}` : ""}`);
}

async function evidence(context, store, options) {
    const file = options.file, settings = store.settings(context.guild.id);
    if (!settings.logChannel) fail("Set a moderation log channel first so evidence files can be kept in your server.");
    if (!file || typeof file.url !== "string" || !Number.isInteger(file.size) || file.size > 8 * 1024 * 1024 || !/^(?:image|video)\//.test(file.content_type ?? "")) fail("Attach an image or video no larger than 8 MiB.");
    const url = new URL(file.url);
    if (url.protocol !== "https:" || !["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname) || !url.pathname.startsWith("/attachments/")) fail("Use a file attached directly to the command.");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(12_000) });
    if (!response.ok || !response.body) fail("Discord could not provide that attachment. Upload it again and retry.");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 8 * 1024 * 1024) fail("That file is larger than 8 MiB."); chunks.push(chunk); }
    const filename = String(file.filename ?? "evidence").replace(/[^\w. -]/g, "_").slice(0, 100);
    const form = new FormData();
    form.set("payload_json", JSON.stringify({ ...embed(`Evidence for case #${options.case}`, `Submitted by <@${context.command.actor}>.`), attachments: [{ id: "0", filename }] }));
    form.set("files[0]", new Blob(chunks, { type: file.content_type }), filename);
    const posted = await context.api(`/channels/${settings.logChannel}/messages`, { method: "POST", form });
    const link = `https://discord.com/channels/${context.guild.id}/${settings.logChannel}/${posted.id}`;
    store.addNote(context.guild.id, options.case, context.command.actor, "evidence", link);
    return embed("Evidence saved", `The file is saved in your moderation log channel:\n${link}\nKeep that Discord message to retain the evidence.`);
}

async function configure(context, store) {
    const { command, api, guild } = context, options = command.options, settings = store.settings(guild.id);
    if (command.sub === "view") return embed("Sonata settings", `Prefix: \`${settings.prefix}\`\nLog channel: ${settings.logChannel ? `<#${settings.logChannel}>` : "Not configured"}\nPunishment DMs: ${settings.dm ? "On" : "Off"}\nJail role: ${settings.jailRole ? `<@&${settings.jailRole}>` : "Not configured"}`);
    if (command.sub === "prefix") { if (!/^[^\s/@<>`]{1,5}$/.test(options.prefix)) fail("Choose one to five characters without whitespace, mentions, a slash, or backticks."); settings.prefix = options.prefix; }
    if (command.sub === "dm") settings.dm = options.enabled;
    if (command.sub === "message") settings.templates[options.action] = options.text;
    if (command.sub === "modlog") {
        const channel = await api(`/channels/${options.channel}`);
        if (channel.guild_id !== guild.id || ![0, 5].includes(channel.type)) fail("Choose a text channel in this server.");
        requirePermission(channelPermissions(context.bot, context.roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.HISTORY | PERMS.EMBEDS | PERMS.ATTACH);
        settings.logChannel = channel.id;
    }
    store.saveSettings(guild.id, settings);
    return embed("Settings saved", "Your server's Sonata settings were updated.");
}

async function automod(context, store) {
    context.botPermission(PERMS.GUILD);
    const { command, api, guild } = context, settings = store.settings(guild.id), key = command.sub.startsWith("words") ? "words" : command.sub;
    const rules = await api(`/guilds/${guild.id}/auto-moderation/rules`);
    if (key === "list") return embed("Sonata AutoMod rules", rules.filter(rule => Object.values(settings.automod).includes(rule.id)).map(rule => `${rule.name}: ${rule.enabled ? "On" : "Off"}`).join("\n") || "No rules configured.");
    const existing = rules.find(rule => rule.id === settings.automod[key] && rule.creator_id === context.bot.user.id);
    let trigger_type, trigger_metadata, enabled = true;
    if (key === "words") {
        const word = command.options.word.trim(); if (!word || word.length > 60) fail("Choose a word or wildcard between one and sixty characters.");
        let words = existing?.trigger_metadata.keyword_filter ?? [];
        words = command.sub === "wordsadd" ? [...new Set([...words, word])] : words.filter(value => value !== word);
        if (words.length > 100) fail("This bot supports up to 100 blocked words per server.");
        if (!words.length) { if (existing) await api(`/guilds/${guild.id}/auto-moderation/rules/${existing.id}`, { method: "DELETE" }); delete settings.automod[key]; store.saveSettings(guild.id, settings); return embed("Word filter updated", "The word filter is now empty."); }
        trigger_type = 1; trigger_metadata = { keyword_filter: words };
    }
    if (key === "mentions") { trigger_type = 5; trigger_metadata = { mention_total_limit: command.options.limit, mention_raid_protection_enabled: true }; }
    if (key === "spam") { trigger_type = 3; trigger_metadata = {}; enabled = command.options.enabled; }
    const body = { name: `Sonata | ${key}`, event_type: 1, trigger_type, trigger_metadata, actions: [{ type: 1, metadata: { custom_message: "This message was blocked by this server's Sonata moderation rule." } }], enabled };
    const saved = await api(`/guilds/${guild.id}/auto-moderation/rules${existing ? `/${existing.id}` : ""}`, { method: existing ? "PATCH" : "POST", body });
    settings.automod[key] = saved.id; store.saveSettings(guild.id, settings);
    return embed("AutoMod updated", `${saved.name} is ${enabled ? "enabled" : "disabled"}. Discord applies these rules automatically.`);
}

export async function executeCommand(command, store, api, botId) {
    if (command.name === "help") return help(command);
    if (command.name === "ping") return embed("Sonata is here", "Prefix and slash commands use the same moderation checks and case history.");
    const context = await commandContext(command, botId, api), { guild, channel } = context, options = command.options, reason = options.reason ?? "No reason supplied.";
    if (!store.claim(command.id)) return embed("Already handled", "This command has already been accepted. Check the case history before repeating an action.");
    if (EXTRA_COMMANDS.includes(command.name)) return extraCommand(context, store, perform);
    if (["userinfo", "avatar", "banner", "serverinfo", "membercount", "roleinfo", "roles", "channelinfo"].includes(command.name)) return information(context);
    if (command.name === "settings") return configure(context, store);
    if (command.name === "automod") return automod(context, store);
    if (command.name === "case") {
        if (command.sub === "list") return embed("Server case history", recentCases(store.all("SELECT * FROM cases WHERE guild=? AND n<? ORDER BY n DESC LIMIT 8", guild.id, options.before ?? 2147483647)));
        if (command.sub === "history") return embed("Member case history", recentCases(store.all("SELECT * FROM cases WHERE guild=? AND target=? AND n<? ORDER BY n DESC LIMIT 8", guild.id, options.member, options.before ?? 2147483647)));
        const row = store.case(guild.id, options.case); if (!row) fail("That case does not exist in this server.");
        if (command.sub === "view") return embed(`Case #${row.n}`, recentCases([row]) + "\n\n" + store.all("SELECT * FROM notes WHERE guild=? AND n=? ORDER BY at DESC LIMIT 5", guild.id, row.n).map(note => `${note.kind}: ${clean(note.value)}\nBy <@${note.actor}>`).join("\n"));
        if (command.sub === "evidence") return evidence(context, store, options);
        store.addNote(guild.id, row.n, command.actor, command.sub === "reason" ? "reason change" : "note", command.sub === "reason" ? `Previous: ${row.reason}\nNew: ${options.reason}` : options.note);
        if (command.sub === "reason") store.run("UPDATE cases SET reason=? WHERE guild=? AND n=?", options.reason, guild.id, row.n);
        return embed(`Case #${row.n} updated`, "The change and its author are saved in this server's case history.");
    }
    if (command.name === "warnings") return embed("Member warnings", recentCases(store.all("SELECT * FROM cases WHERE guild=? AND target=? AND kind='warn' AND status='completed' ORDER BY n DESC LIMIT 8", guild.id, options.member)));
    if (["lock", "unlock", "hide", "unhide", "slowmode", "purge"].includes(command.name)) return perform(context, store, command.name, channel.id, reason, 0, (_, audit) => channelAction(context, store, audit));
    if (command.name === "jailsetup") return jailAction(context, store);
    if (command.name === "unban") {
        context.botPermission(PERMS.BAN);
        if (!isId(options.user) || [guild.owner_id, command.actor, botId].includes(options.user)) fail("Choose another valid user ID.");
        return perform(context, store, "unban", options.user, reason, 0, async (_, audit) => { await api(`/guilds/${guild.id}/bans/${options.user}`, { method: "DELETE", reason: audit }); store.cancelJobs(guild.id, options.user, "tempban"); });
    }
    const targetId = options.member, target = await context.target(targetId, ["ban", "tempban", "unjail"].includes(command.name));
    if (["jail", "unjail"].includes(command.name)) {
        context.botPermission(PERMS.ROLES);
        if (command.name === "unjail") return perform(context, store, "unjail", targetId, reason, 0, (_, audit) => {
            if (target) return releaseJail(context, store, target, audit);
            if (!store.restriction(guild.id, targetId, "jail")) fail("That user has no saved Sonata jail restriction.");
            store.clearRestriction(guild.id, targetId, "jail"); store.cancelJobs(guild.id, targetId, "jail");
            return "The saved jail restriction was cleared. The user is not in the server, so no roles were granted.";
        });
        const ms = options.duration ? parseDuration(options.duration, 28 * 86400_000) : 0;
        return perform(context, store, "jail", targetId, reason, ms, async (n, audit) => { await jailAction(context, store, target, audit); if (ms) store.schedule(guild.id, n, targetId, "jail", Date.now() + ms); });
    }
    const ms = ["timeout", "tempban"].includes(command.name) ? parseDuration(options.duration, command.name === "timeout" ? 28 * 86400_000 : 365 * 86400_000) : 0;
    const permission = { ban: PERMS.BAN, tempban: PERMS.BAN, kick: PERMS.KICK, timeout: PERMS.TIMEOUT, untimeout: PERMS.TIMEOUT }[command.name];
    if (permission) context.botPermission(permission);
    if (command.name === "timeout" && (memberPermissions(target, context.roles, guild) & PERMS.ADMIN)) fail("Discord cannot timeout an administrator.");
    return perform(context, store, command.name, targetId, reason, ms, async (n, audit) => {
        if (["ban", "tempban"].includes(command.name)) { await api(`/guilds/${guild.id}/bans/${targetId}`, { method: "PUT", reason: audit, body: { delete_message_seconds: 0 } }); store.cancelJobs(guild.id, targetId, "tempban"); if (ms) store.schedule(guild.id, n, targetId, "tempban", Date.now() + ms, caseMarker(guild.id, n)); }
        if (command.name === "kick") await api(`/guilds/${guild.id}/members/${targetId}`, { method: "DELETE", reason: audit });
        if (["timeout", "untimeout"].includes(command.name)) await api(`/guilds/${guild.id}/members/${targetId}`, { method: "PATCH", reason: audit, body: { communication_disabled_until: ms ? new Date(Date.now() + ms).toISOString() : null } });
    });
}
