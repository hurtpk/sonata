/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Saved on this computer: invites you create (so they show up even where you
// can't list a server's invites) and the "who it's for" note on each.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export interface SavedInvite {
    code: string;
    guildId: string | null;
    channelId: string | null;
    createdAt: number;
    maxAge: number;
    maxUses: number;
}

interface Data { saved: Record<string, SavedInvite>; labels: Record<string, string>; }

const KEY = "Opticord_inviteManager";
let data: Data = { saved: {}, labels: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => DataStore.set(KEY, data).catch(() => { });

export async function loadInvites() {
    const stored = await DataStore.get<Data>(KEY).catch(() => undefined);
    data = { saved: stored?.saved ?? {}, labels: stored?.labels ?? {} };
    emit();
}

export const savedInvites = () => Object.values(data.saved);
export const labels = () => data.labels;

export function rememberInvite(inv: SavedInvite) {
    data = { ...data, saved: { ...data.saved, [inv.code]: inv } };
    save(); emit();
}

export function forgetInvite(code: string) {
    const { [code]: _, ...rest } = data.saved;
    data = { ...data, saved: rest };
    save(); emit();
}

export function setLabel(code: string, label: string) {
    const next = { ...data.labels };
    if (label.trim()) next[code] = label.trim().slice(0, 80); else delete next[code];
    data = { ...data, labels: next };
    save(); emit();
}

export function useInviteStore() {
    const [, force] = useState(0);
    useEffect(() => {
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return data;
}
