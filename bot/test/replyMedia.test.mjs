/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parsePrefix, parseSlash } from "../commands.mjs";
import { executeCommand } from "../moderation.mjs";
import { readDiscordFile } from "../media.mjs";
import { fixture, ACTOR, BOT, CHANNEL, GUILD, MODROLE, TARGET } from "./fixture.mjs";
import { PERMS } from "../discord.mjs";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), STICKER = "999999999999999993";
const reply = (f, content, reference = {}) => executeCommand({ ...f.command(content), reply: { message_id: TARGET, channel_id: CHANNEL, guild_id: GUILD, ...reference } }, f.store, f.api, BOT);

test("Reply shorthand keeps explicit prefix and slash options unchanged", () => {
    assert.deepEqual(parsePrefix(",download", ",").options, { message: "reply" });
    assert.deepEqual(parsePrefix(",emoji steal", ",").options, { emoji: "reply" });
    assert.deepEqual(parsePrefix(",sticker steal", ",").options, { id: "reply" });
    assert.equal(parsePrefix(`,emoji steal <:test:${TARGET}> renamed`, ",").options.name, "renamed");
    assert.throws(() => parseSlash({ name: "download", options: [{ name: "emoji", options: [] }] }), /Missing emoji/);
});

test("Reply downloads include Unicode emoji PNGs with credit and preserve animated custom emoji GIFs", async t => {
    const f = fixture(t), urls = []; t.mock.method(globalThis, "fetch", async url => { urls.push(String(url)); return new Response(PNG); });
    f.messages.push({ id: TARGET, content: "😭" }); await reply(f, ",download");
    let upload = f.calls.filter(call => call.form).at(-1).form; assert.equal(upload.get("files[0]").name, "emoji_1f62d.png"); assert.match(JSON.parse(upload.get("payload_json")).content, /CC BY 4.0/); assert.match(urls[0], /twemoji@17\.0\.3\/assets\/72x72\/1f62d\.png$/);
    f.messages[0].content = `<a:dance:${ACTOR}>`; await reply(f, ",download"); upload = f.calls.filter(call => call.form).at(-1).form; assert.equal(upload.get("files[0]").name, "dance.gif"); assert.match(urls.at(-1), new RegExp(`/emojis/${ACTOR}\\.gif$`));
    f.messages[0].content = "❤️"; await reply(f, ",download"); assert.match(urls.at(-1), /2764\.png$/);
    f.messages[0].content = "👩‍⚕️"; await reply(f, ",download"); assert.match(urls.at(-1), /1f469-200d-2695-fe0f\.png$/);
});

test("Replied stickers download or import without an ID, and expression permissions still apply", async t => {
    const f = fixture(t); t.mock.method(globalThis, "fetch", async () => new Response(PNG));
    f.stickers.push({ id: STICKER, name: "source", format_type: 1 }); f.messages.push({ id: TARGET, content: "", sticker_items: [{ id: STICKER, name: "source", format_type: 1 }] });
    await reply(f, ",download"); assert.equal(f.calls.filter(call => call.form).at(-1).form.get("files[0]").name, "source.png");
    await reply(f, ",sticker steal"); assert.equal(f.stickers.at(-1).name, "source");
    f.messages[0] = { id: TARGET, content: "😭" }; await reply(f, ",emoji steal"); assert.equal(f.emojis[0].name, "emoji_1f62d");
    f.roles.find(role => role.id === MODROLE).permissions = (PERMS.VIEW | PERMS.HISTORY).toString(); await assert.rejects(reply(f, ",emoji steal"), /Create Expressions/);
});

test("Reply lookup requires source history access and rejects forwarded, foreign, missing or empty replies", async t => {
    const f = fixture(t); f.messages.push({ id: TARGET, content: "" });
    await assert.rejects(f.execute(",download"), /Reply to a message/);
    for (const reference of [{ channel_id: ACTOR }, { guild_id: ACTOR }, { type: 1 }]) await assert.rejects(reply(f, ",download", reference), /ordinary message/);
    await assert.rejects(reply(f, ",download"), /no downloadable/); await assert.rejects(reply(f, ",sticker steal"), /No sticker/);
    f.channels[0].permission_overwrites.push({ id: ACTOR, type: 1, allow: "0", deny: PERMS.HISTORY.toString() }); await assert.rejects(reply(f, ",download"), /permissions/);
    f.channels[0].permission_overwrites = [];
    const command = { ...f.command(",download"), reply: { message_id: TARGET } }, api = async (path, options) => path.endsWith(`/messages/${TARGET}`) ? null : f.api(path, options);
    await assert.rejects(executeCommand(command, f.store, api, BOT), /deleted/);
});

test("Unicode asset access is pinned to a fixed image path without weakening the file URL allowlist", async () => {
    for (const url of ["https://cdn.jsdelivr.net/npm/example/file.png", "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/1f62d.png", "https://cdn.jsdelivr.net/gh/jdecked/twemoji@17.0.3/assets/72x72/1f62d.png?other=1", "https://cdn.jsdelivr.net.evil.test/gh/jdecked/twemoji@17.0.3/assets/72x72/1f62d.png"]) await assert.rejects(readDiscordFile(url, 1000, () => assert.fail("An unapproved URL was requested")));
});
