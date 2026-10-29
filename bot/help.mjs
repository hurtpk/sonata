/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { COMMANDS } from "./commands.mjs";
import { embed, fail } from "./discord.mjs";

const GROUPS = {
    general: { label: "General & information", names: ["help", "ping", "choose", "roll", "coinflip", "8ball", "timestamp", "snowflake", "afk", "dashboard", "userinfo", "avatar", "banner", "serverinfo", "membercount", "roleinfo", "roles", "channelinfo", "servericon", "serverbanner", "boosts", "firstmessage"] },
    moderation: { label: "Moderation & cases", names: ["ban", "tempban", "softban", "banlist", "unban", "kick", "timeout", "untimeout", "nickname", "warn", "warnings", "warnremove", "warnclear", "escalation", "jailsetup", "jail", "unjail", "case", "modstats"] },
    security: { label: "Security & AutoMod", names: ["honeypot", "automod", "antiraid", "antinuke", "lockdown", "nicknamepolicy"] },
    server: { label: "Server management", names: ["role", "settings", "prefix", "eventlog", "alias", "purge", "slowmode", "lock", "unlock", "hide", "unhide", "pin", "unpin", "pins", "channel", "stick", "fakepermissions", "commandsettings", "commandstats"] },
    community: { label: "Community", names: ["welcome", "goodbye", "autorole", "autonick", "joinlogs", "autoresponder", "tag", "poll", "giveaway", "verification", "levels"] },
    support: { label: "Tickets & appeals", names: ["ticket", "appeals"] },
    media: { label: "Files & expressions", names: ["download", "emoji", "sticker", "sonata"] },
    music: { label: "Music & voice", names: ["voice", "voicemaster", "play", "pause", "resume", "skip", "stop", "queue", "nowplaying", "volume", "shuffle", "remove", "loop", "seek", "filter", "voteskip", "musicsettings"] },
};
const usage = (name, options) => `${name} ${options.map(option => option.required ? `<${option.name}>` : `[${option.name}]`).join(" ")}`.trim();
const entries = names => COMMANDS.filter(command => names.includes(command.name)).flatMap(command => command.options[0]?.type === 1 ? command.options.map(sub => ({ ...sub, name: `${command.name} ${sub.name}` })) : [command]);

export function helpPage(owner, group = "home", page = 0, expires = Date.now() + 30 * 60_000) {
    if (!["home", "all", ...Object.keys(GROUPS)].includes(group)) fail("Choose an available help category.");
    const values = group === "all" ? COMMANDS : group === "home" ? [] : entries(GROUPS[group].names), size = group === "all" ? 10 : 6;
    const pages = Math.max(1, Math.ceil(values.length / size));
    if (!Number.isInteger(page) || page < 0 || page >= pages) fail(`Choose a help page from 1 to ${pages}.`);
    const response = group === "home" ? embed("Sonata · help", `**${entries(COMMANDS.map(command => command.name)).length} commands across ${Object.keys(GROUPS).length} categories.**\nChoose a category below, or use \`help <command>\`.\n\n` + Object.values(GROUPS).map(value => `**${value.label}** · ${entries(value.names).length}`).join("\n")) : embed(`Sonata · ${group === "all" ? "All commands" : GROUPS[group].label}`, values.slice(page * size, (page + 1) * size).map(value => group === "all" ? `**${value.name}** · ${value.description}` : `**${value.name}**\n\`${usage(value.name, value.options)}\`\n${value.description}`).join("\n\n"));
    response.embeds[0].color = 0x34363c;
    if (group === "home") response.embeds[0].description += "\n\n[Sonata dashboard](https://sonata.hurts.workers.dev) · Manage settings, disabled commands and more.";
    response.embeds[0].footer = { text: `${group === "home" ? "Choose a category" : `Page ${page + 1} of ${pages}`} • Slash commands or your server prefix • <Required> [Optional]` };
    const id = (action, destination = group, target = page) => `snhelp:${owner}:${expires}:${destination}:${target}:${action}`;
    response.components = [
        { type: 1, components: [{ type: 3, custom_id: id("select"), placeholder: "Select a category…", min_values: 1, max_values: 1, options: [{ label: "All commands", value: "all", default: group === "all" }, ...Object.entries(GROUPS).map(([key, value]) => ({ label: value.label, value: key, description: `${entries(value.names).length} commands`, default: group === key }))] }] },
        { type: 1, components: [
            { type: 2, style: 2, emoji: { name: "◀️" }, custom_id: id("prev", group === "home" ? "all" : group, group === "home" ? Math.ceil(COMMANDS.length / 10) - 1 : Math.max(0, page - 1)), disabled: group !== "home" && page === 0 },
            { type: 2, style: 1, emoji: { name: "🏠" }, custom_id: id("home", "home", 0) },
            { type: 2, style: 2, emoji: { name: "▶️" }, custom_id: id("next", group === "home" ? "all" : group, group === "home" ? 0 : Math.min(pages - 1, page + 1)), disabled: group !== "home" && page >= pages - 1 },
        ] },
    ];
    return response;
}

export function helpInteraction(data, botId) {
    const error = text => ({ type: 4, data: { ...embed("Sonata help", text), flags: 64 } });
    const id = data.data?.custom_id;
    if (typeof id !== "string" || data.message?.author?.id !== botId) return error("Open a new help menu with /help or your server's prefix.");
    const match = /^snhelp:(\d{17,20}):(\d{13}):([a-z]+):(\d{1,3}):(select|prev|next|home)$/.exec(id);
    if (!match || !data.message.components?.some(row => row.components?.some(component => component.custom_id === id && !component.disabled))) return error("That help control is no longer available. Open a new help menu.");
    const [, owner, expires, group, page, action] = match;
    if (data.member?.user?.id !== owner) return error("This menu belongs to someone else. Run /help to open your own.");
    if (Number(expires) < Date.now()) return error("This menu has expired. Run /help to open a new one.");
    if ((action === "select" && (data.data.component_type !== 3 || data.data.values?.length !== 1 || !["all", ...Object.keys(GROUPS)].includes(data.data.values[0]))) || (action !== "select" && data.data.component_type !== 2)) return error("Choose an available help control.");
    try { return { type: 7, data: helpPage(owner, action === "select" ? data.data.values[0] : group, action === "select" ? 0 : Number(page), Number(expires)) }; }
    catch { return error("That help page is no longer available. Open a new help menu."); }
}

export function help(command) {
    const query = command.options.command?.trim().toLowerCase();
    if (!query) return helpPage(command.actor);
    if (query.replace(/^[,/]/, "") === "modlogs") return embed("Help · modlogs", "`modlogs <victim ID>`\nBrowse a member's Sonata cases with emoji page buttons and moderator/action filters.\n\n`case <case number>` shows a single action and evidence.\n`modstats <staff ID>` shows completed actions and case numbers for that moderator.");
    if (/^\d+$/.test(query)) return helpPage(command.actor, "all", Number(query) - 1);
    if (Object.hasOwn(GROUPS, query) && !COMMANDS.some(value => value.name === query)) return helpPage(command.actor, query);
    const [name, sub] = query.replace(/^[,/]/, "").split(/\s+/), definition = COMMANDS.find(value => value.name === name || value.aliases.includes(name));
    if (!definition) fail("That command does not exist. Use help to browse the available commands.");
    const values = definition.options[0]?.type === 1 ? definition.options.filter(value => !sub || value.name === sub) : [definition];
    if (!values.length) fail("That subcommand does not exist.");
    const response = helpPage(command.actor, Object.keys(GROUPS).find(key => GROUPS[key].names.includes(definition.name)));
    response.embeds = embed(`Help · ${definition.name}`, `${definition.description}\n\n` + values.map(value => `\`${usage(value === definition ? definition.name : `${definition.name} ${value.name}`, value.options)}\`\n${value.description}`).join("\n\n") + (definition.aliases.length ? `\n\nPrefix aliases: ${definition.aliases.join(", ")}.` : "")).embeds;
    return response;
}
