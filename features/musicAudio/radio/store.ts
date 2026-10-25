/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Radio keeps on this computer (DataStore): your favourite stations, the
// ones you played lately, your SoundCloud profile and its likes, and the music
// files you added (only where they are — nothing is copied).

import * as DataStore from "@api/DataStore";
import { OptionType } from "@utils/types";
import { useEffect, useState } from "@webpack/common";

import { defineFeatureSettings } from "../../../featureSettings";
import type { PickedFile, ScTrack, Station } from "./native";

export const settings = defineFeatureSettings("radio", {
    volume: { type: OptionType.NUMBER, description: "Volume (0–100)", default: 70, hidden: true },
    repeat: { type: OptionType.BOOLEAN, description: "Start a list again from the top when it ends", default: false },
});

export interface MusicFile extends PickedFile { missing?: boolean; }
interface Saved { favorites: Station[]; recent: Station[]; scUser?: string; scTracks?: ScTrack[]; scLoaded?: number; files: MusicFile[]; }

const KEY = "Sonata_radio";
let saved: Saved = { favorites: [], recent: [], files: [] };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const put = (p: Partial<Saved>) => { saved = { ...saved, ...p }; emit(); void DataStore.set(KEY, saved); };

const native = () => VencordNative.pluginHelpers.Sonata as any;

export const loadRadio = () => loaded ??= DataStore.get<Saved>(KEY).then(async v => {
    if (v) saved = { ...saved, ...v };
    // Tell the player which files may be played, and mark any that were moved or deleted.
    if (saved.files.length) {
        const there: Record<string, boolean> = await native().musicKnown(saved.files).catch(() => ({}));
        saved = { ...saved, files: saved.files.map(f => ({ ...f, missing: there[f.id] === false })) };
    }
    emit();
}).catch(() => { });
export const radio = () => saved;

export function useRadio() {
    const [, bump] = useState(0);
    useEffect(() => { void loadRadio(); const l = () => bump(n => n + 1); listeners.add(l); return () => void listeners.delete(l); }, []);
    return saved;
}

/* ── Stations ── */

export const isFavorite = (id: string) => saved.favorites.some(s => s.id === id);
export const toggleFavorite = (s: Station) => put({ favorites: isFavorite(s.id) ? saved.favorites.filter(x => x.id !== s.id) : [...saved.favorites, s] });
export const playedStation = (s: Station) => put({ recent: [s, ...saved.recent.filter(x => x.id !== s.id)].slice(0, 12) });

export async function stations(by: "top" | "tag" | "name", value = ""): Promise<Station[] | string> {
    const r = await native().radioStations(by, value).catch(() => null);
    return r?.ok ? r.stations : r?.error ?? "Couldn't load stations";
}

/* ── SoundCloud ── */

export async function loadLikes(profile: string): Promise<string | null> {
    const r = await native().scLikes(profile).catch(() => null);
    if (!r?.ok) return r?.error ?? "Couldn't load those likes";
    put({ scUser: r.user, scTracks: r.tracks, scLoaded: Date.now() });
    return null;
}
export const forgetSoundCloud = () => put({ scUser: undefined, scTracks: undefined, scLoaded: undefined });
export const radioTools = (): Promise<{ ytdlp: boolean; ffmpeg: boolean; }> => native().radioTools().catch(() => ({ ytdlp: false, ffmpeg: false }));

/* ── Your files ── */

export async function addFiles() {
    const picked: PickedFile[] = await native().musicPick().catch(() => []);
    const known = new Set(saved.files.map(f => f.path.toLowerCase()));
    const fresh = picked.filter(f => !known.has(f.path.toLowerCase()));
    // Ones already in the list get the id the player just learned for them.
    const again = new Map(picked.filter(f => known.has(f.path.toLowerCase())).map(f => [f.path.toLowerCase(), f.id]));
    put({ files: [...saved.files.map(f => again.has(f.path.toLowerCase()) ? { ...f, id: again.get(f.path.toLowerCase())!, missing: false } : f), ...fresh] });
    return fresh.length;
}
export const removeFile = (id: string) => put({ files: saved.files.filter(f => f.id !== id) });
