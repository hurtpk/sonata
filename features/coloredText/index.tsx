/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import definePlugin, { IconProps, OptionType } from "@utils/types";
import { Menu } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { openColoredText } from "./Panel";

export const settings = defineFeatureSettings("coloredText", {
    chatBarButton: {
        type: OptionType.BOOLEAN,
        description: "Show a button for it in the chat bar",
        default: true,
    },
});

export function ColoredTextIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" aria-hidden>
            <path d="M5 18 10.5 4h3L19 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            <path d="M7.4 12h9.2" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
            <rect x="3" y="20" width="6" height="2.4" rx="1" fill="#dc322f" />
            <rect x="9" y="20" width="6" height="2.4" rx="1" fill="#859900" />
            <rect x="15" y="20" width="6" height="2.4" rx="1" fill="#268bd2" />
        </svg>
    );
}

const ColoredTextChatBarButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat || !settings.store.chatBarButton) return null;
    return (
        <ChatBarButton tooltip="Colored Text" onClick={() => openColoredText()}>
            <ColoredTextIcon />
        </ChatBarButton>
    );
};

// A message with coloured text can be opened in the builder to reuse or change it.
const messageMenu: NavContextMenuPatchCallback = (children, props) => {
    const content: string | undefined = props?.message?.content;
    if (!content || !/```ansi/.test(content)) return;
    children.push(<Menu.MenuItem id="vc-ansi-edit" label="Edit colored text" action={() => openColoredText(content)} />);
};

export default definePlugin({
    name: "ColoredTextBuilder",
    description: "A simple editor for Discord's coloured ansi text: type, select some, click a colour, background, bold or underline, see a preview, and insert it into your message.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openColoredText(),

    chatBarButton: {
        icon: ColoredTextIcon,
        render: ColoredTextChatBarButton,
    },

    contextMenus: {
        "message": messageMenu,
    },
});
