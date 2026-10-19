/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Media Downloader: save videos and music from YouTube, SoundCloud, TikTok,
// Instagram, X, Reddit, Twitch and many more — as MP4 or MP3 — using yt-dlp,
// which you install yourself (winget install yt-dlp). Right-click a message
// with a link → "Download video or audio", or open it from the chat bar.
// Spotify isn't possible: its songs are copy-protected.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps } from "@utils/types";
import { Menu } from "@webpack/common";

import { linksIn } from "./links";
import { openDownloader } from "./Panel";
import { loadItems, settings } from "./store";

function DownloadIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" />
        </svg>
    );
}

const OpenButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="Download a video or song from a link" onClick={() => openDownloader()}><DownloadIcon /></ChatBarButton>
    : null;

const messageMenu: NavContextMenuPatchCallback = (children, { message }: any) => {
    if (!settings.store.showMenu) return;
    const links = linksIn(message);
    if (!links.length) return;
    children.push(links.length === 1
        ? <Menu.MenuItem id="vc-dl-message" label={`Download video or audio (${links[0].site})`} action={() => openDownloader(links[0].url)} />
        : (
            <Menu.MenuItem id="vc-dl-message" label="Download video or audio">
                {links.slice(0, 8).map((l, i) => <Menu.MenuItem key={i} id={`vc-dl-link-${i}`} label={`${l.site}: ${l.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 48)}`} action={() => openDownloader(l.url)} />)}
            </Menu.MenuItem>
        ));
};

export default definePlugin({
    name: "MediaDownloader",
    description: "Save videos and music from YouTube, SoundCloud, TikTok, Instagram, X, Reddit, Twitch and many more as MP4 or MP3. Right-click a message with a link, or use the chat bar button. Needs yt-dlp (winget install yt-dlp).",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openDownloader(),

    chatBarButton: { icon: DownloadIcon, render: OpenButton },

    contextMenus: { message: messageMenu },

    start() {
        void loadItems();
    },
});
