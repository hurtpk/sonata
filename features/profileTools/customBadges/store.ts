/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Your badges: saved on this computer (DataStore), in the order they show.
// Each is a picture, either one of Discord's badge pictures or your own (an
// uploaded image or an emoji, turned into a small picture), with the text you
// see when you hover it.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export interface MyBadge {
    id: string;
    /** The picture: a Discord badge picture's address, or your own as a data: URL. */
    src: string;
    /** Shown when you hover it. */
    label: string;
    /** Opened when you click it (optional). */
    link?: string;
    /** Which kind it came from, for the editor. */
    from: "discord" | "picture" | "emoji";
}

/** Discord's own badge pictures (checked to load, Oct 2026). */
export const DISCORD_BADGES: { name: string; hash: string; }[] = [
    { name: "Discord Staff", hash: "5e74e9b61934fc1f67c65515d1f7e60d" },
    { name: "Partnered Server Owner", hash: "3f9748e53446a137a052f3454e2de41e" },
    { name: "Moderator Programs Alumni", hash: "fee1624003e2fee35cb398e125dc479b" },
    { name: "HypeSquad Events", hash: "bf01d1073931f921909045f3a39fd264" },
    { name: "HypeSquad Bravery", hash: "8a88d63823d8a71cd5e390baa45efa02" },
    { name: "HypeSquad Brilliance", hash: "011940fd013da3f7fb926e4a1cd2e618" },
    { name: "HypeSquad Balance", hash: "3aa41de486fa12454c3761e8e223442e" },
    { name: "Discord Bug Hunter", hash: "2717692c7dca7289b35297368a940dd0" },
    { name: "Discord Bug Hunter (gold)", hash: "848f79194d4be5ff5f81505cbd0ce1e6" },
    { name: "Active Developer", hash: "6bdc42827a38498929a4920da12695d9" },
    { name: "Early Verified Bot Developer", hash: "6df5892e0f35b051f8b61eace34f4967" },
    { name: "Early Supporter", hash: "7060786766c9c840eb3019e725d2b358" },
    { name: "Nitro", hash: "2ba85e8026a8614b640c2837bcdfe21b" },
    { name: "Nitro Bronze (1 month)", hash: "4f33c4a9c64ce221936bd256c356f91f" },
    { name: "Nitro Silver (3 months)", hash: "4514fab914bdbfb4ad2fa23df76121a6" },
    { name: "Nitro Gold (6 months)", hash: "2895086c18d5531d499862e41d1155a6" },
    { name: "Nitro Platinum (1 year)", hash: "0334688279c8359120922938dcb1d6f8" },
    { name: "Nitro Diamond (2 years)", hash: "0d61871f72bb9a33a7ae568c1fb4f20a" },
    { name: "Nitro Emerald (3 years)", hash: "11e2d339068b55d3a506cff34d3780f3" },
    { name: "Nitro Ruby (5 years)", hash: "cd5e2cfd9d7f27a8cdcd3e8a8d5dc9f4" },
    { name: "Nitro Opal (6 years)", hash: "5b154df19c53dce2af92c9b61e6be5e2" },
    { name: "Server Booster", hash: "51040c70d4f20a921ad6674ff86fc95c" },
    { name: "Completed a Quest", hash: "7d9ae358c8c5e118768335dbe68b4fb8" },
    { name: "Originally known as", hash: "6de6d34650760ba5551a79732e98ed60" },
];

export const discordBadgeSrc = (hash: string) => `https://cdn.discordapp.com/badge-icons/${hash}.png`;

const KEY = "Sonata_customBadges";
interface Saved {
    badges: MyBadge[];
    /** Every badge on your profile, in the order you put them (by key). */
    order: string[];
    /** Badges you hid (by key) — yours or the real ones. */
    hidden: string[];
    /** The badges last seen on your profile, so the editor can list the real ones too. */
    seen: SeenBadge[];
}

/** A badge as it was on your profile: real, from another plugin, or one of yours. */
export interface SeenBadge { key: string; label: string; src?: string; source: "discord" | "plugin" | "custom"; }

let state: Saved = { badges: [], order: [], hidden: [], seen: [] };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, state);

export const loadBadges = () => loaded ??= DataStore.get<Saved | MyBadge[]>(KEY).then(v => {
    // Older saves were just the list of your badges.
    if (Array.isArray(v)) state = { ...state, badges: v };
    else if (v) state = { ...state, ...v };
    emit();
}).catch(() => { });
export const myBadges = () => state.badges;
export const arrangement = () => state;

export function useBadges() {
    const [, bump] = useState(0);
    useEffect(() => { void loadBadges(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return state.badges;
}

/** Listen for changes outside React (the profile badges). */
export function onBadgesChange(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

const newId = () => Math.random().toString(36).slice(2, 10);
export const customKey = (id: string) => `sonata-custom-${id}`;

export function addBadge(b: Omit<MyBadge, "id">) {
    const made = { ...b, id: newId() };
    state = { ...state, badges: [...state.badges, made] };
    emit(); save();
    return made;
}

export function updateBadge(id: string, patch: Partial<MyBadge>) {
    state = { ...state, badges: state.badges.map(b => b.id === id ? { ...b, ...patch } : b) };
    emit(); save();
}

export function removeBadge(id: string) {
    const key = customKey(id);
    state = { ...state, badges: state.badges.filter(b => b.id !== id), order: state.order.filter(k => k !== key), hidden: state.hidden.filter(k => k !== key) };
    emit(); save();
}

/* ── Order and hiding, for every badge on your profile ── */

/** A badge's key, whoever made it: Discord's have an id ("staff", "premium_tenure_24_month_v2"…). */
export const keyOf = (b: any): string => String(b?.id ?? b?.key ?? b?.description ?? "");

/** Every badge to show in the editor: the ones seen on your profile, plus any of yours added since. */
export function allBadges(): SeenBadge[] {
    const out = [...state.seen];
    const have = new Set(out.map(s => s.key));
    for (const b of state.badges) {
        const key = customKey(b.id);
        if (!have.has(key)) out.push({ key, label: b.label, src: b.src, source: "custom" });
    }
    // Yours use their newest picture and text.
    const mine = new Map(state.badges.map(b => [customKey(b.id), b]));
    return sortByOrder(out.filter(s => s.source !== "custom" || mine.has(s.key)).map(s => mine.has(s.key) ? { ...s, label: mine.get(s.key)!.label, src: mine.get(s.key)!.src } : s), s => s.key);
}

/** In your order; anything you haven't placed keeps its own place after the ones you have. */
function sortByOrder<T>(list: T[], key: (t: T) => string) {
    const at = new Map(state.order.map((k, i) => [k, i]));
    return list.map((t, i) => ({ t, i, o: at.get(key(t)) ?? Infinity })).sort((a, b) => a.o - b.o || a.i - b.i).map(x => x.t);
}

export const isHidden = (key: string) => state.hidden.includes(key);

export function setHidden(key: string, hide: boolean) {
    state = { ...state, hidden: hide ? [...new Set([...state.hidden, key])] : state.hidden.filter(k => k !== key) };
    emit(); save();
}

/** Moves one badge left or right among all of them. */
export function moveKey(key: string, by: -1 | 1) {
    const keys = allBadges().map(s => s.key);
    const i = keys.indexOf(key), j = i + by;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    state = { ...state, order: keys };
    emit(); save();
}

export function resetArrangement() {
    state = { ...state, order: [], hidden: [] };
    emit(); save();
}

const srcOf = (b: any): string | undefined => b?.iconSrc ?? (b?.icon ? `https://cdn.discordapp.com/badge-icons/${b.icon}.png` : undefined);

/**
 * Your profile's badges, arranged: called by Discord's badge list as it draws your profile.
 * Remembers what it saw (for the editor), then hides and orders them.
 */
export function arrangeBadges<T>(list: T[]): T[] {
    if (!Array.isArray(list)) return list;
    const seen: SeenBadge[] = list.map((b: any) => {
        const key = keyOf(b);
        return { key, label: String(b?.description ?? key), src: srcOf(b), source: key.startsWith("sonata-custom-") ? "custom" : b?.icon ? "discord" : "plugin" };
    });
    if (seen.map(s => s.key).join("|") !== state.seen.map(s => s.key).join("|") || seen.some((s, i) => s.src !== state.seen[i]?.src)) {
        // Not while Discord is drawing: just after.
        setTimeout(() => { state = { ...state, seen }; emit(); save(); });
    }
    const hidden = new Set(state.hidden);
    return sortByOrder(list.filter(b => !hidden.has(keyOf(b))), keyOf);
}

/* ── Turning your own pictures and emoji into badge pictures ── */

const SIZE = 64;

/** A picture you picked, as a small square PNG (GIFs under 300 KB are kept as they are, so they still move). */
export async function pictureToBadge(file: File): Promise<string> {
    const asDataUrl = () => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    if (file.type === "image/gif" && file.size < 300_000) return asDataUrl();
    const url = URL.createObjectURL(file);
    try {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const c = document.createElement("canvas");
        c.width = c.height = SIZE;
        const g = c.getContext("2d")!;
        const k = Math.min(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
        const w = img.naturalWidth * k, h = img.naturalHeight * k;
        g.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
        return c.toDataURL("image/png");
    } finally {
        URL.revokeObjectURL(url);
    }
}

/** An emoji, drawn as a small PNG. */
export function emojiToBadge(emoji: string): string {
    const c = document.createElement("canvas");
    c.width = c.height = SIZE;
    const g = c.getContext("2d")!;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `${SIZE * 0.82}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    g.fillText(emoji, SIZE / 2, SIZE / 2 + SIZE * 0.06);
    return c.toDataURL("image/png");
}
