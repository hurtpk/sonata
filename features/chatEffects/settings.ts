/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import { EFFECTS } from "../_shared/effects";
import type { Config } from "./triggers";

export const settings = defineFeatureSettings("chatEffects", {
    fromOthers: {
        type: OptionType.BOOLEAN,
        description: "Play effects for other people's messages too, not just yours",
        default: true,
    },
    maxPerMessage: {
        type: OptionType.SLIDER,
        description: "Most effects one message can start at once",
        markers: [1, 2, 3],
        default: 2,
        stickToMarkers: true,
    },
    config: {
        type: OptionType.STRING,
        description: "Internal: which effects are on and their trigger words (JSON). Edit them in the Chat Effects window.",
        default: "",
        hidden: true,
    },
});

export const defaultConfig = (): Config => Object.fromEntries(EFFECTS.map(e => [e.id, { on: true, words: e.words.join(", ") }]));

export function getConfig(): Config {
    const defaults = defaultConfig();
    try {
        const saved = JSON.parse(settings.store.config || "{}") as Config;
        // New effects added later show up with their default words.
        return { ...defaults, ...saved };
    } catch {
        return defaults;
    }
}

export const saveConfig = (config: Config) => { settings.store.config = JSON.stringify(config); };
