/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Part of Sonata itself (not a switchable feature): where Discord says someone
// is "In voice" (member list, DMs, profiles, friends list), it says
// "In same voice" — or "In same call" for a DM call — when they're in the
// voice channel you're in.

import { SelectedChannelStore, useStateFromStores } from "@webpack/common";

const sameLabel = (channel: any) => channel?.isDM?.() || channel?.isGroupDM?.() ? "In same call" : "In same voice";

/** The voice status line's label; a hook, so it updates when you join or leave. */
export function useSameVoiceLabel(channel: any, label: string) {
    const mine = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getVoiceChannelId());
    return channel?.id && channel.id === mine ? sameLabel(channel) : label;
}

/** The friends list's "In voice" (only given the channel ID; not called as a hook there). */
export function sameVoiceText(channelId: string | null | undefined, label: string) {
    return channelId && channelId === SelectedChannelStore.getVoiceChannelId() ? "In same voice" : label;
}

export const sameVoicePatches = [
    {
        // The voice status line: speaker icon + "In voice" / "In a call" / "In a stage".
        find: /hideTooltip:\i=!1,canTruncate:\i=!0,showChannelName:/,
        replacement: {
            match: /(\i=)(\i\?\i\.intl\.string\(\i\.t\["9FaEzi"\]\):(\i)\.isGuildStageVoice\(\)\?\i\.intl\.string\(\i\.t\.QygGCN\):\i\.intl\.string\(\i\.t\.msxteM\))(?=,\i=null!=)/,
            replace: "$1$self.useSameVoiceLabel($3,$2)",
        },
    },
    {
        // The friends list's activity line.
        find: '"8ALChp"])}),textColor',
        replacement: {
            match: /(null!=(\i)\.voiceChannelId&&.{0,400}?content:null!=\i\?\i\.intl\.format\(\i\.default\.KddZZf,\{duration:.{0,60}?\}\):)(\i\.intl\.string\(\i\.default\["8ALChp"\]\))/,
            replace: "$1$self.sameVoiceText($2.voiceChannelId,$3)",
        },
    },
];
