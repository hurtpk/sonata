/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Spotting fake links — for Roblox (Roblox Tools) and everything else (Scam
// Shield). No Discord or network in here, so it can be tested on its own.
//
// Each brand says which websites are really theirs, the name fakes copy, and
// what scammers say about it. A link is judged by the name someone actually
// registered (evil.net in roblox.com.evil.net), so subdomains like
// roblox.fandom.com and look-alike words like rolex.com stay quiet.

export type Level = "scam" | "suspicious" | "safe" | "other";
export interface Verdict {
    level: Level; url: string; host: string; reasons: string[];
    /** The real website, for "it's always …" tips. */
    home?: string; brand?: string;
    /** A link (default), something said with no link, a file, a QR code in a picture, or who sent it. */
    kind?: "link" | "text" | "file" | "qr" | "account";
}

export interface Brand {
    name: string;
    /** Its real address, like roblox.com. */
    home: string;
    /** Names fakes copy (compared after undoing tricks like 0→o). */
    words: string[];
    /** Its websites — and every address under them. */
    official: string[];
    /** Exact addresses of its own (like ro.blox.com). */
    officialHosts?: string[];
    /** A copy of the name on another ending (roblox.net) counts as a fake. */
    copyOtherEnding: boolean;
    /** Sites that only mention the name (robloxden.com): "suspicious" — or ignored unless the name looks scammy. */
    namedLevel: "suspicious" | "none";
    /** Its money in a website's name (robux, freenitro…) — always a scam. */
    money?: { name: RegExp; label: string; /** Where the real thing comes from. */ where?: string; };
    /** Other short names fakes use (rblx, rbx). */
    alt?: RegExp;
    community?: string[];
    /** Paths on its real website that are a trap when someone sends them to you. */
    traps?: [RegExp, string][];
    /** What scammers say about it. */
    talk: [RegExp, string][];
    /** The message is about this brand (so short links in it are worth checking). */
    context: RegExp;
}

const SCAMMY_NAME = /gift|free|giveaway|reward|promo|claim|login|signin|verify|bonus|premium|hack|gen|event|limited|bux|cash|earn|card|nitro|airdrop|wallet|support|secure|account|recovery|appeal/;

/* ── Reading addresses ── */

function distance(a: string, b: string) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
}

/** Undoes the usual tricks: 0→o, 1→l, rn→m, vv→w, cl→d, and dashes. */
const deTrick = (s: string) => s.toLowerCase().replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl(?=[^aeiou]|$)/g, "d").replace(/[0]/g, "o").replace(/[1!|]/g, "l").replace(/3/g, "e").replace(/5/g, "s").replace(/[-_.]/g, "");

/** "xn--rblox-g9a" → "rōblox": the letters a look-alike address really uses (RFC 3492). */
function punyDecode(label: string): string {
    if (!label.startsWith("xn--")) return label;
    const input = label.slice(4), base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    const out: number[] = [];
    const at = input.lastIndexOf("-");
    if (at > 0) for (let i = 0; i < at; i++) out.push(input.charCodeAt(i));
    let n = 128, bias = 72, i = 0;
    const digit = (c: number) => c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
    for (let idx = at > 0 ? at + 1 : 0; idx < input.length;) {
        const oldi = i;
        for (let w = 1, k = base; ; k += base) {
            if (idx >= input.length) return label;
            const d = digit(input.charCodeAt(idx++));
            i += d * w;
            const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
            if (d < t) break;
            w *= base - t;
        }
        const len = out.length + 1;
        let delta = i - oldi;
        delta = oldi === 0 ? Math.floor(delta / damp) : delta >> 1;
        delta += Math.floor(delta / len);
        let k = 0;
        for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
        bias = Math.floor(k + (base - tMin + 1) * delta / (delta + skew));
        n += Math.floor(i / len);
        i %= len;
        out.splice(i++, 0, n);
    }
    return String.fromCodePoint(...out);
}
/** Letters from other alphabets that look like ours (Cyrillic о, а, е, р, с, х, і…), and accents removed. */
const CONFUSABLE: Record<string, string> = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ӏ": "l", "ⅼ": "l", "ł": "l", "Ɩ": "l", "ı": "i", "ο": "o", "β": "b", "ь": "b", "Ь": "b", "в": "b", "κ": "k", "χ": "x", "ԁ": "d", "ѕ": "s", "т": "t", "м": "m", "н": "h", "ɡ": "g" };
const plainLetters = (s: string) => [...s.normalize("NFKD").replace(/\p{M}/gu, "")].map(c => CONFUSABLE[c] ?? c).join("");
const readable = (host: string) => host.split(".").map(l => plainLetters(punyDecode(l))).join(".");

const SECOND_LEVEL = new Set(["com", "co", "net", "org", "gov", "edu", "ac", "or", "ne", "go"]);
/** The part of an address someone actually registered: evil.net in roblox.com.evil.net. */
export function siteOf(host: string) {
    const p = host.split(".");
    return p.length >= 3 && SECOND_LEVEL.has(p[p.length - 2]) && p[p.length - 1].length === 2 ? p.slice(-3).join(".") : p.slice(-2).join(".");
}

const isOfficial = (b: Brand, host: string) => (b.officialHosts ?? []).includes(host) || b.official.some(d => host === d || host.endsWith("." + d));
const officialFor = (brands: Brand[], host: string) => brands.find(b => isOfficial(b, host));

/** How a website pretends to be a brand. */
function fakeKind(b: Brand, host: string): "copy" | "money" | "named" | null {
    const site = siteOf(host);
    if (b.community?.some(c => c === host || c === site) || isOfficial(b, host)) return null;
    const label = site.split(".")[0], plain = deTrick(label);
    if (b.money && b.money.name.test(plain)) return "money";
    for (const w of b.words) {
        // The name itself on another ending — or written with tricks (discorcl.gift), which is never innocent.
        if (plain === w) return b.copyOtherEnding || label !== w ? "copy" : null;
        // One letter off (rob1ox, dicord), or two with the same start and end (rolbox).
        const d = distance(plain, w);
        if (plain.length >= w.length - 1 && plain.length >= 5 && (d <= 1 || (d === 2 && plain.length >= 6 && plain[0] === w[0] && plain.at(-1) === w.at(-1)))) return "copy";
    }
    if (b.words.some(w => plain.includes(w)) || (b.alt && b.alt.test(plain))) return "named";
    return null;
}

export const talkIn = (text: string, brands: Brand[], extra: [RegExp, string][] = []) => [...new Set([...brands.flatMap(b => b.talk), ...extra].filter(([re]) => re.test(text)).map(([, why]) => why))];

/**
 * What a link really is, for these brands. `shown` is the link's visible text
 * (a masked link shows one address and goes to another); `context` is the
 * message around it; `extraTalk` are scam phrases that aren't about a brand.
 */
export function checkLinkFor(brands: Brand[], raw: string, shown = "", context = "", extraTalk: [RegExp, string][] = []): Verdict {
    const reasons: string[] = [];
    const talk = () => talkIn(context, brands, extraTalk);
    if (/^\s*javascript:/i.test(raw)) return { level: "scam", url: raw, host: "", reasons: ["It runs code in your browser instead of opening a page — never click these."] };
    let u: URL;
    try { u = new URL(raw.trim()); } catch { return { level: "other", url: raw, host: "", reasons }; }
    if (!/^https?:$/.test(u.protocol)) return { level: "other", url: raw, host: "", reasons };
    const host = u.hostname.toLowerCase().replace(/\.$/, "");

    // brand.com@evil.site — everything before @ is ignored; it really goes to evil.site.
    if (u.username || u.password) return { level: "scam", url: raw, host, reasons: [`It shows “${decodeURIComponent(u.username)}” first, but really goes to ${host}.`] };

    // The visible text names a website the link doesn't open.
    const shownHost = (() => { try { return new URL(/^https?:\/\//i.test(shown.trim()) ? shown.trim() : `https://${shown.trim()}`).hostname.toLowerCase(); } catch { return ""; } })();
    if (shown && /\.[a-z]{2,}/i.test(shown) && shownHost && shownHost !== host && !host.endsWith("." + shownHost)) {
        const pretends = brands.find(b => isOfficial(b, shownHost) || fakeKind(b, shownHost));
        if (pretends) {
            reasons.push(`The link says ${shownHost}, but it really opens ${host}.`);
            if (!officialFor(brands, host)) return { level: "scam", url: raw, host, reasons, home: pretends.home, brand: pretends.name };
        }
    }

    const mine = officialFor(brands, host);
    if (mine) {
        const trap = mine.traps?.find(([re]) => re.test(u.pathname));
        if (trap) return { level: "scam", url: raw, host, reasons: [trap[1]], home: mine.home, brand: mine.name };
        // A real page with scam talk around it still deserves a careful look.
        const words = talkIn(context, [mine]);
        return words.length ? { level: "suspicious", url: raw, host, reasons: words, home: mine.home, brand: mine.name } : { level: "safe", url: raw, host, reasons, home: mine.home, brand: mine.name };
    }

    if (host.startsWith("xn--") || host.includes(".xn--")) {
        const reads = readable(host);
        const b = brands.find(x => isOfficial(x, reads) || fakeKind(x, reads));
        if (b) return { level: "scam", url: raw, host, reasons: [`This address reads as “${reads}”, but it uses look-alike letters from other alphabets — it isn't ${b.name}'s website.`, ...talk()], home: b.home, brand: b.name };
        reasons.push("The address uses look-alike letters from other alphabets, which can make a fake site look real.");
        if (brands.some(x => x.context.test(context))) return { level: "scam", url: raw, host, reasons };
    }
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) reasons.push("It goes to a bare number address, not a website name — real websites almost never do.");

    const site = siteOf(host);
    for (const b of brands) {
        // roblox.com.evil.net — it only starts like the real thing.
        const real = b.home.replace(/\./g, "\\.");
        if (new RegExp(`^(?:www\\.|web\\.)?${real}\\.`).test(host)) {
            const rest = host.slice(host.indexOf(b.home) + b.home.length);
            return { level: "scam", url: raw, host, reasons: [`${host} isn't ${b.name} — it only starts with “${b.home}”. ${b.name}'s real address ends right there; this one carries on to “${rest}”.`, ...reasons, ...talk()], home: b.home, brand: b.name };
        }
        const kind = fakeKind(b, host);
        if (kind === "copy" || kind === "money") {
            const why = kind === "money"
                ? `${site} is a “${b.money!.label}” website — ${b.money!.where ?? `${b.name} only gives out ${b.money!.label} on ${b.home}`}, and sites offering it free are always scams.`
                : `${site} is made to look like ${b.home}, but it isn't ${b.name}'s website.`;
            return { level: "scam", url: raw, host, reasons: [why, ...reasons, ...talk()], home: b.home, brand: b.name };
        }
        if (kind === "named") {
            const scammy = SCAMMY_NAME.test(deTrick(site)) || talk().length > 0;
            if (!scammy && b.namedLevel === "none") continue;
            const why = scammy
                ? `${site} uses ${b.name}'s name to look official, but it isn't ${b.name} — names like this are used to steal accounts.`
                : `${site} has ${b.name} in its name, but it isn't ${b.name}'s website. Never log in there.`;
            return { level: scammy ? "scam" : "suspicious", url: raw, host, reasons: [why, ...reasons, ...talk()], home: b.home, brand: b.name };
        }
    }

    const words = talk();
    const about = brands.some(b => b.context.test(context));
    // Brand talk only counts in a message about that brand; the general scam phrases always do.
    if (words.length && (about || talkIn(context, [], extraTalk).length)) return { level: "suspicious", url: raw, host, reasons: [...reasons, ...words] };
    return { level: reasons.length && about ? "suspicious" : "other", url: raw, host, reasons };
}

/** Every link in a message's text — plain ones and [masked](ones). */
export function linksIn(text: string): { url: string; shown: string; }[] {
    const out: { url: string; shown: string; }[] = [];
    const masked = /\[([^\]]{1,200})\]\(\s*<?((?:https?|javascript):[^\s)>]+)>?\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = masked.exec(text))) out.push({ url: m[2], shown: m[1] });
    const rest = text.replace(masked, " ");
    for (const url of rest.match(/(?:https?:\/\/|javascript:)[^\s<>()"']+/gi) ?? []) out.push({ url: url.replace(/[.,!?;:)\]]+$/, ""), shown: "" });
    return out;
}

/* ── The brands ── */

export const ROBLOX: Brand = {
    name: "Roblox", home: "roblox.com", words: ["roblox"],
    official: ["roblox.com", "rbxcdn.com", "robloxlabs.com", "roblox.qq.com"], officialHosts: ["ro.blox.com"],
    copyOtherEnding: true, namedLevel: "suspicious",
    money: { name: /robux/, label: "Robux" }, alt: /^(?:rblx|rbx)/, community: ["noblox.js.org"],
    talk: [
        [/\bfree\s*robux|\brobux\s*(?:generator|gen\b|hack)|\bget\s+\d+k?\s*robux\b|claim\s+(?:your\s+)?(?:free\s+)?robux/i, "It promises free Robux — Roblox never gives Robux away through links."],
        [/\.?roblosecurity|roblox\s*cookie/i, "It talks about your .ROBLOSECURITY cookie — anyone with it can take over your account."],
        [/paste\s+(?:this|it|the\s+code)\s+(?:in|into)\s+(?:the\s+|your\s+)?(?:console|address\s*bar|url\s*bar|browser)|\bjavascript\s*:/i, "It asks you to paste code into your browser — that's how accounts get stolen."],
        [/(?:log\s*in|login|sign\s*in|verify\s+(?:your\s+)?(?:roblox\s+)?account)\s+(?:to|and)\s+(?:claim|get|receive|unlock)/i, "It asks you to log in to “claim” something — a classic fake login page."],
        [/\b(?:limited|item|robux)\s+giveaway\b.*\b(?:link|click)\b/i, "A giveaway that wants you to open a link."],
    ],
    context: /roblox|robux|\brbx\b|limited|bloxburg|adopt\s*me|blox\s*fruits|pet\s*sim|\btrade\b/i,
};

/** Things scammers say on Discord that are worth a warning even with no link. */
export const DISCORD_ALARMS: [RegExp, string][] = [
    [/^(?=[\s\S]*\bdiscord\s*(?:staff|team|support|trust\s*(?:&|and)?\s*safety|moderat\w*|admin)\b)(?=[\s\S]*\b(?:your|ur)\s+(?:discord\s+)?(?:account|acc)\b)(?=[\s\S]*\b(?:disabled?|ban(?:ned)?|terminat\w*|suspend\w*|reported|verif\w*|flagged|suspicious\s+activity)\b)/i, "Someone says they're Discord staff and something's wrong with your account — Discord never DMs you like that."],
    [/\bi\s*(?:accidentally|accidently|mistakenly)\s+reported\s+(?:you|ur|your)\b|\breported\s+(?:you|your\s+account)\s+by\s+(?:accident|mistake)\b/i, "“I accidentally reported you” is a well-known scam to get you to a fake “support” account."],
    [/\bscan\s+(?:this|the|my)\s+(?:qr(?:\s*code)?|code)\b[\s\S]{0,80}\b(?:nitro|verify|verified|claim|log\s*in|gift|role|access)\b|\bscan\s+(?:this|it)\s+(?:to|with\s+(?:your|the)\s+(?:phone|discord))\b/i, "It asks you to scan a QR code — scanning a Discord QR code with your phone logs whoever made it into your account."],
    [/\b(?:send|give|paste|dm)\s+(?:me\s+)?(?:your|ur)\s+(?:discord\s+)?token\b|\b(?:your|ur)\s+(?:discord\s+)?token\b[\s\S]{0,40}\b(?:send|give|paste|copy)\b/i, "It asks for your Discord token — that's the key to your account."],
];

export const DISCORD: Brand = {
    name: "Discord", home: "discord.com", words: ["discord", "discordapp"],
    official: ["discord.com", "discordapp.com", "discord.gg", "discord.gift", "discord.new", "discord.dev", "discord.media", "discordapp.net", "discordstatus.com", "discord.co", "discord.design", "discord.store", "dis.gd"],
    copyOtherEnding: false, namedLevel: "none",
    money: { name: /(?:free|gift|claim|get)nitro|nitro(?:gift|free|drop|claim|gen|boost)|discordnitro|nitrodiscord|discordgift|giftdiscord/, label: "Nitro", where: "real Nitro gifts only ever come as discord.gift links" },
    community: ["disboard.org", "discords.com", "discord.me", "discord.io", "discordjs.guide", "discord.js.org", "discordbotlist.com", "discordservers.com", "discordlist.gg", "discordhome.com", "discord.st", "discord.bio"],
    traps: [[/^\/ra\//, "This is a Discord login QR code link. Scanning or opening one logs SOMEONE ELSE into your account — real Discord never sends these to you."]],
    talk: [
        [/\bfree\s*(?:discord\s*)?nitro\b|\bnitro\s*(?:giveaway|for\s*free|generator|gen\b)|\b\d+\s*months?\s*(?:of\s*)?(?:free\s*)?nitro\b/i, "It promises free Nitro — real gifts are discord.gift links, and never need you to log in."],
        ...DISCORD_ALARMS,
    ],
    context: /discord|nitro|server\s*boost|\bdm\b/i,
};

export const STEAM: Brand = {
    name: "Steam", home: "steamcommunity.com", words: ["steamcommunity", "steampowered"],
    official: ["steamcommunity.com", "steampowered.com", "steamstatic.com", "steamgames.com", "steamusercontent.com", "valvesoftware.com", "steamchina.com", "steamdeck.com"], officialHosts: ["s.team"],
    copyOtherEnding: true, namedLevel: "none",
    talk: [
        [/\$\s?\d{2,3}\s*(?:steam|gift\s*card)|steam\s*(?:gift|wallet)\s*(?:card|code)?\b[\s\S]{0,60}\b(?:free|claim|giveaway|link)\b/i, "A free Steam gift that needs a link — Steam gifts arrive in your Steam inventory, not through links."],
        [/vote\s+for\s+(?:my|our)\s+team|(?:tournament|esports?)\s+vote/i, "“Vote for my team” links are fake Steam logins."],
    ],
    context: /steam|cs2|csgo|skins?|dota|tf2|valve/i,
};

export const EPIC: Brand = {
    name: "Epic Games", home: "epicgames.com", words: ["epicgames", "fortnite"],
    official: ["epicgames.com", "fortnite.com", "unrealengine.com", "epicgames.dev", "rocketleague.com", "fallguys.com"],
    copyOtherEnding: false, namedLevel: "none",
    money: { name: /vbucks|vbuck/, label: "V-Bucks" },
    talk: [[/\bfree\s*v-?bucks\b|v-?bucks\s*(?:generator|gen\b|hack)/i, "It promises free V-Bucks — Epic never gives them away through links."]],
    context: /fortnite|v-?bucks|epic\s*games/i,
};

export const PAYPAL: Brand = {
    name: "PayPal", home: "paypal.com", words: ["paypal"],
    official: ["paypal.com", "paypal.me", "paypalobjects.com", "paypal-community.com"],
    copyOtherEnding: true, namedLevel: "suspicious",
    talk: [[/(?:your\s+)?paypal\s+(?:account\s+)?(?:has\s+been\s+)?(?:limited|suspended|locked)/i, "It says your PayPal account is limited — PayPal tells you inside the PayPal app, not through Discord."]],
    context: /paypal|payment|refund/i,
};
