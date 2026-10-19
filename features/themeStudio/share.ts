/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sharing themes. A share code is short enough for a chat message:
// "sonata-theme:" + the theme's settings, packed and squeezed. Pictures and
// videos are too big for a message, so those go in a .sonatatheme file instead.
// Anything read back in is checked field by field before it's used.

import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

import { DEFAULT_FX, Effects, newId, normalize, Theme } from "./theme";

export const CODE_PREFIX = "sonata-theme:";
export const CODE_RE = /sonata-theme:[A-Za-z0-9_-]{20,6000}/;
const FILE_KIND = "sonata-theme";

const HEX = /^#[0-9a-f]{6}$/i;
// Only plain base64 pictures/videos: anything else could carry CSS that restyles Discord or loads things from the internet.
const IMAGE_DATA = /^data:image\/[a-z0-9.+-]{1,20};base64,[A-Za-z0-9+/]+=*$/;
const VIDEO_DATA = /^data:video\/[a-z0-9.+-]{1,20};base64,[A-Za-z0-9+/]+=*$/;
const toB64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));

/** The parts of a theme that are shared (never its id, and no picture or video in a code). */
function shareable(t: Theme, withMedia: boolean) {
    const { id: _id, at: _at, image, video, ...rest } = t;
    return withMedia ? { ...rest, image, video } : rest;
}

export function themeCode(t: Theme) {
    return CODE_PREFIX + toB64url(deflateSync(strToU8(JSON.stringify(shareable(t, false))), { level: 9 }));
}

export function themeFileText(t: Theme) {
    return JSON.stringify({ kind: FILE_KIND, version: 1, theme: shareable(t, true) });
}

/** Rebuilds a theme from shared data — only known fields, only sensible values. Null if it isn't a theme. */
function rebuild(raw: any): Theme | null {
    if (!raw || typeof raw !== "object") return null;
    for (const k of ["bg", "text", "muted", "accent"]) if (typeof raw[k] !== "string" || !HEX.test(raw[k])) return null;
    const hexOrNull = (v: any) => typeof v === "string" && HEX.test(v) ? v : null;
    const num = (v: any) => typeof v === "number" && isFinite(v) ? v : undefined;
    const media = (v: any, re: RegExp) => typeof v === "string" && v.length < 45_000_000 && re.test(v) ? v : null;
    const fx: Partial<Effects> = {};
    if (raw.fx && typeof raw.fx === "object") for (const k of Object.keys(DEFAULT_FX) as (keyof Effects)[]) if (typeof raw.fx[k] === typeof DEFAULT_FX[k]) (fx as any)[k] = raw.fx[k];
    return normalize({
        id: newId(),
        name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 40) : "Shared theme",
        bg: raw.bg, text: raw.text, muted: raw.muted, accent: raw.accent,
        chat: hexOrNull(raw.chat), accent2: hexOrNull(raw.accent2),
        radius: num(raw.radius), opacity: num(raw.opacity), blur: num(raw.blur), dim: num(raw.dim),
        font: typeof raw.font === "string" ? raw.font : undefined,
        seeAll: !!raw.seeAll, moving: !!raw.moving, mentions: raw.mentions !== false, bubbles: !!raw.bubbles, bubblesRight: raw.bubblesRight !== false,
        scrollbars: raw.scrollbars === "discord" ? "discord" : "accent",
        msgIn: raw.msgIn,
        badge: raw.badge === "accent" ? "accent" : hexOrNull(raw.badge),
        image: media(raw.image, IMAGE_DATA), video: media(raw.video, VIDEO_DATA),
        fx: { ...DEFAULT_FX, ...fx },
    });
}

/** A share code, or the text of a .sonatatheme file → a new theme (with its own id). */
export function readShared(input: string): Theme | null {
    const text = input.trim();
    try {
        const m = text.match(CODE_RE);
        if (m) return rebuild(JSON.parse(strFromU8(inflateSync(fromB64url(m[0].slice(CODE_PREFIX.length))))));
        const j = JSON.parse(text);
        return j?.kind === FILE_KIND ? rebuild(j.theme) : null;
    } catch {
        return null;
    }
}
