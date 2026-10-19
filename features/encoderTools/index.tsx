/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { Menu } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { CODECS, detect } from "./codecs";
import { openEncoder } from "./Panel";

export const settings = defineFeatureSettings("encoderTools", {
    chatBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show a button for it in the chat bar",
        default: true,
    },
    lastCodec: {
        type: OptionType.STRING,
        description: "Internal: the format used last.",
        default: "morse",
        hidden: true,
    },
});

const open = (text?: string, codec?: string, direction?: "encode" | "decode") => openEncoder({
    text, codec: codec ?? settings.store.lastCodec, direction,
    onUse: id => { settings.store.lastCodec = id; },
});

export function EncoderIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 6 3 12l5 6M16 6l5 6-5 6" />
            <circle cx="9.5" cy="12" r=".9" fill="currentColor" stroke="none" />
            <path d="M12.5 12h3" />
        </svg>
    );
}

const EncoderChatBarButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat || !settings.store.chatBarButton) return null;
    return (
        <ChatBarButton tooltip="Encoder Tools" onClick={() => open()}>
            <EncoderIcon />
        </ChatBarButton>
    );
};

const messageMenu: NavContextMenuPatchCallback = (children, props) => {
    const content: string | undefined = props?.message?.content;
    if (!content?.trim()) return;
    const guesses = detect(content);
    children.push(
        <Menu.MenuItem id="vc-encoder" label="Encode / decode">
            {guesses.map(c => (
                <Menu.MenuItem key={`d-${c.id}`} id={`vc-encoder-decode-${c.id}`} label={`Decode ${c.name}`} action={() => open(content, c.id, "decode")} />
            ))}
            {guesses.length > 0 && <Menu.MenuSeparator />}
            {CODECS.map(c => (
                <Menu.MenuItem key={`e-${c.id}`} id={`vc-encoder-encode-${c.id}`} label={`To ${c.name}`} action={() => open(content, c.id, "encode")} />
            ))}
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "EncoderTools",
    description: "Turn text into Morse, binary, Base64, hex, ROT13, URL encoding or reversed text, and back again — from the chat bar, or by right-clicking a message (encoded messages are recognised and decoded in one click).",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => open(),

    chatBarButton: {
        icon: EncoderIcon,
        render: EncoderChatBarButton,
    },

    contextMenus: {
        "message": messageMenu,
    },
});
