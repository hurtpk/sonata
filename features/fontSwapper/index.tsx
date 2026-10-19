/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Font Swapper: Discord's font, text size, line spacing and letter spacing,
// changed live — for everything or just messages — with presets for easy
// reading. Only styles change; nothing about Discord's own settings.

import "./styles.css";

import { SettingsStore } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

import { defineFeatureSettings, QOL_NAME } from "../../featureSettings";
import { CODE_FONTS, codeFontById, DEFAULT_LOOK, fontById, fontCss, FontLook, FONTS, safeFontName } from "./fonts";
import { openFontSwapper } from "./Panel";

export const settings = defineFeatureSettings("fontSwapper", {
    font: {
        type: OptionType.SELECT,
        description: "Font",
        options: FONTS.map(f => ({ label: f.name, value: f.id, default: f.id === "discord" })),
    },
    customFont: {
        type: OptionType.STRING,
        description: "A font installed on your computer (when Font is \"Another font on my computer\")",
        default: "",
    },
    codeFont: {
        type: OptionType.SELECT,
        description: "Font for code blocks",
        options: CODE_FONTS.map(f => ({ label: f.name, value: f.id, default: f.id === "discord" })),
    },
    scope: {
        type: OptionType.SELECT,
        description: "Use the font for",
        options: [
            { label: "Everything in Discord", value: "all", default: true },
            { label: "Messages only", value: "messages" },
        ],
    },
    size: { type: OptionType.SLIDER, description: "Message text size (%)", markers: [80, 90, 100, 110, 120, 130, 140], default: 100, stickToMarkers: false },
    lineHeight: { type: OptionType.SLIDER, description: "Line spacing (%)", markers: [80, 100, 120, 140, 160, 180, 200], default: 100, stickToMarkers: false },
    letterSpacing: { type: OptionType.SLIDER, description: "Letter spacing", markers: [-4, -2, 0, 2, 4, 6, 8, 10], default: 0, stickToMarkers: false },
});

export function currentLook(): FontLook {
    const s = settings.store as any;
    return {
        font: s.font ?? DEFAULT_LOOK.font,
        customFont: s.customFont ?? "",
        codeFont: s.codeFont ?? DEFAULT_LOOK.codeFont,
        scope: s.scope === "messages" ? "messages" : "all",
        size: Number(s.size ?? 100) || 100,
        lineHeight: Number(s.lineHeight ?? 100) || 100,
        letterSpacing: Number(s.letterSpacing ?? 0) || 0,
    };
}

export function setLook(look: Partial<FontLook>) {
    for (const [k, v] of Object.entries(look)) (settings.store as any)[k] = v;
}

/** The font-family stack for a look, or "" for Discord's own. */
export function stackOf(look: FontLook) {
    const f = fontById(look.font);
    if (f.id !== "custom") return f.stack;
    const name = safeFontName(look.customFont);
    return name ? `"${name}", "gg sans", "Noto Sans", sans-serif` : "";
}

const THEMES = ":root, body, [class*=\"theme-\"]";
const MESSAGE = "[class*=\"messageContent_\"]";

function css(look: FontLook) {
    const font = fontById(look.font), code = codeFontById(look.codeFont);
    const stack = stackOf(look);
    const out: string[] = [];
    // Web fonts first: @import must come before every other rule.
    for (const f of [font, code]) if (f.kind === "web") out.push(...fontCss(f).map(u => `@import url("${u}");`));
    if (stack) {
        if (look.scope === "all") out.push(`${THEMES} { --font-primary: ${stack} !important; --font-display: ${stack} !important; --font-headline: ${stack} !important; }`);
        else out.push(`${MESSAGE}, [class*="repliedTextContent_"], [class*="embedDescription_"] { font-family: ${stack} !important; }`);
    }
    if (code.stack) out.push(`${THEMES} { --font-code: ${code.stack} !important; }`);
    const k = look.size / 100, lh = look.lineHeight / 100;
    if (k !== 1 || lh !== 1 || look.letterSpacing) {
        out.push(`${MESSAGE} { font-size: calc(1rem * ${k}) !important; line-height: calc(1.375rem * ${k * lh}) !important; letter-spacing: ${look.letterSpacing / 100}em !important; }`);
    }
    return out.join("\n");
}

const STYLE_ID = "sonata-font-swapper";

function apply() {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    const text = css(currentLook());
    if (!text) { el?.remove(); return; }
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    if (el.textContent !== text) el.textContent = text;
}

const PREFIX = `plugins.${QOL_NAME}.fontSwapper_`;
const onChange = (_: unknown, path: string) => { if (path.startsWith(PREFIX)) apply(); };

export default definePlugin({
    name: "FontSwapper",
    description: "Change Discord's font, text size, line spacing and letter spacing live — for everything or just messages — with presets like Easy reading, Dyslexia-friendly and Compact. Also a separate font for code blocks.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    openSettingsModal: () => openFontSwapper(),

    start() {
        apply();
        SettingsStore.addGlobalChangeListener(onChange);
    },

    stop() {
        SettingsStore.removeGlobalChangeListener(onChange);
        document.getElementById(STYLE_ID)?.remove();
    },
});
