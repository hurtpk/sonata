/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Telling tracking numbers and delivery links apart, and where each one is
// tracked. Kept free of Discord so it can be tested on its own.

export type Carrier = "ups" | "usps" | "fedex" | "dhl" | "amazon" | "royalmail" | "canadapost" | "ontrac";
export type Service = "doordash" | "ubereats" | "postmates";

export const CARRIERS: Record<Carrier, { name: string; url(n: string): string; hosts: string[]; }> = {
    ups: { name: "UPS", url: n => `https://www.ups.com/track?tracknum=${n}`, hosts: ["ups.com"] },
    usps: { name: "USPS", url: n => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`, hosts: ["usps.com"] },
    fedex: { name: "FedEx", url: n => `https://www.fedex.com/fedextrack/?trknbr=${n}`, hosts: ["fedex.com"] },
    dhl: { name: "DHL", url: n => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`, hosts: ["dhl.com"] },
    amazon: { name: "Amazon", url: n => `https://track.amazon.com/tracking/${n}`, hosts: ["amazon.com"] },
    royalmail: { name: "Royal Mail", url: n => `https://www.royalmail.com/track-your-item#/tracking-results/${n}`, hosts: ["royalmail.com"] },
    canadapost: { name: "Canada Post", url: n => `https://www.canadapost-postescanada.ca/track-reperage/en#/details/${n}`, hosts: ["canadapost-postescanada.ca", "canadapost.ca"] },
    ontrac: { name: "OnTrac", url: n => `https://www.ontrac.com/tracking/?number=${n}`, hosts: ["ontrac.com"] },
};

export const SERVICES: Record<Service, { name: string; hosts: string[]; }> = {
    doordash: { name: "DoorDash", hosts: ["doordash.com", "drd.sh"] },
    ubereats: { name: "Uber Eats", hosts: ["ubereats.com", "uber.com"] },
    // Postmates is Uber's: its order pages are Uber Eats' (and may send you on to ubereats.com).
    postmates: { name: "Postmates", hosts: ["postmates.com"] },
};

/** Every site the hidden page may load (and be sent on to). */
export const ALLOWED_HOSTS = [...Object.values(CARRIERS).flatMap(c => c.hosts), ...Object.values(SERVICES).flatMap(s => s.hosts)];

export const hostAllowed = (host: string) => ALLOWED_HOSTS.some(h => host === h || host.endsWith("." + h));

/** Numbers that can only be one carrier's. */
const STRONG: [Carrier, RegExp][] = [
    ["ups", /\b1Z[0-9A-Z]{16}\b/g],
    ["amazon", /\bTBA\d{12}\b/g],
    ["usps", /\b9[2-5]\d{20}\b/g],
    ["usps", /\b[A-Z]{2}\d{9}US\b/g],
    ["royalmail", /\b[A-Z]{2}\d{9}GB\b/g],
    ["canadapost", /\b[A-Z]{2}\d{9}CA\b/g],
    ["dhl", /\bJJD\d{18}\b/g],
    ["ontrac", /\b[CD]\d{14}\b/g],
];

/** Plain digits that could be a few carriers' (or nothing at all), only trusted with a carrier named nearby. */
const WEAK: [Carrier, RegExp, RegExp][] = [
    ["fedex", /\b(\d{12}|\d{15}|\d{20})\b/g, /fed ?ex/i],
    ["dhl", /\b\d{10}\b/g, /\bdhl\b/i],
    ["canadapost", /\b\d{16}\b/g, /canada ?post/i],
];

/** The carrier for a number you typed in yourself (any format). */
export function carrierOf(raw: string): Carrier | null {
    const n = clean(raw);
    for (const [c, re] of STRONG) if (new RegExp(`^(?:${re.source})$`).test(n)) return c;
    if (/^(\d{12}|\d{15}|\d{20})$/.test(n)) return "fedex";
    if (/^\d{10}$/.test(n)) return "dhl";
    if (/^\d{16}$/.test(n)) return "canadapost";
    return null;
}

export const clean = (n: string) => n.replace(/[\s-]/g, "").toUpperCase();

export type Found =
    | { kind: "parcel"; carrier: Carrier; number: string; }
    | { kind: "food"; service: Service; url: string; };

/** The service a delivery tracking link belongs to, or null if it isn't one. */
export function serviceOf(link: string): Service | null {
    let u: URL;
    try { u = new URL(link); } catch { return null; }
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.replace(/^www\./, "");
    if (host === "drd.sh") return u.pathname.length > 1 ? "doordash" : null;
    if (host === "doordash.com" || host.endsWith(".doordash.com")) return /\/orders?\//i.test(u.pathname) ? "doordash" : null;
    if (host === "ubereats.com" || host.endsWith(".ubereats.com") || host === "eats.uber.com") return /\/orders?\/|\/track/i.test(u.pathname) ? "ubereats" : null;
    if (host === "postmates.com" || host.endsWith(".postmates.com")) return /\/orders?\/|\/track/i.test(u.pathname) ? "postmates" : null;
    return null;
}

/** Tracking numbers and delivery links in a message. */
export function findInText(text: string): Found[] {
    const out: Found[] = [];
    const seen = new Set<string>();
    for (const m of text.matchAll(/https?:\/\/[^\s<>()]+/gi)) {
        const url = m[0].replace(/[.,!?)\]]+$/, "");
        const service = serviceOf(url);
        if (service && !seen.has(url)) { seen.add(url); out.push({ kind: "food", service, url }); }
    }
    // Numbers inside links (a carrier's own tracking link) count too, but not a link's other parts.
    const words = text.replace(/https?:\/\/\S+/gi, l => decodeURIComponent(l).replace(/[^A-Za-z0-9]+/g, " "));
    for (const [carrier, re] of STRONG) {
        for (const m of words.matchAll(re)) if (!seen.has(m[0])) { seen.add(m[0]); out.push({ kind: "parcel", carrier, number: m[0] }); }
    }
    for (const [carrier, re, near] of WEAK) {
        if (!near.test(text)) continue;
        for (const m of words.matchAll(re)) if (!seen.has(m[0])) { seen.add(m[0]); out.push({ kind: "parcel", carrier, number: m[0] }); }
    }
    return out;
}

/** "1Z…4821": enough to tell numbers apart without filling the screen. */
export const shortNumber = (n: string) => n.length > 10 ? `${n.slice(0, 4)}…${n.slice(-4)}` : n;
