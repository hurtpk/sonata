/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Invite rows and their maths, kept free of Discord so they can be tested on their own.

export interface InviteRow {
    code: string;
    guildId: string | null;
    guildName: string;
    guildIcon: string | null;
    channelId: string | null;
    channelName: string | null;
    inviterId: string | null;
    /** Unknown (null) when we could only look the invite up publicly. */
    uses: number | null;
    /** 0 = no limit. */
    maxUses: number;
    /** Seconds; 0 = never expires. null when unknown. */
    maxAge: number | null;
    temporary: boolean;
    createdAt: number | null;
    expiresAt: number | null;
    /** Where we learned about it. */
    source: "server" | "saved";
    /** Gone: Discord says this code no longer works. */
    gone?: boolean;
}

const DAY = 86_400_000;
export const OLD_AFTER_DAYS = 30;

export const neverExpires = (r: InviteRow) => r.expiresAt == null && (r.maxAge === 0 || (r.maxAge == null && r.source === "server"));

/** Never expires and has been around a while — the ones worth a second look. */
export const isStale = (r: InviteRow, now = Date.now()) =>
    !r.gone && neverExpires(r) && r.createdAt != null && now - r.createdAt > OLD_AFTER_DAYS * DAY;

export const expiringSoon = (r: InviteRow, now = Date.now()) => r.expiresAt != null && r.expiresAt > now && r.expiresAt - now < DAY;

/** From the API: expires_at if given, otherwise created_at + max_age. */
export function expiryOf(raw: { expires_at?: string | null; created_at?: string | null; max_age?: number | null; }) {
    if (raw.expires_at) return Date.parse(raw.expires_at);
    if (raw.max_age && raw.created_at) return Date.parse(raw.created_at) + raw.max_age * 1000;
    return null;
}

export function relative(ms: number, now = Date.now()) {
    const diff = ms - now, abs = Math.abs(diff);
    const unit: [number, string][] = [[365 * DAY, "year"], [30 * DAY, "month"], [7 * DAY, "week"], [DAY, "day"], [3_600_000, "hour"], [60_000, "minute"]];
    for (const [size, name] of unit) {
        if (abs >= size) {
            const n = Math.round(abs / size);
            const text = `${n} ${name}${n === 1 ? "" : "s"}`;
            return diff < 0 ? `${text} ago` : `in ${text}`;
        }
    }
    return diff < 0 ? "just now" : "in under a minute";
}

export const usesText = (r: InviteRow) =>
    r.uses == null ? (r.maxUses ? `max ${r.maxUses}` : "—") : r.maxUses ? `${r.uses} / ${r.maxUses}` : `${r.uses}`;

export type Filter = "all" | "never" | "stale" | "soon";
export type Sort = "newest" | "oldest" | "uses" | "expiry";

export function applyView(rows: InviteRow[], filter: Filter, sort: Sort, query: string, labels: Record<string, string>, now = Date.now()) {
    const q = query.trim().toLowerCase();
    const shown = rows.filter(r => {
        if (filter === "never" && !neverExpires(r)) return false;
        if (filter === "stale" && !isStale(r, now)) return false;
        if (filter === "soon" && !expiringSoon(r, now)) return false;
        if (!q) return true;
        return [r.code, r.guildName, r.channelName ?? "", labels[r.code] ?? ""].some(s => s.toLowerCase().includes(q));
    });
    const by: Record<Sort, (a: InviteRow, b: InviteRow) => number> = {
        newest: (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
        oldest: (a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity),
        uses: (a, b) => (b.uses ?? -1) - (a.uses ?? -1),
        expiry: (a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity),
    };
    return shown.sort(by[sort]);
}
