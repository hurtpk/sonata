/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../../featureSettings";
import { DEFAULT_STATE, type EditState } from "./types";

export const settings = defineFeatureSettings("gifMaker", {
    startWidth: {
        type: OptionType.SELECT,
        description: "Starting width of a new GIF (you can change it in the editor)",
        options: [
            { label: "320px", value: 320 },
            { label: "480px", value: 480, default: true },
            { label: "640px", value: 640 },
            { label: "800px", value: 800 },
        ],
    },
    prefs: {
        type: OptionType.STRING,
        default: "",
        hidden: true,
        description: "",
    },
});

/** Choices the editor remembers from last time. */
const REMEMBERED = ["fontFamily", "captionSize", "format", "colors", "sizeTarget", "favourite"] as const;

export function rememberedPrefs(): Partial<EditState> {
    try {
        const saved = JSON.parse(settings.store.prefs || "{}");
        return Object.fromEntries(REMEMBERED.filter(k => k in saved && typeof saved[k] === typeof DEFAULT_STATE[k]).map(k => [k, saved[k]]));
    } catch {
        return {};
    }
}

export function rememberPrefs(s: EditState) {
    settings.store.prefs = JSON.stringify(Object.fromEntries(REMEMBERED.map(k => [k, s[k]])));
}
