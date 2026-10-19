/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Your themes and which one is on. Kept on this computer (DataStore — the
// pictures can be big, and Discord clears localStorage). The theme that's on
// is one <style> tag; changing a theme updates it straight away.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

import { normalize, Theme, themeCss } from "./theme";

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

/** Puts the theme that's on onto Discord (or takes it off). */
function paint() {
    const t = running ? activeTheme() : null;
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!t) { el?.remove(); return; }
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
    }
    // Last in <head>, so it wins over Discord's own colours and other themes.
    if (el !== document.head.lastElementChild) document.head.appendChild(el);
    const css = themeCss(t);
    if (el.textContent !== css) el.textContent = css;
}

export function startThemes() {
    running = true;
    void loadThemes().then(paint);
    paint();
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
