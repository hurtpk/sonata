/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Video Speed: play Discord's videos (and optionally GIFs and audio files)
// faster or slower — a speed pill on each video when you hover it, a default
// speed, and > / < while hovering to step through speeds. Live streams and
// camera feeds in calls are never touched.

import "./styles.css";

import definePlugin, { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];

export const settings = defineFeatureSettings("videoSpeed", {
    defaultSpeed: {
        type: OptionType.SELECT,
        description: "Speed videos start at",
        options: SPEEDS.map(v => ({ label: v === 1 ? "1× (normal)" : `${v}×`, value: v, default: v === 1 })),
    },
    rememberLast: {
        type: OptionType.BOOLEAN,
        description: "New videos start at the last speed you picked (instead of the default above)",
        default: false,
    },
    keepPitch: {
        type: OptionType.BOOLEAN,
        description: "Keep voices at their normal pitch when sped up or slowed down",
        default: true,
    },
    gifs: {
        type: OptionType.BOOLEAN,
        description: "Also change the speed of GIFs",
        default: false,
    },
    audio: {
        type: OptionType.BOOLEAN,
        description: "Also change the speed of audio files and voice messages",
        default: false,
    },
    lastSpeed: { type: OptionType.NUMBER, description: "Internal: the last speed picked.", default: 1, hidden: true },
});

const label = (v: number) => `${Number(v.toFixed(2))}×`;

/** What a new video starts at. */
const startSpeed = () => settings.store.rememberLast ? Number(settings.store.lastSpeed) || 1 : Number(settings.store.defaultSpeed) || 1;

/** GIFs on Discord are short silent looping videos. */
const isGif = (v: HTMLMediaElement) => v instanceof HTMLVideoElement && v.loop && v.muted && v.autoplay;

/** Never live streams or call cameras (those have a stream instead of a file), nor anything outside Discord's media. */
function wanted(m: HTMLMediaElement) {
    if ((m as any).srcObject) return false;
    if (m.closest(".sonata, .sonata-ambience")) return false;
    if (m instanceof HTMLAudioElement) return settings.store.audio;
    if (isGif(m)) return settings.store.gifs;
    return true;
}

const tracked = new WeakMap<HTMLMediaElement, { speed: number; pill?: HTMLButtonElement; }>();

function apply(m: HTMLMediaElement, speed: number) {
    const t = tracked.get(m);
    if (t) t.speed = speed;
    m.preservesPitch = settings.store.keepPitch;
    if (Math.abs(m.playbackRate - speed) > 0.001) m.playbackRate = speed;
    if (t?.pill) {
        t.pill.textContent = label(speed);
        t.pill.classList.toggle("vc-vspeed-pill-fast", speed !== 1);
    }
}

function setSpeed(m: HTMLMediaElement, speed: number, announce = true) {
    apply(m, speed);
    settings.store.lastSpeed = speed;
    if (announce) flash(m, label(speed));
}

function step(m: HTMLMediaElement, dir: 1 | -1) {
    const cur = tracked.get(m)?.speed ?? m.playbackRate;
    const next = Math.min(2.5, Math.max(0.25, Math.round((cur + dir * 0.25) * 4) / 4));
    setSpeed(m, next);
}

/** A brief big "1.5×" over the video. */
function flash(m: HTMLMediaElement, text: string) {
    const host = m.parentElement;
    if (!host) return;
    host.querySelector(".vc-vspeed-flash")?.remove();
    const el = document.createElement("div");
    el.className = "vc-vspeed-flash";
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 700);
}

let menu: HTMLDivElement | null = null;
const closeMenu = () => { menu?.remove(); menu = null; };

function openMenu(m: HTMLMediaElement, pill: HTMLButtonElement) {
    closeMenu();
    const current = tracked.get(m)?.speed ?? 1;
    menu = document.createElement("div");
    menu.className = "vc-vspeed-menu";
    menu.setAttribute("role", "menu");
    for (const s of SPEEDS) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `vc-vspeed-option${Math.abs(s - current) < 0.001 ? " vc-vspeed-option-on" : ""}`;
        b.textContent = s === 1 ? "1× normal" : label(s);
        b.setAttribute("role", "menuitemradio");
        b.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); setSpeed(m, s); closeMenu(); });
        menu.appendChild(b);
    }
    const r = pill.getBoundingClientRect();
    menu.style.left = `${Math.max(8, r.left)}px`;
    menu.style.top = `${r.bottom + 6}px`;
    document.body.appendChild(menu);
    // Keep it on screen.
    const mr = menu.getBoundingClientRect();
    if (mr.bottom > innerHeight - 8) menu.style.top = `${Math.max(8, r.top - mr.height - 6)}px`;
    if (mr.right > innerWidth - 8) menu.style.left = `${innerWidth - mr.width - 8}px`;
}

function addPill(m: HTMLMediaElement) {
    const host = m.parentElement;
    if (!host || m instanceof HTMLAudioElement) return undefined;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.classList.add("vc-vspeed-host");
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "vc-vspeed-pill";
    pill.title = "Playback speed (hover the video and press > or < to change)";
    pill.textContent = label(tracked.get(m)?.speed ?? 1);
    // Don't let the click reach Discord's player (which would pause or open the video).
    for (const ev of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick"]) pill.addEventListener(ev, e => e.stopPropagation());
    pill.addEventListener("click", e => {
        e.stopPropagation();
        e.preventDefault();
        if (menu) closeMenu(); else openMenu(m, pill);
    });
    host.appendChild(pill);
    return pill;
}

function attach(m: HTMLMediaElement) {
    if (tracked.has(m) || !wanted(m)) return;
    const speed = startSpeed();
    tracked.set(m, { speed });
    tracked.get(m)!.pill = addPill(m);
    apply(m, speed);
    // Discord's player can reset the speed when the video loads or restarts; put it back.
    const reapply = () => { const t = tracked.get(m); if (t) apply(m, t.speed); };
    m.addEventListener("loadedmetadata", reapply);
    m.addEventListener("play", reapply);
    m.addEventListener("ratechange", () => {
        const t = tracked.get(m);
        if (t && Math.abs(m.playbackRate - t.speed) > 0.001 && m.playbackRate === 1) reapply();
    });
}

function scan(root: ParentNode) {
    root.querySelectorAll?.("video, audio").forEach(m => attach(m as HTMLMediaElement));
}

let observer: MutationObserver | null = null;
let hovered: HTMLMediaElement | null = null;

const onOver = (e: MouseEvent) => {
    const t = e.target as Element | null;
    const host = t?.closest?.(".vc-vspeed-host");
    hovered = (host?.querySelector("video") as HTMLMediaElement | null) ?? null;
};

const onKey = (e: KeyboardEvent) => {
    if (!hovered || !tracked.has(hovered)) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    if (e.key === ">" || e.key === "<") {
        e.preventDefault();
        e.stopPropagation();
        step(hovered, e.key === ">" ? 1 : -1);
    }
};

const onDocClick = (e: MouseEvent) => {
    if (menu && !menu.contains(e.target as Node)) closeMenu();
};

export default definePlugin({
    name: "VideoSpeed",
    description: "Play videos faster or slower — from 0.25× up to 2.5× — with a speed button on each video, a default speed, and > / < while hovering a video. Optionally GIFs and audio too.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    start() {
        scan(document);
        observer = new MutationObserver(records => {
            for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) {
                if (n instanceof HTMLMediaElement) attach(n);
                else scan(n);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("mouseover", onOver, true);
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("mousedown", onDocClick, true);
    },

    stop() {
        observer?.disconnect();
        observer = null;
        document.removeEventListener("mouseover", onOver, true);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("mousedown", onDocClick, true);
        closeMenu();
        document.querySelectorAll(".vc-vspeed-pill, .vc-vspeed-flash").forEach(el => el.remove());
        document.querySelectorAll("video, audio").forEach(m => { const v = m as HTMLMediaElement; if (tracked.has(v)) v.playbackRate = 1; });
    },
});
