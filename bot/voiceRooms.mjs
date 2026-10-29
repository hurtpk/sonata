/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channelPermissions, embed, fail, memberPermissions, PERMS, requirePermission } from "./discord.mjs";
import { editBits, restoreBits } from "./restrictions.mjs";
import { voicePanel } from "./controlPanels.mjs";

const privacy = PERMS.VIEW | PERMS.CONNECT;
const saveRoom = (store, row, data) => store.run("UPDATE voice_rooms SET owner=?,data=? WHERE channel=? AND guild=?", row.owner, JSON.stringify(data), row.channel, row.guild);

export async function voiceRoomCommand(context, store) {
    const { command, guild, api, actor, bot, roles } = context, o = command.options, sub = command.sub, settings = store.settings(guild.id);
    if (["setup", "disable", "config"].includes(sub)) {
        requirePermission(memberPermissions(actor, roles, guild), PERMS.GUILD | PERMS.CHANNELS);
        if (sub === "config") return embed("VoiceMaster", settings.voicemaster ? `Enabled: ${settings.voicemaster.enabled ? "Yes" : "No"}\nJoin-to-create: <#${settings.voicemaster.lobby}>\nRoom category: <#${settings.voicemaster.category}>\nManaged rooms: ${store.get("SELECT COUNT(*) AS n FROM voice_rooms WHERE guild=?", guild.id).n}` : "Not configured. Use voicemaster setup.");
        if (sub === "disable") { if (settings.voicemaster) settings.voicemaster.enabled = false; }
        else {
            context.botPermission(PERMS.CHANNELS | PERMS.ROLES | PERMS.MOVE);
            const lobby = await api(`/channels/${o.channel}`), category = await api(`/channels/${o.category}`);
            if (lobby.guild_id !== guild.id || lobby.type !== 2 || category.guild_id !== guild.id || category.type !== 4) fail("Choose a voice lobby and category in this server.");
            for (const channel of [lobby, category]) { requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW); requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.CHANNELS | PERMS.ROLES); }
            requirePermission(channelPermissions(bot, roles, guild, lobby), PERMS.CONNECT | PERMS.MOVE);
            settings.voicemaster = { lobby: lobby.id, category: category.id, enabled: true };
        }
        store.saveSettings(guild.id, settings);
        return embed("VoiceMaster saved", sub === "disable" ? "New rooms are disabled. Existing rooms keep their controls and are deleted when empty." : "Joining the configured lobby creates your temporary room and moves you into it. Empty rooms are removed automatically. One room per owner and up to 25 rooms per server.");
    }
    const state = await api(`/guilds/${guild.id}/voice-states/${actor.user.id}`, { optional: true });
    const row = state?.channel_id ? store.get("SELECT * FROM voice_rooms WHERE guild=? AND channel=?", guild.id, state.channel_id) : null;
    if (!row) fail("Join a Sonata temporary voice room first.");
    const room = await api(`/channels/${row.channel}`), data = JSON.parse(row.data);
    if (room.guild_id !== guild.id || room.type !== 2) fail("This room is no longer available.");
    requirePermission(channelPermissions(actor, roles, guild, room), PERMS.VIEW | PERMS.CONNECT);
    requirePermission(channelPermissions(bot, roles, guild, room), PERMS.VIEW | PERMS.CHANNELS | PERMS.ROLES);
    if (sub === "room") return { ...embed(room.name, `Owner: <@${row.owner}>\nChannel: <#${row.channel}>\nLimit: ${room.user_limit || "Unlimited"}\nBitrate: ${(room.bitrate ?? 64000) / 1000} kbps`), components: voicePanel(guild.id, row.channel) };
    const staff = memberPermissions(actor, roles, guild) & (PERMS.ADMIN | PERMS.GUILD);
    if (sub === "claim") {
        const previous = await api(`/guilds/${guild.id}/voice-states/${row.owner}`, { optional: true });
        if (previous?.channel_id === row.channel && row.owner !== actor.user.id) fail("The room owner is still connected.");
        row.owner = actor.user.id;
        await editBits(api, room, actor.user.id, 1, privacy, privacy, 0n, "Claimed Sonata voice room"); saveRoom(store, row, data);
        return embed("Room claimed", `You now own <#${row.channel}>.`);
    }
    if (row.owner !== actor.user.id && !staff) fail("Only this room's owner or server management can change it.");
    const audit = `Sonata voice room ${sub} by ${actor.user.id}`;
    if (sub === "name") { const name = o.name.trim(); if (!name) fail("Choose a visible room name."); await api(`/channels/${row.channel}`, { method: "PATCH", body: { name }, reason: audit }); }
    if (sub === "limit") await api(`/channels/${row.channel}`, { method: "PATCH", body: { user_limit: o.limit }, reason: audit });
    if (sub === "bitrate") { const maximum = [96, 128, 256, 384][guild.premium_tier ?? 0] ?? 96; if (o.kbps > maximum) fail(`This server currently supports at most ${maximum} kbps.`); await api(`/channels/${row.channel}`, { method: "PATCH", body: { bitrate: o.kbps * 1000 }, reason: audit }); }
    const change = async (id, type, mask, allow, deny) => {
        data.changes ??= [];
        if (!data.changes.some(value => value.id === id)) {
            if (data.changes.length >= 30) fail("Reset the room's permissions before adding more exceptions.");
            const original = room.permission_overwrites?.find(value => value.id === id);
            data.changes.push({ id, type, mask: privacy.toString(), allow: (BigInt(original?.allow ?? "0") & privacy).toString(), deny: (BigInt(original?.deny ?? "0") & privacy).toString() }); saveRoom(store, row, data);
        }
        await editBits(api, room, id, type, mask, allow, deny, audit);
    };
    if (["lock", "unlock", "hide", "unhide"].includes(sub)) {
        const mask = ["hide", "unhide"].includes(sub) ? PERMS.VIEW : PERMS.CONNECT;
        if (["unlock", "unhide"].includes(sub)) {
            const original = data.changes?.find(value => value.id === guild.id);
            if (!original) fail("Sonata has no saved room privacy settings to restore.");
            await editBits(api, room, guild.id, 0, mask, BigInt(original.allow) & mask, BigInt(original.deny) & mask, audit);
        } else await change(guild.id, 0, mask, 0n, mask);
    }
    if (["transfer", "permit", "reject"].includes(sub)) {
        const target = await api(`/guilds/${guild.id}/members/${o.member}`);
        if ([row.owner, bot.user.id].includes(target.user.id) && sub === "reject") fail("You cannot reject the room owner or Sonata Bot.");
        const targetState = await api(`/guilds/${guild.id}/voice-states/${target.user.id}`, { optional: true });
        if (sub === "transfer") {
            if (target.user.bot || targetState?.channel_id !== row.channel) fail("Transfer ownership to a human member connected to this room.");
            await change(target.user.id, 1, privacy, privacy, 0n); row.owner = target.user.id; saveRoom(store, row, data);
        } else if (sub === "permit") await change(target.user.id, 1, privacy, privacy, 0n);
        else {
            if (memberPermissions(target, roles, guild) & (PERMS.ADMIN | PERMS.GUILD | PERMS.MOVE | PERMS.ROLES)) fail("Server management and voice moderators cannot be rejected through room controls.");
            requirePermission(channelPermissions(bot, roles, guild, room), PERMS.MOVE);
            await change(target.user.id, 1, privacy, 0n, privacy);
            const latest = await api(`/guilds/${guild.id}/voice-states/${target.user.id}`, { optional: true });
            if (latest?.channel_id === row.channel) await api(`/guilds/${guild.id}/members/${target.user.id}`, { method: "PATCH", body: { channel_id: null }, reason: audit });
        }
    }
    if (sub === "reset") {
        for (const saved of data.changes ?? []) await restoreBits(api, row.channel, saved, audit);
        const current = await api(`/channels/${row.channel}`);
        await editBits(api, current, row.owner, 1, privacy, privacy, 0n, audit);
        data.changes = []; saveRoom(store, row, data);
    }
    return { ...embed("Voice room updated", `Updated <#${row.channel}>. Room privacy uses Discord permission overwrites; administrators and explicit role/member allows can still grant access.`), components: voicePanel(guild.id, row.channel) };
}

export async function voiceRoomEvent(event, data, store, api, botId, cooldowns) {
    if (event === "GUILD_CREATE" && (data.unavailable || !Array.isArray(data.voice_states))) return;
    const guildId = event === "GUILD_CREATE" ? data.id : data.guild_id;
    if (event === "CHANNEL_DELETE") { store.run("DELETE FROM voice_rooms WHERE guild=? AND channel=?", guildId, data.id); return; }
    const rows = store.all("SELECT * FROM voice_rooms WHERE guild=?", guildId);
    for (const row of rows) {
        const details = JSON.parse(row.data), previous = details.members ?? [];
        const members = event === "GUILD_CREATE" ? (data.voice_states ?? []).filter(state => state.channel_id === row.channel).map(state => state.user_id) : [...new Set([...previous.filter(id => id !== data.user_id), ...(data.channel_id === row.channel ? [data.user_id] : [])])];
        details.members = members; saveRoom(store, row, details);
        if (!members.length && (event === "GUILD_CREATE" || previous.includes(data.user_id))) {
            const room = await api(`/channels/${row.channel}`, { optional: true });
            if (room?.guild_id === guildId && room.type === 2) await api(`/channels/${row.channel}`, { method: "DELETE", reason: "Empty Sonata temporary voice room" });
            store.run("DELETE FROM voice_rooms WHERE guild=? AND channel=?", guildId, row.channel);
        }
    }
    if (event !== "VOICE_STATE_UPDATE") return;
    const settings = store.settings(guildId).voicemaster;
    if (!settings?.enabled || data.channel_id !== settings.lobby || data.user_id === botId) return;
    if (store.get("SELECT channel FROM voice_rooms WHERE guild=? AND owner=?", guildId, data.user_id)) return;
    if (store.get("SELECT COUNT(*) AS n FROM voice_rooms WHERE guild=?", guildId).n >= 25) return;
    const key = `room:${guildId}:${data.user_id}`, now = Date.now();
    if ((cooldowns.get(key)?.until ?? 0) > now) return;
    cooldowns.set(key, { until: now + 30_000, n: 1 });
    const [guild, roles, target, bot, category, lobby] = await Promise.all([api(`/guilds/${guildId}`), api(`/guilds/${guildId}/roles`), api(`/guilds/${guildId}/members/${data.user_id}`), api(`/guilds/${guildId}/members/${botId}`), api(`/channels/${settings.category}`), api(`/channels/${settings.lobby}`)]);
    if (target.user.bot || category.guild_id !== guildId || category.type !== 4 || lobby.guild_id !== guildId || lobby.type !== 2) return;
    requirePermission(memberPermissions(bot, roles, guild), PERMS.CHANNELS | PERMS.ROLES | PERMS.MOVE);
    requirePermission(channelPermissions(bot, roles, guild, lobby), PERMS.VIEW | PERMS.CONNECT | PERMS.MOVE);
    requirePermission(channelPermissions(bot, roles, guild, category), PERMS.VIEW | PERMS.CHANNELS | PERMS.ROLES);
    const current = await api(`/guilds/${guildId}/voice-states/${data.user_id}`, { optional: true });
    if (current?.channel_id !== settings.lobby) return;
    const overwrites = (category.permission_overwrites ?? []).filter(value => ![target.user.id, botId].includes(value.id));
    if (overwrites.length > 90) return;
    overwrites.push({ id: target.user.id, type: 1, allow: privacy.toString(), deny: "0" }, { id: botId, type: 1, allow: (privacy | PERMS.MOVE | PERMS.CHANNELS | PERMS.ROLES).toString(), deny: "0" });
    const room = await api(`/guilds/${guildId}/channels`, { method: "POST", body: { name: `${target.user.username || "Member"}'s room`.slice(0, 100), type: 2, parent_id: category.id, permission_overwrites: overwrites }, reason: "Sonata join-to-create voice room" });
    try {
        store.run("INSERT INTO voice_rooms VALUES (?,?,?,?)", guildId, room.id, target.user.id, JSON.stringify({ members: [target.user.id], changes: [] }));
        await api(`/guilds/${guildId}/members/${target.user.id}`, { method: "PATCH", body: { channel_id: room.id }, reason: "Move into Sonata temporary voice room" });
    } catch (error) {
        await api(`/channels/${room.id}`, { method: "DELETE", reason: "Incomplete Sonata voice room creation" }); store.run("DELETE FROM voice_rooms WHERE channel=? AND guild=?", room.id, guildId); throw error;
    }
    if (channelPermissions(bot, roles, guild, room) & PERMS.SEND) try { await api(`/channels/${room.id}/messages`, { method: "POST", body: { ...embed("Your voice room", `Owner: <@${target.user.id}>. Use these controls while connected to this room. You can also open them with voicemaster room.`), components: voicePanel(guildId, room.id) } }); }
    catch { const currentSettings = store.settings(guildId); currentSettings.voicePanelError = "A voice room was created, but its control panel could not be posted. Use voicemaster room."; store.saveSettings(guildId, currentSettings); }
}
