/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Gift Wrap: wrap a message, link or picture as a present. Friends with
// Sonata see a wrapped box that wobbles until they tap it — then the lid flies
// off, confetti bursts and the gift is revealed. Everyone else sees a line
// saying a gift was sent.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconProps } from "@utils/types";

import { openGiftWrap } from "./Panel";
import { GiftAccessory } from "./Present";

function GiftIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 9h16v3H4zM5.5 12v8h13v-8M12 9v11M12 9C10.5 6 7 5.5 7.5 7.5 8 9 12 9 12 9zM12 9c1.5-3 5-3.5 4.5-1.5C16 9 12 9 12 9z" />
            <path d="M18.5 2.5l.6 1.3 1.4.2-1 1 .2 1.4-1.2-.7-1.2.7.2-1.4-1-1 1.4-.2z" fill="currentColor" stroke="none" />
        </svg>
    );
}

const WrapButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="Gift wrap something" onClick={openGiftWrap}><GiftIcon /></ChatBarButton>
    : null;

const Accessory = ErrorBoundary.wrap(GiftAccessory, { noop: true });

export default definePlugin({
    name: "GiftWrap",
    description: "Wrap a message, link or picture as a present — friends with Sonata get a wrapped box to tap open, with confetti. Choose the paper, ribbon and a gift tag.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],

    openSettingsModal: () => openGiftWrap(),

    chatBarButton: { icon: GiftIcon, render: WrapButton },

    renderMessageAccessory: ({ message }: Record<string, any>) => message?.content?.includes("||sgw1.") ? <Accessory message={message} /> : null,
});
