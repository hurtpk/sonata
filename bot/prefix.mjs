/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

export function prefixCommand(context, store) {
    const { command, guild, actor, roles } = context, settings = store.settings(guild.id);
    if (command.sub === "view") return embed("Command prefixes", `Server: \`${settings.prefix}\`\nPersonal: ${store.get("SELECT prefix FROM user_prefixes WHERE user=?", command.actor)?.prefix || "Not set"}\nUse prefix set to change the server prefix, prefix self to set your own, or /prefix if you forget it.`);
    if (["set", "remove"].includes(command.sub)) requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD);
    if (["set", "self"].includes(command.sub) && !/^[^\s/@<>`]{1,5}$/.test(command.options.prefix)) fail("Choose one to five characters without whitespace, mentions, slashes or backticks.");
    if (command.sub === "self") store.run("INSERT INTO user_prefixes VALUES (?,?) ON CONFLICT(user) DO UPDATE SET prefix=excluded.prefix", command.actor, command.options.prefix);
    if (command.sub === "selfclear") store.run("DELETE FROM user_prefixes WHERE user=?", command.actor);
    if (["set", "remove"].includes(command.sub)) { settings.prefix = command.sub === "set" ? command.options.prefix : ","; store.saveSettings(guild.id, settings); }
    return embed("Prefix saved", ["self", "selfclear"].includes(command.sub) ? "Your personal prefix was updated. The server prefix still works too." : `This server's prefix is now \`${settings.prefix}\`. Slash commands still work.`);
}
