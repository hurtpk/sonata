/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Trigger-word matching, kept free of Discord so it can be tested on its own.

export interface EffectConfig {
    on: boolean;
    /** Comma-separated words or phrases. */
    words: string;
}

export type Config = Record<string, EffectConfig>;

export const splitWords = (words: string) => words.split(",").map(w => w.trim().toLowerCase()).filter(Boolean);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does the message contain this trigger? Words and phrases must stand on their
 * own ("yay" doesn't fire on "yayyy" or "papaya"); symbols and emoji like "<3"
 * or "🎉" match anywhere.
 */
export function hasTrigger(text: string, word: string) {
    const lower = text.toLowerCase();
    if (!/[\p{L}\p{N}]/u.test(word)) return lower.includes(word);
    const start = /^[\p{L}\p{N}]/u.test(word) ? "(?<![\\p{L}\\p{N}])" : "";
    const end = /[\p{L}\p{N}]$/u.test(word) ? "(?![\\p{L}\\p{N}])" : "";
    return new RegExp(start + escape(word) + end, "u").test(lower);
}

/** The effects a message triggers, in the order they're listed. */
export function effectsFor(text: string, config: Config, order: string[]) {
    if (!text) return [];
    // Ignore code, links and custom-emoji markup so they don't fire effects by accident.
    const plain = text.replace(/```[\s\S]*?```|`[^`]*`/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/<a?:\w+:\d+>/g, " ");
    return order.filter(id => config[id]?.on && splitWords(config[id].words).some(w => hasTrigger(plain, w)));
}
