/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reading a tracking page's text into a few fixed facts. Only those facts
// leave here: the stage or status is one of a fixed list (never the page's
// own words, which name the driver), and the store and food are checked so
// that nothing that looks like an address, phone number or name gets through.
// Kept free of Discord and Electron so it can be tested on its own.

export type FoodStage = "placed" | "preparing" | "pickup" | "onTheWay" | "delivered" | "cancelled";
export interface FoodInfo {
    stage?: FoodStage;
    store?: string;
    /** When the order was placed. */
    placedAt?: number;
    items?: string[];
    /** When it should arrive (the start of the range, if the page gives one). */
    etaAt?: number;
    /** The end of the arrival range ("7:40–7:50 PM"). */
    etaTo?: number;
}

export type ParcelStatus = "label" | "transit" | "out" | "delayed" | "delivered" | "exception";
export interface ParcelInfo {
    status?: ParcelStatus;
    /** The day it should arrive (local midnight). */
    expected?: number;
    /** The day it was delivered (local midnight). */
    deliveredOn?: number;
    /** The carrier says it has nothing for this number (yet). */
    unknown?: boolean;
}

const DAY = 86_400_000;
const lines = (text: string) => text.split(/\n+/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean);
/** Status headlines are short; long lines are paragraphs (help text, terms). */
const headline = (l: string) => l.length <= 90;

/* ── Keeping personal details out ── */

const STREET = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|apt|apartment|suite|ste|unit|hwy|highway|pl|place|pkwy|parkway|cir|circle|ter|terrace|crescent|close|floor|fl|po box|building|bldg)\b\.?/i;
const looksPersonal = (s: string) =>
    /\d{2,6}\s+\S+/.test(s) && STREET.test(s) // "123 Main St"
    || /\b\d{5}(-\d{4})?\b/.test(s) // ZIP code
    || /\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/.test(s) // UK postcode
    || /\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b/.test(s) // Canadian postcode
    || /(\+?\d[\s().-]?){9,}/.test(s) // phone number
    || /@/.test(s)
    || /\b(dasher|driver|courier|your (dasher|driver|courier)|customer|recipient|deliver(ing|ed)? to|drop.?off|leave (it )?at|gate code|instructions?)\b/i.test(s);

/** A store or dish name, or nothing if it might be personal. */
function safeName(s: string | undefined, max = 60) {
    const t = s?.replace(/^[\s"'“”‘’:·•-]+|[\s"'“”‘’:·•.!,-]+$/g, "").trim();
    if (!t || t.length < 2 || t.length > max || looksPersonal(t)) return undefined;
    return t;
}

/* ── Times and dates ── */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** "7:45 PM" or "19:45" today (or tonight / just after midnight), near `now`. */
function clockAt(text: string, now: number, prefer: "past" | "future"): number | undefined {
    const m = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?|\b([01]?\d|2[0-3]):([0-5]\d)\b/i.exec(text);
    if (!m) return undefined;
    let h: number, min: number;
    if (m[3]) { h = Number(m[1]) % 12 + (m[3].toLowerCase() === "p" ? 12 : 0); min = Number(m[2] ?? 0); } else { h = Number(m[4]); min = Number(m[5]); }
    if (h > 23 || min > 59) return undefined;
    const d = new Date(now);
    d.setHours(h, min, 0, 0);
    let t = d.getTime();
    // An order placed "11:50 PM" just after midnight was yesterday; arriving "12:10 AM" late at night is tomorrow.
    if (prefer === "past" && t > now + 30 * 60_000) t -= DAY;
    if (prefer === "future" && t < now - 3 * 3_600_000) t += DAY;
    return t;
}

/** A calendar day written in a sentence ("Thursday, October 23", "23 Oct 2026", "10/23", "tomorrow"), near `now`. */
export function dayIn(text: string, now: number): number | undefined {
    const t = text.toLowerCase();
    const today = midnight(now);
    if (/\btoday\b/.test(t)) return today;
    if (/\btomorrow\b/.test(t)) return midnight(today + DAY + 3_600_000);
    const pick = (month: number, day: number, year?: number) => {
        if (month < 0 || month > 11 || day < 1 || day > 31) return undefined;
        if (year) return new Date(year < 100 ? 2000 + year : year, month, day).getTime();
        // No year: the one closest to now (a little behind, or up to ten months ahead).
        const y = new Date(now).getFullYear();
        const options = [y - 1, y, y + 1].map(yy => new Date(yy, month, day).getTime());
        return options.reduce((a, b) => Math.abs(b - now - 60 * DAY) < Math.abs(a - now - 60 * DAY) ? b : a);
    };
    let m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/.exec(t);
    if (m) return pick(MONTHS.indexOf(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
    m = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s+(\d{4}))?/.exec(t);
    if (m) return pick(MONTHS.indexOf(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined);
    m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
    if (m) return pick(Number(m[1]) - 1, Number(m[2]), m[3] ? Number(m[3]) : undefined);
    m = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(t);
    if (m) {
        // A weekday on its own is the next one coming (today counts).
        const want = WEEKDAYS.indexOf(m[1]);
        const diff = (want - new Date(now).getDay() + 7) % 7;
        return midnight(today + diff * DAY + 3_600_000);
    }
    return undefined;
}

/* ── Food ── */

const FOOD_STAGES: [FoodStage, RegExp][] = [
    ["cancelled", /\b(order (was |has been )?cancel+ed|cancel+ed your order|refunded)\b/i],
    ["delivered", /\b(delivered|enjoy your (order|meal|food)|dropped off|has arrived|order (is )?complete)\b/i],
    ["onTheWay", /\b(on (the|their|its|his|her) way|heading (to you|your way|over)|en route|out for delivery|picked up (your|the) order|arriving (soon|now|shortly|in)|almost (there|here)|nearby|approaching|on the move)\b/i],
    ["pickup", /\b(heading to (the )?(store|restaurant|merchant)|at the (store|restaurant)|waiting (for|on) (your |the )?order|picking up|arrived at the (store|restaurant)|assigned|found a (dasher|courier|driver))\b/i],
    ["preparing", /\b(preparing|being (made|prepared|cooked)|in the kitchen|making your|cooking|getting (your|the) order ready|order (is )?(being )?prepared|started (on )?your order)\b/i],
    ["placed", /\b(order (received|placed|confirmed|submitted)|confirming (your )?order|sent (your order )?to the (store|restaurant)|(we|we've|they've) (got|received) your order|waiting for the (store|restaurant) to (accept|confirm))\b/i],
];

export function readFood(text: string, title: string, now = Date.now()): FoodInfo {
    const all = lines(text);
    const info: FoodInfo = {};

    // The stage: the first status headline on the page (the big one at the top), as a fixed label.
    for (const l of all) {
        if (!headline(l)) continue;
        const hit = FOOD_STAGES.find(([, re]) => re.test(l));
        if (hit) { info.stage = hit[0]; break; }
    }

    // The store: "Your order from Taco Palace", "Taco Palace is preparing…", or the page title.
    for (const l of [...all.filter(headline), title]) {
        const m = /\b(?:order|food|meal|delivery) from\s+(.+?)(?:\s+(?:is|has|will|was)\b.*)?$/i.exec(l)
            ?? /^(.+?)\s+(?:is (?:preparing|making|getting|working on)|has (?:started|accepted|confirmed)|accepted)\b/i.exec(l);
        const name = safeName(m?.[1]);
        if (name && !/^(your|the|a|an)$/i.test(name)) { info.store = name; break; }
    }

    // Placed: "Placed at 7:02 PM", "Ordered 7:02 PM", "Order placed · 7:02 PM".
    for (const l of all) {
        if (!/\b(placed|ordered|order time|submitted)\b/i.test(l) || !headline(l)) continue;
        const at = clockAt(l, now, "past");
        if (at) { info.placedAt = at; break; }
    }

    // Arriving: "Arriving at 7:45 PM", "Estimated arrival 7:40 – 7:50 PM", "Arrives in 12 min", "ETA 7:45".
    for (let i = 0; i < all.length; i++) {
        const l = all[i];
        if (!headline(l) || !/\b(arriv\w*|estimated|eta|deliver\w* (by|at|in|around)|expected|get it (by|in)|ready (by|at|in))\b/i.test(l)) continue;
        const near = `${l} ${all[i + 1] ?? ""}`;
        const range = /(\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?)\s*(?:–|—|-|to)\s*(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)/i.exec(near);
        if (range) {
            const ampm = /[ap]\.?m/i.exec(range[2])?.[0] ?? "";
            const from = clockAt(/[ap]\.?m/i.test(range[1]) ? range[1] : `${range[1]} ${ampm}`, now, "future");
            const to = clockAt(range[2], now, "future");
            if (from) { info.etaAt = from; if (to && to >= from) info.etaTo = to; break; }
        }
        const mins = /\b(\d{1,3})\s*(?:(?:–|—|-|to)\s*(\d{1,3})\s*)?min/i.exec(near);
        if (mins) {
            info.etaAt = now + Number(mins[1]) * 60_000;
            if (mins[2]) info.etaTo = now + Number(mins[2]) * 60_000;
            break;
        }
        const at = clockAt(near, now, "future");
        if (at) { info.etaAt = at; break; }
    }

    // The food: "1x Big Mac", "2 × Fries", "Big Mac x1", or plain "1 Big Mac" under an "Order details" heading.
    const items: string[] = [];
    let inOrder = false;
    for (const l of all) {
        if (/^(order (details|summary|items)|your (order|items)|items?|what you ordered|receipt)$/i.test(l)) { inOrder = true; continue; }
        if (inOrder && /^(subtotal|total|fees?|tax(es)?|tip|delivery fee|service fee|payment|promotions?)\b/i.test(l)) inOrder = false;
        let count = 0, name = "", m: RegExpExecArray | null;
        if ((m = /^(\d{1,2})\s*[x×]\s*(.+)$/i.exec(l))) [count, name] = [Number(m[1]), m[2]];
        else if ((m = /^(.+?)\s*[x×]\s*(\d{1,2})$/i.exec(l))) [count, name] = [Number(m[2]), m[1]];
        else if (inOrder && (m = /^(\d{1,2})\s+([A-Za-z].+)$/.exec(l))) [count, name] = [Number(m[1]), m[2]];
        if (!name) continue;
        const food = safeName(name.replace(/\s*[$£€]\s?\d.*$/, ""), 70);
        if (food && count > 0 && count < 50 && items.length < 30) items.push(count > 1 ? `${count} × ${food}` : food);
    }
    if (items.length) info.items = items;
    return info;
}

/* ── Parcels ── */

const PARCEL_STATUS: [ParcelStatus, RegExp][] = [
    ["delivered", /\b(delivered|was delivered|has been delivered|left at|handed to|signed for)\b/i],
    ["exception", /\b(exception|returned to sender|return(ing)? to sender|delivery attempt(ed)?|unable to deliver|undeliverable|lost|damaged|action required|held at|available for pickup)\b/i],
    ["delayed", /\b(delay(ed)?|running late|new (estimated )?delivery date|rescheduled|weather|later than expected)\b/i],
    ["out", /\b(out for delivery|on (the|its) vehicle for delivery|with (the )?(courier|driver) for delivery|arriving today)\b/i],
    ["transit", /\b(in transit|on (its|the) way|departed|arrived at|moving through|processed (at|through)|shipped|picked up|accepted at|in possession|on schedule|on track)\b/i],
    ["label", /\b(label (created|printed)|shipping label|pre-?shipment|awaiting (item|pickup|package)|information received|shipment information (sent|received)|order processed|ready (for|to) ship)\b/i],
];

export function readParcel(text: string, now = Date.now(), number?: string): ParcelInfo {
    let all = lines(text);
    // Start just before the tracking number: menus above it are full of words like "Redelivery" and "Returns".
    const at = number ? all.findIndex(l => l.replace(/\s/g, "").toUpperCase().includes(number)) : -1;
    if (at > 0) all = all.slice(Math.max(0, at - 3));
    const info: ParcelInfo = {};
    for (const l of all) {
        if (!headline(l)) continue;
        const hit = PARCEL_STATUS.find(([, re]) => re.test(l));
        if (hit) { info.status = hit[0]; break; }
    }
    for (let i = 0; i < all.length; i++) {
        const l = all[i];
        if (!headline(l)) continue;
        const near = `${l} ${all[i + 1] ?? ""} ${all[i + 2] ?? ""}`;
        if (info.status === "delivered" && !info.deliveredOn && /\bdelivered\b/i.test(l)) {
            const d = dayIn(near, now);
            if (d && d <= midnight(now)) info.deliveredOn = d;
        }
        if (!info.expected && /\b(expected|estimated|scheduled|arriv\w*|delivery (by|date|on|day)|get it|new delivery date|deliver(s|ed)? by|delivery expected|due)\b/i.test(l) && !/\bdelivered\b/i.test(l)) {
            const d = dayIn(near, now);
            if (d && d >= midnight(now) - 2 * DAY) info.expected = d;
        }
    }
    if (!info.status && all.some(l => /\b(tracking (is )?not available|not (yet )?(found|in (our|the) system)|could ?n.t find|invalid tracking|no (tracking )?(information|results|record))\b/i.test(l))) info.unknown = true;
    return info;
}

/** The page is a bot check or a "blocked" page rather than the tracking page. */
export function isBlocked(text: string, title: string) {
    return /just a moment|attention required|access denied|are you a (human|robot)|verify (that )?you are (a )?human|captcha|unusual traffic|request blocked|pardon our interruption/i.test(`${title}\n${text.slice(0, 3000)}`);
}
