/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embed, fail, memberPermissions, PERMS } from "./discord.mjs";

export function musicSettings(context, store) {
    const { guild, command, roles } = context, settings = store.settings(guild.id), config = settings.music ?? { mode: "open", threshold: 50 };
    if (command.sub === "djrole") { if (command.options.role === guild.id || !roles.some(role => role.id === command.options.role)) fail("Choose a server role other than everyone."); config.role = command.options.role; }
    if (command.sub === "cleardj") delete config.role;
    if (command.sub === "mode") config.mode = command.options.mode;
    if (command.sub === "votes") config.threshold = command.options.percent;
    if (command.sub !== "view") { settings.music = config; store.saveSettings(guild.id, settings); }
    return embed("Music permissions", `Playback controls: ${config.mode === "dj" ? "DJ role and staff only" : "All listeners"}\nDJ role: ${config.role ? `<@&${config.role}>` : "Not configured"}\nSkip vote threshold: ${config.threshold ?? 50}% of current human listeners\n\nEveryone in the channel can queue tracks, browse music and use voteskip. Manage Server or Move Members permission also grants DJ controls.`);
}

export function musicAudienceEvent(type, data, store) {
    if (type === "READY") { store.run("DELETE FROM music_audience"); store.run("DELETE FROM music_audience_ready"); return; }
    const guild = type === "GUILD_CREATE" || type === "GUILD_DELETE" ? data.id : data.guild_id;
    if (type === "GUILD_DELETE") { if (!data.unavailable) { store.run("DELETE FROM music_audience WHERE guild=?", guild); store.run("DELETE FROM music_audience_ready WHERE guild=?", guild); } return; }
    if (type === "GUILD_CREATE") { store.run("DELETE FROM music_audience WHERE guild=?", guild); if (!data.unavailable) store.run("INSERT OR IGNORE INTO music_audience_ready VALUES (?)", guild); }
    for (const state of type === "GUILD_CREATE" ? data.voice_states ?? [] : [data]) {
        if (state.channel_id) store.run("INSERT INTO music_audience VALUES (?,?,?) ON CONFLICT(guild,user) DO UPDATE SET channel=excluded.channel", guild, state.user_id, state.channel_id);
        else store.run("DELETE FROM music_audience WHERE guild=? AND user=?", guild, state.user_id);
    }
}

export async function musicPolicy(context, store, channel) {
    if (!store) return {};
    const { guild, command, actor, roles, api } = context, config = store.settings(guild.id).music ?? {}, privileged = !!(memberPermissions(actor, roles, guild) & (PERMS.ADMIN | PERMS.GUILD | PERMS.MOVE)) || !!(config.role && actor.roles.includes(config.role));
    const vote = command.name === "voteskip" || (command.name === "skip" && config.mode === "dj" && !privileged);
    if (!vote) {
        if (config.mode === "dj" && !privileged && !["play", "queue", "nowplaying"].includes(command.name)) fail("Playback controls require the configured DJ role or staff permissions. Use voteskip to vote for a skip.");
        return {};
    }
    if (!store.get("SELECT guild FROM music_audience_ready WHERE guild=?", guild.id)) fail("Discord's current listener list is not ready yet. Try again shortly.");
    const cached = store.all("SELECT user FROM music_audience WHERE guild=? AND channel=?", guild.id, channel.id), ids = [...new Set([...cached.map(row => row.user), actor.user.id])];
    if (ids.length > 50) fail("Skip voting supports up to fifty connected accounts. Ask a DJ or voice moderator to skip directly.");
    const listeners = [];
    for (const id of ids) {
        const voice = await api(`/guilds/${guild.id}/voice-states/${id}`, { optional: true });
        if (voice?.channel_id !== channel.id || voice.deaf || voice.self_deaf) continue;
        const member = voice.member ?? await api(`/guilds/${guild.id}/members/${id}`, { optional: true });
        if (member && !member.user.bot) listeners.push(id);
    }
    return { name: "voteskip", listeners, threshold: config.threshold ?? 50 };
}
