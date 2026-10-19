/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Your tags and who has them. Kept in Sonata's settings, so they come along
// with Share My Setup and backups — and nobody else ever sees them.

import { useEffect, useState } from "@webpack/common";

/** How a tag looks: one colour, or a gradient (its first colour is used for the dot and the border). */
export interface Look { color: string; gradient?: string[]; }
export interface Tag extends Look { id: string; name: string; }
export interface TagData {
    tags: Tag[];
    /** Person → their tags, and the name they had when tagged (for lists of people Discord hasn't loaded). */
    people: Record<string, { tags: string[]; name?: string; }>;
}

export const COLORS = [
    "#ed4245", "#f2555a", "#ff7a59", "#f47b20", "#faa61a", "#fee75c", "#c9e265", "#57f287",
    "#3ba55c", "#1abc9c", "#2dd4bf", "#00b0f4", "#3b82f6", "#5865f2", "#7c5cff", "#9b59b6",
    "#c26bff", "#eb459e", "#ff6fae", "#ff9eb5", "#c69c6d", "#8d6e63", "#99aab5", "#ffffff",
];

export const GRADIENTS: [string, string[]][] = [
    ["Sunset", ["#ff7a59", "#eb459e"]],
    ["Ocean", ["#00b0f4", "#5865f2"]],
    ["Candy", ["#ff6fae", "#c26bff"]],
    ["Aurora", ["#57f287", "#00b0f4", "#7c5cff"]],
    ["Fire", ["#fee75c", "#f47b20", "#ed4245"]],
    ["Mint", ["#c9e265", "#1abc9c"]],
    ["Galaxy", ["#3b2a80", "#9b59b6", "#eb459e"]],
    ["Peach", ["#ffd3a5", "#ff9eb5"]],
    ["Neon", ["#2dd4bf", "#c26bff"]],
    ["Gold", ["#fee75c", "#c69c6d"]],
    ["Ice", ["#ffffff", "#00b0f4"]],
    ["Rainbow", ["#ed4245", "#faa61a", "#fee75c", "#57f287", "#00b0f4", "#9b59b6"]],
];
const g = (name: string) => GRADIENTS.find(([n]) => n === name)![1];
const grad = (name: string): Look => ({ color: g(name)[0], gradient: g(name) });

export const STARTERS: [string, Look][] = [
    ["Best friend", grad("Candy")], ["Close friend", { color: "#ff6fae" }], ["IRL friend", grad("Sunset")], ["Family", { color: "#f47b20" }],
    ["School", { color: "#5865f2" }], ["Work", { color: "#8d6e63" }], ["Teammate", { color: "#3b82f6" }], ["Gaming", { color: "#9b59b6" }],
    ["Roblox", { color: "#ed4245" }], ["Minecraft", { color: "#3ba55c" }], ["Trading", grad("Mint")], ["Artist", grad("Peach")],
    ["Streamer", grad("Neon")], ["Moderator", { color: "#1abc9c" }], ["VIP", grad("Gold")], ["New friend", { color: "#c9e265" }],
    ["Owes me", { color: "#faa61a" }], ["Be careful", { color: "#ed4245" }], ["Scammer", grad("Fire")], ["Ignore", { color: "#99aab5" }],
];

/** 0 (black) to 1 (white). */
function lightness(hex: string) {
    const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
    const [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => v / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
/** The CSS a tag chip needs for its look. */
export function lookStyle(look: Look): Record<string, string> {
    const stops = look.gradient?.length ? look.gradient : null;
    return stops && stops.length > 1
        ? {
            "--ptag": stops[0],
            "--ptag-bg": `linear-gradient(90deg, ${stops.map(c => mix(c, 62)).join(", ")})`,
            "--ptag-line": `linear-gradient(90deg, ${stops.join(", ")})`,
            // Dark writing on light gradients (Peach, Ice…), so it stays readable.
            "--ptag-text": stops.reduce((a, c) => a + lightness(c), 0) / stops.length > 0.62 ? "#1e1f22" : "#fff",
        }
        : { "--ptag": look.color };
}
export const isGradient = (look: Look) => (look.gradient?.length ?? 0) > 1;
export const sameLook = (a: Look, b: Look) => isGradient(a) || isGradient(b)
    ? (a.gradient ?? []).join() === (b.gradient ?? []).join()
    : a.color.toLowerCase() === b.color.toLowerCase();

const io = { read: () => "", write: (_raw: string) => { } };
let data: TagData = { tags: [], people: {} };
const listeners = new Set<() => void>();

export function connect(read: () => string, write: (raw: string) => void) {
    io.read = read;
    io.write = write;
    try {
        const j = JSON.parse(read() || "{}");
        data = { tags: Array.isArray(j.tags) ? j.tags : [], people: j.people && typeof j.people === "object" ? j.people : {} };
    } catch { data = { tags: [], people: {} }; }
}

function save() {
    // People with no tags left aren't worth keeping.
    for (const [id, p] of Object.entries(data.people)) if (!p.tags.length) delete data.people[id];
    io.write(JSON.stringify(data));
    for (const l of listeners) l();
}

export const allTags = () => data.tags;
export const tagById = (id: string) => data.tags.find(t => t.id === id);
export const tagsOf = (userId: string) => (data.people[userId]?.tags ?? []).map(tagById).filter((t): t is Tag => !!t);
export const peopleWith = (tagId: string) => Object.entries(data.people).filter(([, p]) => p.tags.includes(tagId)).map(([id, p]) => ({ id, name: p.name ?? "" }));

export function createTag(name: string, look: Look = { color: COLORS[(data.tags.length * 5) % COLORS.length] }): Tag {
    const tag: Tag = { id: Math.random().toString(36).slice(2, 9), name: name.trim().slice(0, 24) || "Tag", color: look.color, ...(isGradient(look) ? { gradient: look.gradient } : {}) };
    data.tags = [...data.tags, tag];
    save();
    return tag;
}

export function updateTag(id: string, patch: Partial<Omit<Tag, "id">>) {
    data.tags = data.tags.map(t => {
        if (t.id !== id) return t;
        const next: Tag = { ...t, ...patch, name: (patch.name ?? t.name).slice(0, 24) };
        if (!isGradient(next)) delete next.gradient;
        return next;
    });
    save();
}

export function deleteTag(id: string) {
    data.tags = data.tags.filter(t => t.id !== id);
    for (const p of Object.values(data.people)) p.tags = p.tags.filter(t => t !== id);
    save();
}

export function moveTag(id: string, by: number) {
    const i = data.tags.findIndex(t => t.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= data.tags.length) return;
    const list = data.tags.slice();
    [list[i], list[j]] = [list[j], list[i]];
    data.tags = list;
    save();
}

export function setTagged(userId: string, tagId: string, on: boolean, name?: string) {
    const p = data.people[userId] ?? { tags: [] };
    p.tags = on ? [...new Set([...p.tags, tagId])] : p.tags.filter(t => t !== tagId);
    if (name) p.name = name;
    data.people[userId] = p;
    save();
}

/** Re-renders when any tag changes. */
export function useTags() {
    const [, bump] = useState(0);
    useEffect(() => {
        const l = () => bump(n => n + 1);
        listeners.add(l);
        return () => void listeners.delete(l);
    }, []);
    return data;
}
