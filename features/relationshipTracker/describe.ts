/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { LogEntry, UserSnap } from "./tracker";

export type Tone = "good" | "bad" | "neutral" | "info";

export const nameOf = (u?: UserSnap) => u?.globalName || u?.username || "Someone";

export function avatarOf(u?: UserSnap): string | undefined {
    if (!u?.id) return undefined;
    if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith("a_") ? "gif" : "webp"}?size=64`;
    try { return `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`; } catch { return undefined; }
}

/** One sentence for the log row / notification, plus a color tone. */
/** "2 years 3 months", "5 months", "3 weeks", "4 days", "today". */
export function span(ms: number) {
    const d = Math.floor(ms / 86400_000);
    if (d < 1) return "less than a day";
    if (d < 14) return `${d} day${d === 1 ? "" : "s"}`;
    if (d < 60) return `${Math.floor(d / 7)} weeks`;
    const months = Math.floor(d / 30.44);
    if (months < 12) return `${months} months`;
    const y = Math.floor(months / 12), m = months % 12;
    return `${y} year${y === 1 ? "" : "s"}${m ? ` ${m} month${m === 1 ? "" : "s"}` : ""}`;
}

/** For a friend removal: "friends for 2 years · last talked 3 weeks ago". */
export function friendshipDetails(e: LogEntry): string | null {
    if (e.kind !== "friend-removed") return null;
    const bits: string[] = [];
    if (e.friendsSince) bits.push(`friends for ${span(e.t - e.friendsSince)} (since ${new Date(e.friendsSince).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })})`);
    if (e.lastTalked) bits.push(e.t - e.lastTalked < 86400_000 ? "talked today" : `last talked ${span(e.t - e.lastTalked)} ago`);
    return bits.length ? bits.join(" · ") : null;
}

export function describe(e: LogEntry): { text: string; tone: Tone; } {
    const name = nameOf(e.user);
    const group = e.group?.name ?? "a group chat";
    const server = e.server?.name ?? "a server";

    switch (e.kind) {
        case "friend-added":
            return {
                tone: "good",
                text: e.by === "you" ? `You accepted ${name}'s friend request`
                    : e.by === "them" ? `${name} accepted your friend request`
                        : `You and ${name} are now friends`,
            };
        case "friend-removed":
            return {
                tone: "bad",
                text: e.blocked ? `You blocked ${name} (no longer friends)`
                    : e.by === "you" ? `You removed ${name} as a friend`
                        : e.by === "them" ? `${name} removed you as a friend`
                            : `You and ${name} are no longer friends`,
            };
        case "request-received":
            return { tone: "info", text: `${name} sent you a friend request` };
        case "request-sent":
            return { tone: "neutral", text: `You sent ${name} a friend request` };
        case "request-cancelled":
            return {
                tone: "neutral",
                text: e.direction === "outgoing" ? `You cancelled your friend request to ${name}`
                    : e.by === "them" ? `${name} cancelled their friend request`
                        : `${name}'s friend request is gone`,
            };
        case "request-declined":
            return {
                tone: e.by === "you" ? "neutral" : "bad",
                text: e.direction === "incoming" ? `You declined ${name}'s friend request`
                    : e.by === "them" ? `${name} declined your friend request`
                        : `Your friend request to ${name} is gone`,
            };
        case "group-removed":
            return { tone: "bad", text: e.offline ? `You're no longer in ${group}` : `You were removed from ${group}` };
        case "group-left":
            return { tone: "neutral", text: `You left ${group}` };
        case "group-member-removed":
            return { tone: "bad", text: `${nameOf(e.actor)} removed ${name} from ${group}` };
        case "group-member-left":
            return { tone: "neutral", text: `${name} left ${group}` };
        case "server-removed":
            return { tone: "bad", text: e.offline ? `You're no longer in ${server}` : `You were removed from ${server} (kicked, banned, or it was deleted)` };
        case "server-left":
            return { tone: "neutral", text: `You left ${server}` };
    }
}

export const byLabel = (e: LogEntry) =>
    e.by === "you" ? "By you" : e.by === "them" ? "By them" : "Unknown";
