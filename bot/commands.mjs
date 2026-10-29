/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fail, isId, PERMS } from "./discord.mjs";

import { channel, command, duration, member, option, reason, role, sub, text, caseNumber } from "./commandOptions.mjs";
import { ADVANCED_COMMANDS } from "./advancedCommands.mjs";
import { MUSIC_COMMANDS, MUSIC_SETTINGS_COMMAND } from "./musicCommands.mjs";
import { SERVER_COMMANDS } from "./serverCommands.mjs";
import { DASHBOARD_COMMANDS } from "./dashboardCommands.mjs";
import { AUTOMOD_OPTIONS } from "./advancedAutomod.mjs";
import { delegatedCommand } from "./commandAccess.mjs";

export const COMMANDS = [
    command("stick", "Keep a message below new channel messages", PERMS.MESSAGES, [sub("set", "Set sticky text or copy a message from this channel", [option("message", 3, "Text or message link, or reply to a message", false, { max_length: 1800 })]), sub("remove", "Stop reposting the channel sticky message", [text("message", "Current or original sticky message link", false)])], ["stickmessage", "unstick", "unstickmessage"]),
    command("sonata", "Embed a supported public video with sender credit", 0n, [option("url", 3, "TikTok, Instagram, X or YouTube video URL", true, { max_length: 500 })]),
    ...ADVANCED_COMMANDS,
    ...MUSIC_COMMANDS,
    MUSIC_SETTINGS_COMMAND,
    ...SERVER_COMMANDS,
    ...DASHBOARD_COMMANDS,
    command("tag", "Save and retrieve server text snippets", 0n, [
        sub("create", "Create a server tag", [text("name", "Tag name"), text("text", "Tag text")]),
        sub("edit", "Edit a server tag", [text("name", "Tag name"), text("text", "New text")]),
        sub("delete", "Delete a server tag", [text("name", "Tag name")]),
        sub("show", "Read a server tag", [text("name", "Tag name")]),
        sub("info", "Show a tag's author and last edit", [text("name", "Tag name")]),
        sub("list", "Browse server tags", [option("page", 4, "Page number", false, { min_value: 1 })]),
    ]),
    command("autoresponder", "Configure exact-text automatic replies", PERMS.GUILD, [
        ...["add", "update"].map(name => sub(name, `${name === "add" ? "Add" : "Update"} an automatic reply`, [text("trigger", "Exact trigger text, quote multiple words in prefix commands"), text("reply", "Reply text")])),
        sub("remove", "Remove an automatic reply", [text("trigger", "Trigger text")]),
        sub("view", "View an automatic reply", [text("trigger", "Trigger text")]),
        sub("list", "List automatic reply triggers"),
    ]),
    ...["welcome", "goodbye"].map(name => command(name, `Configure ${name} messages`, PERMS.GUILD, [
        sub("add", "Set a channel's message", [channel([0, 5]), text("message", "Use {user}, {username}, {server} and {id}")]),
        sub("remove", "Remove a channel's message", [channel([0, 5])]),
        sub("view", "View a channel's configured message", [channel([0, 5])]),
        sub("list", "List configured channels"),
        sub("variables", "List available message variables"),
        sub("test", "Post a preview using your own account", [channel([0, 5])]),
    ])),
    command("autorole", "Configure safe roles for new members", PERMS.GUILD | PERMS.ROLES, [
        sub("add", "Add a role for new members", [role(), option("audience", 3, "Who receives it", true, { choices: ["humans", "bots", "all"].map(value => ({ name: value, value })) })]),
        sub("remove", "Remove a configured role", [role()]),
        sub("list", "Show configured roles"),
        sub("enable", "Enable configured autoroles"),
        sub("disable", "Pause autoroles without deleting their configuration"),
    ]),
    command("joinlogs", "Configure member join and leave logs", PERMS.GUILD, [sub("set", "Choose a log channel", [channel([0, 5])]), sub("off", "Disable member logs"), sub("view", "View member log configuration")]),
    command("autonick", "Configure nicknames for new human members", PERMS.GUILD | PERMS.NICKNAMES, [sub("set", "Set a nickname template", [option("template", 3, "Use {username} and {id}; at most 32 characters", true, { max_length: 32 })]), sub("off", "Disable automatic nicknames"), sub("view", "View the nickname template")]),
    command("poll", "Create polls and inspect poll results", 0n, [
        sub("create", "Create a native Discord poll", [text("question", "Question, quote multiple words in prefix commands"), text("answers", "Two to ten answers separated by |")]),
        sub("results", "Show results for a poll in this channel", [option("message", 3, "The poll message ID")]),
    ]),
    command("choose", "Choose randomly from options separated by |", 0n, [text("options", "Options separated by |")]),
    command("roll", "Roll dice such as 2d6", 0n, [option("dice", 3, "One to twenty dice, with two to one thousand sides")]),
    command("coinflip", "Flip a coin", 0n),
    command("8ball", "Ask the magic eight ball", 0n, [text("question", "Your question")]),
    command("timestamp", "Format a Unix timestamp for Discord", 0n, [option("seconds", 4, "Unix time in seconds", true, { min_value: 0, max_value: 253402300799 })]),
    command("snowflake", "Show when a Discord ID was created", 0n, [option("id", 3, "Discord ID")]),
    command("firstmessage", "Link the first available message in this channel", 0n),
    ...["servericon", "serverbanner", "boosts"].map(name => command(name, name === "boosts" ? "Show this server's boost level and count" : `Show this server's ${name === "servericon" ? "icon" : "banner"}`, 0n)),
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
        sub("restore", "Restore basic roles within three hours of departure", [member()]),
        sub("recovery", "Enable or disable future role recovery snapshots", [option("enabled", 5, "Remember role IDs for three-hour staff recovery")]),
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
        sub("export", "Download up to one hundred member cases and their notes", [member(), option("format", 3, "Report format", false, { choices: ["json", "csv", "text"].map(value => ({ name: value, value })) }), option("before", 4, "Export case numbers below this number", false, { min_value: 1 })]),
        sub("list", "Browse this server's recent cases", [option("before", 4, "Show cases before this case number", false, { min_value: 1 })]),
        sub("view", "View one case", [caseNumber()]),
        sub("history", "See a member's recent cases", [member(), option("before", 4, "Show cases before this case number", false, { min_value: 1 })]),
        sub("reason", "Update a case's reason", [caseNumber(), text("reason", "The corrected reason")]),
        sub("note", "Add a staff note to a case", [caseNumber(), text("note", "The note to save")]),
        sub("evidence", "Attach an evidence file to a case", [caseNumber(), option("file", 11, "An image or video file")]),
    ]),
    command("settings", "Configure Sonata for this server", PERMS.GUILD, [
        sub("view", "See this server's Sonata settings"),
        sub("videoembeds", "Automatically embed supported videos in a channel", [option("enabled", 5, "Enable automatic video embeds"), channel([0, 5])]),
        sub("prefix", "Set the prefix used for message commands", [option("prefix", 3, "Between one and five characters", true, { min_length: 1, max_length: 5 })]),
        sub("modlog", "Choose the moderation log channel", [option("channel", 7, "Where moderation actions are logged", true, { channel_types: [0, 5] })]),
        sub("dm", "Choose whether punishments send a DM", [option("enabled", 5, "Send the affected user a DM")]),
        sub("message", "Customize a punishment DM", [option("action", 3, "The punishment", true, { choices: ["ban", "tempban", "softban", "kick", "timeout", "warn", "jail", "unjail"].map(value => ({ name: value, value })) }), text("text", "Use {user}, {moderator}, {reason}, {duration}, {case} or {server}")]),
    ]),
    command("automod", "Configure Discord's built-in automatic moderation", PERMS.GUILD, [
        ...AUTOMOD_OPTIONS,
        sub("allowadd", "Allow a word in Sonata's word filter", [text("word", "Allowed word or wildcard")]),
        sub("allowremove", "Remove an allowed word", [text("word", "Existing allowed word")]),
        sub("exemptrole", "Exempt a role from a Sonata rule", [option("rule", 3, "Sonata rule", true, { choices: ["words", "mentions", "spam", "regex", "profile"].map(value => ({ name: value, value })) }), role(), option("enabled", 5, "Exempt this role")]),
        sub("exemptchannel", "Exempt a channel from a Sonata rule", [option("rule", 3, "Sonata message rule", true, { choices: ["words", "mentions", "spam", "regex"].map(value => ({ name: value, value })) }), channel([0, 5, 15, 16]), option("enabled", 5, "Exempt this channel")]),
        sub("words", "View Sonata's blocked and allowed words"),
        sub("config", "View Sonata's rules and their exemptions"),
        sub("wordsadd", "Add a blocked word or wildcard", [text("word", "A word or wildcard, such as *badword*")]),
        sub("wordsremove", "Remove a blocked word or wildcard", [text("word", "The existing word or wildcard")]),
        sub("mentions", "Set the blocked mention threshold", [option("limit", 4, "Between one and fifty unique mentions", true, { min_value: 1, max_value: 50 })]),
        sub("spam", "Enable or disable Discord's spam filtering", [option("enabled", 5, "Enable automatic spam filtering")]),
        sub("list", "See AutoMod rules managed by Sonata"),
    ]),
];

export const slashCommands = () => COMMANDS.map(({ permission, aliases, ...value }) => ({ ...value, default_member_permissions: permission && !delegatedCommand(value.name) ? permission.toString() : null, contexts: [0], integration_types: [0] }));

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
    if (!selected) throw Object.assign(new Error("Choose a valid subcommand."), { commandName: definition.name });
    const values = Object.fromEntries((group ? data.options[0].options ?? [] : data.options ?? []).map(option => [option.name, option.type === 11 ? attachments[option.value] : option.value]));
    try { return { definition, name: definition.name, sub: group ? selected.name : "", options: validate(values, selected.options) }; }
    catch (error) { throw Object.assign(error, { commandName: definition.name }); }
}

export function parsePrefix(content, prefix, attachments = []) {
    if (!content.startsWith(prefix) || content.length > 2500) return null;
    const tokens = content.slice(prefix.length).trim().match(/"[^"\r\n]*"|'[^'\r\n]*'|\S+/g)?.map(value => value.replace(/^(["'])([\s\S]*)\1$/, "$2")) ?? [];
    const word = tokens.shift()?.toLowerCase();
    if (!word) return null;
    const definition = COMMANDS.find(command => command.name === word || command.aliases.includes(word));
    if (!definition) return null;
    if (definition.name === "afk" && !["set", "clear", "view"].includes(tokens[0])) tokens.unshift("set");
    if (["levels", "verification", "lockdown"].includes(definition.name) && !tokens.length) tokens.push(definition.name === "levels" ? "rank" : "view");
    if (definition.name === "modstats" && !tokens.length) tokens.push("summary");
    if (definition.name === "commandstats" && !tokens.length) tokens.push("summary");
    if (["commandsettings", "fakepermissions", "nicknamepolicy"].includes(definition.name) && !tokens.length) tokens.push("view");
    if (definition.name === "musicsettings" && !tokens.length) tokens.push("view");
    if (definition.name === "prefix" && !tokens.length) tokens.push("view");
    if (["emoji", "sticker", "honeypot"].includes(definition.name) && !tokens.length) tokens.push("list");
    if (definition.name === "voicemaster" && !tokens.length) tokens.push("room");
    if (definition.name === "download" && !tokens.length) tokens.push("message");
    const group = definition.options[0]?.type === 1;
    if (definition.name === "stick") tokens.unshift(["unstick", "unstickmessage"].includes(word) ? "remove" : ["set", "remove"].includes(tokens[0]) ? tokens.shift() : "set");
    const subName = group ? tokens.shift()?.toLowerCase() : "";
    const selected = group ? definition.options.find(option => option.name === subName) : definition;
    if (!selected) throw Object.assign(new Error(`Use ${prefix}help to see this command's subcommands.`), { commandName: definition.name });
    const values = {};
    for (let i = 0; i < selected.options.length; i++) {
        const option = selected.options[i];
        if (option.type === 11) values[option.name] = attachments[0];
        else if ([6, 7, 8].includes(option.type) && !option.required && tokens[0] && !/^(?:<@!?|<@&|<#)?\d{17,20}>?$/.test(tokens[0])) values[option.name] = undefined;
        else if (option.name === "duration" && !option.required && tokens[0] && !/^(?:\d+(?:\.\d+)?[smhdw])+$/i.test(tokens[0])) values[option.name] = undefined;
        else values[option.name] = option.type === 3 && i === selected.options.length - 1 ? tokens.splice(0).join(" ") || undefined : tokens.shift();
    }
    const replyField = definition.name === "download" ? { message: "message", emoji: "emoji", sticker: "id" }[subName] : ["emoji", "sticker"].includes(definition.name) && subName === "steal" ? definition.name === "emoji" ? "emoji" : "id" : null;
    if (replyField && !values[replyField]) values[replyField] = "reply";
    try { return { definition, name: definition.name, sub: group ? selected.name : "", options: validate(values, selected.options) }; }
    catch (error) { throw Object.assign(error, { commandName: definition.name }); }
}

export function expandAlias(content, prefix, aliases = {}) {
    const match = /^\s*(\S+)/.exec(content.slice(prefix.length));
    const name = match?.[1].toLowerCase();
    if (!content.startsWith(prefix) || !name || !Object.hasOwn(aliases, name)) return content;
    return prefix + aliases[name] + content.slice(prefix.length + match[0].length);
}
