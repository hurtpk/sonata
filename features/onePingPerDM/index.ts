/*
 * Vencord, a Discord client mod
 * Copyright (c) 2023 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin, { OptionType, PluginNative } from "@utils/types";
import { MessageJSON } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, ReadStateStore, UserStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";

const Notifications: { playNotificationSound(sound: string, volume: number): void; } = findByPropsLazy("playNotificationSound", "showNotification");
const Native = IS_WEB ? undefined : VencordNative.pluginHelpers.Sonata as PluginNative<typeof import("./native")> | undefined;
let generation = 0;
let running = false;

const settings = defineFeatureSettings("onePingPerDM", {
    shareAcrossBuilds: {
        type: OptionType.BOOLEAN,
        description: "Share the ping limit across Discord, PTB and Canary for the same account on this computer.",
        default: true,
        target: "DESKTOP"
    },
    channelToAffect: {
        type: OptionType.SELECT,
        description: "Select the type of DM for the plugin to affect",
        options: [
            { label: "Both", value: "both_dms", default: true },
            { label: "User DMs", value: "user_dm" },
            { label: "Group DMs", value: "group_dm" },
        ]
    },
    allowMentions: {
        type: OptionType.BOOLEAN,
        description: "Receive audio pings for @mentions",
        default: false,
    },
    allowEveryone: {
        type: OptionType.BOOLEAN,
        description: "Receive audio pings for @everyone and @here in group DMs",
        default: false,
    },
    ignoreUsers: {
        type: OptionType.STRING,
        description: "User IDs (comma + space) whose pings should NEVER be throttled",
        restartNeeded: true,
        default: ""
    },
    alwaysPlaySound: {
        type: OptionType.BOOLEAN,
        description: "Play the message notification sound even when its disabled",
        restartNeeded: true,
        default: false
    }
});

function recordRead(channelId: string, messageId?: string, readStateType?: number) {
    if (!running || !settings.store.shareAcrossBuilds || typeof Native?.onePingRead !== "function" || (readStateType != null && readStateType !== 0)) return;
    const type = ChannelStore.getChannel(channelId)?.type;
    if (type !== ChannelType.DM && type !== ChannelType.GROUP_DM) return;
    const userId = UserStore.getCurrentUser()?.id;
    const current = generation;
    queueMicrotask(() => {
        if (generation !== current || !running || !userId || UserStore.getCurrentUser()?.id !== userId) return;
        const ack = messageId ?? ReadStateStore.ackMessageId(channelId);
        if (ack) void Native.onePingRead(userId, channelId, ack).catch(() => null);
    });
}

export default definePlugin({
    name: "OnePingPerDM",
    description: "If unread messages are sent by a user in DMs multiple times, you'll only receive one audio ping. Read the messages to reset the limit",
    tags: ["Notifications", "Customisation"],
    authors: [Devs.ProffDea],
    isModified: true,
    settings,
    patches: [
        {
            find: '"NotificationStore"',
            replacement: {
                match: /(?<=let \i=)(!\i\.\i\.isSoundDisabled\((\i)\))(?=;if\((\i)&&.{0,150}?\|\|!(\i)\))/,
                replace: '$self.shouldPlaySound(arguments[0]?.message,$1,$3?"message3":$2,$3||$4)'
            }
        }
    ],
    start() {
        running = true;
        generation++;
    },
    stop() {
        running = false;
        generation++;
    },
    flux: {
        MESSAGE_ACK({ channelId, messageId, readStateType }) { recordRead(channelId, messageId, readStateType); },
        CHANNEL_ACK({ channelId, messageId, readStateType }) { recordRead(channelId, messageId, readStateType); },
        CHANNEL_LOCAL_ACK({ channelId }) { recordRead(channelId); },
        BULK_ACK({ channels }) {
            for (const channel of channels) recordRead(channel.channelId, channel.messageId, channel.readStateType);
        },
        CONNECTION_OPEN() { generation++; },
        LOGOUT() { generation++; }
    },
    shouldPlaySound(message: MessageJSON | undefined, enabled: boolean, sound = "message1", notify = true) {
        if (!notify) return false;
        if (!enabled && !settings.store.alwaysPlaySound) return false;
        if (!message || !this.affectsChannel(message.channel_id)) return true;
        if (running && settings.store.shareAcrossBuilds && typeof Native?.onePingClaim === "function") {
            void this.playSharedSound(message, sound);
            return false;
        }
        return this.isPrivateChannelRead(message);
    },
    async playSharedSound(message: MessageJSON, sound: string) {
        if (!Native) return;
        const userId = UserStore.getCurrentUser()?.id;
        if (!userId) return;
        const current = generation;
        const fallback = this.isPrivateChannelRead(message);
        const allowed = await Native.onePingClaim(userId, message.channel_id, message.id,
            ReadStateStore.ackMessageId(message.channel_id) ?? "0",
            ReadStateStore.getOldestUnreadMessageId(message.channel_id) ?? "0", this.isExempt(message)).catch(() => null);
        if (!running || generation !== current || UserStore.getCurrentUser()?.id !== userId || !settings.store.shareAcrossBuilds) return;
        const ack = ReadStateStore.ackMessageId(message.channel_id);
        if (ack && BigInt(ack) >= BigInt(message.id)) return;
        if (allowed === true || (allowed === null && fallback)) Notifications.playNotificationSound(sound, .4);
    },
    affectsChannel(channelId: string) {
        const type = ChannelStore.getChannel(channelId)?.type;
        return (type === ChannelType.DM && settings.store.channelToAffect !== "group_dm")
            || (type === ChannelType.GROUP_DM && settings.store.channelToAffect !== "user_dm");
    },
    isExempt(message: MessageJSON) {
        return settings.store.ignoreUsers.split(/[,\s]+/).includes(message.author.id)
            || (settings.store.allowMentions && message.mentions.some(m => m.id === UserStore.getCurrentUser()?.id))
            || (settings.store.allowEveryone && message.mention_everyone);
    },
    isPrivateChannelRead(message: MessageJSON | undefined) {
        if (!message || !this.affectsChannel(message.channel_id) || this.isExempt(message)) return true;
        const oldestUnread = ReadStateStore.getOldestUnreadMessageId(message.channel_id);
        return oldestUnread == null || oldestUnread === message.id;
    },
});
