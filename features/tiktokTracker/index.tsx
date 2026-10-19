/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// TikTok Tracker: watch creators' TikTok accounts (and their Roblox) and see
// how much they've grown since you started watching — followers, likes,
// videos, and the current likes on each post with when it was posted. Reads
// TikTok's public profile pages while Discord is open; saved on this computer.

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { Menu, showToast } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { openTracker, settingsHook } from "./Panel";
import { checkOne, opts, startSchedule, stopSchedule } from "./refresh";
import { addAccount, getAccount, loadAccounts } from "./store";

const settings = defineFeatureSettings("tiktokTracker", {
    refreshMinutes: {
        type: OptionType.SELECT,
        description: "How often to check everyone",
        options: [
            { label: "Every 30 minutes", value: 30 },
            { label: "Every hour", value: 60, default: true },
            { label: "Every 3 hours", value: 180 },
            { label: "Every 6 hours", value: 360 },
        ],
    },
    showPosts: { type: OptionType.BOOLEAN, description: "See current likes on posts (and when each was posted)", default: true },
    postsCount: {
        type: OptionType.SELECT,
        description: "How many of their latest posts to check",
        options: [{ label: "6", value: 6 }, { label: "12", value: 12, default: true }, { label: "20", value: 20 }],
    },
    milestones: { type: OptionType.BOOLEAN, description: "Pop up when someone passes a follower milestone (1K, 10K, 100K…)", default: true },
});

function syncOpts() {
    opts.minutes = Number(settings.store.refreshMinutes) || 60;
    opts.posts = settings.store.showPosts !== false;
    opts.postsCount = Number(settings.store.postsCount) || 12;
    opts.milestones = settings.store.milestones !== false;
}
settingsHook.setPosts = v => { settings.store.showPosts = v; };

export function TrendIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
        </svg>
    );
}

const TrackerButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="TikTok Tracker" onClick={() => { syncOpts(); openTracker(); }}><TrendIcon /></ChatBarButton>
    : null;

// Right-click a message with a TikTok link → watch that account.
const messageMenu: NavContextMenuPatchCallback = (children, { message }: any) => {
    const names = [...new Set([...(message?.content ?? "").matchAll(/tiktok\.com\/@([a-z0-9._]{2,24})/gi)].map(m => m[1].toLowerCase()))];
    if (!names.length) return;
    children.push(...names.slice(0, 3).map(u => getAccount(u)
        ? <Menu.MenuItem key={u} id={`vc-ttt-open-${u}`} label={`Open @${u} in TikTok Tracker`} action={() => { syncOpts(); openTracker(u); }} />
        : <Menu.MenuItem key={u} id={`vc-ttt-add-${u}`} label={`Track @${u} on TikTok`} action={() => {
            addAccount(u);
            syncOpts();
            void checkOne(u, { posts: opts.posts });
            showToast(`Watching @${u} — growth is counted from now`, "success");
        }} />));
};

export default definePlugin({
    name: "TikTokTracker",
    description: "Watch your creators' TikTok accounts — and their Roblox — and see how many followers, likes and videos they've gained since you started, plus the current likes on each post and when it went up. Checks their public profile pages while Discord is open.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => { syncOpts(); openTracker(); },
    chatBarButton: { icon: TrendIcon, render: TrackerButton },
    contextMenus: { message: messageMenu },

    async start() {
        syncOpts();
        await loadAccounts();
        startSchedule();
    },
    stop() {
        stopSchedule();
    },
});
