/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { findByCodeLazy } from "@webpack";
import { FluxDispatcher } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";
import { openSection, registerSection, setOriginal } from "../../_shared/Hub";
import { openStyler, StylerModal } from "./Panel";
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

const saveOptions = (o: StyleOptions) => { settings.store.options = JSON.stringify(o); };
const open = (image: Blob | null = null) => openStyler(image, lastOptions(), saveOptions);
// Media Tools' window: a picture you're editing goes straight in.
registerSection("mediaTools", {
    id: "screenshotStyler", feature: "screenshotStyler", name: "Screenshot Styler", sub: "Frames, backgrounds and shadows",
    render: (p, input) => <StylerModal modalProps={p} initial={input?.file?.type.startsWith("image/") ? input.file : null} startOptions={lastOptions()} saveOptions={saveOptions} />,
});

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

/** Discord's own button for the bar on an attachment (the same one Anonymise File Names uses). */
const ActionBarIcon = findByCodeLazy("Children.map", "isValidElement", "dangerous:");

/** "Edit in Media Tools" on a picture or video you've added to a message: the edited copy replaces it. */
const EditUploadButton = ErrorBoundary.wrap(({ upload, channelId, draftType }: { upload: any; channelId: string; draftType: number; }) => {
    const file: File | undefined = upload?.item?.file;
    if (!(file instanceof File) || !/^(image|video)\//.test(file.type)) return null;
    return (
        <ActionBarIcon tooltip="Edit in Media Tools" onClick={() => {
            setOriginal({ channelId, id: upload.id, draftType }, FluxDispatcher);
            openSection("mediaTools", file.type.startsWith("video/") ? "videoEditor" : file.type === "image/gif" ? "gifMaker" : "screenshotStyler", undefined, { file });
        }}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5" />
            </svg>
        </ActionBarIcon>
    );
}, { noop: true });

export default definePlugin({
    name: "ScreenshotStyler",
    description: "Paste a screenshot to frame it (background, corners, shadow, border, window bar, caption, shape), adjust its colours (looks, brightness, contrast, saturation, warmth, tint, vignette, grain) and edit it (crop, blur, pixelate, black out, boxes, spotlight, arrows, text, rotate) before sending it.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => open(),
    EditUploadButton,
    patches: [{
        // The bar on an attachment in the message box (spoiler, edit, remove).
        find: "#{intl::ATTACHMENT_UTILITIES_SPOILER}",
        replacement: {
            match: /(?<=children:\[)(?=.{0,220}?tooltip:.{0,100}#{intl::ATTACHMENT_UTILITIES_SPOILER})/,
            replace: "arguments[0].canEdit!==false?$self.EditUploadButton(arguments[0]):null,",
        },
    }],

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
