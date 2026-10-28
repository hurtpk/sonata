/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fail, isId, PERMS } from "./discord.mjs";

const option = (name, type, description, required = true, extra = {}) => ({ name, type, description, required, ...extra });
const member = () => option("member", 6, "The member to moderate");
const reason = () => option("reason", 3, "The reason for this action", false, { max_length: 500 });
const duration = () => option("duration", 3, "Duration, such as 30m, 2h or 7d");
const caseNumber = () => option("case", 4, "The case number", true, { min_value: 1 });
const text = (name, description, required = true) => option(name, 3, description, required, { max_length: 1000 });
const sub = (name, description, options = []) => ({ name, description, type: 1, options });
const command = (name, description, permission, options = [], aliases = []) => ({ name, description, permission, options, aliases });
const role = () => option("role", 8, "The role to manage");
const channel = (types, required = true) => option("channel", 7, "The server channel", required, { channel_types: types });

export const COMMANDS = [
    command("help", "See commands, a help page, or help for a specific command", 0n, [text("command", "Command name or help page number", false)]),
    command("ping", "Check whether Sonata is responding", 0n),
    command("ban", "Ban a member or user ID", PERMS.BAN, [member(), reason()], ["b"]),
    command("tempban", "Ban a member until a chosen time", PERMS.BAN, [member(), duration(), reason()], ["tban"]),
    command("softban", "Remove a member and delete their recent messages, then unban", PERMS.BAN, [member(), option("days", 4, "Days of messages to remove, from one to seven", true, { min_value: 1, max_value: 7 }), reason()]),
    command("banlist", "Browse this server's bans", PERMS.BAN, [option("after", 3, "Show bans after this user ID", false)], ["bans"]),
    command("nickname", "Change a member's nickname, or omit the name to reset it", PERMS.NICKNAMES, [member(), option("name", 3, "The new nickname, or omit to reset", false, { max_length: 32 })], ["nick"]),
    command("unban", "Remove a user's ban", PERMS.BAN, [option("user", 3, "The banned user's ID"), reason()]),
    command("kick", "Remove a member from the server", PERMS.KICK, [member(), reason()]),
    command("timeout", "Temporarily prevent a member from participating", PERMS.TIMEOUT, [member(), duration(), reason()], ["mute"]),
    command("untimeout", "Remove a member's timeout", PERMS.TIMEOUT, [member(), reason()], ["unmute"]),
    command("warn", "Record a warning for a member", PERMS.TIMEOUT, [member(), reason()]),
    command("warnings", "List a member's warnings", PERMS.TIMEOUT, [member()], ["warns"]),
    command("warnremove", "Clear one warning while keeping its case history", PERMS.TIMEOUT, [caseNumber(), reason()]),
    command("warnclear", "Clear a member's warnings while keeping their case history", PERMS.TIMEOUT, [member(), reason()]),
    command("purge", "Delete matching messages from up to 100 recent messages", PERMS.MESSAGES, [option("count", 4, "Maximum matching messages to delete", true, { min_value: 1, max_value: 100 }), option("member", 6, "Only delete this member's messages", false), option("filter", 3, "Which messages to delete; pinned messages are normally kept", false, { choices: ["all", "bots", "humans", "links", "files", "embeds", "pinned"].map(value => ({ name: value, value })) })], ["clear"]),
    command("slowmode", "Set this channel's slowmode delay", PERMS.CHANNELS, [option("seconds", 4, "Delay, or zero to disable slowmode", true, { min_value: 0, max_value: 21600 })]),
    ...["lock", "unlock", "hide", "unhide"].map(name => command(name, `${name[0].toUpperCase() + name.slice(1)} this channel`, PERMS.CHANNELS | PERMS.ROLES, [reason()])),
    ...["pin", "unpin"].map(name => command(name, `${name === "pin" ? "Pin" : "Unpin"} a message in this channel`, PERMS.PINS, [option("message", 3, "A message ID or link in this channel"), reason()])),
    command("pins", "Browse this channel's pinned messages", 0n, [option("before", 3, "Show pins before this ISO timestamp", false)]),
    command("role", "Assign roles and manage role appearance", PERMS.ROLES, [
        sub("add", "Give a member a role", [member(), role(), reason()]),
        sub("remove", "Remove a member's role", [member(), role(), reason()]),
        sub("create", "Create a role without extra permissions", [option("name", 3, "Role name", true, { max_length: 100 })]),
        sub("rename", "Rename a role", [role(), option("name", 3, "New role name", true, { max_length: 100 })]),
        sub("color", "Change a role's colour", [role(), option("color", 3, "A six-digit hex colour, or default")]),
        sub("hoist", "Show a role separately in the member list", [role(), option("enabled", 5, "Show separately")]),
        sub("mentionable", "Allow anyone to mention a role", [role(), option("enabled", 5, "Allow mentions")]),
    ]),
    command("voice", "Moderate members in voice channels", 0n, [
        sub("move", "Move a member to another voice channel", [member(), channel([2]), reason()]),
        ...["disconnect", "mute", "unmute", "deafen", "undeafen"].map(name => sub(name, `${name[0].toUpperCase() + name.slice(1)} a member in voice`, [member(), reason()])),
    ]),
    command("channel", "Change this channel's settings", PERMS.CHANNELS, [
        sub("name", "Rename this channel", [option("name", 3, "New channel name", true, { min_length: 1, max_length: 100 })]),
        sub("topic", "Change this channel's topic, or omit to clear", [text("topic", "New topic", false)]),
        sub("nsfw", "Set this channel's age restriction", [option("enabled", 5, "Require age verification")]),
        sub("userlimit", "Set a voice channel's user limit", [channel([2]), option("limit", 4, "Zero for unlimited, otherwise one to ninety-nine", true, { min_value: 0, max_value: 99 })]),
    ]),
    ...["userinfo", "avatar", "banner"].map(name => command(name, name === "userinfo" ? "Show a member's account and server details" : `Show a member's ${name}`, 0n, [option("member", 6, "The member, or yourself if omitted", false)])),
    command("serverinfo", "Show this server's details", 0n),
    command("membercount", "Show this server's member count", 0n),
    command("roleinfo", "Show a role's details and permissions", 0n, [role()]),
    command("roles", "Browse this server's roles", 0n, [option("page", 4, "Page number", false, { min_value: 1 })]),
    command("channelinfo", "Show a channel's details", 0n, [channel([0, 2, 4, 5, 13, 15, 16], false)]),
    command("jailsetup", "Create and configure a jail role and channel", PERMS.GUILD | PERMS.ROLES | PERMS.CHANNELS),
    command("jail", "Restrict a member to the jail channel", PERMS.TIMEOUT | PERMS.ROLES, [member(), option("duration", 3, "Optional duration, such as 2h or 7d", false), reason()]),
    command("unjail", "Release a member and restore their saved roles", PERMS.TIMEOUT | PERMS.ROLES, [member(), reason()]),
    command("case", "View and maintain server moderation records", PERMS.TIMEOUT, [
        sub("list", "Browse this server's recent cases", [option("before", 4, "Show cases before this case number", false, { min_value: 1 })]),
        sub("view", "View one case", [caseNumber()]),
        sub("history", "See a member's recent cases", [member(), option("before", 4, "Show cases before this case number", false, { min_value: 1 })]),
        sub("reason", "Update a case's reason", [caseNumber(), text("reason", "The corrected reason")]),
        sub("note", "Add a staff note to a case", [caseNumber(), text("note", "The note to save")]),
        sub("evidence", "Attach an evidence file to a case", [caseNumber(), option("file", 11, "An image or video file")]),
    ]),
    command("settings", "Configure Sonata for this server", PERMS.GUILD, [
        sub("view", "See this server's Sonata settings"),
        sub("prefix", "Set the prefix used for message commands", [option("prefix", 3, "Between one and five characters", true, { min_length: 1, max_length: 5 })]),
        sub("modlog", "Choose the moderation log channel", [option("channel", 7, "Where moderation actions are logged", true, { channel_types: [0, 5] })]),
        sub("dm", "Choose whether punishments send a DM", [option("enabled", 5, "Send the affected user a DM")]),
        sub("message", "Customize a punishment DM", [option("action", 3, "The punishment", true, { choices: ["ban", "tempban", "softban", "kick", "timeout", "warn", "jail", "unjail"].map(value => ({ name: value, value })) }), text("text", "Use {user}, {moderator}, {reason}, {duration}, {case} or {server}")]),
    ]),
    command("automod", "Configure Discord's built-in automatic moderation", PERMS.GUILD, [
        sub("wordsadd", "Add a blocked word or wildcard", [text("word", "A word or wildcard, such as *badword*")]),
        sub("wordsremove", "Remove a blocked word or wildcard", [text("word", "The existing word or wildcard")]),
        sub("mentions", "Set the blocked mention threshold", [option("limit", 4, "Between one and fifty unique mentions", true, { min_value: 1, max_value: 50 })]),
        sub("spam", "Enable or disable Discord's spam filtering", [option("enabled", 5, "Enable automatic spam filtering")]),
        sub("list", "See AutoMod rules managed by Sonata"),
    ]),
];

export const slashCommands = () => COMMANDS.map(({ permission, aliases, ...value }) => ({ ...value, default_member_permissions: permission ? permission.toString() : null, contexts: [0], integration_types: [0] }));

export function parseDuration(value, maximum = 365 * 86400_000) {
    if (typeof value !== "string" || value.length > 40 || !/^(?:\d+(?:\.\d+)?[smhdw])+$/i.test(value)) fail("Use a duration such as 30m, 2h, 7d or 1h30m.");
    let result = 0;
    const units = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000, w: 7 * 86400_000 };
    for (const part of value.matchAll(/(\d+(?:\.\d+)?)([smhdw])/gi)) result += Number(part[1]) * units[part[2].toLowerCase()];
    if (!Number.isFinite(result) || result < 1000 || result > maximum) fail(`That duration must be between one second and ${Math.floor(maximum / 86400_000)} days.`);
    return Math.floor(result);
}

const idValue = value => { const match = /^(?:<@!?|<@&|<#)?(\d{17,20})>?$/.exec(String(value)); if (!match || !isId(match[1])) fail("Use a member mention or a valid Discord ID."); return match[1]; };

function validate(options, definitions) {
    for (const definition of definitions) {
        let value = options[definition.name];
        if (value === undefined || value === "") { if (definition.required) fail(`Missing ${definition.name}. Use the help command to see the syntax.`); delete options[definition.name]; continue; }
        if ([6, 7, 8].includes(definition.type)) value = idValue(value);
        if (definition.type === 4) { value = Number(value); if (!Number.isSafeInteger(value) || value < (definition.min_value ?? 0) || value > (definition.max_value ?? Number.MAX_SAFE_INTEGER)) fail(`Choose a valid ${definition.name}.`); }
        if (definition.type === 5) { if (typeof value !== "boolean") { if (!/^(?:true|false|on|off|yes|no)$/i.test(value)) fail(`Use on or off for ${definition.name}.`); value = /^(?:true|on|yes)$/i.test(value); } }
        if (definition.type === 3) { value = String(value); if (value.length < (definition.min_length ?? 1) || value.length > (definition.max_length ?? 500) || (definition.choices && !definition.choices.some(choice => choice.value === value))) fail(`Choose a valid ${definition.name}.`); }
        options[definition.name] = value;
    }
    return options;
}

export function parseSlash(data, attachments = {}) {
    const definition = COMMANDS.find(command => command.name === data.name);
    if (!definition) fail("That command is not available.");
    const group = definition.options[0]?.type === 1;
    const selected = group ? definition.options.find(option => option.name === data.options?.[0]?.name) : definition;
    if (!selected) fail("Choose a valid subcommand.");
    const values = Object.fromEntries((group ? data.options[0].options ?? [] : data.options ?? []).map(option => [option.name, option.type === 11 ? attachments[option.value] : option.value]));
    return { definition, name: definition.name, sub: group ? selected.name : "", options: validate(values, selected.options) };
}

export function parsePrefix(content, prefix, attachments = []) {
    if (!content.startsWith(prefix) || content.length > 2500) return null;
    const tokens = content.slice(prefix.length).trim().match(/"[^"\r\n]*"|'[^'\r\n]*'|\S+/g)?.map(value => value.replace(/^(["'])([\s\S]*)\1$/, "$2")) ?? [];
    const word = tokens.shift()?.toLowerCase();
    if (!word) return null;
    const definition = COMMANDS.find(command => command.name === word || command.aliases.includes(word));
    if (!definition) return null;
    const group = definition.options[0]?.type === 1;
    const subName = group ? tokens.shift()?.toLowerCase() : "";
    const selected = group ? definition.options.find(option => option.name === subName) : definition;
    if (!selected) fail(`Use ${prefix}help to see this command's subcommands.`);
    const values = {};
    for (let i = 0; i < selected.options.length; i++) {
        const option = selected.options[i];
        if (option.type === 11) values[option.name] = attachments[0];
        else if ([6, 7, 8].includes(option.type) && !option.required && tokens[0] && !/^(?:<@!?|<@&|<#)?\d{17,20}>?$/.test(tokens[0])) values[option.name] = undefined;
        else if (option.name === "duration" && !option.required && tokens[0] && !/^(?:\d+(?:\.\d+)?[smhdw])+$/i.test(tokens[0])) values[option.name] = undefined;
        else values[option.name] = option.type === 3 && i === selected.options.length - 1 ? tokens.splice(0).join(" ") || undefined : tokens.shift();
    }
    return { definition, name: definition.name, sub: group ? selected.name : "", options: validate(values, selected.options) };
}
