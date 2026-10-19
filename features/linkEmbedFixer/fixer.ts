/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Link rewriting, kept free of Discord so it can be tested on its own.

export interface Service {
    /** Setting key. */
    id: string;
    label: string;
    /** Hosts this service owns (subdomains of these match too). */
    hosts: string[];
    /** Suggested embed-friendly domain. */
    fallback: string;
    /**
     * "Video only": the sites known to show just the media (no post card), and how to ask them.
     * "sub" puts d. in front of the domain; "query" adds ?isDirect=true (works with short links too).
     */
    direct?: { sites: string[]; how: "sub" | "query"; };
}

export const SERVICES: Service[] = [
    { id: "twitter", label: "Twitter / X", hosts: ["twitter.com", "x.com"], fallback: "fxtwitter.com", direct: { sites: ["fxtwitter.com", "fixupx.com"], how: "sub" } },
    { id: "instagram", label: "Instagram", hosts: ["instagram.com"], fallback: "kkinstagram.com" },
    { id: "tiktok", label: "TikTok", hosts: ["tiktok.com"], fallback: "tnktok.com", direct: { sites: ["tnktok.com", "tiktxk.com", "tfxktok.com"], how: "query" } },
    { id: "reddit", label: "Reddit", hosts: ["reddit.com"], fallback: "rxddit.com" },
    { id: "bluesky", label: "Bluesky", hosts: ["bsky.app"], fallback: "fxbsky.app", direct: { sites: ["fxbsky.app"], how: "sub" } },
];

/** Subdomains that are just another way to reach the main site, so they're dropped. */
const PLAIN_SUBDOMAINS = new Set(["www", "m", "mobile", "old", "new"]);

/** Service id -> replacement domain (empty = leave alone). */
export type Targets = Record<string, string>;

function cleanDomain(d: string) {
    return d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

/** The embed-friendly version of one URL, or null if it isn't one we fix. With videoOnly, just the media where the site supports it. */
export function fixUrl(raw: string, targets: Targets, videoOnly = false): string | null {
    let url: URL;
    try { url = new URL(raw); } catch { return null; }
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.toLowerCase();

    for (const s of SERVICES) {
        const target = cleanDomain(targets[s.id] ?? "");
        if (!target) continue;
        const base = s.hosts.find(h => host === h || host.endsWith(`.${h}`));
        if (!base) continue;
        // Short links (vm.tiktok.com) keep their subdomain; www./m. don't need it.
        const sub = host.slice(0, -base.length).replace(/\.$/, "");
        const keep = sub && !PLAIN_SUBDOMAINS.has(sub) ? `${sub}.` : "";
        // Only links to an actual post — a bare profile or home page embeds fine already.
        if (url.pathname === "/" || url.pathname === "") return null;
        url.hostname = keep + target;
        const direct = videoOnly && s.direct?.sites.includes(target) ? s.direct.how : null;
        if (direct === "query") url.searchParams.set("isDirect", "true");
        else if (direct === "sub" && !keep) url.hostname = `d.${target}`;
        return url.toString();
    }
    return null;
}

const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,!?:;'"\]]/g;

/** Rewrite links in a message, leaving code and <suppressed> links untouched. */
export function fixLinks(text: string, targets: Targets, videoOnly = false): string {
    // Split off code blocks and inline code; only the text between them is rewritten.
    return text.split(/(```[\s\S]*?```|`[^`\n]*`)/).map((part, i) => {
        if (i % 2 === 1) return part;
        return part.replace(URL_RE, (m, offset: number) => {
            if (part[offset - 1] === "<") return m;
            return fixUrl(m, targets, videoOnly) ?? m;
        });
    }).join("");
}
