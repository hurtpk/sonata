/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Smooth Chat: new messages ease into the chat instead of popping in. Only
// messages that arrive while you're looking get the animation — scrolling
// back through history stays instant.

import "./styles.css";

import definePlugin, { OptionType } from "@utils/types";
import { SelectedChannelStore, UserStore } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";

export const settings = defineFeatureSettings("smoothChat", {
    style: {
        type: OptionType.SELECT,
        description: "How new messages come in",
        options: [
            { label: "Slide up", value: "slide", default: true },
            { label: "Fade in", value: "fade" },
            { label: "Pop", value: "pop" },
            { label: "Glide from the side", value: "side" },
        ],
    },
    speed: {
        type: OptionType.SELECT,
        description: "Speed",
        options: [
            { label: "Quick", value: 0.18 },
            { label: "Normal", value: 0.3, default: true },
            { label: "Relaxed", value: 0.5 },
        ],
    },
    mine: {
        type: OptionType.BOOLEAN,
        description: "Animate my own messages too",
        default: true,
    },
    highlight: {
        type: OptionType.BOOLEAN,
        description: "Give new messages a brief soft glow",
        default: false,
    },
});

/** Finds the new message once Discord has drawn it (a few frames), and plays the animation once. */
function animate(channelId: string, messageId: string, tries = 0) {
    const el = document.getElementById(`chat-messages-${channelId}-${messageId}`);
    if (!el) {
        if (tries < 20) requestAnimationFrame(() => animate(channelId, messageId, tries + 1));
        return;
    }
    const cls = `vc-smooth-${settings.store.style}`;
    el.style.setProperty("--smooth-speed", `${Number(settings.store.speed) || 0.3}s`);
    el.classList.add("vc-smooth-in", cls);
    if (settings.store.highlight) el.classList.add("vc-smooth-glow");
    el.addEventListener("animationend", () => el.classList.remove("vc-smooth-in", cls, "vc-smooth-glow"), { once: true });
}

export default definePlugin({
    name: "SmoothChat",
    description: "New messages ease into the chat — slide up, fade, pop or glide — instead of appearing all at once. Only new messages animate; scrolling history stays instant.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    flux: {
        MESSAGE_CREATE({ channelId, message, optimistic }: any) {
            if (!message?.id || channelId !== SelectedChannelStore.getChannelId()) return;
            const mine = message.author?.id === UserStore.getCurrentUser()?.id;
            if (mine && !settings.store.mine) return;
            // Your own message arrives twice (sending, then sent — the same row): animate the first only.
            if (mine && !optimistic) return;
            animate(channelId, message.id);
        },
    },
});
