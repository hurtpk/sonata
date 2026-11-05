/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parsePrefix, parseSlash, slashCommands } from "../commands.mjs";
import { lastfmClient } from "../lastfm.mjs";
import { executeCommand } from "../moderation.mjs";
import { ACTOR, BOT, fixture, TARGET } from "./fixture.mjs";

const key = "a".repeat(32);
const info = { user: { name: "RJ" } };
const recent = { recenttracks: { track: [{ name: "One", artist: { "#text": "Artist" }, album: { "#text": "Album" }, "@attr": { nowplaying: "true" } }], "@attr": { totalPages: "2" } } };
const clientFor = (data = info) => lastfmClient(key, async () => Response.json(data));
const run = (f, text, client = clientFor(), actor = ACTOR) => executeCommand(f.command(text, actor), f.store, f.api, BOT, undefined, client);

test("Last.fm aliases agree with slash forms and the slash catalogue fits Discord", () => {
    assert.equal(parsePrefix(",fm", ",").sub, "now");
    assert.equal(parsePrefix(",lastfm", ",").name, "fm");
    assert.equal(parsePrefix(",topartists 7day", ",").options.period, "7day");
    assert.equal(parsePrefix(`,toptracks <@${TARGET}>`, ",").options.member, TARGET);
    assert.equal(parsePrefix(`,toptracks <@${TARGET}>`, ",").options.period, "overall");
    assert.deepEqual(parsePrefix(",fm set rj", ",").options, parseSlash({ name: "fm", options: [{ name: "set", options: [{ name: "username", value: "rj" }] }] }).options);
    assert.ok(slashCommands().some(command => command.name === "fm"));
    assert.ok(slashCommands().length <= 100);
    for (const [sub, name] of [["view", "serverinfo"], ["icon", "servericon"], ["banner", "serverbanner"], ["boosts", "boosts"]]) {
        assert.equal(parseSlash({ name: "serverinfo", options: [{ name: sub, type: 1 }] }).name, name);
        assert.equal(parsePrefix(`,${name}`, ",").name, name);
    }
});

test("Linking validates the remote profile, persists a global preference and removes only the actor", async t => {
    const f = fixture(t);
    await run(f, ",fm set rj");
    assert.equal(f.store.get("SELECT username FROM lastfm_accounts WHERE user=?", ACTOR).username, "RJ");
    await run(f, ",fm set other", clientFor({ user: { name: "other" } }), TARGET);
    await assert.rejects(run(f, ",fm set nope", lastfmClient(key, async () => Response.json({ error: 6 }))), /could not be found/);
    assert.equal(f.store.get("SELECT username FROM lastfm_accounts WHERE user=?", ACTOR).username, "RJ");
    const view = await run(f, `,fm view ${TARGET}`);
    assert.match(view.embeds[0].description, /other/);
    await run(f, ",fm remove");
    assert.equal(f.store.get("SELECT username FROM lastfm_accounts WHERE user=?", ACTOR), undefined);
    assert.equal(f.store.get("SELECT username FROM lastfm_accounts WHERE user=?", TARGET).username, "other");
});

test("Ordinary members can use Last.fm but disabled commands remain enforced", async t => {
    const f = fixture(t); f.members.get(ACTOR).roles = [];
    await run(f, ",fm set rj");
    f.store.saveSettings(f.guild.id, { ...f.store.settings(f.guild.id), disabledCommands: ["fm"] });
    await assert.rejects(run(f, ",fm now", clientFor(recent)), /disabled/);
});

test("Current, last-played, empty and recent results are rendered without fabricated activity", async t => {
    const f = fixture(t); await run(f, ",fm set rj");
    const current = await run(f, ",fm", clientFor(recent));
    assert.equal(current.embeds[0].title, "Now playing");
    assert.match(current.embeds[0].description, /One/);
    assert.equal(current.embeds[0].author.url, "https://www.last.fm/user/RJ");
    const old = structuredClone(recent); delete old.recenttracks.track[0]["@attr"]; old.recenttracks.track[0].date = { uts: "1700000000" };
    assert.equal((await run(f, ",fm now", clientFor(old))).embeds[0].title, "Last played");
    const empty = await run(f, ",fm recent", clientFor({ recenttracks: { track: [], "@attr": { totalPages: "0" } } }));
    assert.match(empty.embeds[0].description, /No listening data/);
    await assert.rejects(run(f, `,fm now ${TARGET}`, clientFor(recent)), /has not saved/);
});

test("Top charts honor selected period, member, page, play counts and five-entry page size", async t => {
    const f = fixture(t); await run(f, ",fm set rj"); const requests = [];
    const client = lastfmClient(key, async raw => {
        const url = new URL(raw); requests.push(url);
        const field = url.searchParams.get("method") === "user.getTopArtists" ? "topartists" : "toptracks";
        return Response.json({ [field]: { [field === "topartists" ? "artist" : "track"]: Array.from({ length: 8 }, (_, i) => ({ name: "Item " + i, artist: { name: "Artist" }, playcount: "1234" })), "@attr": { totalPages: "5" } } });
    });
    const artists = await run(f, ",topartists 7day", client);
    assert.match(artists.embeds[0].description, /1,234 plays/);
    assert.ok(!artists.embeds[0].description.includes("Item 5"));
    assert.equal(requests[0].searchParams.get("period"), "7day");
    assert.equal(requests[0].searchParams.get("limit"), "5");
    const tracks = await run(f, ",toptracks 1month 2", client);
    assert.match(tracks.embeds[0].description, /^6\./);
    assert.equal(requests[1].searchParams.get("page"), "2");
});

test("Lookups cache bounded data, expire recent results and use identifiable requests", async () => {
    let time = 1000, calls = 0;
    const client = lastfmClient(key, async (raw, options) => {
        calls++; assert.equal(new URL(raw).hostname, "ws.audioscrobbler.com");
        assert.match(options.headers["User-Agent"], /Sonata/); assert.equal(options.redirect, "error"); assert.ok(options.signal);
        return Response.json(recent);
    }, () => time);
    const first = await client("user.getRecentTracks", "rj"); first.recenttracks.track[0].name = "Changed";
    assert.equal((await client("user.getRecentTracks", "RJ")).recenttracks.track[0].name, "One"); assert.equal(calls, 1);
    time += 30_001; await client("user.getRecentTracks", "rj"); assert.equal(calls, 2);
});

test("Rate limits back off, provider failures do not expose credentials, and invalid inputs never fetch", async () => {
    let calls = 0;
    const limited = lastfmClient(key, async () => { calls++; return Response.json({ error: 29 }, { status: 429 }); });
    await assert.rejects(limited("user.getInfo", "rj"), /rate limiting/);
    await assert.rejects(limited("user.getInfo", "rj"), /rate limiting/); assert.equal(calls, 1);
    for (const response of [Response.json({ error: 10, message: key }), new Response("bad"), new Response("x".repeat(256 * 1024 + 1)), Response.json({})]) {
        const client = lastfmClient(key, async () => response);
        await assert.rejects(client("user.getInfo", "rj"), error => !error.message.includes(key));
    }
    const client = lastfmClient(key, async () => { throw Error("must not fetch"); });
    for (const [method, name, period, page] of [["other", "rj"], ["user.getInfo", "https://bad"], ["user.getTopArtists", "rj", "bad"], ["user.getRecentTracks", "rj", "overall", 101]]) await assert.rejects(client(method, name, period, page), /Use a Last.fm|Choose a supported/);
});
