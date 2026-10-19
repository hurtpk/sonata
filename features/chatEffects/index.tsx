/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import definePlugin from "@utils/types";
import { SelectedChannelStore, UserStore } from "@webpack/common";

import { EFFECTS, playEffect, stopEffects } from "../_shared/effects";
import { messageRect } from "./anchor";
import { openEffects } from "./Panel";
import { getConfig, settings } from "./settings";
import { effectsFor } from "./triggers";

const ORDER = EFFECTS.map(e => e.id);
/** One run per message: your own message arrives twice (sending, then sent). */
const seen = new Set<string>();
let lastPlayed = 0;

const open = () => openEffects();

export default definePlugin({
    name: "ChatEffects",
    description: "iMessage-style screen effects — Echo, Spotlight, Balloons, Confetti, Love, Lasers, Fireworks and Celebration, plus extras like snow and hearts — when a message contains words you choose. Only you see them; nothing is sent to anyone.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: open,

    flux: {
        MESSAGE_CREATE({ message, optimistic, isPushNotification }: any) {
            if (isPushNotification || !message?.content) return;
            if (message.channel_id !== SelectedChannelStore.getChannelId()) return;
            if (document.visibilityState !== "visible") return;

            const mine = message.author?.id === UserStore.getCurrentUser()?.id;
            if (!mine && (!settings.store.fromOthers || optimistic)) return;

            const key = message.nonce || message.id;
            if (seen.has(key)) return;
            seen.add(key);
            if (seen.size > 200) seen.delete(seen.values().next().value!);

            const ids = effectsFor(message.content, getConfig(), ORDER).slice(0, settings.store.maxPerMessage);
            if (!ids.length) return;
            // A short breather so a burst of messages doesn't stack up dozens of effects.
            if (Date.now() - lastPlayed < 1500) return;
            lastPlayed = Date.now();
            const options = { text: message.content, anchor: () => messageRect(message.channel_id, message.id, message.nonce) };
            ids.forEach(id => playEffect(id, options));
        },
    },

    stop() {
        stopEffects();
        seen.clear();
    },
});
