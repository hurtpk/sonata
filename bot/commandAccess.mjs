/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embed, fail, highestRole, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

export const DELEGATED_COMMANDS = {
    ban: ["ban", "tempban", "softban", "banlist", "unban"],
    kick: ["kick"],
    timeout: ["timeout", "untimeout"],
    warnings: ["warn", "warnings", "warnremove", "warnclear"],
    messages: ["purge"],
    nicknames: ["nickname"],
    cases: ["case"],
};
export const delegatedCommand = name => Object.values(DELEGATED_COMMANDS).some(names => names.includes(name));
export const delegatedRole = (settings, id) => !!settings.fakePermissions?.[id]?.length;

export function commandAccess(command, settings, actor, roles) {
    if ((settings.disabledCommands ?? []).some(name => name === command.name || name === `${command.name} ${command.sub}`)) fail("This command is disabled in this server. A server manager can enable it in the Sonata dashboard.", "denied");
    return roles.some(role => actor.roles.includes(role.id) && (settings.fakePermissions?.[role.id] ?? []).some(capability => DELEGATED_COMMANDS[capability]?.includes(command.name)));
}

export function fakePermissions(context, store) {
    const { command, actor, guild, roles } = context, settings = store.settings(guild.id), o = command.options;
    requirePermission(memberPermissions(actor, roles, guild), PERMS.ADMIN);
    const grants = settings.fakePermissions ?? {};
    if (command.sub === "view") return embed("Bot-only permissions", Object.entries(grants).filter(([id]) => !o.role || id === o.role).map(([id, values]) => `<@&${id}>: ${values.join(", ")}`).join("\n") || "No bot-only permissions granted.");
    const role = roles.find(value => value.id === o.role);
    if (command.sub === "grant") {
        if (!role || role.id === guild.id || role.managed || role.id === settings.jailRole) fail("Choose an ordinary staff role, other than everyone or the jail role.");
        const top = highestRole(actor, roles, guild.id);
        if (actor.user.id !== guild.owner_id && (role.position > top.position || (role.position === top.position && BigInt(role.id) <= BigInt(top.id)))) fail("Choose a role below your own highest role.", "denied");
        if (settings.autoroles?.roles?.[role.id] || settings.verification?.role === role.id || Object.values(settings.levels?.rewards ?? {}).includes(role.id)) fail("Remove this role from autoroles, verification and level rewards before granting bot-only permissions.");
        grants[o.role] = [...new Set([...(grants[o.role] ?? []), o.permission])];
    } else if (grants[o.role]) {
        grants[o.role] = grants[o.role].filter(value => value !== o.permission);
        if (!grants[o.role].length) delete grants[o.role];
    }
    settings.fakePermissions = grants; store.saveSettings(guild.id, settings);
    const n = store.begin(command, `bot permission ${command.sub}`, o.role, `${o.permission} permission ${command.sub === "grant" ? "granted" : "revoked"}.`);
    store.status(guild.id, n, "completed");
    return embed("Bot-only permissions saved", `${command.sub === "grant" ? "Granted" : "Revoked"} **${o.permission}** for <@&${o.role}>.\nThese grants only authorize Sonata commands. Discord permissions and role positions are unchanged; Sonata still needs the real permissions and both role hierarchy checks still apply.\nCase #${n}.`);
}

export function commandSettings(context, store, definitions) {
    const { command, guild } = context, settings = store.settings(guild.id), disabled = settings.disabledCommands ?? [];
    if (command.sub === "view") return embed("Disabled commands", disabled.map(name => `\`${name}\``).join("\n") || "All commands are enabled.");
    const parts = command.options.command.trim().toLowerCase().replace(/^[,/]/, "").split(/\s+/), definition = definitions.find(value => value.name === parts[0] || value.aliases.includes(parts[0]));
    if (!definition || parts.length > 2 || (parts[1] && !definition.options.some(value => value.type === 1 && value.name === parts[1]))) fail("Choose an existing command or a command and subcommand.");
    if (["help", "dashboard", "commandsettings", "fakepermissions"].includes(definition.name)) fail("Help, dashboard and permission controls must stay available.");
    const name = [definition.name, ...parts.slice(1)].join(" ");
    settings.disabledCommands = command.sub === "disable" ? [...new Set([...disabled, name])] : disabled.filter(value => value !== name);
    store.saveSettings(guild.id, settings);
    return embed("Command settings saved", `\`${name}\` is ${command.sub === "disable" ? "disabled" : "enabled"}. This applies to prefix commands, slash commands and matching dashboard actions.${disabled.includes(definition.name) && parts[1] ? " The parent command is also disabled; enable it separately." : ""}`);
}
