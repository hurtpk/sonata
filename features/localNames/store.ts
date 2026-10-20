/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The names you gave servers, channels and group chats, saved on this computer only.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export type Kind = "guild" | "channel";
interface Saved { guild: Record<string, string>; channel: Record<string, string>; }

const KEY = "Sonata_localNames";
let names: Saved = { guild: {}, channel: {} };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const loadNames = () => loaded ??= DataStore.get<Saved>(KEY).then(v => { if (v) names = { guild: v.guild ?? {}, channel: v.channel ?? {} }; emit(); }).catch(() => { });
export const localName = (kind: Kind, id: string): string | undefined => names[kind][id];
export const allNames = () => names;

export function setLocalName(kind: Kind, id: string, name: string | null) {
    const next = { ...names[kind] };
    const v = name?.trim();
    if (v) next[id] = v.slice(0, 100);
    else delete next[id];
    names = { ...names, [kind]: next };
    emit();
    void DataStore.set(KEY, names);
}

export function onNamesChange(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

export function useNames() {
    const [, bump] = useState(0);
    useEffect(() => { void loadNames(); return onNamesChange(() => bump(n => n + 1)); }, []);
    return names;
}
