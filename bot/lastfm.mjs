/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { command, member, option, sub } from "./commandOptions.mjs";
import { embed, fail } from "./discord.mjs";

export const LASTFM_PERIODS = ["overall", "7day", "1month", "3month", "6month", "12month"];
const page = () => option("page", 4, "Result page, five entries per page", false, { min_value: 1, max_value: 100 });
const target = () => ({ ...member(), description: "Member whose saved Last.fm username to use", required: false });
export const LASTFM_COMMAND = command("fm", "Look up Last.fm listening activity and charts", 0n, [
    sub("set", "Save your public Last.fm username", [option("username", 3, "Your Last.fm username, not an API key", true, { max_length: 32 })]),
    sub("remove", "Remove your saved Last.fm username"),
    sub("view", "Show a member's saved Last.fm profile", [target()]),
    sub("now", "Show the current or most recently scrobbled track", [target()]),
    sub("recent", "Browse five recent Last.fm tracks", [target(), page()]),
    ...["topartists", "toptracks"].map(name => sub(name, name === "topartists" ? "Browse a member's most played artists" : "Browse a member's most played tracks", [option("period", 3, "Chart period, default overall", false, { choices: LASTFM_PERIODS.map(value => ({ name: value, value })) }), target(), page()])),
], ["lastfm", "topartists", "toptracks"]);

const username = value => {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,32}$/.test(value)) fail("Use a Last.fm username of up to 32 letters, numbers, underscores or hyphens, not a profile URL or API key.");
    return value;
};
const plain = (value, maximum = 100) => String(value ?? "").replace(/@/g, "＠").replace(/[\\`*_~|\[\]<>]/g, "\\$&").slice(0, maximum);
const count = value => /^\d{1,15}$/.test(String(value ?? "")) ? Number(value).toLocaleString("en-US") : "0";
const array = value => Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
const profile = name => `https://www.last.fm/user/${encodeURIComponent(name)}`;
function imageUrl(images) {
    for (const image of array(images).slice().reverse()) {
        try {
            const url = new URL(image["#text"]);
            if (url.protocol === "https:" && !url.username && !url.password && !url.port && ["lastfm.freetls.fastly.net", "lastfm-img2.akamaized.net", "userserve-ak.last.fm"].includes(url.hostname) && !url.pathname.includes("2a96cbd8b46e442fc41c2b86b821562f")) return url.href;
        } catch { continue; }
    }
}

export function lastfmClient(key, transport = fetch, now = Date.now) {
    const cache = new Map();
    let blockedUntil = 0;
    return async (method, user, period = "overall", page = 1) => {
        if (!/^[a-f0-9]{32}$/i.test(key ?? "")) fail("Last.fm is not configured on Sonata's host yet.");
        username(user);
        if (!["user.getInfo", "user.getRecentTracks", "user.getTopArtists", "user.getTopTracks"].includes(method) || !LASTFM_PERIODS.includes(period) || !Number.isInteger(page) || page < 1 || page > 100) fail("Choose a supported Last.fm lookup, period and page from 1 to 100.");
        const id = `${method}:${user.toLowerCase()}:${period}:${page}`, saved = cache.get(id);
        if (saved && saved.until > now()) return structuredClone(saved.data);
        if (blockedUntil > now()) fail("Last.fm is rate limiting requests. Try again in about 30 seconds.");
        const url = new URL("https://ws.audioscrobbler.com/2.0/");
        url.search = new URLSearchParams({ method, user, api_key: key, format: "json", limit: "5", page: String(page), ...(/^user.getTop/.test(method) ? { period } : {}) }).toString();
        let response, data;
        try {
            response = await transport(url, { headers: { "User-Agent": "Sonata/1.0 (https://sonatabot.info)", Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(8000) });
            if (Number(response.headers.get("content-length")) > 256 * 1024) { await response.body?.cancel(); throw Error("size"); }
            const chunks = []; let size = 0;
            if (response.body) for await (const chunk of response.body) { size += chunk.length; if (size > 256 * 1024) throw Error("size"); chunks.push(chunk); }
            const bytes = new Uint8Array(size); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            data = JSON.parse(new TextDecoder().decode(bytes));
        } catch { fail("Last.fm could not be reached or returned an unreadable response. Try again shortly."); }
        if (response.status === 429 || Number(data?.error) === 29) { blockedUntil = now() + 30_000; fail("Last.fm is rate limiting requests. Try again in about 30 seconds."); }
        if (Number(data?.error) === 6) fail("That Last.fm profile could not be found or its listening history is unavailable.");
        if ([10, 26].includes(Number(data?.error))) fail("Sonata's Last.fm API key needs attention on the host.");
        if (!response.ok || !data || typeof data !== "object" || data.error) fail("Last.fm could not supply this listening data. Try again later.");
        const field = { "user.getInfo": "user", "user.getRecentTracks": "recenttracks", "user.getTopArtists": "topartists", "user.getTopTracks": "toptracks" }[method];
        if (!data[field] || typeof data[field] !== "object") fail("Last.fm returned incomplete listening data. Try again later.");
        if (cache.size >= 128) cache.delete(cache.keys().next().value);
        cache.set(id, { data: structuredClone(data), until: now() + (method === "user.getRecentTracks" ? 30_000 : 300_000) });
        return data;
    };
}

export async function lastfmCommand(context, store, client) {
    const { command } = context, o = command.options, actor = command.actor;
    if (command.sub === "remove") {
        store.run("DELETE FROM lastfm_accounts WHERE user=?", actor);
        return embed("Last.fm removed", "Your saved Last.fm username was removed from Sonata. Your Last.fm account and listening history were kept.");
    }
    if (command.sub === "set") {
        const name = username(o.username), data = await client("user.getInfo", name), canonical = username(data.user.name);
        store.run("INSERT INTO lastfm_accounts (user,username) VALUES (?,?) ON CONFLICT(user) DO UPDATE SET username=excluded.username", actor, canonical);
        return embed("Last.fm saved", `[${plain(canonical)}](${profile(canonical)}) is now your saved public profile across Sonata servers. Use fm to see your latest track. This is a username preference, not verified account ownership. Use fm remove to unlink it.`);
    }
    const user = o.member ?? actor, saved = store.get("SELECT username FROM lastfm_accounts WHERE user=?", user);
    if (!saved) fail(user === actor ? "Save your Last.fm username first with fm set <username>." : "This member has not saved a Last.fm username in Sonata.");
    const name = username(saved.username);
    if (command.sub === "view") return embed("Last.fm profile", `<@${user}> · [${plain(name)}](${profile(name)})\nSaved username, not verified ownership.`);
    const method = { now: "user.getRecentTracks", recent: "user.getRecentTracks", topartists: "user.getTopArtists", toptracks: "user.getTopTracks" }[command.sub];
    if (!method) fail("Choose fm set, remove, view, now, recent, topartists or toptracks.");
    const data = await client(method, name, o.period ?? "overall", o.page ?? 1);
    const field = command.sub.startsWith("top") ? command.sub : "recenttracks", result = data[field], values = array(result[field === "topartists" ? "artist" : "track"]);
    const tracks = values.slice(0, command.sub === "now" ? 1 : 5), first = tracks[0];
    const response = embed(command.sub === "now" ? first?.["@attr"]?.nowplaying === "true" ? "Now playing" : "Last played" : command.sub === "recent" ? "Recent tracks" : command.sub === "topartists" ? "Top artists" : "Top tracks", "");
    const item = response.embeds[0];
    item.author = { name: `Last.fm · ${name}`, url: profile(name) };
    item.footer = { text: `Last.fm${command.sub.startsWith("top") ? ` • ${o.period ?? "overall"}` : ""}${command.sub === "now" ? " • Latest available scrobble" : ` • Page ${o.page ?? 1} of ${count(result["@attr"]?.totalPages || 1)} • 5 entries per page`}` };
    item.description = tracks.length ? tracks.map((track, i) => {
        const artist = typeof track.artist === "string" ? track.artist : track.artist?.name ?? track.artist?.["#text"];
        const stamp = Number(track.date?.uts), date = Number.isSafeInteger(stamp) && stamp > 0 && stamp < 253402300800 ? ` · <t:${stamp}:R>` : "";
        return command.sub === "now" ? `**${plain(track.name, 160)}**\n${plain(artist, 100)}${track.album?.["#text"] ? `\n${plain(track.album["#text"], 120)}` : ""}${date}\n\n[Open Last.fm profile](${profile(name)})` : `${((o.page ?? 1) - 1) * 5 + i + 1}. **${plain(track.name, 80)}**${field === "topartists" ? "" : ` · ${plain(artist, 60)}`}${command.sub.startsWith("top") ? ` · ${count(track.playcount)} plays` : track["@attr"]?.nowplaying === "true" ? " · Now playing" : date}`;
    }).join("\n\n") : "No listening data was returned for this page or period. Check the profile's Last.fm scrobbles and privacy settings.";
    const image = imageUrl(first?.image);
    if (image && command.sub === "now") item.thumbnail = { url: image };
    return response;
}
