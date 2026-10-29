/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { command, option, role, sub } from "./commandOptions.mjs";
import { channelPermissions, embed, fail, PERMS, requirePermission } from "./discord.mjs";
import { musicPanel } from "./controlPanels.mjs";
import { musicPolicy } from "./musicPolicy.mjs";

export const MUSIC_COMMANDS = [
    command("play", "Play or queue a track in your voice channel", 0n, [option("query", 3, "Song name, SoundCloud track or YouTube video link", true, { max_length: 200 })], ["p"]),
    command("pause", "Pause music in your voice channel", 0n),
    command("resume", "Resume paused music", 0n),
    command("skip", "Skip the current track", 0n, [], ["next"]),
    command("stop", "Clear the queue and disconnect Sonata", 0n, [], ["leave", "disconnect"]),
    command("queue", "Show this server's music queue", 0n, [], ["q"]),
    command("nowplaying", "Show the current track and playback position", 0n, [], ["np"]),
    command("volume", "Set music volume from zero to one hundred", 0n, [option("percent", 4, "Volume percentage", true, { min_value: 0, max_value: 100 })]),
    command("shuffle", "Shuffle upcoming tracks", 0n),
    command("remove", "Remove an upcoming track from the queue", 0n, [option("position", 4, "Upcoming track number", true, { min_value: 1, max_value: 50 })]),
    command("loop", "Set track or queue looping", 0n, [option("mode", 3, "Loop mode", true, { choices: ["off", "track", "queue"].map(value => ({ name: value, value })) })]),
    command("seek", "Seek to a position in the current track", 0n, [option("seconds", 4, "Position in seconds", true, { min_value: 0, max_value: 7200 })]),
    command("filter", "Set an audio effect while keeping the current position", 0n, [option("preset", 3, "Audio effect, or off to reset", true, { choices: ["off", "bassboost", "nightcore", "vaporwave"].map(value => ({ name: value, value })) })]),
    command("voteskip", "Vote to skip the current track", 0n, [], ["vs"]),
];
export const MUSIC_NAMES = MUSIC_COMMANDS.map(value => value.name);
export const MUSIC_SETTINGS_COMMAND = command("musicsettings", "Configure DJ controls and skip voting", PERMS.GUILD, [sub("view", "Show music control settings"), sub("djrole", "Choose the DJ role", [role()]), sub("cleardj", "Remove the DJ role"), sub("mode", "Choose who can control playback", [option("mode", 3, "Playback control policy", true, { choices: ["open", "dj"].map(value => ({ name: value, value })) })]), sub("votes", "Set the percentage of listeners needed to skip", [option("percent", 4, "Percentage of current human listeners", true, { min_value: 1, max_value: 100 })])]);

export async function musicCommand(context, broker, store) {
    const { api, guild, actor, bot, roles, command } = context;
    if (!broker?.online()) fail("Music is offline. The separate voice service must be running before music commands can work.");
    const state = await api(`/guilds/${guild.id}/voice-states/${actor.user.id}`, { optional: true });
    if (!state?.channel_id) fail("Join a voice channel first.");
    const channel = await api(`/channels/${state.channel_id}`);
    if (channel.guild_id !== guild.id || channel.type !== 2) fail("Use a normal voice channel in this server.");
    requirePermission(channelPermissions(actor, roles, guild, channel), PERMS.VIEW | PERMS.CONNECT);
    requirePermission(channelPermissions(bot, roles, guild, channel), PERMS.VIEW | PERMS.CONNECT | PERMS.SPEAK);
    const current = await api(`/guilds/${guild.id}/voice-states/${bot.user.id}`, { optional: true });
    if (current?.channel_id && current.channel_id !== channel.id) fail("Join Sonata's current voice channel to control its music.");
    const policy = await musicPolicy(context, store, channel);
    const result = await broker.submit({ id: command.id, guild: guild.id, channel: channel.id, actor: actor.user.id, name: command.name, options: command.options, ...policy });
    return { ...embed(result.title, result.description), components: command.name === "stop" ? [] : musicPanel(guild.id, channel.id) };
}
