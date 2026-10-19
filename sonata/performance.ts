/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata's performance settings. Most are small style rules that stop
// Discord drawing expensive things (blur, animated decorations, messages
// you've scrolled past); some switch Discord's own settings (GIFs, emoji,
// reduced motion, link previews); and a few are behaviours — pausing
// animations while Discord is in the background, hiding huge member lists,
// and Gaming mode. "Speed everything up" turns on the recommended set and
// remembers what you had, so "Put it back" restores it exactly.

import { PlainSettings, Settings, SettingsStore } from "@api/Settings";
import { getUserSettingLazy } from "@api/UserSettings";
import { AccessibilityStore, FluxDispatcher, GuildMemberCountStore, SelectedGuildStore, showToast } from "@webpack/common";

import { QOL_NAME } from "../featureSettings";

const GifAutoPlay = getUserSettingLazy<boolean>("textAndImages", "gifAutoPlay")!;
const AnimateEmoji = getUserSettingLazy<boolean>("textAndImages", "animateEmoji")!;
/** 0 = always animate, 1 = when you hover, 2 = never. */
const AnimateStickers = getUserSettingLazy<number>("textAndImages", "animateStickers")!;
const RenderEmbeds = getUserSettingLazy<boolean>("textAndImages", "renderEmbeds")!;
const InlineEmbedMedia = getUserSettingLazy<boolean>("textAndImages", "inlineEmbedMedia")!;

export type Impact = "big" | "medium" | "small";

export interface PerfOption {
    key: string;
    title: string;
    detail: string;
    impact: Impact;
    /** Part of "Speed everything up". */
    recommended: boolean;
    css?: string;
}

/** Sonata's own on/off options (stored in Sonata's settings). */
export const OPTIONS: PerfOption[] = [
    {
        key: "perfLazyChat",
        title: "Only draw messages you can see",
        detail: "Discord keeps hundreds of messages laid out even when they're far off screen. This skips drawing them until you scroll near — long, busy channels scroll and switch much faster. Experimental: if scrolling up through old messages jumps around, turn it off.",
        impact: "big",
        recommended: false,
        css: "li[id^=\"chat-messages-\"] { content-visibility: auto; contain-intrinsic-size: auto 72px; }",
    },
    {
        key: "perfNoBlur",
        title: "Turn off blur effects",
        detail: "Frosted-glass blur is one of the most expensive things to draw — it's redrawn every time anything behind it moves. Themes and Sonata's glass panels use it a lot.",
        impact: "big",
        recommended: true,
        css: "*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }",
    },
    {
        key: "perfNoProfileEffects",
        title: "Hide profile effects",
        detail: "The animated effects that play over people's profiles (snow, sparkles, flames…).",
        impact: "medium",
        recommended: true,
        css: "[class*=\"profileEffects_\"] { display: none !important; }",
    },
    {
        key: "perfNoDecorations",
        title: "Hide avatar decorations",
        detail: "The animated frames around avatars in chat, the member list and profiles.",
        impact: "medium",
        recommended: false,
        css: "[class*=\"avatarDecoration_\"], [class*=\"avatarDecorationContainer_\"] img { display: none !important; }",
    },
    {
        key: "perfNoNameplates",
        title: "Hide animated nameplates",
        detail: "The moving backgrounds behind some people's names in the member list and DMs.",
        impact: "small",
        recommended: false,
        css: "[class*=\"nameplated_\"] video { display: none !important; }",
    },
    {
        key: "perfNoShadows",
        title: "Flatter look",
        detail: "Removes soft shadows around popups and cards. A small saving on slower graphics.",
        impact: "small",
        recommended: false,
        css: "[class*=\"popout_\"], [class*=\"menu_\"], [class*=\"tooltip_\"], [class*=\"card_\"] { box-shadow: none !important; }",
    },
];

/** Rules for the behaviours below (switched on with a class on the page). */
const PAUSED_CSS = "html.sonata-perf-paused *, html.sonata-perf-paused *::before, html.sonata-perf-paused *::after { animation-play-state: paused !important; }";
const BIG_GUILD_CSS = "html.sonata-perf-big-guild [class*=\"membersWrap_\"] { display: none !important; }";

/** Discord's own settings, switched from here (they're the same switches as in Discord's settings). */
export const DISCORD_OPTIONS = [
    { key: "motion", title: "Reduced motion everywhere", detail: "Discord's own Reduced Motion: calmer transitions and fewer moving parts in all of Discord.", impact: "big" as Impact, recommended: true },
    { key: "gif", title: "Play GIFs only when you hover them", detail: "GIFs in chat stay still until you point at them. A big saving in meme-heavy channels.", impact: "big" as Impact, recommended: true },
    { key: "emoji", title: "Animate emoji only when you hover them", detail: "Animated emoji stay still in messages until you point at them.", impact: "medium" as Impact, recommended: true },
    { key: "stickers", title: "Animate stickers only when you hover them", detail: "Stickers stay still until you point at them.", impact: "small" as Impact, recommended: true },
    { key: "embeds", title: "No link previews", detail: "Links stay as plain links instead of loading a preview card. Less to download and draw — but you won't see previews.", impact: "medium" as Impact, recommended: false },
    { key: "embedMedia", title: "Linked images and videos as links", detail: "Pictures and videos linked from other sites aren't loaded into chat until you open them. Files people upload still show.", impact: "medium" as Impact, recommended: false },
];

const store = () => (PlainSettings.plugins?.[QOL_NAME] ?? {}) as Record<string, any>;
const live = () => Settings.plugins[QOL_NAME] as Record<string, any>;

// ─── Discord's switches ───

export function discordState(key: string): boolean {
    try {
        switch (key) {
            case "motion": return AccessibilityStore.useReducedMotion;
            case "gif": return GifAutoPlay.getSetting() === false;
            case "emoji": return AnimateEmoji.getSetting() === false;
            case "stickers": return AnimateStickers.getSetting() !== 0;
            case "embeds": return RenderEmbeds.getSetting() === false;
            case "embedMedia": return InlineEmbedMedia.getSetting() === false;
        }
    } catch { }
    return false;
}

export function setDiscord(key: string, saving: boolean) {
    switch (key) {
        case "motion": FluxDispatcher.dispatch({ type: "ACCESSIBILITY_SET_PREFERS_REDUCED_MOTION", prefersReducedMotion: saving ? "reduce" : "auto" } as any); break;
        case "gif": void GifAutoPlay.updateSetting(!saving); break;
        case "emoji": void AnimateEmoji.updateSetting(!saving); break;
        case "stickers": void AnimateStickers.updateSetting(saving ? 1 : 0); break;
        case "embeds": void RenderEmbeds.updateSetting(!saving); break;
        case "embedMedia": void InlineEmbedMedia.updateSetting(!saving); break;
    }
}

// ─── The preset & Gaming mode ───

const BACKUP = "perfBackup";
/** Everything the preset can change, so "Put it back" can restore it. */
const SAVED_KEYS = () => [...OPTIONS.map(o => o.key), "perfPause", "perfBigServer"];

export const hasBackup = () => !!store()[BACKUP];

function saveBackup() {
    const s = live();
    if (s[BACKUP]) return;
    s[BACKUP] = JSON.stringify({
        sonata: Object.fromEntries(SAVED_KEYS().map(k => [k, store()[k]])),
        discord: Object.fromEntries(DISCORD_OPTIONS.map(o => [o.key, discordState(o.key)])),
    });
}

export function speedUp() {
    saveBackup();
    const s = live();
    for (const o of OPTIONS) if (o.recommended) s[o.key] = true;
    for (const o of DISCORD_OPTIONS) if (o.recommended && !discordState(o.key)) setDiscord(o.key, true);
    if ((s.perfPause ?? "off") === "off") s.perfPause = "hidden";
}

export function putBack() {
    const s = live();
    const raw = s[BACKUP];
    if (!raw) return;
    try {
        const saved = JSON.parse(raw);
        for (const [k, v] of Object.entries(saved.sonata ?? {})) {
            if (v === undefined) delete s[k]; else s[k] = v;
        }
        for (const [k, v] of Object.entries(saved.discord ?? {})) if (discordState(k) !== !!v) setDiscord(k, !!v);
    } catch { }
    s[BACKUP] = "";
    s.perfGaming = false;
}

/** Gaming mode: everything recommended, plus animations pausing whenever another window (your game) is in front. */
export function setGaming(on: boolean) {
    const s = live();
    if (on) {
        speedUp();
        s.perfPause = "unfocused";
        s.perfGaming = true;
        showToast("Gaming mode on ⚡ — Discord pauses its animations while your game is in front", "success");
    } else {
        putBack();
        showToast("Gaming mode off — your settings are back", "message");
    }
}

export const isOn = (key: string) => !!store()[key];

// ─── Gaming mode hotkey ───

export const DEFAULT_HOTKEY = "ctrl+shift+g";

export function keyName(e: KeyboardEvent) {
    const parts = [e.ctrlKey && "ctrl", e.altKey && "alt", e.shiftKey && "shift", e.metaKey && "meta"].filter(Boolean) as string[];
    const k = e.key.toLowerCase();
    if (!["control", "alt", "shift", "meta"].includes(k)) parts.push(k === " " ? "space" : k);
    return parts.join("+");
}

export const prettyKey = (k: string) => k.split("+").map(p => p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)).join(" + ");

const onKey = (e: KeyboardEvent) => {
    const want = (store().perfGamingKey as string) || DEFAULT_HOTKEY;
    if (!want || keyName(e) !== want) return;
    e.preventDefault();
    setGaming(!store().perfGaming);
};

// ─── Pausing in the background ───

function updatePaused() {
    const mode = store().perfPause ?? "off";
    const paused = mode === "hidden" ? document.hidden : mode === "unfocused" ? (document.hidden || !document.hasFocus()) : false;
    document.documentElement.classList.toggle("sonata-perf-paused", paused);
}

// ─── Big servers ───

function updateBigGuild() {
    const limit = Number(store().perfBigServer) || 0;
    let big = false;
    if (limit) {
        try {
            const id = SelectedGuildStore.getGuildId();
            big = !!id && (GuildMemberCountStore.getMemberCount(id) ?? 0) >= limit;
        } catch { }
    }
    document.documentElement.classList.toggle("sonata-perf-big-guild", big);
}

// ─── Applying ───

const STYLE_ID = "sonata-perf-style";

function apply() {
    const css = [PAUSED_CSS, BIG_GUILD_CSS, ...OPTIONS.filter(o => o.css && isOn(o.key)).map(o => o.css)].join("\n");
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
    updatePaused();
    updateBigGuild();
}

const paths = () => [...OPTIONS.map(o => o.key), "perfPause", "perfBigServer"].map(k => `plugins.${QOL_NAME}.${k}`);

export function startPerformance() {
    apply();
    for (const p of paths()) SettingsStore.addChangeListener(p, apply);
    document.addEventListener("visibilitychange", updatePaused);
    window.addEventListener("blur", updatePaused);
    window.addEventListener("focus", updatePaused);
    document.addEventListener("keydown", onKey);
    SelectedGuildStore.addChangeListener(updateBigGuild);
    GuildMemberCountStore.addChangeListener(updateBigGuild);
}

export function stopPerformance() {
    for (const p of paths()) SettingsStore.removeChangeListener(p, apply);
    document.removeEventListener("visibilitychange", updatePaused);
    window.removeEventListener("blur", updatePaused);
    window.removeEventListener("focus", updatePaused);
    document.removeEventListener("keydown", onKey);
    SelectedGuildStore.removeChangeListener(updateBigGuild);
    GuildMemberCountStore.removeChangeListener(updateBigGuild);
    document.documentElement.classList.remove("sonata-perf-paused", "sonata-perf-big-guild");
    document.getElementById(STYLE_ID)?.remove();
}

// ─── Starting Sonata features later ───

/** Features that can wait until Discord has loaded: no code changes to Discord, and nothing that must catch the first connection. */
export function canStartLater(f: any) {
    return !f.patches?.length && !f.flux?.CONNECTION_OPEN && !f.flux?.POST_CONNECTION_OPEN;
}

export const startLaterOn = () => !!store().perfDeferStart;

let laterTimer: number | null = null;
let laterIdle: number | null = null;

/** Starts the given features a few at a time once Discord is idle. */
export function startLater(keys: string[], start: (key: string) => void) {
    const queue = [...keys];
    const step = (deadline?: IdleDeadline) => {
        laterIdle = null;
        do {
            const key = queue.shift();
            if (!key) return;
            start(key);
        } while (queue.length && (deadline?.timeRemaining() ?? 0) > 8);
        if (queue.length) laterIdle = requestIdleCallback(step, { timeout: 1500 });
    };
    laterTimer = window.setTimeout(() => { laterTimer = null; laterIdle = requestIdleCallback(step, { timeout: 2000 }); }, 2500);
}

export function cancelStartLater() {
    if (laterTimer != null) clearTimeout(laterTimer);
    if (laterIdle != null) cancelIdleCallback(laterIdle);
    laterTimer = laterIdle = null;
}
