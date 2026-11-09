/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { dashboardAccess } from "./dashboardAccess.mjs";
import { commandAccess } from "./commandAccess.mjs";
import { checkOperations } from "./ownerConsole.mjs";
import { channelPermissions, fail, isId, memberPermissions, PERMS, requirePermission } from "./discord.mjs";

const types = { messages: ["messages"], voice: ["voice"], users: ["joins", "members"], channels: ["channels"], roles: ["roles"], bans: ["bans"], moderation: [] };

export async function setupLogging(input, actorId, bot) {
    const { api, store } = bot, options = input.options;
    if (!isId(input.guild) || !store.get("SELECT id FROM bot_guilds WHERE id=? AND active=1", input.guild) || store.get("SELECT id FROM guild_blacklist WHERE id=?", input.guild)) fail("Choose an installed, allowed server.");
    const { guild, actor, roles } = await dashboardAccess(api, input.guild, actorId, store);
    requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD | PERMS.CHANNELS);
    if (!Array.isArray(options?.routes) || !options.routes.length || options.routes.length > 7 || options.routes.some(route => !route || !Object.hasOwn(types, route.type)) || new Set(options.routes.map(route => route.type)).size !== options.routes.length) fail("Choose between one and seven different logging types.");
    const settings = store.settings(guild.id);
    checkOperations(store, { name: "eventlog", sub: "set", guild: guild.id });
    const [channels, member] = await Promise.all([api(`/guilds/${guild.id}/channels`), api(`/guilds/${guild.id}/members/${bot.session.userId}`)]);
    requirePermission(memberPermissions(member, roles, guild), PERMS.CHANNELS);
    const contextChannel = channels.find(channel => [0, 5].includes(channel.type) && (channelPermissions(actor, roles, guild, channel) & PERMS.VIEW));
    if (!contextChannel) fail("Choose a server with an accessible text channel.");
    commandAccess({ name: "eventlog", sub: "set", channel: contextChannel.id }, settings, actor, roles, guild);
    if (options.routes.some(route => route.type === "moderation")) commandAccess({ name: "settings", sub: "modlog", channel: contextChannel.id }, settings, actor, roles, guild);
    if (options.role && (!isId(options.role) || options.role === guild.id || !roles.some(role => role.id === options.role))) fail("Choose a staff role from this server, or owner and administrators only.");
    const category = options.category ? channels.find(channel => channel.id === options.category && channel.type === 4) : null;
    if (options.category && !category) fail("Choose an existing category in this server.");
    const name = typeof options.name === "string" ? options.name.trim() : "Sonata Logs";
    if (!category && (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name))) fail("Enter a category name between 1 and 100 characters.");
    if (category) {
        requirePermission(channelPermissions(actor, roles, guild, category), PERMS.VIEW | PERMS.CHANNELS);
        requirePermission(channelPermissions(member, roles, guild, category), PERMS.VIEW | PERMS.CHANNELS);
    }
    for (const route of options.routes) {
        if (route.channel) {
            const channel = channels.find(channel => channel.id === route.channel && [0, 5].includes(channel.type));
            if (!channel) fail("Choose a text or announcement channel in this server.");
            requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.SEND);
            requirePermission(channelPermissions(member, roles, guild, channel), PERMS.VIEW | PERMS.SEND | PERMS.EMBEDS | PERMS.ATTACH);
        } else if (typeof route.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(route.name)) fail("New channel names must use 1 to 100 lowercase letters, numbers or hyphens.");
    }
    const needsChannels = options.routes.some(route => !route.channel);
    if (needsChannels && !category && channels.some(channel => channel.type === 4 && channel.name === name)) fail("That category already exists. Select it instead of creating a duplicate.");
    const overwrites = [
        { id: guild.id, type: 0, allow: "0", deny: PERMS.VIEW.toString() },
        { id: bot.session.userId, type: 1, allow: (PERMS.VIEW | PERMS.SEND | PERMS.HISTORY | PERMS.EMBEDS | PERMS.ATTACH | PERMS.CHANNELS).toString(), deny: "0" },
        { id: actorId, type: 1, allow: (PERMS.VIEW | PERMS.SEND | PERMS.HISTORY).toString(), deny: "0" },
        ...(options.role ? [{ id: options.role, type: 0, allow: (PERMS.VIEW | PERMS.HISTORY).toString(), deny: "0" }] : []),
    ];
    const created = [], destinations = new Map(), named = new Map();
    let parent = category;
    try {
        if (needsChannels && !parent) { parent = await api(`/guilds/${guild.id}/channels`, { method: "POST", body: { name, type: 4, permission_overwrites: overwrites }, reason: "Sonata logging setup" }); created.push(parent); }
        for (const route of options.routes) {
            let id = route.channel;
            if (!id) {
                let channel = named.get(route.name);
                if (!channel) {
                    if (channels.some(channel => channel.parent_id === parent.id && channel.name === route.name)) fail(`A channel named ${route.name} already exists in this category. Select it as the destination.`);
                    channel = await api(`/guilds/${guild.id}/channels`, { method: "POST", body: { name: route.name, type: 0, parent_id: parent.id, permission_overwrites: overwrites }, reason: "Sonata logging setup" });
                    created.push(channel); named.set(route.name, channel);
                }
                id = channel.id;
            }
            destinations.set(route.type, id);
        }
        const next = store.settings(guild.id); next.eventlogs ??= {};
        for (const [type, channel] of destinations) {
            if (type === "moderation") next.logChannel = channel;
            else for (const event of types[type]) next.eventlogs[event] = channel;
            if (type === "users") next.joinlogs = "";
        }
        store.saveSettings(guild.id, next, actorId, "Dashboard: logging setup");
        return { settings: next, created: created.map(({ id, name, type }) => ({ id, name, type })), routes: Object.fromEntries(destinations) };
    } catch (error) {
        const remaining = [];
        for (const channel of [...created].reverse()) {
            try { await api(`/channels/${channel.id}`, { method: "DELETE", optional: true, reason: "Sonata logging setup could not finish" }); }
            catch { remaining.push(channel.name); }
        }
        if (remaining.length) error.message += ` Some created channels could not be removed: ${remaining.join(", ")}. Select those existing channels when retrying.`;
        throw error;
    }
}
