/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Scam Shield looks for, beyond the brand look-alikes in the shared
// checker: IP loggers, crypto wallet tricks, "try my game" programs, and
// Discord scam lines (fake staff, QR logins, token grabs). No Discord in
// here, so it can be tested on its own.

import { Brand, checkLinkFor, DISCORD_ALARMS, siteOf, talkIn, Verdict } from "../../_shared/scam";

export const shield = { brands: () => [] as Brand[], ipLoggers: true, files: true };

/** Links that only exist to record your IP address (Grabify, IPLogger and the disguised names they hand out). */
const IP_LOGGERS = new Set([
    "grabify.link", "grabify.org", "grabify.icu", "iplogger.org", "iplogger.com", "iplogger.ru", "iplogger.co", "iplogger.info", "iplogger.cn",
    "2no.co", "yip.su", "iplis.ru", "ezstat.ru", "maper.info", "blasze.com", "blasze.tk", "ps3cfw.com", "lovebird.guru", "trulove.guru",
    "dateing.club", "otherhalf.life", "shrekis.life", "datasig.io", "datauth.io", "headshot.monster", "gaming-at-my.best", "progaming.monster",
    "yourmy.monster", "screenshare.host", "imageshare.best", "screenshot.best", "gamingfun.me", "catsnthing.com", "catsnthings.fun",
    "curiouscat.club", "joinmy.site", "fortnitechat.site", "fortnight.space", "freegiftcards.co", "stopify.co", "leancoding.co",
    "bmwforum.co", "spottyfly.com", "quickmessage.us", "youshouldclick.us", "crabrave.pw", "mypic.icu", "xda-developers.us",
]);
export const isIpLogger = (host: string) => IP_LOGGERS.has(host) || IP_LOGGERS.has(siteOf(host));

const TRY_GAME = /\b(?:try|test|play|check\s*out)\s+(?:out\s+)?(?:my|our)\s+(?:new\s+)?game\b|\b(?:beta\s*)?test(?:er)?s?\s+(?:for\s+)?(?:my|our)\s+(?:new\s+)?game\b/i;
const TRY_GAME_WHY = "“Try my game” is a well-known scam — the “game” is a program that steals your Discord account and saved passwords.";

/** Scam lines that aren't about one brand. */
export const GENERAL_TALK: [RegExp, string][] = [
    [/\b(?:seed|recovery|secret|mnemonic)\s*phrase\b|\bprivate\s*key\b|\b(?:12|24)\s*(?:or\s*24\s*)?words?\b[\s\S]{0,30}\bwallet\b/i, "It's about a wallet's seed phrase or private key — anyone with it can empty the wallet, and no real service ever asks for it."],
    [/\bconnect\s+(?:your\s+)?(?:crypto\s+)?wallet\b|\bwallet\s*connect\b|\bclaim\s+(?:your\s+)?(?:\w+\s+)?airdrop\b|\bfree\s+(?:crypto|nft|mint)\b|\bmint\s+(?:is\s+)?(?:live|now|free)\b/i, "It wants you to connect a crypto wallet to claim something — sites like that drain wallets."],
    [/\bdouble\s+your\s+(?:crypto|btc|bitcoin|eth|money|coins)\b|\bsend\s+(?:me\s+)?[\d.]*\s*(?:btc|eth|usdt|sol|bitcoin|ltc)\b[\s\S]{0,60}\b(?:back|double|twice|return)\b/i, "“Send some and get double back” is always a scam."],
    [TRY_GAME, TRY_GAME_WHY],
    ...DISCORD_ALARMS,
];

/** Programs — opening one runs it. */
const PROGRAM = /\.(exe|scr|bat|cmd|com|pif|vbs|vbe|jse|wsf|ps1|msi|msix|jar|lnk|hta|reg|cpl|apk)$/i;
const ARCHIVE = /\.(zip|rar|7z)$/i;

/** A warning for a file someone sent (or links to), if it's a program. */
export function fileWarning(name: string, url: string, context = ""): Verdict | null {
    if (!shield.files || !name) return null;
    const game = TRY_GAME.test(context);
    let host = "";
    try { host = new URL(url).hostname; } catch { }
    const ext = name.match(PROGRAM)?.[1];
    if (ext) return {
        kind: "file", level: game ? "scam" : "suspicious", url, host,
        reasons: [`${name} is a program (.${ext.toLowerCase()}) — opening it runs it on your computer, and programs sent in chat often steal accounts and passwords.`, ...(game ? [TRY_GAME_WHY] : [])],
    };
    if (game && ARCHIVE.test(name)) return {
        kind: "file", level: "suspicious", url, host,
        reasons: ["A zipped “game” — scammers hide account-stealing programs inside .zip and .rar files.", TRY_GAME_WHY],
    };
    return null;
}

/** What a link really is, for every brand Scam Shield watches. */
export function checkAny(raw: string, shown = "", context = ""): Verdict {
    let host = "", file = "";
    try { const u = new URL(raw.trim()); host = u.hostname.toLowerCase(); file = decodeURIComponent(u.pathname.split("/").pop() ?? ""); } catch { }
    if (shield.ipLoggers && host && isIpLogger(host)) return {
        level: "scam", url: raw, host,
        reasons: [`${siteOf(host)} is an IP logger — opening it gives whoever sent it your IP address and rough location, and often your device details.`, ...talkIn(context, [], GENERAL_TALK)],
    };
    const v = checkLinkFor(shield.brands(), raw, shown, context, GENERAL_TALK);
    if (v.level === "scam") return v;
    return fileWarning(file, raw, context) ?? v;
}

/** Scam lines in a message with no link to check — fake staff, QR codes, wallets, "try my game". */
export function talkWarning(text: string): Verdict | null {
    const reasons = talkIn(text, [], GENERAL_TALK);
    return reasons.length ? { kind: "text", level: "suspicious", url: "", host: "", reasons } : null;
}

/** Is it worth asking where short links in this message go? */
export const worthResolving = (text: string) => shield.brands().some(b => b.context.test(text)) || talkIn(text, [], GENERAL_TALK).length > 0;

/** When an account was made — it's written into every Discord ID. */
export const createdAt = (id: string) => Number((BigInt(id) >> 22n) + 1420070400000n);

/** A warning for links from an account made in the last `days` days. */
export function newAccountWarning(authorId: string, days = 7, now = Date.now()): Verdict | null {
    let age: number;
    try { age = now - createdAt(authorId); } catch { return null; }
    if (age < 0 || age > days * 86400_000) return null;
    const d = Math.floor(age / 86400_000);
    const when = d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
    return {
        kind: "account", level: "suspicious", url: "", host: "",
        reasons: [`This account was made ${when}. Scammers make new accounts after their old ones get banned — be careful with links from it, even if it says it's a friend's “new account”.`],
    };
}

/** What a QR code found in a picture means, if it's anything to worry about. */
export function qrWarning(text: string): Verdict | null {
    const t = text.trim();
    let u: URL;
    try { u = new URL(t); } catch { return null; }
    if (/(^|\.)discord(app)?\.com$/i.test(u.hostname) && /^\/ra\//.test(u.pathname)) return {
        kind: "qr", level: "scam", url: t, host: u.hostname,
        reasons: ["This picture is a Discord login QR code. Scanning it with the Discord app on your phone logs whoever sent it into YOUR account — it's the most common way accounts get stolen right now. Real Discord never sends you one."],
    };
    const v = checkAny(t);
    if (v.level !== "scam" && v.level !== "suspicious") return null;
    return { ...v, kind: "qr", reasons: [`The QR code in this picture leads to ${v.host || t}.`, ...v.reasons] };
}
