/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord keeps embeds in its own client shape (rawTitle, iconURL, "#rrggbb"
// colours…). This turns one back into the JSON the API — and Discohook,
// webhooks and EmbedSender — use. Kept free of Discord so it can be tested.

const drop = <T extends Record<string, any>>(o: T): Partial<T> | undefined => {
    const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)));
    return Object.keys(out).length ? out as Partial<T> : undefined;
};

function colorNumber(color: unknown): number | undefined {
    if (typeof color === "number") return color;
    if (typeof color !== "string" || !color) return undefined;
    const n = parseInt(color.replace(/^#/, ""), 16);
    return Number.isFinite(n) ? n : undefined;
}

const media = (m: any) => m?.url ? { url: m.url } : undefined;

function timestamp(t: unknown): string | undefined {
    if (!t) return undefined;
    const d = t instanceof Date ? t : new Date(t as any);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** One embed in API / Discohook JSON (accepts the client shape or API shape). */
export function toApiEmbed(e: any): Record<string, any> {
    return drop({
        title: e.rawTitle ?? e.title,
        description: e.rawDescription ?? e.description,
        url: e.url,
        color: colorNumber(e.color),
        timestamp: timestamp(e.timestamp),
        author: e.author ? drop({ name: e.author.name, url: e.author.url, icon_url: e.author.iconURL ?? e.author.icon_url }) : undefined,
        footer: e.footer ? drop({ text: e.footer.text, icon_url: e.footer.iconURL ?? e.footer.icon_url }) : undefined,
        image: media(e.image ?? e.images?.[0]),
        thumbnail: media(e.thumbnail),
        fields: (e.fields ?? []).map((f: any) => ({ name: f.rawName ?? f.name ?? "", value: f.rawValue ?? f.value ?? "", inline: !!f.inline })),
    }) ?? {};
}

/** A whole message the way Discohook imports it. */
export function toApiMessage(content: string | undefined, embeds: any[]) {
    return { content: content || null, embeds: embeds.map(toApiEmbed) };
}
