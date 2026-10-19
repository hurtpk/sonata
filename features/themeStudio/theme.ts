/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Theme Studio's themes: a few colours you pick, turned into the colour
// variables Discord itself uses (so every part of Discord follows them), plus
// roundness, a font, how see-through the backgrounds are, a picture or moving
// colours behind Discord, and hover animations.

export type ListFx = "none" | "slide" | "bar" | "tint" | "grow";

export interface Effects {
    chatBar: "none" | "glow" | "lift" | "pulse";
    channels: ListFx;
    dms: ListFx;
    messages: "none" | "tint" | "bar";
    servers: "none" | "grow" | "bounce" | "wiggle";
    /** Buttons squish a little when pressed. */
    buttons: boolean;
    speed: "snappy" | "normal" | "relaxed";
}

export interface Theme {
    id: string;
    name: string;
    /** The main background (the chat area). Everything else is shaded from it. */
    bg: string;
    /** A different colour just for the chat area, or null for the same as bg. */
    chat: string | null;
    text: string;
    muted: string;
    accent: string;
    /** Corner roundness: 0 = square, 1 = Discord's own, 2.5 = extra round. */
    radius: number;
    font: string;
    /** How solid Discord's backgrounds are, 0–100. Lower shows the picture, the moving colours, or — with the see-through window on — the apps behind Discord. */
    opacity: number;
    /** Popouts, menus, cards and the chat bar go see-through too (not just the big areas). */
    seeAll: boolean;
    /** A picture behind Discord (a data: URL), or null. */
    image: string | null;
    /** Picture blur in px, 0–30. */
    blur: number;
    /** How much the picture is darkened, 0–80. */
    dim: number;
    /** Slowly moving colours behind Discord. */
    moving: boolean;
    scrollbars: "discord" | "accent";
    /** @mentions in the accent colour. */
    mentions: boolean;
    fx: Effects;
    at: number;
    /** Old: how much of the picture showed through. Now `opacity`. */
    see?: number;
}

export interface Font { id: string; label: string; stack: string | null; }

export const FONTS: Font[] = [
    { id: "discord", label: "Discord's own", stack: null },
    { id: "system", label: "Windows (Segoe UI)", stack: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif' },
    { id: "rounded", label: "Rounded", stack: '"Segoe UI Variable Display", "Nunito", "Varela Round", system-ui, sans-serif' },
    { id: "serif", label: "Serif", stack: 'Georgia, "Times New Roman", serif' },
    { id: "mono", label: "Typewriter", stack: '"Cascadia Code", Consolas, "Courier New", monospace' },
    { id: "comic", label: "Comic", stack: '"Comic Sans MS", "Comic Neue", cursive' },
];

export const DEFAULT_FX: Effects = { chatBar: "glow", channels: "slide", dms: "slide", messages: "none", servers: "grow", buttons: true, speed: "normal" };
export const NO_FX: Effects = { chatBar: "none", channels: "none", dms: "none", messages: "none", servers: "none", buttons: false, speed: "normal" };

interface Preset { name: string; bg: string; text: string; muted: string; accent: string; radius?: number; font?: string; chat?: string; fx?: Partial<Effects>; moving?: boolean; opacity?: number; }

export const PRESETS: Preset[] = [
    { name: "Midnight", bg: "#101218", text: "#e7e9ee", muted: "#8b90a0", accent: "#6e8bff" },
    { name: "Ocean", bg: "#0f1d2b", text: "#e3eef7", muted: "#87a2b8", accent: "#2fb5d6", fx: { channels: "bar", dms: "bar" } },
    { name: "Forest", bg: "#13201a", text: "#e4efe7", muted: "#8aa596", accent: "#4fbf7f", fx: { servers: "bounce" } },
    { name: "Rose", bg: "#24161c", text: "#f5e6ec", muted: "#b1909e", accent: "#ff6fa3", radius: 1.6, fx: { chatBar: "pulse", channels: "tint", dms: "tint" } },
    { name: "Mocha", bg: "#1f1a17", text: "#efe6de", muted: "#a8998c", accent: "#d7995b", fx: { messages: "bar" } },
    { name: "Grape", bg: "#1b1528", text: "#ece6f7", muted: "#9c91b3", accent: "#a77bff", fx: { servers: "wiggle", chatBar: "lift" } },
    { name: "Ember", bg: "#1c1412", text: "#f4e7e1", muted: "#ad958b", accent: "#ff7a45", radius: 1.4 },
    { name: "Aurora", bg: "#0c1120", text: "#e6ecfa", muted: "#8d97b3", accent: "#5eead4", moving: true, opacity: 60, fx: { chatBar: "pulse", channels: "grow", dms: "grow" } },
    { name: "Paper", bg: "#f6f4ef", text: "#23211d", muted: "#6f6a62", accent: "#3d6bff", fx: { chatBar: "lift" } },
];

export const newId = () => Math.random().toString(36).slice(2, 10);

export function fromPreset(p: Preset): Theme {
    return normalize({
        id: newId(), name: p.name, bg: p.bg, chat: p.chat ?? null, text: p.text, muted: p.muted, accent: p.accent, radius: p.radius ?? 1, font: p.font ?? "discord",
        opacity: p.opacity ?? 100, seeAll: false, image: null, blur: 0, dim: 35, moving: !!p.moving, scrollbars: "accent", mentions: true, fx: { ...DEFAULT_FX, ...p.fx }, at: Date.now(),
    });
}

/** Fills in anything a theme saved by an older Sonata doesn't have yet. */
export function normalize(t: Partial<Theme> & Pick<Theme, "id" | "name" | "bg" | "text" | "muted" | "accent">): Theme {
    const clamp = (n: unknown, lo: number, hi: number, d: number) => typeof n === "number" && isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
    return {
        id: t.id, name: t.name, bg: t.bg, chat: t.chat ?? null, text: t.text, muted: t.muted, accent: t.accent,
        radius: clamp(t.radius, 0, 2.5, 1),
        font: t.font ?? "discord",
        opacity: clamp(t.opacity, 0, 100, t.image && typeof t.see === "number" ? 100 - t.see : 100),
        seeAll: !!t.seeAll,
        image: t.image ?? null,
        blur: clamp(t.blur, 0, 30, 0),
        dim: clamp(t.dim, 0, 80, 35),
        moving: !!t.moving,
        scrollbars: t.scrollbars === "discord" ? "discord" : "accent",
        mentions: t.mentions !== false,
        fx: { ...DEFAULT_FX, ...t.fx },
        at: t.at ?? Date.now(),
    };
}

/** 0 (black) – 1 (white). */
export function lightness(hex: string) {
    const h = hex.replace("#", "");
    const n = h.length === 3 ? [...h].map(c => c + c).join("") : h;
    const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const mix = (c: string, toward: string, pct: number) => pct <= 0 ? c : `color-mix(in oklab, ${c} ${100 - pct}%, ${toward})`;
const alpha = (c: string, pct: number) => pct >= 100 ? c : `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/** The backgrounds that become see-through (the big areas — popouts and menus stay solid so they're easy to read). */
const SEE_THROUGH = ["--background-base-lowest", "--background-base-lower", "--background-base-low", "--chat-background", "--panel-bg", "--app-frame-background", "--background-secondary-alt",
    "--background-gradient-chat", "--background-gradient-lowest", "--background-gradient-lower", "--background-gradient-low"];
/** …and with "everything" on. These never go below 35% solid, so menus stay readable. */
const SEE_THROUGH_ALL = ["--background-surface-high", "--background-surface-higher", "--background-surface-highest", "--bg-surface-raised", "--chat-background-default", "--modal-background", "--modal-footer-background", "--card-background-default", "--channeltextarea-background",
    "--background-gradient-high", "--background-gradient-higher", "--background-gradient-highest"];

/** Discord's colour variables for a theme. */
export function themeVars(t: Theme): Record<string, string> {
    const light = lightness(t.bg) > 0.55;
    // Dark themes: the frame is darker, raised things are lighter. Light themes: raised things go white.
    const down = (p: number) => mix(t.bg, "black", light ? p * 0.45 : p);
    const up = (p: number) => mix(t.bg, "white", light ? p * 6 : p);
    const chat = t.chat || t.bg;
    const strong = mix(t.text, light ? "black" : "white", 45);
    const font = FONTS.find(f => f.id === t.font)?.stack;

    const v: Record<string, string> = {
        "--background-base-lowest": down(28),
        "--background-base-lower": chat,
        "--background-base-low": up(4),
        "--background-surface-high": up(7),
        "--background-surface-higher": up(10),
        "--background-surface-highest": up(13),
        "--background-secondary-alt": up(4),
        "--bg-surface-raised": up(7),
        "--chat-background": chat,
        "--chat-background-default": up(7),
        "--app-frame-background": down(28),
        "--panel-bg": chat,
        "--modal-background": up(7),
        "--modal-footer-background": up(5),
        "--card-background-default": up(7),
        "--channeltextarea-background": up(6),
        // Nitro app themes paint through these (Discord falls back to the ones above when they're unset);
        // set them too, so Theme Studio wins over a Nitro theme and see-through works with one on.
        "--background-gradient-chat": chat,
        "--background-gradient-lowest": down(28),
        "--background-gradient-lower": chat,
        "--background-gradient-low": up(4),
        "--background-gradient-high": up(7),
        "--background-gradient-higher": up(10),
        "--background-gradient-highest": up(13),

        "--text-default": t.text,
        "--text-normal": t.text,
        "--text-strong": strong,
        "--header-primary": strong,
        "--text-muted": t.muted,
        "--header-secondary": t.muted,
        "--chat-text-muted": t.muted,
        "--channels-default": t.muted,
        "--input-text-default": t.text,
        "--input-placeholder-text-default": t.muted,
        "--interactive-text-default": mix(t.text, t.muted, 45),
        "--interactive-normal": mix(t.text, t.muted, 45),
        "--interactive-icon-default": t.muted,
        "--interactive-text-hover": strong,
        "--interactive-text-active": strong,
        "--interactive-icon-hover": strong,
        "--interactive-icon-active": strong,
        "--interactive-hover": strong,
        "--interactive-active": strong,

        "--brand-500": t.accent,
        "--brand-530": mix(t.accent, "black", 6),
        "--brand-560": mix(t.accent, "black", 12),
        "--brand-600": mix(t.accent, "black", 20),
        "--brand-460": mix(t.accent, "white", 8),
        "--brand-360": mix(t.accent, "white", 24),
        "--background-brand": t.accent,
        "--text-link": mix(t.accent, light ? "black" : "white", 22),
        "--interactive-accent-background-hover": t.accent,
        "--interactive-accent-background-selected": t.accent,
        "--interactive-accent-background-active": mix(t.accent, "black", 12),
        "--input-border-active": t.accent,
        "--border-focus": t.accent,
        "--control-brand-foreground": mix(t.accent, "white", 24),
    };

    if (t.radius !== 1) for (const [k, px] of [["xs", 4], ["sm", 8], ["md", 12], ["lg", 16], ["xl", 24]] as const) v[`--radius-${k}`] = `${Math.round(px * t.radius)}px`;
    if (font) { v["--font-primary"] = font; v["--font-headline"] = font; v["--font-display"] = font; }
    if (t.scrollbars === "accent") {
        v["--scrollbar-thin-thumb"] = alpha(t.accent, 55);
        v["--scrollbar-auto-thumb"] = alpha(t.accent, 55);
        v["--scrollbar-auto-scrollbar-color-thumb"] = alpha(t.accent, 55);
    }
    if (t.mentions) {
        v["--mention-foreground"] = mix(t.accent, light ? "black" : "white", 35);
        v["--mention-background"] = alpha(t.accent, 24);
    }
    if (t.opacity < 100) {
        for (const k of SEE_THROUGH) v[k] = alpha(v[k], t.opacity);
        if (t.seeAll) for (const k of SEE_THROUGH_ALL) v[k] = alpha(v[k], Math.max(35, t.opacity));
    }
    return v;
}

const ROOTS = ":root, .theme-dark, .theme-light, .theme-darker, .theme-midnight, .visual-refresh";

// What the hover animations point at. Discord's list items are labelled "<list>___<item>",
// which doesn't change between Discord updates the way class names do. Each is a plain,
// single-element match (never inside :has()), so it costs nothing while you're not hovering.
const CHAT_BAR = '[class*="channelTextArea_"]';
const CHANNEL = '[data-list-item-id^="channels___"]';
const DM = '[data-list-item-id^="private-channels-"]';
const MESSAGE = 'li[id^="chat-messages-"]';
const SERVER = '[data-list-item-id^="guildsnav___"]';

const SPEED = { snappy: 110, normal: 180, relaxed: 320 };

function listFx(sel: string, kind: ListFx, a: string, ms: number) {
    if (kind === "none") return "";
    const move = `${sel} { transition: translate ${ms}ms ease, scale ${ms}ms ease, background-color ${ms}ms ease, box-shadow ${ms}ms ease; }\n`;
    switch (kind) {
        case "slide": return `${move}${sel}:hover { translate: 4px 0; }\n`;
        case "grow": return `${move}${sel}:hover { scale: 1.03; }\n`;
        case "bar": return `${move}${sel}:hover { box-shadow: inset 3px 0 0 ${a}; }\n`;
        case "tint": return `${move}${sel}:hover { background-color: ${alpha(a, 18)} !important; }\n`;
    }
}

/** The hover animations, as CSS. Only what's switched on is included. */
export function effectsCss(t: Theme) {
    const f = t.fx, a = t.accent, ms = SPEED[f.speed] ?? 180;
    let css = "";
    const border = `inset 0 0 0 1px ${alpha(a, 70)}`;
    const inner = `inset 0 0 26px -10px ${a}`;
    if (f.chatBar !== "none") {
        css += `${CHAT_BAR} { transition: box-shadow ${ms}ms ease, translate ${ms}ms ease; }\n`;
        if (f.chatBar === "glow") css += `${CHAT_BAR}:hover, ${CHAT_BAR}:focus-within { box-shadow: ${border}, ${inner}; }\n`;
        if (f.chatBar === "lift") css += `${CHAT_BAR}:hover, ${CHAT_BAR}:focus-within { box-shadow: ${border}; translate: 0 -2px; }\n`;
        if (f.chatBar === "pulse") css += `${CHAT_BAR}:hover { box-shadow: ${border}; }\n${CHAT_BAR}:focus-within { animation: vc-ts-pulse 2.4s ease-in-out infinite; }\n`
            + `@keyframes vc-ts-pulse { 0%, 100% { box-shadow: ${border}, inset 0 0 14px -10px ${a}; } 50% { box-shadow: inset 0 0 0 1px ${a}, inset 0 0 30px -8px ${a}; } }\n`;
    }
    css += listFx(CHANNEL, f.channels, a, ms);
    css += listFx(DM, f.dms, a, ms);
    if (f.messages !== "none") {
        css += `${MESSAGE} { transition: background-color ${ms}ms ease, box-shadow ${ms}ms ease; }\n`;
        css += f.messages === "tint" ? `${MESSAGE}:hover { background-color: ${alpha(a, 7)}; }\n` : `${MESSAGE}:hover { box-shadow: inset 2px 0 0 ${a}; }\n`;
    }
    if (f.servers === "grow") css += `${SERVER} { transition: scale ${ms}ms ease; }\n${SERVER}:hover { scale: 1.1; }\n`;
    if (f.servers === "bounce") css += `${SERVER}:hover { animation: vc-ts-bounce ${Math.round(ms * 2.8)}ms ease; }\n@keyframes vc-ts-bounce { 0%, 100% { translate: 0 0; } 40% { translate: 0 -5px; } 70% { translate: 0 1px; } }\n`;
    if (f.servers === "wiggle") css += `${SERVER}:hover { animation: vc-ts-wiggle ${Math.round(ms * 2.6)}ms ease; }\n@keyframes vc-ts-wiggle { 0%, 100% { rotate: 0deg; } 25% { rotate: -9deg; } 60% { rotate: 7deg; } }\n`;
    // The separate "scale" property, so Discord's own transforms on buttons are left alone.
    if (f.buttons) css += `button:active:not(:disabled) { scale: 0.96; }\n`;
    return css ? `@media (prefers-reduced-motion: no-preference) {\n${css}}\n` : "";
}

/** The picture and moving colours behind Discord. */
function backdropCss(t: Theme) {
    let css = "";
    if (t.opacity < 100) css += "html, body { background: transparent !important; }\n";
    if (!t.image && !t.moving) return css + (t.opacity < 100 ? "#app-mount { background: transparent !important; }\n" : "");
    css += "#app-mount { background: transparent !important; isolation: isolate; }\n";
    if (t.image) {
        const d = t.dim / 100;
        // A blurred picture is drawn a little bigger, so its blurry edges stay off screen.
        css += `#app-mount::before { content: ""; position: fixed; inset: ${t.blur ? `-${t.blur * 2}px` : "0"}; z-index: -1; pointer-events: none;\n`
            + `    background: linear-gradient(hsl(0 0% 0% / ${d}), hsl(0 0% 0% / ${d})), url("${t.image}") center / cover no-repeat;${t.blur ? ` filter: blur(${t.blur}px);` : ""} }\n`;
    }
    if (t.moving) {
        const a = t.accent;
        const b = mix(a, "#ff3df0", 55), c = mix(a, "#3d7bff", 55);
        // A big soft layer that drifts (only moved, never repainted, so it's cheap).
        css += `#app-mount::after { content: ""; position: fixed; inset: -30%; z-index: -1; pointer-events: none; opacity: ${t.image ? 0.6 : 1};\n`
            + `    background: radial-gradient(40% 44% at 28% 32%, ${alpha(a, 90)}, transparent 72%), radial-gradient(36% 42% at 72% 58%, ${alpha(b, 80)}, transparent 72%), radial-gradient(32% 38% at 46% 82%, ${alpha(c, 75)}, transparent 72%)${t.image ? "" : `, ${t.bg}`};\n`
            + "    animation: vc-ts-drift 38s ease-in-out infinite alternate; will-change: transform; }\n"
            + "@keyframes vc-ts-drift { 0% { transform: translate3d(-7%, -5%, 0) rotate(0deg); } 50% { transform: translate3d(5%, 4%, 0) rotate(14deg); } 100% { transform: translate3d(-3%, 7%, 0) rotate(-10deg); } }\n"
            + "@media (prefers-reduced-motion: reduce) { #app-mount::after { animation: none; } }\n";
    }
    return css;
}

/** The CSS that puts a theme on Discord. */
export function themeCss(t: Theme) {
    const vars = Object.entries(themeVars(t)).map(([k, v]) => `    ${k}: ${v} !important;`).join("\n");
    return `${ROOTS} {\n${vars}\n}\n${backdropCss(t)}${effectsCss(t)}`;
}

/** A theme file Equicord (and Vencord/BetterDiscord) can load. */
export function themeFile(t: Theme) {
    const safe = t.name.replace(/\*\//g, "");
    return `/**\n * @name ${safe}\n * @description Made with Sonata's Theme Studio\n * @author Sonata\n * @version 1.0.0\n */\n\n${themeCss(t)}`;
}

export function fileName(t: Theme) {
    return `${t.name.trim().replace(/[^\w -]+/g, "").replace(/\s+/g, "-") || "theme"}.theme.css`;
}
