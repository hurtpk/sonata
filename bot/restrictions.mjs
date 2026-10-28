/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { canManage, channelPermissions, embed, fail, isId, memberPermissions, PERMS } from "./discord.mjs";

const view = PERMS.VIEW, send = PERMS.SEND;
const channelsForJail = values => values.filter(channel => [0, 2, 4, 5, 13, 15, 16].includes(channel.type));

async function editBits(api, channel, id, type, mask, allow, deny, audit) {
    const original = channel.permission_overwrites?.find(value => value.id === id);
    const value = { id, type, allow: ((BigInt(original?.allow ?? "0") & ~mask) | allow).toString(), deny: ((BigInt(original?.deny ?? "0") & ~mask) | deny).toString() };
    await api(`/channels/${channel.id}/permissions/${id}`, { method: "PUT", body: value, reason: audit });
    return { id, type, mask: mask.toString(), allow: (BigInt(original?.allow ?? "0") & mask).toString(), deny: (BigInt(original?.deny ?? "0") & mask).toString() };
}

async function restoreBits(api, channelId, saved, audit) {
    const channel = await api(`/channels/${channelId}`, { optional: true });
    if (channel) await editBits(api, channel, saved.id, saved.type, BigInt(saved.mask), BigInt(saved.allow), BigInt(saved.deny), audit);
}

export async function channelAction(context, store, audit) {
    const { command, channel, api, guild, bot } = context, { name, options } = command;
    if (![0, 5].includes(channel.type)) fail("Use this command in a server text or announcement channel.");
    if (name === "purge") {
        context.botPermission(PERMS.MESSAGES | PERMS.HISTORY | PERMS.VIEW, true);
        const messages = await api(`/channels/${channel.id}/messages?limit=${options.member || (options.filter && options.filter !== "all") ? 100 : Math.min(100, options.count + 2)}`);
        const cutoff = Date.now() - 14 * 86400_000 + 60_000;
        const filters = { all: () => true, bots: message => !!message.author.bot, humans: message => !message.author.bot, links: message => /https?:\/\/\S+/i.test(message.content ?? ""), files: message => !!message.attachments?.length, embeds: message => !!message.embeds?.length, pinned: message => !!message.pinned };
        const filter = options.filter ?? "all";
        const matching = messages.filter(message => message.id !== command.id && message.id !== command.reply && (!options.member || message.author.id === options.member) && (!message.pinned || filter === "pinned") && filters[filter](message)).slice(0, options.count);
        const ids = matching.filter(message => Number((BigInt(message.id) >> 22n) + 1420070400000n) > cutoff).map(message => message.id);
        if (ids.length === 1) await api(`/channels/${channel.id}/messages/${ids[0]}`, { method: "DELETE", reason: audit });
        if (ids.length > 1) await api(`/channels/${channel.id}/messages/bulk-delete`, { method: "POST", reason: audit, body: { messages: ids } });
        return `Deleted ${ids.length} recent messages. ${matching.length - ids.length} older messages were kept because Discord cannot bulk-delete messages older than fourteen days.`;
    }
    if (name === "slowmode") {
        context.botPermission(PERMS.CHANNELS, true);
        await api(`/channels/${channel.id}`, { method: "PATCH", body: { rate_limit_per_user: options.seconds }, reason: audit });
        return `Slowmode is ${options.seconds ? `${options.seconds} seconds` : "off"}.`;
    }
    context.botPermission(PERMS.CHANNELS | PERMS.ROLES | PERMS.VIEW, true);
    const kind = ["hide", "unhide"].includes(name) ? "hide" : "lock", saved = store.restriction(guild.id, channel.id, kind);
    if (["unlock", "unhide"].includes(name)) {
        if (!saved) fail("Sonata has no saved permissions to restore for this channel.");
        await restoreBits(api, channel.id, saved.everyone, audit);
        if (saved.bot) await restoreBits(api, channel.id, saved.bot, audit);
        store.clearRestriction(guild.id, channel.id, kind);
        return "The permissions Sonata changed have been restored. Other permission changes were kept.";
    }
    if (saved) fail("Sonata has already applied this restriction to this channel.");
    const mask = kind === "hide" ? view : send;
    const current = channel.permission_overwrites?.find(value => value.id === guild.id);
    const record = { everyone: { id: guild.id, type: 0, mask: mask.toString(), allow: (BigInt(current?.allow ?? "0") & mask).toString(), deny: (BigInt(current?.deny ?? "0") & mask).toString() } };
    store.saveRestriction(guild.id, channel.id, kind, record);
    const oldBot = channel.permission_overwrites?.find(value => value.id === bot.user.id);
    record.bot = { id: bot.user.id, type: 1, mask: mask.toString(), allow: (BigInt(oldBot?.allow ?? "0") & mask).toString(), deny: (BigInt(oldBot?.deny ?? "0") & mask).toString() };
    store.saveRestriction(guild.id, channel.id, kind, record);
    await editBits(api, channel, bot.user.id, 1, mask, mask, 0n, audit);
    await editBits(api, channel, guild.id, 0, mask, 0n, mask, audit);
    return kind === "hide" ? "The everyone role can no longer view this channel. Explicit role or member allows can still grant access." : "The everyone role can no longer send here. Explicit role or member allows and administrators can still send.";
}

export async function jailAction(context, store, target, audit = "Sonata jail setup") {
    const { api, guild, bot, roles, actor } = context, settings = store.settings(guild.id);
    context.botPermission(PERMS.ROLES | PERMS.CHANNELS);
    const channels = channelsForJail(await api(`/guilds/${guild.id}/channels`));
    if (channels.length > 100) fail("Automatic jail setup supports servers with up to 100 channels.");
    if (!target) {
        if (settings.jailRole || settings.jailChannel) {
            if (roles.some(role => role.id === settings.jailRole) && channels.some(channel => channel.id === settings.jailChannel)) return embed("Jail is configured", `Role: <@&${settings.jailRole}>\nChannel: <#${settings.jailChannel}>`);
            fail("The saved jail setup is incomplete. Release jailed members and restore the missing jail role or channel before trying again.");
        }
        let role, jailChannel;
        try {
            role = await api(`/guilds/${guild.id}/roles`, { method: "POST", body: { name: "Jailed", permissions: "0", colors: { primary_color: 0x777777 } }, reason: audit });
            const staff = roles.filter(role => role.id !== guild.id && (BigInt(role.permissions) & (PERMS.TIMEOUT | PERMS.GUILD | PERMS.BAN)));
            if (staff.length > 90) fail("Too many staff roles to configure the jail channel automatically.");
            const overwrites = [{ id: guild.id, type: 0, allow: "0", deny: view.toString() }, { id: role.id, type: 0, allow: (view | send | PERMS.HISTORY).toString(), deny: "0" }, { id: bot.user.id, type: 1, allow: (view | send | PERMS.HISTORY).toString(), deny: "0" }, { id: actor.user.id, type: 1, allow: view.toString(), deny: "0" }, ...staff.map(role => ({ id: role.id, type: 0, allow: view.toString(), deny: "0" }))];
            jailChannel = await api(`/guilds/${guild.id}/channels`, { method: "POST", body: { name: "jail", type: 0, topic: "Sonata moderation jail. Contact server staff to appeal.", permission_overwrites: overwrites }, reason: audit });
            for (const channel of channels) await editBits(api, channel, role.id, 0, view, 0n, view, audit);
            settings.jailRole = role.id; settings.jailChannel = jailChannel.id; store.saveSettings(guild.id, settings);
            return embed("Jail setup complete", `Role: <@&${role.id}>\nChannel: <#${jailChannel.id}>\nMove Sonata Bot above members it needs to manage. Use jail and unjail to restrict members and restore their saved roles.`);
        } catch (error) {
            const cleanupErrors = [];
            if (isId(jailChannel?.id)) try { await api(`/channels/${jailChannel.id}`, { method: "DELETE", reason: "Incomplete Sonata jail setup" }); } catch { cleanupErrors.push("Remove the new jail channel manually."); }
            if (isId(role?.id)) try { await api(`/guilds/${guild.id}/roles/${role.id}`, { method: "DELETE", reason: "Incomplete Sonata jail setup" }); } catch { cleanupErrors.push("Remove the new Jailed role manually."); }
            fail([error.message, ...cleanupErrors].join(" "));
        }
    }
    if (!roles.some(role => role.id === settings.jailRole) || !channels.some(channel => channel.id === settings.jailChannel)) fail("Run jailsetup before jailing a member.");
    const id = target.user.id;
    if (target.user.bot) fail("Use jail for human members. Use other moderation commands for bots.");
    if (store.restriction(guild.id, id, "jail")) fail("That member already has a saved jail restriction.");
    const kept = target.roles.filter(id => roles.find(role => role.id === id)?.managed);
    const after = { ...target, roles: [...kept, settings.jailRole] };
    if (memberPermissions(after, roles, guild) & PERMS.ADMIN) fail("This member has administrator permissions that Sonata cannot remove.");
    const record = { roles: target.roles, overwrites: [], jailRole: settings.jailRole };
    store.saveRestriction(guild.id, id, "jail", record);
    for (const channel of channels.filter(channel => channel.id !== settings.jailChannel)) {
        const old = channel.permission_overwrites?.find(value => value.id === id);
        if (channelPermissions(after, roles, guild, channel) & view) {
            record.overwrites.push({ channel: channel.id, saved: { id, type: 1, mask: view.toString(), allow: (BigInt(old?.allow ?? "0") & view).toString(), deny: (BigInt(old?.deny ?? "0") & view).toString() } });
            store.saveRestriction(guild.id, id, "jail", record);
            await editBits(api, channel, id, 1, view, 0n, view, audit);
        }
    }
    await api(`/guilds/${guild.id}/members/${id}`, { method: "PATCH", body: { roles: after.roles }, reason: audit });
    return `Jailed in <#${settings.jailChannel}>. Original roles are saved for release.`;
}

export async function releaseJail(context, store, target, audit) {
    const { api, guild, roles, actor, bot } = context, id = target.user.id, saved = store.restriction(guild.id, id, "jail");
    if (!saved) fail("That member has no saved Sonata jail restriction.");
    const restored = [...new Set([...target.roles.filter(id => id !== saved.jailRole), ...saved.roles.filter(id => roles.some(role => role.id === id && !role.managed))])];
    canManage(actor, { ...target, roles: restored }, bot, roles, guild);
    if (!(memberPermissions(actor, roles, guild) & PERMS.ADMIN) && roles.some(role => restored.includes(role.id) && (BigInt(role.permissions) & PERMS.ADMIN))) fail("An administrator must restore this member's saved administrator role.");
    for (const value of saved.overwrites) await restoreBits(api, value.channel, value.saved, audit);
    await api(`/guilds/${guild.id}/members/${id}`, { method: "PATCH", body: { roles: restored }, reason: audit });
    store.clearRestriction(guild.id, id, "jail"); store.cancelJobs(guild.id, id, "jail");
    return "Released from jail. Saved roles that still exist have been restored.";
}

export async function maintainJail(event, data, store, api, botId) {
    const guildId = data.guild_id, settings = store.settings(guildId);
    if (!settings.jailRole) return;
    if (event === "CHANNEL_CREATE" && data.id !== settings.jailChannel && channelsForJail([data]).length) {
        const audit = "Keep Sonata jail restrictions on new channels";
        await editBits(api, data, settings.jailRole, 0, view, 0n, view, audit);
        for (const old of data.permission_overwrites ?? []) {
            if (old.type !== 1 || !(BigInt(old.allow) & view)) continue;
            const record = store.restriction(guildId, old.id, "jail");
            if (!record) continue;
            if (!record.overwrites.some(value => value.channel === data.id)) {
                record.overwrites.push({ channel: data.id, saved: { id: old.id, type: 1, mask: view.toString(), allow: (BigInt(old.allow) & view).toString(), deny: (BigInt(old.deny) & view).toString() } });
                store.saveRestriction(guildId, old.id, "jail", record);
            }
            await editBits(api, data, old.id, 1, view, 0n, view, audit);
        }
    }
    if (event === "GUILD_MEMBER_ADD" && store.restriction(guildId, data.user.id, "jail")) {
        const [guild, roles, target, bot] = await Promise.all([api(`/guilds/${guildId}`), api(`/guilds/${guildId}/roles`), api(`/guilds/${guildId}/members/${data.user.id}`), api(`/guilds/${guildId}/members/${botId}`)]);
        const kept = target.roles.filter(id => roles.find(role => role.id === id)?.managed);
        canManage({ user: { id: guild.owner_id }, roles: [] }, target, bot, roles, guild);
        await api(`/guilds/${guildId}/members/${target.user.id}`, { method: "PATCH", body: { roles: [...kept, settings.jailRole] }, reason: "Reapply saved Sonata jail restriction after rejoining" });
    }
}
