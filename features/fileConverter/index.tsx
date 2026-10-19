/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// File Converter: images, GIFs, videos, sound, PDFs and text data turned
// into other formats — or made Discord-ready (sticker, emoji, avatar,
// banner, under 10 MB, voice message) — all on this computer. Open it from
// the chat bar, or right-click a message → Convert attachment.

import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { Menu, showToast } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { getBytes } from "../_shared/media";
import { shutdown } from "./media";
import { openFileConverter } from "./Panel";
import { startUploadGuard, stopUploadGuard } from "./upload";

const settings = defineFeatureSettings("fileConverter", {
    shrinkPrompt: {
        type: OptionType.BOOLEAN,
        description: "When a file is too big to upload, offer to shrink it to fit",
        default: true,
    },
});

export function ConvertIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 3H7a2 2 0 0 0-2 2v6M14 3l5 5v3M14 3v5h5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M9 15l3 3 3-3M12 18v-7" />
        </svg>
    );
}

const ConvertButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return <ChatBarButton tooltip="File Converter" onClick={() => openFileConverter()}><ConvertIcon /></ChatBarButton>;
};

const MAX_DOWNLOAD = 500 * 1024 * 1024;

async function openAttachment(a: any) {
    try {
        showToast(`Getting ${a.filename}…`);
        const data = await getBytes(a.url, MAX_DOWNLOAD);
        openFileConverter([new File([data as BlobPart], a.filename, { type: a.content_type ?? "" })]);
    } catch (e) {
        showToast(`Couldn't get the file: ${e instanceof Error ? e.message : e}`, "failure");
    }
}

const messageMenu: NavContextMenuPatchCallback = (children, { message }: any) => {
    const files: any[] = [...(message?.attachments ?? [])];
    if (!files.length) return;
    children.push(files.length === 1 ? (
        <Menu.MenuItem id="vc-fconv-open" label="Convert attachment…" action={() => openAttachment(files[0])} />
    ) : (
        <Menu.MenuItem id="vc-fconv-open" label="Convert attachment">
            {files.slice(0, 10).map((a, i) => <Menu.MenuItem key={a.id ?? i} id={`vc-fconv-${a.id ?? i}`} label={a.filename} action={() => openAttachment(a)} />)}
        </Menu.MenuItem>
    ));
};

export default definePlugin({
    name: "FileConverter",
    description: "Convert files before you send them: pictures (PNG, JPG, WebP, GIF, BMP, ICO, iPhone HEIC, PDF), videos and GIFs (MP4, WebM, MOV, MKV, AVI, animated WebP, frames), sound (MP3, WAV, FLAC, OGG, Opus, M4A), PDFs to pictures or text, and CSV / JSON / YAML / Markdown. Plus Discord-ready presets: sticker, emoji, avatar, banner, under 10 MB and voice message. Everything runs on your computer.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    settings,
    openSettingsModal: () => openFileConverter(),
    contextMenus: { message: messageMenu },
    chatBarButton: { icon: ConvertIcon, render: ConvertButton },

    start() { startUploadGuard(() => settings.store.shrinkPrompt !== false, () => { settings.store.shrinkPrompt = false; showToast("Okay — turn it back on in File Converter's settings", "success"); }); },
    stop() { stopUploadGuard(); shutdown(); },
});
