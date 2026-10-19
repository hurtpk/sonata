/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin, { IconProps, OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import { openStyler } from "./Panel";
import { DEFAULT_OPTIONS, StyleOptions } from "./render";

export const settings = defineFeatureSettings("screenshotStyler", {
    onPaste: {
        type: OptionType.BOOLEAN,
        description: "Open the styler when you paste an image into the message box (it has an \"Attach original\" button for when you don't want to style it)",
        default: true,
    },
    options: {
        type: OptionType.STRING,
        description: "Internal: the style used last (JSON).",
        default: "",
        hidden: true,
    },
});

function lastOptions(): StyleOptions {
    try { return { ...DEFAULT_OPTIONS, ...JSON.parse(settings.store.options || "{}") }; } catch { return DEFAULT_OPTIONS; }
}

const open = (image: Blob | null = null) => openStyler(image, lastOptions(), o => { settings.store.options = JSON.stringify(o); });

export function StylerIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="15" rx="3" />
            <path d="M3 9h18" />
            <circle cx="6" cy="7" r=".6" fill="currentColor" />
            <circle cx="8.4" cy="7" r=".6" fill="currentColor" />
            <path d="m7 17 3.5-3.5 2.5 2.5 1.5-1.5L17 17" />
        </svg>
    );
}

const StylerChatBarButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return (
        <ChatBarButton tooltip="Style a screenshot" onClick={() => open()}>
            <StylerIcon />
        </ChatBarButton>
    );
};

// Pasting a picture into the message box opens the styler instead of attaching it straight away.
function onPaste(e: ClipboardEvent) {
    if (!settings.store.onPaste) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.('[role="textbox"]')) return;
    const images = Array.from(e.clipboardData?.files ?? []).filter(f => f.type.startsWith("image/"));
    // Several files at once is a different job — let Discord handle it.
    if (images.length !== 1 || (e.clipboardData?.files.length ?? 0) !== 1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    open(images[0]);
}

export default definePlugin({
    name: "ScreenshotStyler",
    description: "Paste a screenshot to frame it (background, corners, shadow, border, window bar, caption, shape), adjust its colours (looks, brightness, contrast, saturation, warmth, tint, vignette, grain) and edit it (crop, blur, pixelate, black out, boxes, spotlight, arrows, text, rotate) before sending it.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => open(),

    chatBarButton: {
        icon: StylerIcon,
        render: StylerChatBarButton,
    },

    start() {
        document.addEventListener("paste", onPaste, true);
    },

    stop() {
        document.removeEventListener("paste", onPaste, true);
    },
});
