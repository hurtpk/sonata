/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Share My Setup: send your Sonata design, accent, dock and feature switches
// as a card in any chat. Friends with Sonata see a preview and apply any part
// in one click (with Undo); there's also a code to copy and paste anywhere.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconProps } from "@utils/types";

import { SetupAccessory } from "./Card";
import { openShareSetup } from "./Panel";

function GiftIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 8h16a1 1 0 0 1 1 1v3H3V9a1 1 0 0 1 1-1zM5 12v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8M12 8v13M12 8C11 5 7 4 7 6.5S10 8 12 8zM12 8c1-3 5-4 5-1.5S14 8 12 8z" />
        </svg>
    );
}

const ShareButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="Share my Sonata setup" onClick={openShareSetup}><GiftIcon /></ChatBarButton>
    : null;

const Accessory = ErrorBoundary.wrap(SetupAccessory, { noop: true });

export default definePlugin({
    name: "ShareSetup",
    description: "Share your Sonata design, accent, dock and feature switches as a card in any chat — friends with Sonata preview it and apply any part in one click, with Undo. Or copy a code to share anywhere.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: () => openShareSetup(),

    chatBarButton: { icon: GiftIcon, render: ShareButton },

    renderMessageAccessory: ({ message }: Record<string, any>) => message?.content?.includes("||sset1.") ? <Accessory message={message} /> : null,
});
