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
const period = () => option("period", 3, "Chart period, default overall", false, { choices: LASTFM_PERIODS.map(value => ({ name: value, value })) });
const artist = () => option("artist", 3, "Artist name, quote multiple words in prefix commands", true, { max_length: 100 });
export const LASTFM_COMMAND = command("fm", "Look up Last.fm listening activity and charts", 0n, [
    sub("set", "Save your public Last.fm username", [option("username", 3, "Your Last.fm username, not an API key", true, { max_length: 32 })]),
    sub("remove", "Remove your saved Last.fm username"),
    sub("view", "Show a member's saved Last.fm profile", [target()]),
    sub("now", "Show the current or most recently scrobbled track", [target()]),
    sub("recent", "Browse five recent Last.fm tracks", [target(), page()]),
    ...["topartists", "toptracks", "topalbums"].map(name => sub(name, "Browse a member's most played " + name.slice(3), [period(), target(), page()])),
    sub("compare", "Compare your top artists with another member", [member(), period()]),
    sub("album", "Show Last.fm listeners and personal play counts for an album", [artist(), option("album", 3, "Album name, quote multiple words before a member argument", true, { max_length: 100 }), target()]),
    sub("whoknows", "Rank participating members by plays for an artist", [artist()]),
    sub("participate", "Join or leave this server's Last.fm artist rankings", [option("enabled", 5, "Show your public artist play counts in this server")]),
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
    return async (method, user, period = "overall", page = 1, { limit = 5, artist, album } = {}) => {
        if (!/^[a-f0-9]{32}$/i.test(key ?? "")) fail("Last.fm is not configured on Sonata's host yet.");
        username(user);
        const field = { "user.getInfo": "user", "user.getRecentTracks": "recenttracks", "user.getTopArtists": "topartists", "user.getTopTracks": "toptracks", "user.getTopAlbums": "topalbums", "artist.getInfo": "artist", "album.getInfo": "album" }[method];
        const info = ["artist.getInfo", "album.getInfo"].includes(method);
        if (typeof field !== "string" || !LASTFM_PERIODS.includes(period) || !Number.isInteger(page) || page < 1 || page > 100 || !Number.isInteger(limit) || limit < 1 || limit > 50 || (info && (!artist?.trim() || artist.length > 100)) || (method === "album.getInfo" && (!album?.trim() || album.length > 100))) fail("Choose a supported Last.fm lookup and valid artist, album or chart options.");
        const id = JSON.stringify([method, user.toLowerCase(), period, page, limit, artist?.toLowerCase(), album?.toLowerCase()]), saved = cache.get(id);
        if (saved && saved.until > now()) return structuredClone(saved.data);
        if (blockedUntil > now()) fail("Last.fm is rate limiting requests. Try again in about 30 seconds.");
        const url = new URL("https://ws.audioscrobbler.com/2.0/");
        url.search = new URLSearchParams({ method, api_key: key, format: "json", ...(info ? { username: user, artist, autocorrect: "1", ...(album ? { album } : {}) } : { user, limit: String(limit), page: String(page), ...(/^user.getTop/.test(method) ? { period } : {}) }) }).toString();
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
        store.run("DELETE FROM lastfm_guilds WHERE user=?", actor);
        return embed("Last.fm removed", "Your saved Last.fm username was removed from Sonata. Your Last.fm account and listening history were kept.");
    }
    if (command.sub === "participate") {
        if (!o.enabled) {
            store.run("DELETE FROM lastfm_guilds WHERE guild=? AND user=?", command.guild, actor);
            return embed("Artist rankings disabled", "Your profile is no longer included in this server's rankings.");
        }
        if (!store.get("SELECT username FROM lastfm_accounts WHERE user=?", actor)) fail("Save your Last.fm username first with fm set.");
        if (!store.get("SELECT user FROM lastfm_guilds WHERE guild=? AND user=?", command.guild, actor) && store.get("SELECT COUNT(*) AS n FROM lastfm_guilds WHERE guild=?", command.guild).n >= 20) fail("This server already has 20 ranking participants.");
        store.run("INSERT OR IGNORE INTO lastfm_guilds VALUES (?,?)", command.guild, actor);
        return embed("Artist rankings enabled", "Your public Last.fm artist play counts can now appear in this server's rankings. Use fm participate off to leave.");
    }
    if (command.sub === "whoknows") {
        const participants = store.all("SELECT lastfm_guilds.user,lastfm_accounts.username FROM lastfm_guilds JOIN lastfm_accounts USING(user) WHERE guild=? ORDER BY user LIMIT 20", command.guild), ranks = [];
        let unavailable = 0;
        for (let offset = 0; offset < participants.length; offset += 4) await Promise.all(participants.slice(offset, offset + 4).map(async row => {
            try {
                if (!await context.api(`/guilds/${command.guild}/members/${row.user}`, { optional: true })) { store.run("DELETE FROM lastfm_guilds WHERE guild=? AND user=?", command.guild, row.user); return; }
                const data = await client("artist.getInfo", row.username, "overall", 1, { artist: o.artist });
                const plays = Number(data.artist.stats?.userplaycount);
                if (Number.isSafeInteger(plays) && plays > 0 && store.get("SELECT user FROM lastfm_guilds WHERE guild=? AND user=?", command.guild, row.user)) ranks.push({ user: row.user, plays });
            } catch { unavailable++; }
        }));
        ranks.sort((a, b) => b.plays - a.plays || a.user.localeCompare(b.user));
        return embed(`Who knows ${plain(o.artist)}?`, (ranks.slice(0, 10).map((row, i) => `${i + 1}. <@${row.user}> · ${count(row.plays)} plays`).join("\n") || "No participating members have plays available for this artist.") + `\n\nPublic Last.fm counts from this server's opt-in members.${unavailable ? ` ${unavailable} lookups were unavailable.` : ""} Use fm participate on to join.`);
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
    if (command.sub === "compare") {
        const mine = store.get("SELECT username FROM lastfm_accounts WHERE user=?", actor);
        if (!mine) fail("Save your Last.fm username first with fm set.");
        const [left, right] = await Promise.all([mine.username, name].map(value => client("user.getTopArtists", value, o.period ?? "overall", 1, { limit: 50 })));
        const chart = data => new Map(array(data.topartists.artist).slice(0, 50).filter(entry => entry.name).map(entry => [entry.name.toLowerCase(), entry.name]));
        const a = chart(left), b = chart(right), shared = [...a.keys()].filter(key => b.has(key)), total = a.size + b.size - shared.length;
        return embed("Last.fm taste comparison", `<@${actor}> and <@${user}> · ${o.period ?? "overall"}\n${total ? `${Math.round(shared.length * 100 / total)}% overlap · ${shared.length} shared artists` : "No chart data to compare."}\n\n${shared.slice(0, 10).map(key => plain(a.get(key))).join(", ") || "No shared artists in these charts."}\n\nCompares up to 50 top artists per person.`);
    }
    if (command.sub === "album") {
        const { album } = await client("album.getInfo", name, "overall", 1, { artist: o.artist, album: o.album });
        const reply = embed(`${plain(album.artist)} · ${plain(album.name)}`, `<@${user}>: **${count(album.userplaycount)} plays**\nLast.fm: ${count(album.listeners)} listeners · ${count(album.playcount)} plays\n[Open album on Last.fm](https://www.last.fm/music/${encodeURIComponent(album.artist)}/${encodeURIComponent(album.name)})`);
        const image = imageUrl(album.image); if (image) reply.embeds[0].thumbnail = { url: image };
        return reply;
    }
    const method = { now: "user.getRecentTracks", recent: "user.getRecentTracks", topartists: "user.getTopArtists", toptracks: "user.getTopTracks", topalbums: "user.getTopAlbums" }[command.sub];
    if (!method) fail("Choose an available Last.fm command.");
    const data = await client(method, name, o.period ?? "overall", o.page ?? 1);
    const field = command.sub.startsWith("top") ? command.sub : "recenttracks", result = data[field], values = array(result[{ topartists: "artist", topalbums: "album" }[field] ?? "track"]);
    const tracks = values.slice(0, command.sub === "now" ? 1 : 5), first = tracks[0];
    const response = embed(command.sub === "now" ? first?.["@attr"]?.nowplaying === "true" ? "Now playing" : "Last played" : { recent: "Recent tracks", topartists: "Top artists", toptracks: "Top tracks", topalbums: "Top albums" }[command.sub], "");
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
