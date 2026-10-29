/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channelPermissions, embed, fail, highestRole, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { delegatedRole } from "./commandAccess.mjs";

export const COMMUNITY_COMMANDS = ["tag", "autoresponder", "welcome", "goodbye", "autorole", "joinlogs", "autonick"];
const safeBits = PERMS.VIEW | PERMS.SEND | PERMS.HISTORY | PERMS.EMBEDS | PERMS.ATTACH | PERMS.CONNECT | 2097152n | 64n | 256n | 512n | 262144n | 32768n;
export const safeAutorole = role => !role.managed && !(BigInt(role.permissions) & ~safeBits);
export const expandMessage = (text, user, guild) => text.replace(/\{(user|username|server|id)\}/g, (_, key) => ({ user: `<@${user.id}>`, username: user.username || user.id, server: guild.name, id: user.id })[key]);

export async function messageChannel(context, id) {
    const channel = await context.api(`/channels/${id}`);
    if (channel.guild_id !== context.guild.id || ![0, 5].includes(channel.type)) fail("Choose a text or announcement channel in this server.");
    requirePermission(channelPermissions(context.actor, context.roles, context.guild, channel), PERMS.VIEW | PERMS.SEND);
    requirePermission(channelPermissions(context.bot, context.roles, context.guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.EMBEDS);
    return channel;
}

export async function communityCommand(context, store) {
    const { command, guild, roles, actor, bot, api } = context, o = command.options, sub = command.sub, settings = store.settings(guild.id);
    const save = () => { store.saveSettings(guild.id, settings); return embed("Settings saved", "This server's configuration was updated."); };
    if (command.name === "tag") {
        const tags = settings.tags ?? {}, name = o.name?.trim().toLowerCase();
        if (["create", "edit", "delete"].includes(sub)) requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD);
        if (sub === "list") { const names = Object.keys(tags).sort(), pages = Math.max(1, Math.ceil(names.length / 20)), page = o.page ?? 1; if (page > pages) fail(`Choose a tag page from 1 to ${pages}.`); return embed(`Server tags · ${page}/${pages}`, names.slice((page - 1) * 20, page * 20).join("\n") || "No tags saved."); }
        if (!/^[a-z0-9_-]{1,32}$/.test(name) || ["__proto__", "constructor", "prototype"].includes(name)) fail("Use a tag name with one to 32 letters, numbers, underscores or hyphens.");
        const tag = Object.hasOwn(tags, name) ? tags[name] : null;
        if (sub === "create" && tag) fail("That tag already exists. Use tag edit.");
        if (sub !== "create" && !tag) fail("That tag does not exist in this server.");
        if (sub === "show") return embed(name, tag.text);
        if (sub === "info") return embed(name, `Created by <@${tag.author}>\nLast edited by <@${tag.editor}>\nUpdated <t:${Math.floor(tag.at / 1000)}:R>`);
        if (sub === "create" && Object.keys(tags).length >= 100) fail("This server already has 100 tags.");
        if (sub === "delete") delete tags[name];
        else tags[name] = { text: o.text, author: tag?.author ?? command.actor, editor: command.actor, at: Date.now() };
        settings.tags = tags; return save();
    }
    if (command.name === "autoresponder") {
        const replies = settings.replies ?? {}, key = o.trigger?.trim().toLowerCase();
        if (sub === "list") return embed("Automatic replies", Object.keys(replies).join("\n") || "No replies configured.");
        if (!key || key.length > 100 || key.startsWith(settings.prefix)) fail("Choose a trigger up to 100 characters that doesn't begin with the command prefix.");
        const existing = Object.hasOwn(replies, key) ? replies[key] : null;
        if (["view", "remove", "update"].includes(sub) && !existing) fail("That automatic reply does not exist.");
        if (sub === "view") return embed(key, existing);
        if (sub === "add" && existing) fail("That trigger exists. Use autoresponder update.");
        if (sub === "add" && Object.keys(replies).length >= 20) fail("This server already has 20 automatic replies.");
        if (["__proto__", "constructor", "prototype"].includes(key)) fail("Choose a different trigger.");
        if (sub === "remove") delete replies[key]; else replies[key] = o.reply;
        settings.replies = replies; return save();
    }
    if (["welcome", "goodbye"].includes(command.name)) {
        const values = settings[command.name] ?? {};
        if (sub === "variables") return embed("Message variables", "{user}: member mention\n{username}: username\n{server}: server name\n{id}: user ID\nMentions in these messages do not send notifications.");
        if (sub === "list") return embed(`${command.name} channels`, Object.keys(values).map(id => `<#${id}>`).join("\n") || "No messages configured.");
        await messageChannel(context, o.channel);
        if (sub === "view") return embed("Configured message", values[o.channel] || "No message configured for this channel.");
        if (sub === "test") { if (!values[o.channel]) fail("Configure a message for this channel first."); const posted = await api(`/channels/${o.channel}/messages`, { method: "POST", body: embed(`${command.name} preview`, expandMessage(values[o.channel], actor.user, guild)) }); return embed("Preview posted", `https://discord.com/channels/${guild.id}/${o.channel}/${posted.id}`); }
        if (sub === "add" && !values[o.channel] && Object.keys(values).length >= 3) fail("Configure at most three channels for each message type.");
        if (sub === "remove") delete values[o.channel]; else values[o.channel] = o.message;
        settings[command.name] = values; return save();
    }
    if (command.name === "joinlogs") {
        if (sub === "view") return embed("Member logs", settings.joinlogs ? `<#${settings.joinlogs}>` : "Disabled.");
        if (sub === "set") { await messageChannel(context, o.channel); settings.joinlogs = o.channel; } else settings.joinlogs = "";
        return save();
    }
    if (command.name === "autonick") {
        if (sub === "view") return embed("Automatic nickname", settings.autonick || "Disabled.");
        if (sub === "set") context.botPermission(PERMS.NICKNAMES);
        settings.autonick = sub === "set" ? o.template : ""; return save();
    }
    const config = settings.autoroles ?? { enabled: true, roles: {} };
    if (sub === "list") return embed(`Autoroles · ${config.enabled ? "enabled" : "paused"}`, Object.entries(config.roles).map(([id, mode]) => `<@&${id}> · ${mode}`).join("\n") || "No roles configured.");
    if (["enable", "disable"].includes(sub)) config.enabled = sub === "enable";
    else if (sub === "remove") delete config.roles[o.role];
    else {
        context.botPermission(PERMS.ROLES);
        const role = roles.find(role => role.id === o.role), above = member => { const top = highestRole(member, roles, guild.id); return role && (top.position > role.position || (top.position === role.position && BigInt(top.id) < BigInt(role.id))); };
        if (!role || role.id === guild.id || role.id === settings.jailRole || !safeAutorole(role) || delegatedRole(settings, o.role)) fail("Choose an ordinary role without moderation or management permissions.");
        if ((actor.user.id !== guild.owner_id && !above(actor)) || !above(bot)) fail("The autorole must be below both your role and Sonata Bot's role.");
        if (!config.roles[o.role] && Object.keys(config.roles).length >= 5) fail("Configure at most five autoroles.");
        config.roles[o.role] = o.audience;
    }
    settings.autoroles = config; return save();
}
