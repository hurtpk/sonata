/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Whisper: send a normal-looking message with a hidden one inside. Everyone
// sees the cover; people with Sonata get a small box under it to tap and
// read the hidden part. Lock it with a password, or pair with a friend for
// whispers only the two of you can open — and one message can carry two
// secrets for two different groups. Works only between Sonata users.
//
// Quick whispers: "cover ;; hidden" in the message box becomes a whisper
// when you press Enter.

import "../_shared/tool.css";
import "./styles.css";

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { IconProps } from "@utils/types";
import { showToast } from "@webpack/common";

import { hasWhisper, hide, LIMIT } from "./codec";
import { getBook, loadKeys, pairWith } from "./keys";
import { sealOf } from "./locks";
import { dmPartner, openWhisper } from "./Panel";
import { WhisperReveal } from "./Reveal";
import { settings } from "./settings";

function WhisperIcon({ height = 20, width = 20, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" width={width} height={height} className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 5.5h16v10H9l-4.5 3.5v-3.5H4z" />
            <path d="M9 10.5h.01M12 10.5h.01M15 10.5h.01" strokeWidth={2.6} />
        </svg>
    );
}

const WriteButton: ChatBarButtonFactory = ({ isMainChat }) => isMainChat
    ? <ChatBarButton tooltip="Whisper — a hidden message for Sonata users" onClick={() => openWhisper()}><WhisperIcon /></ChatBarButton>
    : null;

const Accessory = ErrorBoundary.wrap(WhisperReveal, { noop: true });

/** "cover ;; hidden" — both sides need something in them. */
const QUICK = /^([\s\S]*?\S[\s\S]*?)\s;;\s([\s\S]*\S[\s\S]*)$/;

export default definePlugin({
    name: "Whisper",
    description: "Send a normal-looking message with a hidden one inside — friends with Sonata tap to read it. Lock it with a password or pair with a friend, put two secrets for two groups in one message, let it expire, and type “cover ;; hidden” for a quick one.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openWhisper(),

    chatBarButton: { icon: WhisperIcon, render: WriteButton },

    renderMessageAccessory: ({ message }: Record<string, any>) => hasWhisper(message?.content) ? <Accessory message={message} /> : null,

    async onBeforeMessageSend(channelId: string, msg: { content: string; }) {
        if (!settings.store.quickWhisper || !msg?.content?.includes(";;")) return;
        const m = msg.content.match(QUICK);
        if (!m) return;
        await loadKeys();
        const pick = settings.store.quickLock ?? "auto";
        const dm = dmPartner(channelId);
        const named = pick.startsWith("p:") ? getBook().find(b => b.name === pick.slice(2)) : undefined;
        // Never quietly less private than you asked for.
        if (pick.startsWith("p:") && !named) {
            showToast(`Quick whispers use “${pick.slice(2)}”, which isn't in your password book any more — pick another under Whisper → Keys`, "failure");
            return { cancel: true };
        }
        const seal = await sealOf(
            named ? { kind: "password", password: named.password }
                : pick === "auto" && dm && pairWith(dm.id) ? { kind: "pair", userId: dm.id }
                    : { kind: "sonata" }
        );
        if (!seal) return;
        const text = await hide(m[1], [{ text: m[2].trim(), seal }]);
        if (text.length > LIMIT) {
            showToast("Too long for a whisper — shorten the hidden part", "failure");
            return { cancel: true };
        }
        msg.content = text;
    },

    start() {
        void loadKeys();
    },
});
