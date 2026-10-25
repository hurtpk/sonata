/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The names you gave servers, channels, group chats and roles, and the icons
// you gave servers, saved on this computer only.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

export type Kind = "guild" | "channel";
interface Saved {
    guild: Record<string, string>;
    channel: Record<string, string>;
    /** Role id → your name for it. */
    role: Record<string, string>;
    /** Role id → its server, so a server's renamed roles can be found quickly. */
    roleGuild: Record<string, string>;
    /** Server id → a small picture (a data URL) shown as its icon. */
    icon: Record<string, string>;
}

const KEY = "Sonata_localNames";
let names: Saved = { guild: {}, channel: {}, role: {}, roleGuild: {}, icon: {} };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const save = () => void DataStore.set(KEY, names);

export const loadNames = () => loaded ??= DataStore.get<Partial<Saved>>(KEY).then(v => {
    if (v) names = { guild: v.guild ?? {}, channel: v.channel ?? {}, role: v.role ?? {}, roleGuild: v.roleGuild ?? {}, icon: v.icon ?? {} };
    emit();
}).catch(() => { });
export const localName = (kind: Kind, id: string): string | undefined => names[kind][id];
export const localRole = (roleId: string): string | undefined => names.role[roleId];
export const localIcon = (guildId: string): string | undefined => names.icon[guildId];
export const allNames = () => names;
/** The renamed roles in one server. */
export const renamedRolesIn = (guildId: string) => Object.keys(names.role).filter(id => names.roleGuild[id] === guildId);

export function setLocalName(kind: Kind, id: string, name: string | null) {
    const next = { ...names[kind] };
    const v = name?.trim();
    if (v) next[id] = v.slice(0, 100);
    else delete next[id];
    names = { ...names, [kind]: next };
    emit();
    save();
}

export function setLocalRole(guildId: string, roleId: string, name: string | null) {
    const role = { ...names.role }, roleGuild = { ...names.roleGuild };
    const v = name?.trim();
    if (v) { role[roleId] = v.slice(0, 100); roleGuild[roleId] = guildId; } else { delete role[roleId]; delete roleGuild[roleId]; }
    names = { ...names, role, roleGuild };
    emit();
    save();
}

export function setLocalIcon(guildId: string, dataUrl: string | null) {
    const icon = { ...names.icon };
    if (dataUrl) icon[guildId] = dataUrl; else delete icon[guildId];
    names = { ...names, icon };
    emit();
    save();
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

/** A picture made into a small square server icon (cropped to the middle), as a data URL. */
export async function iconFrom(file: Blob, size = 128): Promise<string> {
    const bmp = await createImageBitmap(file);
    const side = Math.min(bmp.width, bmp.height);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
    bmp.close();
    return c.toDataURL("image/webp", 0.9);
}
