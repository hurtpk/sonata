/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { writeFile } from "node:fs/promises";
import { COMMANDS, slashName } from "../bot/commands.mjs";
import { reference } from "../bot/commandReference.mjs";
import { DASHBOARD_ACTIONS } from "../bot/dashboard.mjs";

const groups = {
    Moderation: "ban tempban softban banlist unban kick timeout untimeout nickname warn warnings warnremove warnclear escalation jailsetup jail unjail case modstats",
    Security: "honeypot automod antiraid antinuke lockdown nicknamepolicy verification",
    Music: "fm voice voicemaster play pause resume skip stop queue nowplaying volume shuffle remove loop seek filter voteskip musicsettings",
    Community: "welcome goodbye autorole autonick joinlogs autoresponder tag poll giveaway levels ticket appeals afk",
    Media: "download emoji sticker sonata",
};
const catalog = COMMANDS.flatMap(command => (command.options[0]?.type === 1 ? command.options : [command]).map(sub => {
    const name = command.name + (sub === command ? "" : " " + sub.name);
    return { name, slashName: slashName(name), options: sub.options, aliases: command.aliases, category: Object.keys(groups).find(key => groups[key].split(" ").includes(command.name)) ?? "Server tools", websiteSetup: DASHBOARD_ACTIONS[command.name]?.includes(sub === command ? "run" : sub.name) ?? false, ...reference(command, sub) };
}));
await writeFile(new URL("public/catalog.json", import.meta.url), JSON.stringify(catalog));
console.log(`Generated ${catalog.length} public command forms.`);
