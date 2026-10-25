/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../_shared/tool.css";
import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";
import { MediaNative } from "../../_shared/media";
import { FontCard } from "./FontCard";
import { formatSize, LIMITS, previewKind } from "./formats";
import { FileRef, preview } from "./Viewer";

export const settings = defineFeatureSettings("filePreviewer", {
    showButtons: {
        type: OptionType.BOOLEAN,
        description: "Show Preview buttons under messages with previewable files (right-click → Preview works either way)",
        default: true,
    },
});

function previewable(message: Message | undefined): FileRef[] {
    return ((message?.attachments ?? []) as any[])
        .filter(a => previewKind(a.filename, a.content_type))
        .map(a => ({ url: a.url, filename: a.filename, size: a.size ?? 0, contentType: a.content_type }));
}

const ICON: Record<string, string> = { pdf: "📄", table: "📊", text: "📝", archive: "🗜️", font: "🔤", video: "🎬" };

const limitText = (bytes: number) => bytes >= 1073741824 ? "1 GB" : formatSize(bytes);

function Buttons({ files }: { files: FileRef[]; }) {
    const fonts = files.filter(f => previewKind(f.filename, f.contentType) === "font");
    return (
        <div className="vc-fprev-pills">
            {fonts.map(f => <FontCard key={f.url} file={f} />)}
            {files.filter(f => !fonts.includes(f)).map(f => {
                const kind = previewKind(f.filename, f.contentType)!;
                const tooBig = f.size > LIMITS[kind];
                return (
                    <button
                        key={f.url}
                        type="button"
                        className={tooBig ? "vc-fprev-pill vc-fprev-pill-off" : "vc-fprev-pill"}
                        aria-disabled={tooBig}
                        onClick={() => preview(f)}
                        title={tooBig ? `Too big to preview (the limit for this kind of file is ${limitText(LIMITS[kind])})` : `Preview ${f.filename}`}
                    >
                        <span aria-hidden>{ICON[kind]}</span>
                        {tooBig ? "Too big to preview" : "Preview"} <b>{f.filename}</b>
                        <span className="vc-fprev-pill-size">{formatSize(f.size)}</span>
                    </button>
                );
            })}
        </div>
    );
}

const messageMenu: NavContextMenuPatchCallback = (children, { message }) => {
    const files = previewable(message);
    if (!files.length) return;
    children.push(files.length === 1
        ? <Menu.MenuItem id="vc-fprev-one" label={`Preview ${files[0].filename}`} action={() => preview(files[0])} />
        : (
            <Menu.MenuItem id="vc-fprev-many" label="Preview file">
                {files.map((f, i) => <Menu.MenuItem key={i} id={`vc-fprev-${i}`} label={f.filename} action={() => preview(f)} />)}
            </Menu.MenuItem>
        ));
};

export default definePlugin({
    name: "FilePreviewer",
    description: "Preview PDFs, spreadsheets, text/code, .rar/.7z archives, fonts and MKV videos right from chat, without downloading them.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    contextMenus: { "message": messageMenu },

    // Big previews (archives, PDFs) are cached on disk while you're in a
    // channel; switching channels deletes them.
    flux: {
        CHANNEL_SELECT() {
            MediaNative?.clearPreviewCache().catch(() => { });
        },
    },

    stop() {
        MediaNative?.clearPreviewCache().catch(() => { });
    },

    renderMessageAccessory({ message }: Record<string, any>) {
        if (settings.store.showButtons === false) return null;
        const files = previewable(message);
        return files.length ? <Buttons files={files} /> : null;
    },
});
