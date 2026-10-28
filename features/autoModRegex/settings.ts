/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import type { Opts } from "./regex";

// The switches are kept so the window opens the way you left it. The word list itself is never saved.
export const settings = defineFeatureSettings("autoModRegex", {
    leet: { type: OptionType.BOOLEAN, description: "Internal: swap in look-alike symbols.", default: true, hidden: true },
    homoglyphs: { type: OptionType.BOOLEAN, description: "Internal: Cyrillic look-alike letters.", default: true, hidden: true },
    separators: { type: OptionType.BOOLEAN, description: "Internal: allow spaces and punctuation between letters.", default: true, hidden: true },
    stretch: { type: OptionType.BOOLEAN, description: "Internal: allow repeated letters.", default: true, hidden: true },
    wordStart: { type: OptionType.BOOLEAN, description: "Internal: only match at the start of a word.", default: true, hidden: true },
    ignoreCase: { type: OptionType.BOOLEAN, description: "Internal: case-insensitive patterns.", default: true, hidden: true },
    vowelSwap: { type: OptionType.BOOLEAN, description: "Internal: any character in place of a vowel.", default: false, hidden: true },
});

export const readOpts = (): Opts => ({
    leet: settings.store.leet !== false,
    homoglyphs: settings.store.homoglyphs !== false,
    separators: settings.store.separators !== false,
    stretch: settings.store.stretch !== false,
    wordStart: settings.store.wordStart !== false,
    ignoreCase: settings.store.ignoreCase !== false,
    vowelSwap: settings.store.vowelSwap === true,
});

export const writeOpt = (k: keyof Opts, v: boolean) => { (settings.store as any)[k] = v; };
