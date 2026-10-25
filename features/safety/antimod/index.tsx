/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { playAudio } from "@api/AudioPlayer";
import definePlugin, { OptionType } from "@utils/types";
import type { Guild, GuildMember } from "@vencord/discord-types";
import { GuildMemberStore, GuildRoleStore, GuildStore, showToast, UserStore, VoiceStateStore } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";

// On/off lives here on the settings page (it used to be the dock button's
// left-click). It's a normal boolean, so it can also be bound to a key from
// ChannelSettings' Keybinds tab.
const settings = defineFeatureSettings("antimod", {
    active: {
        description: "AntiMod alert active.",
        type: OptionType.BOOLEAN,
        default: true,
    },
});

const MOD_ALERT_SOUND_URL = "https://www.myinstants.com/media/sounds/tmp_7901-951678082.mp3";

const MOD_PERMISSION_BITS: bigint[] = [
    (1n << 3n), (1n << 2n), (1n << 1n), (1n << 24n), (1n << 22n), (1n << 23n),
    (1n << 7n), (1n << 5n), (1n << 28n), (1n << 40n), (1n << 4n),
];

function getMemberEffectivePermissions(guild: Guild | undefined, member: GuildMember | null | undefined): bigint {
    if (!guild || !member) return 0n;
    if (guild.ownerId === member.userId) return MOD_PERMISSION_BITS.reduce((a, b) => a | b, 0n);
    const memberRoles = (GuildRoleStore.getSortedRoles(guild.id) ?? [])
        .filter(role => role.id === guild.id || member.roles.includes(role.id));
    return memberRoles.reduce((acc, role) => acc | (role.permissions ?? 0n), 0n);
}

function hasAnyModPermission(permissions: bigint): boolean {
    return MOD_PERMISSION_BITS.some(bit => (permissions & bit) === bit);
}

/** Who in this voice channel (other than me) has mod powers. */
function modsInChannel(channelId: string, guildId: string, myUserId: string): string[] {
    const guild = GuildStore.getGuild(guildId);
    const states = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    const labels: string[] = [];
    for (const vs of Object.values(states) as any[]) {
        if (!vs?.userId || vs.userId === myUserId) continue;
        const member = GuildMemberStore.getMember(guildId, vs.userId);
        if (hasAnyModPermission(getMemberEffectivePermissions(guild, member))) labels.push(getModLabel(vs.userId, guildId));
    }
    return labels;
}

function getModLabel(userId: string, guildId: string | undefined): string {
    const user = UserStore.getUser(userId);
    const member = guildId ? GuildMemberStore.getMember(guildId, userId) : null;
    const username = user?.username ?? userId;
    const displayName = member?.nick ?? user?.globalName;
    return displayName ? `${username} (${displayName})` : username;
}

// Where everyone was last seen, so a "join" is only counted when someone really moved into the channel.
const lastChannel = new Map<string, string | null>();
// The same alert isn't repeated within a few seconds (Discord often sends a voice update twice).
const recent = new Map<string, number>();

function showModAlert(key: string, message: string) {
    if (!settings.store.active) return;
    const now = Date.now();
    if (now - (recent.get(key) ?? 0) < 5000) return;
    recent.set(key, now);
    try { showToast(message, "failure"); } catch { }
    try { playAudio(MOD_ALERT_SOUND_URL); } catch { }
}

type VoiceUpdate = { userId?: string; channelId?: string | null; oldChannelId?: string | null; guildId?: string; };

function onVoiceStates(voiceStates: VoiceUpdate[]) {
    const myId = UserStore.getCurrentUser()?.id;
    if (!myId) return;
    const myChannel = VoiceStateStore.getVoiceStateForUser(myId)?.channelId ?? null;

    for (const state of voiceStates ?? []) {
        const { userId, guildId } = state ?? {};
        if (!userId) continue;
        const channelId = state.channelId ?? null;
        const before = lastChannel.has(userId) ? lastChannel.get(userId)! : (state.oldChannelId ?? null);
        lastChannel.set(userId, channelId);
        if (!channelId || !guildId || before === channelId) continue;

        if (userId === myId) {
            // I joined (or moved into) a channel: is there a mod in it?
            const mods = modsInChannel(channelId, guildId, myId);
            if (mods.length) showModAlert(`me:${channelId}`, `MOD ALERT: ${mods.join(", ")} in this voice channel.`);
        } else if (channelId === myChannel) {
            // Someone joined my channel: are they a mod?
            const member = GuildMemberStore.getMember(guildId, userId);
            if (hasAnyModPermission(getMemberEffectivePermissions(GuildStore.getGuild(guildId), member)))
                showModAlert(`join:${userId}:${channelId}`, `MOD ALERT: ${getModLabel(userId, guildId)} joined.`);
        }
    }
}

export default definePlugin({
    name: "AntiMod",
    description: "Plays a sound when you join a voice channel that has a mod in it, or when a mod joins your voice channel.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    dependencies: ["AudioPlayerAPI"],
    settings,

    flux: {
        VOICE_STATE_UPDATES({ voiceStates }: { voiceStates: VoiceUpdate[]; }) {
            try { onVoiceStates(voiceStates); } catch (e) { console.error("[AntiMod] voice update", e); }
        },
    },

    stop() {
        lastChannel.clear();
        recent.clear();
    },
});
