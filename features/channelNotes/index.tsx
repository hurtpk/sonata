/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Channel Notes: a private note on any channel, DM or server — rules to
// remember, who's who, links, what you were in the middle of. Open it from
// the 📝 button in the chat bar (it shows a dot when there's a note), or
// right-click a channel or server.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps } from "@utils/types";
import { Menu } from "@webpack/common";

import { openNotes } from "./Panel";
import { channelKey, guildKey, loadNotes, noteOf, useNotes } from "./store";

export function NotesIcon({ height = 20, width = 20, className, dot }: IconProps & { dot?: boolean; }) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 3v4h4M8.5 11h7M8.5 14.5h7M8.5 18h4" />
            {dot && <circle cx="19" cy="5" r="3.2" fill="var(--status-danger, #f23f43)" stroke="var(--background-base-lower, #1e1f22)" strokeWidth={1.5} />}
        </svg>
    );
}

const NotesButton: ChatBarButtonFactory = ({ channel, isMainChat }) => {
    useNotes();
    if (!isMainChat || !channel) return null;
    const has = !!noteOf(channelKey(channel.id)) || (!!channel.guild_id && !!noteOf(guildKey(channel.guild_id)));
    return (
        <ChatBarButton tooltip={has ? "Your note on this chat" : "Channel Notes"} onClick={() => openNotes({ channelId: channel.id, guildId: channel.guild_id ?? undefined })}>
            <NotesIcon dot={has} />
        </ChatBarButton>
    );
};

const channelMenu: NavContextMenuPatchCallback = (children, { channel }: any) => {
    if (!channel?.id) return;
    children.push(
        <Menu.MenuItem id="vc-cnotes-channel" label={noteOf(channelKey(channel.id)) ? "Open my note" : "Add a note"} icon={() => <NotesIcon width={16} height={16} />}
            action={() => openNotes({ channelId: channel.id, guildId: channel.guild_id ?? undefined })} />
    );
};

const guildMenu: NavContextMenuPatchCallback = (children, { guild }: any) => {
    if (!guild?.id) return;
    children.push(
        <Menu.MenuItem id="vc-cnotes-guild" label={noteOf(guildKey(guild.id)) ? "Open my server note" : "Add a server note"} icon={() => <NotesIcon width={16} height={16} />}
            action={() => openNotes({ guildId: guild.id, startKey: guildKey(guild.id) })} />
    );
};

export default definePlugin({
    name: "ChannelNotes",
    description: "Private notes on any channel, DM or server — only you see them. Open one from the 📝 chat bar button (it shows a dot when there's a note), or right-click a channel or server.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: () => openNotes(),
    chatBarButton: { icon: NotesIcon, render: NotesButton },
    contextMenus: { "channel-context": channelMenu, "thread-context": channelMenu, "gdm-context": channelMenu, "guild-context": guildMenu, "guild-header-popout": guildMenu },

    start() {
        void loadNotes();
    },
});
