/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { requireFeature } from "./featureGroups.mjs";
import { channelPermissions, embed, fail, highestRole, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

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

export function commandAccess(command, settings, actor, roles, guild) {
    requireFeature(command, settings);
    if ((settings.disabledCommands ?? []).some(name => name === command.name || name === `${command.name} ${command.sub}`)) fail("This command is disabled in this server. A server manager can enable it in the Sonata dashboard.", "denied");
    if (guild && actor.user.id !== guild.owner_id) {
        const rules = (settings.commandRules ?? []).filter(rule => rule.command === command.name || rule.command === `${command.name} ${command.sub}`);
        const matches = rule => rule.kind === "role" ? rule.target === guild.id || actor.roles.includes(rule.target) : rule.target === command.channel;
        if (rules.some(rule => rule.mode === "deny" && matches(rule))) fail("A server command rule blocks this role or channel.", "denied");
        for (const key of new Set(rules.map(rule => rule.command))) for (const kind of ["role", "channel"]) {
            const allowed = rules.filter(rule => rule.command === key && rule.kind === kind && rule.mode === "allow");
            if (allowed.length && !allowed.some(matches)) fail(`This command is limited to selected ${kind}s.`, "denied");
        }
    }
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
        if (settings.autoroles?.roles?.[role.id] || settings.verification?.role === role.id || Object.values(settings.levels?.rewards ?? {}).includes(role.id) || store.get("SELECT role_menus.id FROM role_menus,json_each(role_menus.data,'$.roles') WHERE guild=? AND json_extract(value,'$.id')=?", guild.id, role.id)) fail("Remove this role from autoroles, verification, role menus and level rewards before granting bot-only permissions.");
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

export async function commandSettings(context, store, definitions) {
    const { command, guild, api, actor, roles } = context, settings = store.settings(guild.id), disabled = settings.disabledCommands ?? [], rules = settings.commandRules ?? [];
    if (command.sub === "view") return embed("Disabled commands", disabled.map(name => `\`${name}\``).join("\n") || "All commands are enabled.");
    if (command.sub === "rules") {
        const page = Math.min(command.options.page ?? 1, Math.max(1, Math.ceil(rules.length / 10)));
        return embed("Command access rules", rules.slice((page - 1) * 10, page * 10).map(rule => `\`${rule.id}\` · \`${rule.command}\` · ${rule.mode} ${rule.kind === "role" ? `<@&${rule.target}>` : `<#${rule.target}>`}`).join("\n") + (rules.length ? `\n\nPage ${page}/${Math.ceil(rules.length / 10)}. Deny wins; allowed roles and channels are both required when configured.` : "No role or channel rules configured."));
    }
    if (command.sub === "unrule") {
        if (!rules.some(rule => rule.id === command.options.id)) fail("Choose a rule ID from commandsettings rules.");
        settings.commandRules = rules.filter(rule => rule.id !== command.options.id); store.saveSettings(guild.id, settings);
        return embed("Command rule removed", `Removed rule \`${command.options.id}\`.`);
    }
    const parts = command.options.command.trim().toLowerCase().replace(/^[,/]/, "").split(/\s+/), definition = definitions.find(value => value.name === parts[0] || value.aliases.includes(parts[0]));
    if (!definition || parts.length > 2 || (parts[1] && !definition.options.some(value => value.type === 1 && value.name === parts[1]))) fail("Choose an existing command or a command and subcommand.");
    if (["help", "dashboard", "commandsettings", "fakepermissions"].includes(definition.name)) fail("Help, dashboard and permission controls must stay available.");
    const name = [definition.name, ...parts.slice(1)].join(" ");
    if (command.sub === "rule") {
        const { mode, role, channel } = command.options;
        if (!!role === !!channel) fail("Choose exactly one role or one channel.");
        if (role && !roles.some(value => value.id === role)) fail("Choose a role from this server.");
        if (channel) {
            const selected = await api(`/channels/${channel}`);
            if (selected.guild_id !== guild.id) fail("Choose a channel from this server.");
            requirePermission(channelPermissions(actor, roles, guild, selected), PERMS.VIEW);
        }
        const kind = role ? "role" : "channel", target = role || channel;
        const previous = rules.find(rule => rule.command === name && rule.kind === kind && rule.target === target);
        if (!previous && rules.length >= 50) fail("Remove a command rule before adding more than 50.");
        const rule = { id: previous?.id ?? crypto.randomUUID().slice(0, 8), command: name, kind, target, mode };
        settings.commandRules = [...rules.filter(value => value.id !== rule.id), rule]; store.saveSettings(guild.id, settings);
        return embed("Command rule saved", `\`${rule.id}\` · \`${name}\` · ${mode} ${role ? `<@&${role}>` : `<#${channel}>`}. Discord permissions still apply.`);
    }
    settings.disabledCommands = command.sub === "disable" ? [...new Set([...disabled, name])] : disabled.filter(value => value !== name);
    store.saveSettings(guild.id, settings);
    return embed("Command settings saved", `\`${name}\` is ${command.sub === "disable" ? "disabled" : "enabled"}. This applies to prefix commands, slash commands and matching dashboard actions.${disabled.includes(definition.name) && parts[1] ? " The parent command is also disabled; enable it separately." : ""}`);
}
