/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../_shared/tool.css";

// GIF Maker: right-click any picture, GIF or video → Make GIF, and edit it
// before sending — trim, speed, reverse/boomerang, crop and rotate, captions
// (including the cut-out speech bubble), text you can place and animate,
// filters, overlays, banners, stickers that move, and GIF / WebP / video
// output that can be squeezed under a size limit.
import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { migratePluginSettings } from "@api/Settings";
import { RemixIcon } from "@components/Icons";
import { EquicordDevs } from "@utils/constants";
import definePlugin, { IconProps } from "@utils/types";
import { Menu } from "@webpack/common";

import { fetchAllGoogleFonts } from "./fonts";
import type { MediaInput } from "./render/source";
import { settings } from "./settings";
import css from "./styles.css?managed";
import { openEditor } from "./ui/Editor";
import { openStart } from "./ui/Gallery";
import { getMediaInfo } from "./utils/contextMenu";
import { collectCandidateUrls, ensureGifUrl, isLikelyVideoUrl, normalizeUrl, orderCandidateUrls, stripDiscordFormatParam } from "./utils/gifPicker";

const GIFMAKER_ID = "vc-gifmaker";

const IMAGE = /^image\//;

/** Every picture in a message, for a slideshow. */
function messageImages(message: any): MediaInput[] {
    const out: MediaInput[] = [];
    for (const a of message?.attachments ?? []) {
        if (IMAGE.test(a.content_type ?? "") && a.content_type !== "image/gif") out.push({ url: a.proxy_url ?? a.url, isVideo: false, isGif: false });
    }
    for (const e of message?.embeds ?? []) {
        const i = e?.image ?? (e?.video ? null : e?.thumbnail);
        if (i?.proxyURL || i?.url) out.push({ url: i.proxyURL ?? i.url, isVideo: false });
    }
    return out;
}

const makeItem = (info: { url: string; isVideo: boolean; }) => (
    <Menu.MenuItem id={GIFMAKER_ID} label="Make GIF" action={() => openEditor([{ url: info.url, isVideo: info.isVideo }])} />
);

/** Every video in a message (files and embedded ones), with a name to show. */
function messageVideos(message: any): (MediaInput & { name: string; })[] {
    const out: (MediaInput & { name: string; })[] = [];
    for (const a of message?.attachments ?? []) {
        if ((a.content_type ?? "").startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(a.filename ?? "")) out.push({ url: a.proxy_url ?? a.url, isVideo: true, name: a.filename ?? "video" });
    }
    for (const e of message?.embeds ?? []) {
        const v = e?.video;
        if ((v?.proxyURL || v?.url) && e?.type !== "gifv") out.push({ url: v.proxyURL ?? v.url, isVideo: true, name: e.title ?? e.provider?.name ?? "Embedded video" });
    }
    return out;
}

/** Where a video in this message is paused, if you paused it partway. */
function pausedAt(messageId: string): { index: number; time: number; } | null {
    const row = document.querySelector(`[id$="-${messageId}"][id^="chat-messages-"]`) ?? document.getElementById(`message-accessories-${messageId}`);
    const vids = Array.from(row?.querySelectorAll("video") ?? []);
    const i = vids.findIndex(v => v.currentTime > 0.5 && v.duration > 1);
    return i >= 0 ? { index: i, time: vids[i].currentTime } : null;
}

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

const messageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    const videos = messageVideos(props.message);
    const info = getMediaInfo(props);
    if (videos.length) {
        const paused = props.message?.id ? pausedAt(props.message.id) : null;
        if (videos.length === 1) {
            children.push(<Menu.MenuItem id={GIFMAKER_ID} label="Make a GIF from this video" action={() => openEditor([videos[0]])} />);
        } else {
            children.push(
                <Menu.MenuItem id={GIFMAKER_ID} label={`Make a GIF from a video (${videos.length})`}>
                    {videos.slice(0, 10).map((v, i) => <Menu.MenuItem key={i} id={`${GIFMAKER_ID}-v${i}`} label={v.name} action={() => openEditor([v])} />)}
                </Menu.MenuItem>
            );
        }
        if (paused && videos[paused.index]) {
            children.push(<Menu.MenuItem id={`${GIFMAKER_ID}-here`} label={`Make a GIF from ${clock(paused.time)} (where it's paused)`} action={() => openEditor([videos[paused.index]], { startAt: paused.time })} />);
        }
        // Pictures in the same message can still be made into a GIF.
        if (info && !info.isVideo) children.push(<Menu.MenuItem id={`${GIFMAKER_ID}-pic`} label="Make GIF from the picture" action={() => openEditor([{ url: info.url, isVideo: false }])} />);
    } else if (info) children.push(makeItem(info));
    const images = messageImages(props.message);
    if (images.length > 1) {
        children.push(<Menu.MenuItem id="vc-gifmaker-slides" label={`Make slideshow GIF (${images.length} pictures)`} action={() => openEditor(images)} />);
    }
};

const imageContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props?.src) return;
    if ("href" in props && !props.src) return;
    if (props.target?.classList?.contains("emoji")) return;

    const info = getMediaInfo(props);
    if (info) children.push(makeItem(info));
};

const gifPickerContextMenuPatch: NavContextMenuPatchCallback = (children, props) => {
    if (!props?.src) return;

    children.push(
        <Menu.MenuItem
            id="gif-maker-edit"
            key="gif-maker-edit"
            label="Edit GIF"
            icon={RemixIcon}
            leadingAccessory={{ type: "icon", icon: RemixIcon }}
            action={() => openGifMakerFromItem(props)}
        />
    );
};

function openGifMakerFromItem(item) {
    const directUrl = typeof item.src === "string" ? item.src : null;

    const candidates = collectCandidateUrls(item);
    const adjustedCandidates = new Set<string>();
    if (directUrl) adjustedCandidates.add(normalizeUrl(directUrl));
    for (const candidate of candidates) {
        adjustedCandidates.add(candidate);
    }

    const preferredUrl = directUrl ? normalizeUrl(directUrl) : null;
    const orderedUrls = orderCandidateUrls(preferredUrl, adjustedCandidates);
    if (!orderedUrls.length) return;

    const cleanedUrl = stripDiscordFormatParam(ensureGifUrl(orderedUrls[0]));
    openEditor([{ url: cleanedUrl, isVideo: isLikelyVideoUrl(cleanedUrl) }]);
}

function GifIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="3" />
            <path d="M10 10.2c-.4-.5-1-.7-1.6-.7-1.2 0-2 .9-2 2.5s.8 2.5 2 2.5c.8 0 1.4-.4 1.6-1.1V12H8.6M12.6 9.6v4.8M15.4 14.4V9.6h2.4M15.4 12h2" />
        </svg>
    );
}

const GifButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="GIF Maker" onClick={openStart}><GifIcon /></ChatBarButton>
    : null;

migratePluginSettings("GifMaker", "gifMaker");
export default definePlugin({
    name: "GifMaker",
    description: "Make and edit GIFs from any picture, GIF or video: trim, speed, boomerang, crop, captions (including the cut-out bubble), animated text, filters, overlays, banners, moving stickers, and GIF / WebP / video output that fits a size limit.",
    authors: [EquicordDevs.Leon135, EquicordDevs.benjii],
    tags: ["Emotes", "Media"],
    settings,
    managedStyle: css,
    contextMenus: {
        "message": messageContextMenuPatch,
        "image-context": imageContextMenuPatch,
        "gif-picker": gifPickerContextMenuPatch
    },

    chatBarButton: { icon: GifIcon, render: GifButton },
    openSettingsModal: () => openStart(),

    start() {
        void fetchAllGoogleFonts();
    },
});
