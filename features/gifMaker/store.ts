/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Presets, the gallery of GIFs you've made, and adding a sent GIF to your
// Discord favourites.

import { DataStore } from "@api/index";
import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, showToast, UserSettingsActionCreators, UserStore } from "@webpack/common";

import type { MediaInput } from "./render/source";
import { DEFAULT_FILL, EditState, STYLE_KEYS } from "./types";

const logger = new Logger("GifMaker");

// ─── Presets ───

export interface Preset { id: string; name: string; style: Partial<EditState>; builtIn?: boolean; }

const PRESETS_KEY = "Sonata_gif_presets";

const memeText = (id: string, text: string, y: number) => ({
    id, text, x: 0.5, y, size: 0.11, font: "Anton", fill: { ...DEFAULT_FILL }, outline: "#000000", outlineWidth: 0.14,
    shadow: false, bold: false, from: 0, to: 1, anim: "none" as const,
});

export const BUILT_IN_PRESETS: Preset[] = [
    { id: "b-meme", name: "Classic meme", builtIn: true, style: { captionMode: "meme", captionSize: 40 } },
    { id: "b-fried", name: "Deep-fried", builtIn: true, style: { filter: "deepfried", filterAmount: 1, contrast: 115, particles: "none" } },
    { id: "b-wasted", name: "Wasted", builtIn: true, style: { banner: "wasted", bannerAt: 0.55, zoom: "punch", zoomAt: 0.5, zoomStrength: 0.15 } },
    { id: "b-boomerang", name: "Slow-mo boomerang", builtIn: true, style: { playMode: "boomerang", speed: 0.6 } },
    { id: "b-vhs", name: "Old tape", builtIn: true, style: { filter: "vhs", filterAmount: 0.8, saturation: 110 } },
    { id: "b-party", name: "Party", builtIn: true, style: { particles: "confetti", particleDensity: 1.2, texts: [memeText("party", "LET'S GO", 0.85)] } },
];

export const pickStyle = (s: EditState): Partial<EditState> =>
    Object.fromEntries(STYLE_KEYS.map(k => [k, structuredClone(s[k])])) as Partial<EditState>;

export async function getPresets(): Promise<Preset[]> {
    return (await DataStore.get<Preset[]>(PRESETS_KEY)) ?? [];
}

export async function savePreset(name: string, s: EditState) {
    const list = await getPresets();
    const existing = list.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.style = pickStyle(s);
    else list.push({ id: `p-${Date.now().toString(36)}`, name, style: pickStyle(s) });
    await DataStore.set(PRESETS_KEY, list);
    return list;
}

export async function deletePreset(id: string) {
    const list = (await getPresets()).filter(p => p.id !== id);
    await DataStore.set(PRESETS_KEY, list);
    return list;
}

// ─── Recent GIFs ───

export interface Recent {
    id: string;
    at: number;
    name: string;
    blob: Blob;
    type: string;
    width: number;
    height: number;
    /** What it was made from, when that can be opened again (links, not files from this session). */
    inputs?: MediaInput[];
    state: EditState;
}

const RECENT_KEY = "Sonata_gif_recent";
const MAX_RECENT = 24;
const MAX_RECENT_BYTES = 12 * 1024 * 1024;

export async function getRecent(): Promise<Recent[]> {
    return (await DataStore.get<Recent[]>(RECENT_KEY)) ?? [];
}

export async function addRecent(r: Omit<Recent, "id" | "at">) {
    if (r.blob.size > MAX_RECENT_BYTES) return;
    const inputs = r.inputs?.every(i => /^https?:/.test(i.url)) ? r.inputs : undefined;
    const list = await getRecent();
    list.unshift({ ...r, inputs, id: Date.now().toString(36), at: Date.now() });
    await DataStore.set(RECENT_KEY, list.slice(0, MAX_RECENT));
}

export async function removeRecent(id: string) {
    const list = (await getRecent()).filter(r => r.id !== id);
    await DataStore.set(RECENT_KEY, list);
    return list;
}

// ─── Favourites ───
// Discord's favourites hold links to GIFs it already has, so a new GIF can
// only be starred once it's been sent. This waits for your message with the
// file and then stars it.

const SettingsDelay = findByPropsLazy("INFREQUENT_USER_ACTION");

export function favouriteWhenSent(channelId: string, filename: string) {
    const me = UserStore.getCurrentUser()?.id;
    const done = () => { clearTimeout(timer); FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessage); };
    const onMessage = ({ message, channelId: ch }: any) => {
        if (ch !== channelId || message?.author?.id !== me) return;
        const file = message.attachments?.find((a: any) => a.filename === filename);
        if (!file) return;
        done();
        const isVideo = /^video\//.test(file.content_type ?? "");
        try {
            UserSettingsActionCreators.FrecencyUserSettingsActionCreators.updateAsync("favoriteGifs", (fav: any) => {
                const order = Math.max(0, ...Object.values<any>(fav.gifs ?? {}).map(g => g.order ?? 0)) + 1;
                fav.gifs[file.url] = { format: isVideo ? 2 : 1, src: file.proxy_url ?? file.url, width: file.width ?? 0, height: file.height ?? 0, order };
            }, SettingsDelay.INFREQUENT_USER_ACTION);
            showToast("Added to your GIF favourites ⭐", "success");
        } catch (e) {
            logger.error("Couldn't add to favourites", e);
            showToast("Couldn't add it to your favourites", "failure");
        }
    };
    const timer = setTimeout(done, 3 * 60_000);
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessage);
}
