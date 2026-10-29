/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { stickyCommand } from "./sticky.mjs";
import { videoCommand } from "./videoEmbeds.mjs";
import { EXTRA_COMMANDS, extraCommand } from "./actions.mjs";
import { COMMANDS, parseDuration } from "./commands.mjs";
import { commandAccess, commandSettings, fakePermissions } from "./commandAccess.mjs";
import { insightsCommand } from "./commandInsights.mjs";
import { nicknamePolicy } from "./nicknamePolicy.mjs";
import { COMMUNITY_COMMANDS, communityCommand } from "./community.mjs";
import { canManage, channelPermissions, clean, embed, fail, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { help } from "./help.mjs";
import { information } from "./information.mjs";
import { channelAction, jailAction, releaseJail } from "./restrictions.mjs";
import { UTILITY_COMMANDS, utilityCommand } from "./utility.mjs";
import { prefixCommand } from "./prefix.mjs";
import { honeypotCommand } from "./honeypot.mjs";
import { MEDIA_COMMANDS, mediaCommand } from "./media.mjs";
import { voiceRoomCommand } from "./voiceRooms.mjs";
import { MUSIC_NAMES, musicCommand } from "./musicCommands.mjs";
import { musicSettings } from "./musicPolicy.mjs";
import { roleRecovery } from "./roleRecovery.mjs";
import { caseExport } from "./caseExport.mjs";
import { protectionCommand } from "./protection.mjs";
import { escalationCommand, expireWarnings, warningEscalation } from "./escalation.mjs";
import { appealsCommand, appealButtons, banKind } from "./appeals.mjs";
import { ticketCommand } from "./tickets.mjs";
import { giveawayCommand } from "./giveaways.mjs";
import { afkCommand, aliasCommand, statsCommand, verificationCommand } from "./memberTools.mjs";
import { levelsCommand } from "./levels.mjs";
import { advancedAutomod, AUTOMOD_OPTIONS } from "./advancedAutomod.mjs";
import { lockdownCommand } from "./lockdown.mjs";

export const caseMarker = (guild, n) => `[Sonata case ${guild}-${n}]`;
const caseTarget = (kind, id) => (kind === "role created" || kind.startsWith("server ")) ? `Server ${id}` : `${["lock", "unlock", "hide", "unhide", "slowmode", "purge", "pin", "unpin"].includes(kind) || kind.startsWith("channel ") ? `<#${id}>` : kind.startsWith("bot permission ") || (kind.startsWith("role ") && !["role add", "role remove"].includes(kind)) ? `<@&${id}>` : `<@${id}>`} (${id})`;
const recentCases = rows => rows.length ? rows.map(row => `**#${row.n} · ${row.kind} · ${row.status}**\nTarget: ${caseTarget(row.kind, row.target)} · Moderator: <@${row.actor}>\n${clean(row.reason)}${row.detail ? `\n${clean(row.detail)}` : ""}`).join("\n\n").slice(0, 1750) : "No cases found.";

export async function commandContext(command, botId, api, settings = {}) {
    const [guild, roles, actor, bot, channel] = await Promise.all([
        api(`/guilds/${command.guild}`), api(`/guilds/${command.guild}/roles`), api(`/guilds/${command.guild}/members/${command.actor}`), api(`/guilds/${command.guild}/members/${botId}`), api(`/channels/${command.channel}`),
    ]);
    if (channel.guild_id !== command.guild) fail("Use a channel in this server.");
    if (!(memberPermissions(bot, roles, guild) & PERMS.ADMIN)) fail("Sonata is missing the Discord permissions required for this command. Grant Administrator on the bot's role or use the Add bot link again.", "denied");
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW);
    if (command.prefix) requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.EMBEDS);
    const channelCommand = ["purge", "slowmode", "lock", "unlock", "hide", "unhide", "channel", "pin", "unpin"].includes(command.name);
    const permission = command.name === "channel" && command.sub === "userlimit" ? 0n : command.definition.permission;
    if (!commandAccess(command, settings, actor, roles)) requirePermission(channelCommand ? channelPermissions(actor, roles, guild, channel) : memberPermissions(actor, roles, guild), permission);
    return { command, guild, roles, actor, bot, channel, api, settings,
        async target(id, optional = false) {
            if (!isId(id) || [guild.owner_id, command.actor, botId].includes(id)) fail("You cannot moderate the server owner, yourself, or Sonata Bot.", "denied");
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

export async function perform(context, store, kind, target, reason, duration, action) {
    const command = context.command, n = store.begin(command, kind, target, reason, duration);
    const settings = store.settings(command.guild), canAppeal = settings.appeals?.enabled && banKind(kind);
    let appealNotice;
    if (canAppeal) try {
        const dm = await context.api("/users/@me/channels", { method: "POST", body: { recipient_id: target } });
        const notice = await context.api(`/channels/${dm.id}/messages`, { method: "POST", body: { ...embed("Ban requested", `A moderator requested a ban in ${context.guild.name}.\nReason: ${reason}\nCase #${n}. The appeal form becomes available if the ban completes.`), components: appealButtons(command.guild, n) } });
        appealNotice = { channel: dm.id, message: notice.id };
    } catch { appealNotice = null; }
    let detail = "";
    try { const result = await action(n, `${caseMarker(command.guild, n)} ${reason}`); if (typeof result === "string") detail = result; }
    catch (error) { store.status(command.guild, n, "needs_review", error.message); if (appealNotice) try { await context.api(`/channels/${appealNotice.channel}/messages/${appealNotice.message}`, { method: "PATCH", body: { ...embed("Ban needs staff review", "The requested action was not confirmed. Contact staff before assuming the ban completed."), components: [] } }); } catch { store.addNote(command.guild, n, command.actor, "appeal notice", "Could not update the earlier moderation notice."); } return embed(`Case #${n} needs review`, `${error.message}\nThe action may not have completed. Check the member's current state before repeating it.`); }
    store.status(command.guild, n, "completed", detail);
    const notices = [];
    try { await caseLog(store, context.api, command.guild, n); } catch { notices.push("The action succeeded, but its log message could not be posted."); }
    if (appealNotice) try { await context.api(`/channels/${appealNotice.channel}/messages/${appealNotice.message}`, { method: "PATCH", body: { ...embed("Sonata ban notice", `Server: ${context.guild.name}\nReason: ${reason}\nCase #${n}. You may submit one appeal using the form below.`), components: appealButtons(command.guild, n) } }); } catch { notices.push("The ban completed, but the earlier DM could not be updated."); }
    if (canAppeal && !appealNotice) notices.push("The member could not receive the ban appeal DM.");
    if (!appealNotice && settings.dm && ["ban", "tempban", "softban", "kick", "timeout", "untimeout", "warn", "jail", "unjail"].includes(kind) && settings.templates[kind] !== "off") {
        try {
            const template = settings.templates[kind] || "{user}, a moderator used {action} in {server}. Reason: {reason}. Case #{case}.";
            const values = { user: target, moderator: command.actor, action: kind, server: context.guild.name, reason, case: String(n), duration: duration ? `${Math.round(duration / 60_000)} minutes` : "Not timed" };
            const text = template.replace(/\{(user|moderator|action|server|reason|case|duration)\}/g, (_, key) => values[key]);
            const dm = await context.api("/users/@me/channels", { method: "POST", body: { recipient_id: target } });
            await context.api(`/channels/${dm.id}/messages`, { method: "POST", body: embed("Sonata moderation notice", text) });
        } catch { notices.push("The action succeeded, but the member could not receive a DM."); }
    }
    if (notices.length) store.status(command.guild, n, "completed", [detail, ...notices].filter(Boolean).join(" "));
    if (kind === "warn") {
        try { const result = await warningEscalation(context, store, n, target, perform); if (result) notices.push(result); }
        catch (error) { store.addNote(command.guild, n, command.actor, "warning escalation issue", error.message); notices.push("The warning was saved, but its automatic escalation needs staff review."); }
    }
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
    if (command.sub === "view") return embed("Sonata settings", `Prefix: \`${settings.prefix}\`\nLog channel: ${settings.logChannel ? `<#${settings.logChannel}>` : "Not configured"}\nPunishment DMs: ${settings.dm ? "On" : "Off"}\nJail role: ${settings.jailRole ? `<@&${settings.jailRole}>` : "Not configured"}${settings.automationError ? `\n\nLast member automation issue <t:${Math.floor(settings.automationError.at / 1000)}:R>:\n${settings.automationError.message}` : ""}`);
    if (command.sub === "prefix") { if (!/^[^\s/@<>`]{1,5}$/.test(options.prefix)) fail("Choose one to five characters without whitespace, mentions, a slash, or backticks."); settings.prefix = options.prefix; }
    if (command.sub === "videoembeds") {
        const channel = await api(`/channels/${options.channel}`);
        if (channel.guild_id !== guild.id || ![0,5].includes(channel.type)) fail("Choose a text channel in this server.");
        requirePermission(channelPermissions(context.actor, context.roles, guild, channel), PERMS.VIEW);
        settings.videoEmbeds ??= {}; if (options.enabled) settings.videoEmbeds[channel.id] = true; else delete settings.videoEmbeds[channel.id];
    }
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
    const { command, api, guild } = context, settings = store.settings(guild.id), key = command.sub.startsWith("words") || command.sub.startsWith("allow") ? "words" : command.options.rule ?? command.sub;
    const rules = await api(`/guilds/${guild.id}/auto-moderation/rules`);
    if (key === "list") return embed("Sonata AutoMod rules", rules.filter(rule => Object.values(settings.automod).includes(rule.id)).map(rule => `${rule.name}: ${rule.enabled ? "On" : "Off"}`).join("\n") || "No rules configured.");
    const existing = rules.find(rule => rule.id === settings.automod[key] && rule.creator_id === context.bot.user.id);
    if (command.sub === "config") return embed("Sonata AutoMod configuration", rules.filter(rule => rule.creator_id === context.bot.user.id && Object.values(settings.automod).includes(rule.id)).map(rule => `**${rule.name}** · ${rule.enabled ? "On" : "Off"}\nExempt roles: ${rule.exempt_roles?.length ?? 0}\nExempt channels: ${rule.exempt_channels?.length ?? 0}`).join("\n\n") || "No Sonata rules configured.");
    if (["words", "allowadd", "allowremove", "exemptrole", "exemptchannel"].includes(command.sub)) {
        if (!existing) fail("Configure this Sonata rule before editing its exemptions or allowed words.");
        if (command.sub === "words") return embed("Word filter", `Blocked (${existing.trigger_metadata.keyword_filter?.length ?? 0}; first 10):\n${existing.trigger_metadata.keyword_filter?.slice(0, 10).join("\n") || "None"}\n\nAllowed (${existing.trigger_metadata.allow_list?.length ?? 0}; first 10):\n${existing.trigger_metadata.allow_list?.slice(0, 10).join("\n") || "None"}`);
        let body;
        if (command.sub.startsWith("allow")) {
            const word = command.options.word.trim(); if (!word || word.length > 60) fail("Choose an allowed word between one and sixty characters.");
            const values = existing.trigger_metadata.allow_list ?? [], next = command.sub === "allowadd" ? [...new Set([...values, word])] : values.filter(value => value !== word);
            if (next.length > 100) fail("Use at most 100 allowed words.");
            body = { trigger_metadata: { ...existing.trigger_metadata, allow_list: next } };
        } else {
            const role = command.sub === "exemptrole", id = role ? command.options.role : command.options.channel, field = role ? "exempt_roles" : "exempt_channels";
            if (role) { if (!context.roles.some(role => role.id === id)) fail("Choose a role in this server."); }
            else { const channel = await api(`/channels/${id}`); if (channel.guild_id !== guild.id) fail("Choose a channel in this server."); requirePermission(channelPermissions(context.actor, context.roles, guild, channel), PERMS.VIEW); }
            const values = existing[field] ?? [], next = command.options.enabled ? [...new Set([...values, id])] : values.filter(value => value !== id);
            if (next.length > 10) fail("This bot supports at most ten exemptions of each kind per rule.");
            body = { [field]: next };
        }
        await api(`/guilds/${guild.id}/auto-moderation/rules/${existing.id}`, { method: "PATCH", body });
        return embed("AutoMod updated", "The rule's other settings were preserved.");
    }
    let trigger_type, trigger_metadata, enabled = true;
    if (key === "words") {
        const word = command.options.word.trim(); if (!word || word.length > 60) fail("Choose a word or wildcard between one and sixty characters.");
        let words = existing?.trigger_metadata.keyword_filter ?? [];
        words = command.sub === "wordsadd" ? [...new Set([...words, word])] : words.filter(value => value !== word);
        if (words.length > 100) fail("This bot supports up to 100 blocked words per server.");
        if (!words.length) { if (existing) await api(`/guilds/${guild.id}/auto-moderation/rules/${existing.id}`, { method: "DELETE" }); delete settings.automod[key]; store.saveSettings(guild.id, settings); return embed("Word filter updated", "The word filter is now empty."); }
        trigger_type = 1; trigger_metadata = { ...existing?.trigger_metadata, keyword_filter: words };
    }
    if (key === "mentions") { trigger_type = 5; trigger_metadata = { mention_total_limit: command.options.limit, mention_raid_protection_enabled: true }; }
    if (key === "spam") { trigger_type = 3; trigger_metadata = {}; enabled = command.options.enabled; }
    const body = { name: `Sonata | ${key}`, event_type: 1, trigger_type, trigger_metadata, actions: [{ type: 1, metadata: { custom_message: "This message was blocked by this server's Sonata moderation rule." } }], enabled };
    const saved = await api(`/guilds/${guild.id}/auto-moderation/rules${existing ? `/${existing.id}` : ""}`, { method: existing ? "PATCH" : "POST", body });
    settings.automod[key] = saved.id; store.saveSettings(guild.id, settings);
    return embed("AutoMod updated", `${saved.name} is ${enabled ? "enabled" : "disabled"}. Discord applies these rules automatically.`);
}

export async function executeCommand(command, store, api, botId, music) {
    if (store.get("SELECT id FROM guild_blacklist WHERE id=?", command.guild)) throw Object.assign(new Error("This server is blacklisted from Sonata Bot."), { status: 403, outcome: "denied" });
    if (!store.claim(command.id)) return embed("Already handled", "This command was already handled. Check case history before repeating an action.");
    store.usage(command.guild, command.name);
    const name = [command.name, command.sub].filter(Boolean).join(" ");
    try {
        const response = await runCommand(command, store, api, botId, music);
        const row = store.get("SELECT status FROM cases WHERE request=?", command.id);
        store.outcome(command.guild, name, row?.status === "needs_review" ? "needs_review" : "success");
        return response;
    } catch (error) { store.outcome(command.guild, name, error.outcome ?? "failed"); throw error; }
}

async function runCommand(command, store, api, botId, music) {
    const settings = store.settings(command.guild);
    if (["help", "ping", "dashboard"].includes(command.name)) commandAccess(command, settings, { roles: [] }, []);
    if (command.name === "dashboard") return embed("Sonata dashboard", "Manage your server, review cases and tickets, and configure Sonata at:\nhttps://sonata.hurts.workers.dev\n\nSign in with Discord. Each server requires your current Manage Server permission.");
    if (command.name === "help") return help(command);
    if (command.name === "ping") return embed("Pong!", `Discord API response: ${Number.isFinite(command.latency?.api) ? `${command.latency.api} ms` : "Not measured yet"}\nGateway heartbeat: ${Number.isFinite(command.latency?.gateway) ? `${command.latency.gateway} ms` : "Waiting for the first heartbeat"}`);
    const context = await commandContext(command, botId, api, settings), { guild, channel } = context, options = command.options, reason = options.reason ?? "No reason supplied.";
    if (command.name === "stick") return stickyCommand(context, store);
    if (command.name === "sonata") return videoCommand(context, music);
    if (command.name === "fakepermissions") return fakePermissions(context, store);
    if (command.name === "commandsettings") return commandSettings(context, store, COMMANDS);
    if (command.name === "commandstats") return insightsCommand(context, store);
    if (command.name === "nicknamepolicy") return nicknamePolicy(context, store);
    if (command.name === "verification") return verificationCommand(context, store);
    if (command.name === "levels") return levelsCommand(context, store);
    if (command.name === "afk") return afkCommand(context, store);
    if (command.name === "alias") return aliasCommand(context, store);
    if (command.name === "modstats") return statsCommand(context, store);
    if (command.name === "lockdown") return lockdownCommand(context, store, perform);
    if (command.name === "automod" && AUTOMOD_OPTIONS.some(value => value.name === command.sub)) return advancedAutomod(context, store);
    if (MUSIC_NAMES.includes(command.name)) return musicCommand(context, music, store);
    if (command.name === "musicsettings") return musicSettings(context, store);
    if (command.name === "role" && ["recovery", "restore"].includes(command.sub)) return roleRecovery(context, store, perform);
    if (["antiraid", "antinuke", "eventlog"].includes(command.name)) return protectionCommand(context, store);
    if (command.name === "escalation") return escalationCommand(context, store);
    if (command.name === "appeals") return appealsCommand(context, store);
    if (command.name === "ticket") return ticketCommand(context, store);
    if (command.name === "giveaway") return giveawayCommand(context, store);
    if (["warn", "warnings", "warnremove", "warnclear"].includes(command.name)) expireWarnings(store, guild.id, command.options.member);
    if (command.name === "prefix") return prefixCommand(context, store);
    if (command.name === "honeypot") return honeypotCommand(context, store);
    if (MEDIA_COMMANDS.includes(command.name)) return mediaCommand(context);
    if (command.name === "voicemaster") return voiceRoomCommand(context, store);
    if (COMMUNITY_COMMANDS.includes(command.name)) return communityCommand(context, store);
    if (UTILITY_COMMANDS.includes(command.name)) return utilityCommand(context);
    if (EXTRA_COMMANDS.includes(command.name)) return extraCommand(context, store, perform);
    if (["userinfo", "avatar", "banner", "serverinfo", "membercount", "roleinfo", "roles", "channelinfo"].includes(command.name)) return information(context);
    if (command.name === "settings") return configure(context, store);
    if (command.name === "automod") return automod(context, store);
    if (command.name === "case") {
        if (command.sub === "export") return caseExport(context, store);
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
