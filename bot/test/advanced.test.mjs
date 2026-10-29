/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { parsePrefix, parseSlash } from "../commands.mjs";
import { PERMS } from "../discord.mjs";
import { honeypotEvent } from "../honeypot.mjs";
import { readDiscordFile } from "../media.mjs";
import { executeCommand, perform } from "../moderation.mjs";
import { voiceRoomEvent } from "../voiceRooms.mjs";
import { ACTOR, BOT, BOTROLE, CHANNEL, fixture, full, GUILD, MODROLE, TARGET, USERROLE } from "./fixture.mjs";

const LOBBY = "999999999999999991", CATEGORY = "999999999999999992", STICKER = "999999999999999993";
const file = { url: "https://cdn.discordapp.com/attachments/111/222/image.png", filename: "image.png", size: 32, content_type: "image/png" };
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const attach = (f, content) => executeCommand({ ...f.command(",ping"), ...parsePrefix(content, ",", [file]) }, f.store, f.api, BOT);
const trapMessage = (id = "100000000000000901") => ({ id, guild_id: GUILD, channel_id: CHANNEL, author: { id: TARGET } });

test("Prefix defaults and personal/server updates enforce separate permissions", async t => {
    const f = fixture(t); assert.equal(parsePrefix(",prefix", ",").sub, "view");
    await f.execute(",prefix set !"); assert.equal(f.store.settings(GUILD).prefix, "!");
    await f.execute(",prefix remove"); assert.equal(f.store.settings(GUILD).prefix, ",");
    f.roles.find(role => role.id === MODROLE).permissions = PERMS.VIEW.toString();
    await assert.rejects(f.execute(",prefix set ?"), /permissions/);
    await f.execute(",prefix self ??"); assert.equal(f.store.get("SELECT prefix FROM user_prefixes WHERE user=?", ACTOR).prefix, "??");
    await f.execute(",prefix selfclear"); assert.equal(f.store.get("SELECT prefix FROM user_prefixes WHERE user=?", ACTOR), undefined);
    await assert.rejects(f.execute(",prefix self /"), /one to five/);
});

test("Honeypots require administration, exempt staff and deduplicate actions", async t => {
    const f = fixture(t); await assert.rejects(f.execute(`,honeypot add ${CHANNEL} timeout`), /permissions/);
    f.roles.find(role => role.id === MODROLE).permissions = (full | PERMS.ADMIN).toString();
    await f.execute(`,honeypot add ${CHANNEL} timeout`);
    await honeypotEvent(trapMessage(), f.store, f.api, BOT, perform);
    assert(f.members.get(TARGET).communication_disabled_until); assert.equal(f.store.case(GUILD, 1).kind, "honeypot timeout");
    await honeypotEvent(trapMessage(), f.store, f.api, BOT, perform); assert.equal(f.store.all("SELECT * FROM cases").length, 1);
    f.roles.find(role => role.id === USERROLE).permissions = PERMS.MESSAGES.toString();
    await honeypotEvent(trapMessage("100000000000000902"), f.store, f.api, BOT, perform); assert.equal(f.store.all("SELECT * FROM cases").length, 1);
});

test("Honeypot exemptions and removal are effective immediately", async t => {
    const f = fixture(t); f.roles.find(role => role.id === MODROLE).permissions = (full | PERMS.ADMIN).toString();
    await f.execute(`,honeypot add ${CHANNEL} ban`); await f.execute(`,honeypot exempt ${USERROLE} on`);
    await honeypotEvent(trapMessage(), f.store, f.api, BOT, perform); assert.equal(f.bans.size, 0);
    await f.execute(`,honeypot exempt ${USERROLE} off`); await honeypotEvent(trapMessage(), f.store, f.api, BOT, perform); assert(f.bans.has(TARGET));
    await f.execute(`,honeypot remove ${CHANNEL}`); assert.equal(Object.keys(f.store.settings(GUILD).honeypots).length, 0);
});

test("Downloads reject foreign origins, credentials, redirects and oversized streams", async () => {
    for (const url of ["http://cdn.discordapp.com/attachments/a", "https://127.0.0.1/attachments/a", "https://example.com/attachments/a", "https://user:pass@cdn.discordapp.com/attachments/a"]) await assert.rejects(readDiscordFile(url, 8, () => assert.fail("Unsafe URL was fetched")));
    await assert.rejects(readDiscordFile(file.url, 8, async () => new Response(null, { status: 302, headers: { Location: "https://example.com" } })), /could not provide/);
    await assert.rejects(readDiscordFile(file.url, 8, async () => new Response(png)), /size limit/);
    assert.equal((await readDiscordFile(file.url, 32, async () => new Response(png))).mime, "image/png");
});

test("Emoji and sticker imports use bounded public CDN files and native permissions", async t => {
    const f = fixture(t); t.mock.method(globalThis, "fetch", async () => new Response(png));
    await f.execute(`,emoji steal <:happy:${TARGET}> copied`); assert.equal(f.emojis[0].name, "copied");
    await attach(f, ",emoji add attached"); assert.equal(f.emojis[1].name, "attached");
    await f.execute(`,emoji rename ${f.emojis[0].id} renamed`); assert.equal(f.emojis[0].name, "renamed");
    f.stickers.push({ id: STICKER, name: "source", format_type: 1 });
    await f.execute(`,sticker steal ${STICKER} copied`); assert.equal(f.stickers.at(-1).name, "copied");
    await attach(f, ",sticker add attached"); assert.equal(f.stickers.at(-1).name, "attached");
    await f.execute(`,sticker remove ${f.stickers.at(-1).id}`);
    f.roles.find(role => role.id === MODROLE).permissions = PERMS.VIEW.toString();
    await assert.rejects(f.execute(`,emoji steal ${TARGET}`), /Create Expressions/);
    const slash = parseSlash({ name: "emoji", options: [{ name: "add", options: [{ name: "file", type: 11, value: TARGET }, { name: "name", value: "test" }] }] }, { [TARGET]: file });
    assert.equal(slash.options.file, file);
});

test("Message file download checks source access and reuploads as an attachment", async t => {
    const f = fixture(t); t.mock.method(globalThis, "fetch", async () => new Response(png));
    f.messages.push({ id: TARGET, attachments: [file] });
    await f.execute(`,download message ${TARGET}`);
    const posted = f.calls.find(call => call.method === "POST" && call.form); assert(posted.form.get("files[0]") instanceof Blob);
    f.channels[0].permission_overwrites.push({ id: ACTOR, type: 1, allow: "0", deny: PERMS.HISTORY.toString() });
    await assert.rejects(f.execute(`,download message ${TARGET}`), /permissions/);
});

test("VoiceMaster creates a scoped room, applies controls, and deletes only an empty managed room", async t => {
    const f = fixture(t), cooldowns = new Map();
    f.channels.push({ id: LOBBY, type: 2, guild_id: GUILD, permission_overwrites: [] }, { id: CATEGORY, type: 4, guild_id: GUILD, permission_overwrites: [] });
    await f.execute(`,voicemaster setup ${LOBBY} ${CATEGORY}`);
    f.voiceStates.set(ACTOR, { user_id: ACTOR, channel_id: LOBBY });
    await voiceRoomEvent("VOICE_STATE_UPDATE", { guild_id: GUILD, user_id: ACTOR, channel_id: LOBBY }, f.store, f.api, BOT, cooldowns);
    const row = f.store.get("SELECT * FROM voice_rooms WHERE owner=?", ACTOR); assert(row);
    assert.equal(f.members.get(ACTOR).channel_id, row.channel);
    await f.execute(",voicemaster name Private room"); assert.equal(f.channels.find(channel => channel.id === row.channel).name, "Private room");
    await f.execute(",voicemaster limit 4"); assert.equal(f.channels.find(channel => channel.id === row.channel).user_limit, 4);
    await f.execute(",voicemaster lock"); await f.execute(",voicemaster unlock");
    await f.execute(`,voicemaster permit ${TARGET}`); await f.execute(",voicemaster reset");
    await assert.rejects(f.execute(",voicemaster bitrate 384"), /96 kbps/);
    await voiceRoomEvent("VOICE_STATE_UPDATE", { guild_id: GUILD, user_id: ACTOR, channel_id: null }, f.store, f.api, BOT, cooldowns);
    assert.equal(f.store.get("SELECT * FROM voice_rooms WHERE channel=?", row.channel), undefined);
    assert(f.channels.some(channel => channel.id === LOBBY)); assert(!f.channels.some(channel => channel.id === row.channel));
});

test("VoiceMaster ownership cannot change while the owner is present and ignores partial guild snapshots", async t => {
    const f = fixture(t); const room = { id: STICKER, type: 2, guild_id: GUILD, name: "Room", permission_overwrites: [] }; f.channels.push(room);
    f.store.run("INSERT INTO voice_rooms VALUES (?,?,?,?)", GUILD, STICKER, TARGET, JSON.stringify({ members: [ACTOR, TARGET], changes: [] }));
    f.voiceStates.set(ACTOR, { channel_id: STICKER }); f.voiceStates.set(TARGET, { channel_id: STICKER });
    await assert.rejects(f.execute(",voicemaster claim"), /owner is still/);
    await voiceRoomEvent("GUILD_CREATE", { id: GUILD, unavailable: true }, f.store, f.api, BOT, new Map()); assert(f.channels.includes(room));
    f.voiceStates.set(TARGET, { channel_id: null }); await f.execute(",voicemaster claim");
    assert.equal(f.store.get("SELECT owner FROM voice_rooms WHERE channel=?", STICKER).owner, ACTOR);
});
