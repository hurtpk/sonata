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
import { openFancyText } from "./Panel";

export const settings = defineFeatureSettings("fancyText", {
    lastStyle: {
        type: OptionType.STRING,
        description: "Internal: the style used last (shown first).",
        default: "bold",
        hidden: true,
    },
    favoritesJson: { type: OptionType.STRING, description: "Internal: favourite styles.", default: "[]", hidden: true },
    customJson: { type: OptionType.STRING, description: "Internal: your own styles.", default: "[]", hidden: true },
});

export function FancyTextIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="currentColor" aria-hidden>
            <path d="M7.4 4.6a1 1 0 0 0-1.8 0l-4.5 13a1 1 0 1 0 1.9.7L4.1 15h5.3l1.1 3.3a1 1 0 1 0 1.9-.7l-4.5-13ZM4.8 13l1.9-5.6L8.7 13H4.8Z" />
            <path d="M17.5 9c-2.5 0-4.5 2.2-4.5 5s2 5 4.5 5c1 0 2-.4 2.7-1v.2a1 1 0 1 0 2 0V10a1 1 0 0 0-2 0v.1A4.2 4.2 0 0 0 17.5 9Zm0 8c-1.3 0-2.5-1.2-2.5-3s1.2-3 2.5-3 2.6 1.2 2.6 3-1.2 3-2.6 3Z" />
            <path d="m19.6 3.4.5-1.1a.4.4 0 0 1 .8 0l.5 1.1 1.1.5a.4.4 0 0 1 0 .8l-1.1.5-.5 1.1a.4.4 0 0 1-.8 0l-.5-1.1-1.1-.5a.4.4 0 0 1 0-.8l1.1-.5Z" />
        </svg>
    );
}

const open = () => openFancyText(settings.store as any);

const FancyChatBarButton: ChatBarButtonFactory = ({ isMainChat }) => {
    if (!isMainChat) return null;
    return (
        <ChatBarButton tooltip="Fancy Text" onClick={open}>
            <FancyTextIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "FancyText",
    description: "A chat bar button that turns your text into Unicode styles — bold, script, gothic, small caps, bubbles, upside down and more — with a live preview of each. Star your favourites, and mix your own styles (letters + spacing, lines and wraps like ꧁ ꧂).",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: open,

    chatBarButton: {
        icon: FancyTextIcon,
        render: FancyChatBarButton,
    },
});
