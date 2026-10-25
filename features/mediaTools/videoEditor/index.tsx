/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Video Editor: trim, cut out parts, mute, speed up or slow down, loop, join
// clips, blur a spot, add captions, fade, change the volume, add music — and
// export it at a size Discord takes. It all runs on this computer, with the
// same converter File Converter uses. Open it from Sonata, or right-click a
// video in chat → Edit video. Can also open by itself when you drag a video
// into Discord (switch it on in the settings).

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, showToast } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";
import { getBytes } from "../../_shared/media";
import { openVideoEditor } from "./Editor";

const settings = defineFeatureSettings("videoEditor", {
    openOnDrop: {
        type: OptionType.BOOLEAN,
        description: "Open videos you drag into Discord in the Video Editor instead of uploading them (hold Shift while dropping to upload normally)",
        default: false,
    },
});

const isVideo = (f: File) => f.type.startsWith("video/") || /.(mp4|webm|mov|m4v|mkv|avi)$/i.test(f.name);
const SYNTHETIC = Symbol("vc-vedit-drop");

/** A video dropped into Discord: into the editor instead of the upload box. */
function onDrop(e: DragEvent) {
    if (!settings.store.openOnDrop || e.shiftKey || (e as any)[SYNTHETIC]) return;
    // Drops into an open window (the editor itself, File Converter…) are theirs.
    if ((e.target as Element | null)?.closest?.('[role="dialog"], [class*="vc-vedit-"]')) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!files.length || !files.every(isVideo)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // An empty drop lets Discord put away its "drop to upload" overlay.
    try {
        const empty = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
        (empty as any)[SYNTHETIC] = true;
        e.target?.dispatchEvent(empty);
    } catch { }
    openVideoEditor(files.slice(0, 10));
}

const MAX_DOWNLOAD = 500 * 1024 * 1024;

/** Every video in a message: files, and videos embedded from links. */
function messageVideos(message: any): { url: string; name: string; type: string; }[] {
    const out: { url: string; name: string; type: string; }[] = [];
    for (const a of message?.attachments ?? []) {
        if ((a.content_type ?? "").startsWith("video/") || /\.(mp4|webm|mov|m4v)$/i.test(a.filename ?? "")) out.push({ url: a.url, name: a.filename ?? "video.mp4", type: a.content_type ?? "video/mp4" });
    }
    for (const e of message?.embeds ?? []) {
        const v = e?.video;
        const url = v?.proxyURL ?? v?.url;
        if (url && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) out.push({ url, name: `${(e.title ?? e.provider?.name ?? "video").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60)}.mp4`, type: "video/mp4" });
    }
    return out;
}

async function openFromChat(v: { url: string; name: string; type: string; }) {
    try {
        showToast(`Getting ${v.name}…`);
        const data = await getBytes(v.url, MAX_DOWNLOAD);
        openVideoEditor([new File([data as BlobPart], v.name, { type: v.type })]);
    } catch (e) {
        showToast(`Couldn't get the video: ${e instanceof Error ? e.message : e}`, "failure");
    }
}

const messageMenu: NavContextMenuPatchCallback = (children, { message }: any) => {
    const videos = messageVideos(message);
    if (!videos.length) return;
    children.push(videos.length === 1 ? (
        <Menu.MenuItem id="vc-vedit-open" label="Edit video" action={() => openFromChat(videos[0])} />
    ) : (
        <Menu.MenuItem id="vc-vedit-open" label="Edit video">
            {videos.slice(0, 10).map((v, i) => <Menu.MenuItem key={i} id={`vc-vedit-open-${i}`} label={v.name} action={() => openFromChat(v)} />)}
        </Menu.MenuItem>
    ));
};

export default definePlugin({
    name: "VideoEditor",
    description: "Trim, cut, mute, speed up, loop, join clips, blur a spot, add captions and music — then export at a size Discord takes. Right-click a video in chat → Edit video.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,
    openSettingsModal: () => openVideoEditor(),
    contextMenus: { message: messageMenu },

    start() {
        window.addEventListener("drop", onDrop, true);
    },

    stop() {
        window.removeEventListener("drop", onDrop, true);
    },
});
