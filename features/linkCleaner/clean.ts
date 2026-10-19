/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Removes the tracking bits sites add to links (?si=, utm_…, fbclid…) and
// unwraps redirect links (google.com/url?q=…) to where they really go.
// Anything that changes what the link shows — a YouTube timestamp, a search
// query, a product ID — is kept.

/** Dropped from every link. */
const GLOBAL = [
    /^utm_/i, /^ga_/i, /^_ga$/i, /^_gl$/i, /^mc_(cid|eid)$/i, /^_hs(enc|mi)$/i, /^hsa_/i, /^oly_(anon|enc)_id$/i,
    /^(fbclid|gclid|gclsrc|dclid|msclkid|yclid|ttclid|twclid|li_fat_id|wickedid|epik|igshid|igsh|mkt_tok|vero_(id|conv)|s_cid|rb_clickid|_branch_match_id|_kx)$/i,
];

/** Dropped only on these sites (they mean something elsewhere). */
const PER_SITE: [RegExp, RegExp[]][] = [
    [/(^|\.)(youtube\.com|youtu\.be|music\.youtube\.com)$/, [/^(si|feature|pp|ab_channel|embeds_(referring_euri|referring_origin|widget_referrer))$/]],
    [/(^|\.)spotify\.com$/, [/^(si|context|nd|dl_branch|_branch_.*)$/]],
    [/(^|\.)(twitter\.com|x\.com|fxtwitter\.com|vxtwitter\.com|fixupx\.com)$/, [/^(s|t|ref_src|ref_url|src)$/]],
    [/(^|\.)instagram\.com$/, [/^(igsh|igshid|img_index|utm_.*)$/]],
    [/(^|\.)tiktok\.com$/, [/^(_r|_t|is_from_webapp|is_copy_url|sender_device|sender_web_id|share_app_id|share_link_id|share_item_id|social_sharing|source|tt_from|u_code|preview_pb|checksum|sec_user_id|timestamp|user_id|web_id|enable_checksum|refer|embed_source|lang)$/]],
    [/(^|\.)reddit\.com$/, [/^(share_id|rdt|context|ref|ref_source|ref_campaign|utm_.*)$/]],
    [/(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+)$/, [/^(ref|ref_|tag|pf_rd_.*|pd_rd_.*|smid|spIA|sp_csd|crid|sprefix|qid|sr|dib|dib_tag|content-id|linkCode|linkId|creativeASIN|ascsubtag|_encoding|social_share|starsLeft|skipTwisterOG|camp|creative)$/]],
    [/(^|\.)(aliexpress\.[a-z.]+)$/, [/^(spm|scm|pvid|algo_.*|aff_.*|sk|gatewayAdapt|_randl_.*|btsid|ws_ab_test|gps-id|scm_id|scm-url|pdp_npi|pdp_ext_f|sourceType|utparam|curPageLogUid)$/]],
    [/(^|\.)(ebay\.[a-z.]+)$/, [/^(_trkparms|_trksid|hash|itmprp|amdata|mkcid|mkrid|mkevt|campid|toolid|customid|siteid|ufes_redirect)$/]],
    [/(^|\.)linkedin\.com$/, [/^(trk|trkInfo|lipi|refId|trackingId|originalSubdomain|rcm|midToken|midSig|eid|otpToken|ssid|lgCta|lgTemp)$/]],
    [/(^|\.)facebook\.com$/, [/^(mibextid|sfnsn|__tn__|__cft__\[0\]|ref|rdid|share_url|eid|hc_ref|fref)$/]],
    [/(^|\.)(google\.[a-z.]+)$/, [/^(ved|ei|sa|usg|sxsrf|gs_lcp|gs_lcrp|sclient|oq|aqs|sourceid|uact|bih|biw|iflsig|gs_lp|gs_ssp|rlz|sca_esv|sca_upv|dpr|stick)$/]],
    [/(^|\.)bing\.com$/, [/^(form|sp|ghc|lq|pq|sc|qs|sk|cvid|ghsh|ghacc|ghpl|ver|ptn|hsh|psq)$/]],
    [/(^|\.)(soundcloud\.com)$/, [/^(si|utm_.*|ref|p|c)$/]],
    [/(^|\.)(twitch\.tv)$/, [/^(tt_medium|tt_content|sr)$/]],
    [/(^|\.)(medium\.com)$/, [/^(source|sk)$/]],
    [/(^|\.)(etsy\.com)$/, [/^(click_key|click_sum|ref|pro|frs|sts|ga_order|ga_search_type|ga_view_type|ga_search_query|organic_search_click|plkey|bes|ls|sr_prefetch|pf_from|pop|share_time)$/]],
];

/** Redirect wrappers: host, path, and the parameter that holds the real link. */
const REDIRECTS: [RegExp, RegExp, string][] = [
    [/(^|\.)google\.[a-z.]+$/, /^\/url$/, "q"],
    [/(^|\.)google\.[a-z.]+$/, /^\/url$/, "url"],
    [/^l\.facebook\.com$|^lm\.facebook\.com$/, /^\/l\.php$/, "u"],
    [/(^|\.)youtube\.com$/, /^\/redirect$/, "q"],
    [/^steamcommunity\.com$/, /^\/linkfilter\/?$/, "url"],
    [/^(out\.)?reddit\.com$/, /^\/?$/, "url"],
    [/^l\.instagram\.com$/, /^\/?$/, "u"],
    [/^href\.li$/, /.*/, ""],
    [/^t\.umblr\.com$/, /^\/redirect$/, "z"],
    [/^(www\.)?deviantart\.com$/, /^\/users\/outgoing$/, ""],
];

function unwrap(u: URL): URL {
    for (const [host, path, param] of REDIRECTS) {
        if (!host.test(u.hostname) || !path.test(u.pathname)) continue;
        const target = param ? u.searchParams.get(param) : decodeURIComponent(u.search.slice(1));
        if (!target) continue;
        try {
            const next = new URL(target);
            if (next.protocol === "http:" || next.protocol === "https:") return next;
        } catch { }
    }
    return u;
}

/** One link, cleaned. Returns the same string when there's nothing to remove. */
export function cleanUrl(raw: string): string {
    let original: URL;
    try { original = new URL(raw); } catch { return raw; }
    if (original.protocol !== "http:" && original.protocol !== "https:") return raw;
    const u = unwrap(original);
    const site = PER_SITE.filter(([h]) => h.test(u.hostname)).flatMap(([, rules]) => rules);
    const drop = [...GLOBAL, ...site];
    let changed = u !== original;
    for (const key of [...u.searchParams.keys()]) {
        if (drop.some(r => r.test(key))) { u.searchParams.delete(key); changed = true; }
    }
    // Amazon hides tracking in the path too: /dp/ID/ref=…
    if (/(^|\.)amazon\./.test(u.hostname)) {
        const p = u.pathname.replace(/\/ref=[^/]*$/, "");
        if (p !== u.pathname) { u.pathname = p; changed = true; }
    }
    if (!changed) return raw;
    let out = u.href;
    // Don't leave a dangling "?" or "#" behind.
    if (out.endsWith("?")) out = out.slice(0, -1);
    // Keep the original's lack of a trailing slash on bare domains ("https://site.com").
    if (!/\/$/.test(raw.split(/[?#]/)[0]) && u.pathname === "/" && !u.search && !u.hash) out = out.replace(/\/$/, "");
    return out;
}

// Links in text, but not inside `code` or ```code blocks```. Stops before trailing punctuation.
const URL_RE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?*_~)\]]/g;

/** Cleans every link in a message. Returns the new text and how many links changed. */
export function cleanText(text: string): { text: string; count: number; } {
    let count = 0;
    const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/);
    const out = parts.map((part, i) => {
        if (i % 2) return part; // code
        return part.replace(URL_RE, m => {
            const c = cleanUrl(m);
            if (c !== m) count++;
            return c;
        });
    }).join("");
    return { text: out, count };
}
