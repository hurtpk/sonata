/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Your themes and which one is on. Kept on this computer (DataStore — the
// pictures can be big, and Discord clears localStorage). The theme that's on
// is one <style> tag; changing a theme updates it straight away.

import * as DataStore from "@api/DataStore";
import { findCssClasses } from "@webpack";
import { useEffect, useState } from "@webpack/common";

import { FoundClasses, normalize, Theme, themeCss } from "./theme";

interface State { themes: Theme[]; active: string | null; }

const KEY = "Sonata_themeStudio";
const STYLE_ID = "sonata-theme-studio";
let state: State = { themes: [], active: null };
let loaded: Promise<void> | null = null;
let running = false;
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

let pending = false;
function emit() {
    // At most once a frame, so dragging a colour picker stays smooth — with a timer
    // as well, since frames don't come while Discord's window isn't being drawn.
    if (!pending) {
        pending = true;
        const run = () => { if (!pending) return; pending = false; paint(); };
        requestAnimationFrame(run);
        setTimeout(run, 120);
    }
    listeners.forEach(l => l());
}

function save() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void DataStore.set(KEY, state), 400);
}

export const loadThemes = () => loaded ??= DataStore.get<State>(KEY).then(v => {
    if (v?.themes) state = { themes: v.themes.map(normalize), active: v.active ?? null };
    emit();
}).catch(() => { });

export const themes = () => state.themes;
export const activeId = () => state.active;
export const activeTheme = () => state.themes.find(t => t.id === state.active) ?? null;
export const themeById = (id: string | null) => state.themes.find(t => t.id === id) ?? null;

export function putTheme(t: Theme) {
    const has = state.themes.some(x => x.id === t.id);
    const next = normalize({ ...t, at: Date.now() });
    state = { ...state, themes: has ? state.themes.map(x => x.id === t.id ? next : x) : [next, ...state.themes] };
    emit(); save();
}

export function removeTheme(id: string) {
    state = { themes: state.themes.filter(t => t.id !== id), active: state.active === id ? null : state.active };
    emit(); save();
}

export function setActive(id: string | null) {
    state = { ...state, active: id };
    emit(); save();
}

/* ── Discord's own class names for the badges and brand buttons, looked up once they've loaded ── */

let found: FoundClasses | null = null;
let lookups = 0;
function foundClasses(): FoundClasses {
    if (found) return found;
    const out: FoundClasses = {};
    const first = (c?: string) => c?.split(" ")[0];
    try { const b = findCssClasses("numberBadge", "baseShapeRound"); if (first(b?.numberBadge)) out.badge = `.${first(b.numberBadge)}`; } catch { }
    try { const b = findCssClasses("lookFilled", "colorBrand"); if (first(b?.lookFilled) && first(b?.colorBrand)) out.brandButton = `.${first(b.lookFilled)}.${first(b.colorBrand)}`; } catch { }
    // Discord loads these a little after start — look a few more times, then settle for what was found.
    if ((out.badge && out.brandButton) || ++lookups >= 4) found = out;
    return out;
}

/* ── A video behind Discord ── */

const VIDEO_ID = "sonata-theme-video";
let videoFor: string | null = null;
let videoUrl: string | null = null;

function dataToBlobUrl(data: string) {
    const comma = data.indexOf(",");
    const type = data.slice(5, data.indexOf(";")) || "video/mp4";
    const bin = atob(data.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type }));
}

/** The blob link for a theme's video (made once, reused by the preview). */
export function videoSrc(data: string) {
    if (videoFor !== data) {
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        videoUrl = dataToBlobUrl(data);
        videoFor = data;
    }
    return videoUrl!;
}

const onVisibility = () => {
    const v = document.getElementById(VIDEO_ID) as HTMLVideoElement | null;
    if (!v) return;
    if (document.hidden) v.pause(); else void v.play().catch(() => { });
};

function paintVideo(t: Theme | null) {
    let v = document.getElementById(VIDEO_ID) as HTMLVideoElement | null;
    if (!t?.video) {
        if (v) { v.remove(); document.removeEventListener("visibilitychange", onVisibility); }
        return;
    }
    if (!v) {
        v = document.createElement("video");
        v.id = VIDEO_ID;
        v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
        v.setAttribute("aria-hidden", "true");
        // Behind everything, never in the way of the mouse.
        v.style.cssText = "position:fixed;z-index:-1;object-fit:cover;pointer-events:none;";
        document.body.prepend(v);
        document.addEventListener("visibilitychange", onVisibility);
    }
    const inset = t.blur ? -t.blur * 2 : 0;
    v.style.inset = `${inset}px`;
    v.style.width = `calc(100% + ${-inset * 2}px)`;
    v.style.height = `calc(100% + ${-inset * 2}px)`;
    v.style.filter = t.blur ? `blur(${t.blur}px)` : "";
    const src = videoSrc(t.video);
    if (v.src !== src) { v.src = src; void v.play().catch(() => { }); }
}

/** Puts the theme that's on onto Discord (or takes it off). */
function paint() {
    const t = running ? activeTheme() : null;
    paintVideo(t);
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!t) { el?.remove(); return; }
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
    }
    // Last in <head>, so it wins over Discord's own colours and other themes.
    if (el !== document.head.lastElementChild) document.head.appendChild(el);
    const css = themeCss(t, foundClasses());
    if (el.textContent !== css) el.textContent = css;
}

export function startThemes() {
    running = true;
    void loadThemes().then(paint);
    paint();
    // Badges and buttons are found once Discord has loaded them.
    for (const ms of [4000, 15000, 45000]) setTimeout(() => { if (running && !found) paint(); }, ms);
}

export function stopThemes() {
    running = false;
    paint();
}

export function useThemes() {
    const [, bump] = useState(0);
    useEffect(() => { void loadThemes(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return state;
}
