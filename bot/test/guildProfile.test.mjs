/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { dashboardRequest, guildEvent } from "../dashboard.mjs";
import { maintainProfileBio, profileBio, readGuildProfile, syncProfileBio, writeGuildProfile } from "../guildProfile.mjs";
import { ACTOR, BOT, fixture, GUILD, OWNER, TARGET } from "./fixture.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const request = (path, actor = ACTOR, input, permissions = "") => new Request(`https://bot.example/dashboard/${path}${input ? "" : `?guild=${GUILD}`}`, { method: input ? "POST" : "GET", headers: { "X-Sonata-User": actor, "X-Sonata-Permissions": permissions }, body: input ? JSON.stringify(input) : undefined });
function profileFixture(t) {
    const f = fixture(t), user = { id: BOT, username: "Sonata", avatar: "0123456789abcdef0123456789abcdef", banner: "abcdef0123456789abcdef0123456789" };
    const api = async (route, options = {}) => {
        if (route === "/users/@me") return structuredClone(user);
        if (route === `/guilds/${GUILD}/members/@me` && options.method === "PATCH") {
            const value = await f.api(route, options), member = f.members.get(BOT);
            for (const key of ["avatar", "banner"]) if (typeof member[key] === "string" && member[key].startsWith("data:")) member[key] = "123456789abcdef0123456789abcdef0";
            return { ...value, ...structuredClone(member) };
        }
        return f.api(route, options);
    };
    guildEvent("GUILD_CREATE", f.guild, f.store);
    const bot = { store: f.store, api, env: { DASHBOARD_OWNER_IDS: OWNER }, session: { userId: BOT } };
    return { ...f, bot, user, profileApi: api };
}

test("Guild bios always include the dashboard, slash help and the current server prefix", () => {
    for (const prefix of [",", "!", "hello"]) {
        const bio = profileBio("a".repeat(100), prefix);
        assert.match(bio, /https:\/\/sonatabot.info/); assert(bio.includes("`/help` • " + "`" + prefix + "help`")); assert(bio.length <= 190);
    }
    assert.match(profileBio(""), /^Commands:/);
    assert.throws(() => profileBio("a".repeat(101)), /100 characters/);
    assert.throws(() => profileBio("hide\u202Efooter"), /control characters/);
});

test("Managers can save server nickname, images and bio without modifying the global account", async t => {
    const f = profileFixture(t);
    const result = await dashboardRequest(request("profile", ACTOR, { guild: GUILD, nickname: "Server helper", bio: "Our server bot.", avatar: PNG, banner: PNG }), f.bot);
    assert.equal(result.profile.name, "Server helper"); assert.equal(result.profile.editable, true);
    assert.match(result.profile.avatar, new RegExp(`/guilds/${GUILD}/users/${BOT}/avatars/`));
    assert.match(result.profile.banner, /\/banners\//); assert.match(result.profile.bio, /Our server bot/);
    assert.match(result.profile.bio, /Commands: `\/help` • `,help`/);
    const saved = f.store.get("SELECT data FROM guild_profiles WHERE guild=?", GUILD).data;
    assert(!saved.includes("data:image")); assert.equal(JSON.parse(saved).actor, ACTOR);
    assert(!f.calls.some(call => call.route === "/users/@me" && call.method === "PATCH"));
    assert.equal(f.user.username, "Sonata");
    await assert.rejects(dashboardRequest(request("profile", ACTOR, { guild: GUILD, nickname: "Again", bio: "" }), f.bot), /30 seconds/);
});

test("Server profiles require installed server access and Manage Server for writes", async t => {
    const f = profileFixture(t);
    await assert.rejects(dashboardRequest(request("profile", TARGET), f.bot), /server owner/);
    await assert.rejects(dashboardRequest(request("profile", ACTOR, { guild: "999999999999999999", nickname: "No", bio: "" }), f.bot), /installed/);
    f.store.saveSettings(GUILD, { ...f.store.settings(GUILD), dashboardAccess: { administrators: false, users: [TARGET] } });
    assert.equal((await dashboardRequest(request("profile", TARGET), f.bot)).profile.editable, false);
    await assert.rejects(dashboardRequest(request("profile", TARGET, { guild: GUILD, nickname: "No", bio: "" }), f.bot), /Manage Server/);
    await assert.rejects(dashboardRequest(request("owner/profile", ACTOR), f.bot), /bot owner/);
});

test("Profile validation rejects remote URLs, spoofed image types, oversized images and forged fields", async t => {
    const f = profileFixture(t), base = { guild: GUILD, nickname: "Sonata", bio: "" };
    for (const input of [{ ...base, avatar: "https://example.test/image.png" }, { ...base, banner: PNG.replace("image/png", "image/gif") }, { ...base, avatar: "data:image/png;base64," + "a".repeat(1_400_000) }, { ...base, actor: OWNER }, { ...base, nickname: "x".repeat(33) }, { ...base, bio: "x".repeat(101) }]) await assert.rejects(dashboardRequest(request("profile", ACTOR, input), f.bot));
    assert(!f.calls.some(call => call.method === "PATCH"));
});

test("Sonata administrators can preview and reset server profiles without server permissions", async t => {
    const f = profileFixture(t);
    await dashboardRequest(request("profile", ACTOR, { guild: GUILD, nickname: "Custom", bio: "Custom bio", avatar: PNG, banner: PNG }), f.bot);
    assert.equal((await dashboardRequest(request("owner/profile", OWNER), f.bot)).profile.name, "Custom");
    const result = await dashboardRequest(request("owner/profile", OWNER, { guild: GUILD, action: "reset" }), f.bot);
    assert.equal(result.profile.name, "Sonata"); assert.equal(result.profile.customAvatar, false); assert.equal(result.profile.customBanner, false);
    assert.match(result.profile.bio, /Commands: `\/help` • `,help`/); assert.equal(result.profile.updatedBy, OWNER);
    await assert.rejects(dashboardRequest(request("owner/profile", TARGET, { guild: GUILD, action: "reset" }, "servers"), f.bot), /bot owner/);
    assert.equal((await dashboardRequest(request("owner/profile", TARGET, undefined, "servers"), f.bot)).profile.name, "Sonata");
    assert.equal((await dashboardRequest(request("owner/profile", TARGET, { guild: GUILD, action: "reset" }, "serverAccess"), f.bot)).profile.name, "Sonata");
});

test("Prefix commands update the mandatory bio immediately and personal prefixes stay private", async t => {
    const f = profileFixture(t);
    await f.execute(",prefix set !"); assert.match(f.members.get(BOT).bio, /`\/help` • `!help`/);
    await f.execute(",prefix remove"); assert.match(f.members.get(BOT).bio, /`\/help` • `,help`/);
    await f.execute(",settings prefix ?"); assert.match(f.members.get(BOT).bio, /`\/help` • `\?help`/);
    const count = f.calls.filter(call => call.route.endsWith("/members/@me")).length;
    await f.execute(",prefix self $"); assert.equal(f.calls.filter(call => call.route.endsWith("/members/@me")).length, count);
});

test("Profile setup synchronizes once and records failures for a later retry", async t => {
    const f = profileFixture(t);
    await maintainProfileBio(f.store, async () => { throw Error("Discord refused"); }, GUILD);
    assert.match(JSON.parse(f.store.get("SELECT data FROM guild_profiles").data).error, /Discord refused/);
    await syncProfileBio(f.store, f.profileApi, GUILD);
    const count = f.calls.length; await syncProfileBio(f.store, f.profileApi, GUILD); assert.equal(f.calls.length, count);
    const profile = await readGuildProfile(f.store, f.profileApi, GUILD, BOT); assert.match(profile.avatar, /\/avatars\//);
    assert.equal(profile.error, "");
});

test("Changing one server's profile keeps other servers and the global profile unchanged", async t => {
    const f = profileFixture(t), other = "999999999999999999", calls = [];
    f.store.saveSettings(other, { prefix: "!" });
    const api = async (route, options) => { calls.push({ route, ...options }); return {}; };
    await writeGuildProfile(f.store, api, GUILD, ACTOR, { nickname: "First", bio: "First server" });
    await writeGuildProfile(f.store, api, other, ACTOR, { nickname: "Second", bio: "Second server" });
    assert.equal(calls[0].route, `/guilds/${GUILD}/members/@me`); assert.match(calls[0].body.bio, /,help/);
    assert.equal(calls[1].route, `/guilds/${other}/members/@me`); assert.match(calls[1].body.bio, /!help/);
    const rows = f.store.all("SELECT data FROM guild_profiles ORDER BY guild").map(row => JSON.parse(row.data).customBio);
    assert.deepEqual(rows, ["First server", "Second server"]);
});
