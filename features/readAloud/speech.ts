/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turning a message into something worth hearing: names instead of
// <@123456>, "a link to youtube.com" instead of the whole address, emoji by
// name, and no reading out spoilers or code. No Discord in here.

export interface Names {
    user(id: string): string | null;
    channel(id: string): string | null;
    role(id: string): string | null;
}

const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "a website"; } };

function when(seconds: number, style: string) {
    const d = new Date(seconds * 1000);
    if (style === "R") {
        const mins = Math.round((d.getTime() - Date.now()) / 60000), abs = Math.abs(mins);
        const [n, unit] = abs < 60 ? [abs, "minute"] : abs < 1440 ? [Math.round(abs / 60), "hour"] : [Math.round(abs / 1440), "day"];
        const span = `${n} ${unit}${n === 1 ? "" : "s"}`;
        return mins >= 0 ? `in ${span}` : `${span} ago`;
    }
    if (style === "t" || style === "T") return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleString([], { dateStyle: "long", ...(style === "d" || style === "D" ? {} : { timeStyle: "short" }) });
}

/** The words to say for a message's text. */
export function speakable(text: string, names: Names): string {
    let s = text ?? "";
    s = s.replace(/```[\s\S]*?(?:```|$)/g, " (a code block) ")
        .replace(/`([^`\n]+)`/g, "$1")
        .replace(/\|\|[\s\S]+?\|\|/g, " (a spoiler) ")
        .replace(/<a?:(\w+):\d+>/g, " $1 ")
        .replace(/<@!?(\d+)>/g, (_, id) => names.user(id) ?? "someone")
        .replace(/<@&(\d+)>/g, (_, id) => names.role(id) ?? "a role")
        .replace(/<#(\d+)>/g, (_, id) => names.channel(id) ?? "a channel")
        .replace(/<t:(-?\d+)(?::([tTdDfFR]))?>/g, (_, t, st) => when(Number(t), st ?? "f"))
        .replace(/<\/([\w -]+):\d+>/g, "slash $1")
        .replace(/\[([^\]]+)\]\(<?https?:\/\/[^)\s>]+>?\)/g, "$1 (a link)")
        .replace(/<?(https?:\/\/[^\s<>]+)>?/g, (_, u) => ` a link to ${host(u)} `)
        .replace(/@(everyone|here)\b/g, "at $1")
        .replace(/:([a-z0-9_+-]{2,}):/gi, (_, n) => ` ${n.replace(/_/g, " ")} `)
        .replace(/^\s*>>?>?\s?/gm, "")
        .replace(/^\s*#{1,3}\s+/gm, "")
        .replace(/^\s*-#\s+/gm, "")
        .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, "$2");
    return s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, ". ").replace(/\.\s*\./g, ".").trim();
}

/** "a picture", "2 files"… for what's attached. */
export function attachmentsText(attachments: { content_type?: string; filename?: string; }[] = [], stickers = 0) {
    const kind = (a: { content_type?: string; filename?: string; }) => {
        const t = a.content_type ?? "", f = a.filename ?? "";
        if (t.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(f)) return "picture";
        if (t.startsWith("video/") || /\.(mp4|mov|webm)$/i.test(f)) return "video";
        if (t.startsWith("audio/") || /\.(mp3|ogg|wav|m4a)$/i.test(f)) return "voice message or sound";
        return "file";
    };
    const counts = new Map<string, number>();
    for (const a of attachments) counts.set(kind(a), (counts.get(kind(a)) ?? 0) + 1);
    if (stickers) counts.set("sticker", stickers);
    const parts = [...counts].map(([k, n]) => n === 1 ? `a ${k}` : `${n} ${k === "voice message or sound" ? "sounds" : k + "s"}`);
    return parts.length ? parts.join(" and ") : "";
}
