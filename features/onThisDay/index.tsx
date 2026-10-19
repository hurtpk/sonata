/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { ChannelStore, Menu, SelectedChannelStore, showToast } from "@webpack/common";

import { openOnThisDay } from "./Panel";

function openFor(channel: Channel | undefined | null) {
    if (!channel) return showToast("Open a channel or DM first", "message");
    openOnThisDay(channel);
}

const item = (channel: Channel) => (
    <Menu.MenuItem id="vc-otd-open" label="On This Day" action={() => openFor(channel)} />
);

const channelMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => {
    // Text, announcement, threads, DMs and group DMs — not voice-only, categories or forums.
    if (!channel || ![0, 1, 3, 5, 10, 11, 12].includes(channel.type)) return;
    children.push(item(channel));
};

const userMenu: NavContextMenuPatchCallback = (children, { user, channel }: { user?: { id: string; }; channel?: Channel; }) => {
    const dmId = user && ChannelStore.getDMFromUserId(user.id);
    const dm = channel?.isDM?.() ? channel : dmId ? ChannelStore.getChannel(dmId) : null;
    if (dm) children.push(item(dm));
};

export default definePlugin({
    name: "OnThisDay",
    description: "See what was said in a channel or DM on today's date in past years, with a jump to each message. Right-click a channel, DM or person → On This Day.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    // From the dock: the channel you're in.
    openSettingsModal: () => openFor(ChannelStore.getChannel(SelectedChannelStore.getChannelId())),

    contextMenus: {
        "channel-context": channelMenu,
        "thread-context": channelMenu,
        "gdm-context": channelMenu,
        "user-context": userMenu,
    },
});
