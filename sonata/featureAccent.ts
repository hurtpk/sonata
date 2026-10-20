/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata's accent in every feature's windows. Discord's own buttons, tabs,
// switches and highlights inside those windows are coloured from its "brand"
// colour variables; inside any window that belongs to a Sonata feature
// (recognised by the class names the features use), those variables are
// swapped for the accent — with lighter and darker shades mixed from it.
// Updates live when the accent changes, and is undone when Sonata stops.

import { SettingsStore } from "@api/Settings";

import { getChannelSettingsAccent } from "../controller/accent";
import { QOL_NAME } from "../featureSettings";
import { DEFAULT_ACCENT } from "./accent";

/** Class prefixes of Sonata's feature windows. */
const PREFIXES = [
    "vc-tool-", "vc-er-", "vc-whp-", "vc-steal-", "vc-ansi-", "vc-chars-", "vc-shot-", "vc-qr-", "vc-fancy-", "vc-calc-", "vc-cal-",
    "vc-bday-", "vc-bpf-", "vc-cachec-", "vc-autoreact-", "vc-declutter-", "vc-dmprev-", "vc-fakedms-", "vc-fprev-", "vc-fx-",
    "vc-gifmaker-", "vc-gp-", "vc-imgzoom-", "vc-invm-", "vc-liverpc-", "vc-ml-modal-", "vc-mquote-", "vc-msg-logger-enhanced-",
    "vc-msgtimer-", "vc-ocr-", "vc-otd-", "vc-permviewer-", "vc-pindms-", "vc-purger-", "vc-qolcc-", "vc-schedmsg-", "vc-shc-",
    "vc-sq-", "vc-trans-", "vc-vmsg-", "vc-vtl-", "vc-zip-preview-", "vc-chsettings-", "vc-embedsender-", "vc-voice-", "vc-sstudio-", "vc-mg-", "vc-cg-", "vc-sset-", "vc-doc-", "vc-sonata-tray", "vc-avb-", "vc-streak-", "vc-wave-", "vc-ascii-", "vc-font-", "vc-remw-", "vc-todo-", "vc-conv-", "vc-fconv-", "vc-vedit-", "vc-cmdsc-", "vc-ptag-", "vc-tts-", "vc-wallet-", "vc-shield-", "vc-ttt-", "vc-rbx-", "vc-steam-", "vc-qtext-", "vc-cnotes-", "vc-whisper", "vc-dl-", "vc-ts-", "vc-bm-",
];

const STYLE_ID = "sonata-feature-accent";
const ACCENT_KEYS = new Set(["aboutAmbientColor", "sonataAccentMode", "sonataGradient", "sonataGradientA", "sonataGradientB", "sonataHolidays", "sonataSouthern", "sonataOccasion"]);

/** "#rrggbb" → "h s% l%" (the form Discord's *-hsl variables use). */
function hslOf(hex: string) {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? [...h].map(c => c + c).join("") : h;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let hue = 0, s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
        hue *= 60;
    }
    return `${hue.toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%`;
}

// Only exact class names inside :has() and in front of ::-webkit-scrollbar. Substring matches
// like [class*="vc-tool-"] there made Discord re-check every element on the page whenever
// anything changed (typing, hovering, new messages), which made all of Discord lag.
const WINDOW = '.vc-tool-wrap, [role="dialog"]:has(.vc-tool-wrap)';

function css(accent: string) {
    const scope = PREFIXES.map(p => `[class*="${p}"]`).join(",");
    const a = accent;
    const darker = (n: number) => `color-mix(in oklab, ${a} ${100 - n}%, black)`;
    const lighter = (n: number) => `color-mix(in oklab, ${a} ${100 - n}%, white)`;
    return `
/* The accent by name, for Sonata bits outside its windows (like the Spotify player's buttons). */
:root { --vc-sonata-accent: ${a}; }

/* Windows that belong to a Sonata feature use Sonata's accent instead of Discord's blue. */
${WINDOW}, ${scope} {
    --brand-500: ${a};
    --brand-500-hsl: ${hslOf(a)};
    --brand-530: ${darker(6)};
    --brand-560: ${darker(12)};
    --brand-600: ${darker(20)};
    --brand-460: ${lighter(8)};
    --brand-400: ${lighter(16)};
    --brand-360: ${lighter(26)};
    --brand-330: ${lighter(32)};
    --brand-230: ${lighter(50)};
    --brand-200: ${lighter(58)};
    --brand-experiment: ${a};
    --brand-experiment-560: ${darker(12)};
    --text-brand: ${lighter(30)};
    --background-brand: ${a};
    --control-brand-foreground: ${lighter(30)};
    --control-brand-foreground-new: ${lighter(30)};
    --control-primary-background-default: ${a};
    --control-primary-background-hover: ${darker(12)};
    --control-primary-background-active: ${darker(20)};
    --control-primary-border-default: ${a};
    --control-primary-border-hover: ${darker(12)};
    --control-primary-border-active: ${darker(20)};
    --vc-tool-accent: ${a};
}

/* Scroll bars in Sonata's windows and pages: thin, rounded and see-through, in the
   accent on hover — never the system's white bar. The same look as window.css. */
${bars(WINDOW, a)}`;
}

function bars(scope: string, a: string) {
    // The scrolling element itself, or anything inside one of Sonata's windows.
    const each = (part: string) => scope.split(", ").flatMap(sel => [`${sel}${part}`, `${sel} ${part}`]).join(", ");
    return `
${each("::-webkit-scrollbar")} { width: 8px; height: 8px; background: transparent; }
${each("::-webkit-scrollbar-track")} { background: transparent; border: 0; }
${each("::-webkit-scrollbar-button")} { display: none; width: 0; height: 0; }
${each("::-webkit-scrollbar-corner")} { background: transparent; }
${each("::-webkit-scrollbar-thumb")} { min-height: 40px; border: 2px solid transparent; border-radius: 99px; background: color-mix(in srgb, currentColor 18%, transparent); background-clip: padding-box; }
${each("::-webkit-scrollbar-thumb:hover")} { background: color-mix(in srgb, ${a} 65%, transparent); background-clip: padding-box; }
${each("::-webkit-scrollbar-thumb:active")} { background: ${a}; background-clip: padding-box; }`;
}

function apply() {
    // Never picked an accent? Sonata shows its default, so the windows do too.
    const accent = getChannelSettingsAccent() ?? DEFAULT_ACCENT;
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    el.textContent = css(accent);
}

const onChange = (_: unknown, path: string) => {
    if (!path.startsWith(`plugins.${QOL_NAME}.`)) return;
    if (ACCENT_KEYS.has(path.slice(`plugins.${QOL_NAME}.`.length))) apply();
};

export function startFeatureAccent() {
    apply();
    SettingsStore.addGlobalChangeListener(onChange);
}

export function stopFeatureAccent() {
    SettingsStore.removeGlobalChangeListener(onChange);
    document.getElementById(STYLE_ID)?.remove();
}
