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

import { Settings, SettingsStore } from "@api/Settings";

import { getChannelSettingsAccent } from "../controller/accent";
import { QOL_NAME } from "../featureSettings";
import { accentColors, DEFAULT_ACCENT, onAlbumChange } from "./accent";

/** Class prefixes of Sonata's feature windows. */
const PREFIXES = [
    "vc-tool-", "vc-er-", "vc-whp-", "vc-steal-", "vc-ansi-", "vc-chars-", "vc-shot-", "vc-qr-", "vc-fancy-", "vc-calc-", "vc-cal-",
    "vc-bday-", "vc-bpf-", "vc-cachec-", "vc-autoreact-", "vc-declutter-", "vc-dmprev-", "vc-fakedms-", "vc-fprev-", "vc-fx-",
    "vc-gifmaker-", "vc-gp-", "vc-imgzoom-", "vc-invm-", "vc-liverpc-", "vc-ml-modal-", "vc-mquote-", "vc-msg-logger-enhanced-",
    "vc-msgtimer-", "vc-ocr-", "vc-otd-", "vc-permviewer-", "vc-pindms-", "vc-purger-", "vc-qolcc-", "vc-schedmsg-", "vc-shc-",
    "vc-sq-", "vc-trans-", "vc-vmsg-", "vc-vtl-", "vc-zip-preview-", "vc-chsettings-", "vc-embedsender-", "vc-voice-", "vc-sstudio-", "vc-mg-", "vc-cg-", "vc-sset-", "vc-doc-", "vc-sonata-tray", "vc-avb-", "vc-streak-", "vc-wave-", "vc-ascii-", "vc-font-", "vc-remw-", "vc-todo-", "vc-conv-", "vc-fconv-", "vc-vedit-", "vc-cmdsc-", "vc-ptag-", "vc-tts-", "vc-wallet-", "vc-shield-", "vc-ttt-", "vc-rbx-", "vc-steam-", "vc-qtext-", "vc-cnotes-", "vc-whisper", "vc-dl-", "vc-ts-", "vc-bm-", "vc-cbadge-", "vc-localnames-", "vc-games-", "vc-track-",
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

/**
 * With a two-colour accent (Gradient, Seasons & holidays, Album art), filled buttons, on-switches and
 * picked tabs in Sonata's windows fade between both colours instead of showing only the first.
 */
function gradientCss(a: string, b: string) {
    const grad = `linear-gradient(135deg, ${a}, ${b})`;
    const inside = (sel: string) => [".vc-sw", ".sonata-window", ".vc-tool-wrap"].map(w => `${w} ${sel}`).join(", ");
    return `
/* A two-colour accent: filled buttons and switches fade between both colours. */
:root { --vc-sonata-accent-2: ${b}; --vc-sonata-gradient: ${grad}; }
.vc-sw.vc-sw, .vc-sw-styled.vc-sw-styled, .sonata-window, .vc-tool-wrap.vc-tool-wrap { --sw-accent-fill: ${grad}; }
${inside(".vc-btn-primary")}, ${inside(".vc-tool-primary")}, ${inside(".vc-sw-switch-on")} { background-image: ${grad} !important; border-color: transparent !important; }
${inside(".vc-btn-primary:hover:not(:disabled)")}, ${inside(".vc-tool-primary:hover:not(:disabled)")} { filter: brightness(1.08); }
.vc-sw .vc-sw-tab-on, .vc-sw .vc-tool-tab-on { box-shadow: none !important; background: ${grad} bottom / 100% 2px no-repeat !important; }
.vc-sw .vc-sw-dot { background: ${grad}; }
.vc-sw button[class*="colorBrand"] { background-image: ${grad} !important; }

/* Accent-coloured text in windows (links, highlighted numbers) as gradient text. */
.vc-sw .vc-tool-link, .vc-sw .vc-tool-stat-accent > b { background: ${grad}; -webkit-background-clip: text; background-clip: text; color: transparent !important; text-decoration-color: ${a}; filter: none; }

/* Accent-coloured icons fill with the gradient (the shared one in the page, see accentDefs);
   "currentColor" after it is the plain colour if that gradient isn't there. */
${ICONS.map(s => `${s} [fill="currentColor"], ${s}[fill="currentColor"]`).join(",\n")} { fill: url(#${GRADIENT_ID}) currentColor; }
${ICONS.map(s => `${s} [stroke="currentColor"], ${s}[stroke="currentColor"]`).join(",\n")} { stroke: url(#${GRADIENT_ID}) currentColor; }
#vc-spotify-progress-bar > [class*="slider"]:hover [class*="barFill"] { background-image: ${grad} !important; }`;
}

/** Icons drawn in the accent colour: Spotify's on-buttons, the dock in Accent, feature card and window top-card icons. */
const ICONS = [
    "#vc-spotify-player :is(.vc-spotify-shuffle-on, .vc-spotify-repeat-context, .vc-spotify-repeat-track, .vc-spotify-lyrics-on) svg",
    ":root[data-sonata-dock-color=\"accent\"] .vc-plugin-dock-item:not(.vc-plugin-dock-glowing, .vc-plugin-dock-glow-green, .vc-plugin-dock-selected) button svg",
    ".vc-qolcc-card-icon svg",
    ".vc-sw .vc-tool-hero-icon svg",
];

const GRADIENT_ID = "vc-sonata-accent-gradient";
const DEFS_ID = "sonata-accent-defs";

/** SVG icons can't use a CSS gradient, but they can fill from an SVG one in the page: this keeps one there. */
function accentDefs(a: string, b: string | null) {
    const found = document.getElementById(DEFS_ID);
    if (!b) { found?.remove(); return; }
    let svg: Element | null = found;
    if (!svg) {
        const made = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        made.id = DEFS_ID;
        made.setAttribute("aria-hidden", "true");
        made.setAttribute("width", "0");
        made.setAttribute("height", "0");
        made.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
        document.body.appendChild(made);
        svg = made;
    }
    svg.innerHTML = `<defs><linearGradient id="${GRADIENT_ID}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
}

function apply() {
    // Never picked an accent? Sonata shows its default, so the windows do too.
    const accent = getChannelSettingsAccent() ?? DEFAULT_ACCENT;
    const store = (Settings.plugins as any)[QOL_NAME];
    const mode = store?.sonataAccentMode;
    const [a, b] = mode && mode !== "solid" ? accentColors(store) : [accent, accent];
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    const two = !!b && b.toLowerCase() !== a.toLowerCase();
    el.textContent = css(accent) + (two ? gradientCss(a, b) : "");
    accentDefs(a, two ? b : null);
}

let stopAlbum: (() => void) | null = null;

const onChange = (_: unknown, path: string) => {
    if (!path.startsWith(`plugins.${QOL_NAME}.`)) return;
    if (ACCENT_KEYS.has(path.slice(`plugins.${QOL_NAME}.`.length))) apply();
};

export function startFeatureAccent() {
    apply();
    SettingsStore.addGlobalChangeListener(onChange);
    // Album art: new colours with each new song.
    stopAlbum = onAlbumChange(() => { if ((Settings.plugins as any)[QOL_NAME]?.sonataAccentMode === "album") apply(); });
}

export function stopFeatureAccent() {
    SettingsStore.removeGlobalChangeListener(onChange);
    stopAlbum?.();
    stopAlbum = null;
    document.getElementById(STYLE_ID)?.remove();
    document.getElementById(DEFS_ID)?.remove();
}
