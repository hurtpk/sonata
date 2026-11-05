/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { parsePrefix, parseSlash } from "../commands.mjs";
import { executeCommand } from "../moderation.mjs";
import { featureAction, featureForm } from "../featureInteractions.mjs";
import { MusicBridge } from "../musicBridge.mjs";
import { lastfmClient } from "../lastfm.mjs";
import { reminderControl, reminderTimers } from "../reminders.mjs";
import { PERMS } from "../discord.mjs";
import { ACTOR, BOT, CHANNEL, fixture, GUILD, MODROLE, OWNER, TARGET, USERROLE } from "./fixture.mjs";

const STAFF = "888888888888888889", OTHER = "888888888888888890", ROLE = "777777777777777778";
const image = { id: "999999999999999999", filename: "test.png", size: 100, url: "https://cdn.discordapp.com/attachments/111111111111111111/222222222222222222/test.png" };
const png = Buffer.alloc(24); png.set([137,80,78,71,13,10,26,10]);
const run = (f, content, actor = ACTOR, music, lastfm) => executeCommand(f.command(content, actor), f.store, f.api, BOT, music, lastfm);
const title = response => response.embeds[0].title;
let serial = 800000000000000000n;
const interaction = (actor, message, id, values) => ({ id: String(++serial), type: 3, guild_id: GUILD, channel_id: CHANNEL, member: { user: { id: actor } }, message: { id: message, author: { id: BOT } }, data: { custom_id: id, component_type: values ? 3 : 2, values } });

test("Command rules require role and channel matches, deny wins, and native permissions remain required", async t => {
    const f = fixture(t);
    f.channels.push({ id: OTHER, guild_id: GUILD, type: 0, permission_overwrites: [] });
    await run(f, ",commandsettings rule userinfo allow " + USERROLE, OWNER);
    const before = f.command(",userinfo", TARGET); before.channel = OTHER;
    await run(f, ",commandsettings rule userinfo allow <#" + CHANNEL + ">", OWNER);
    await assert.rejects(executeCommand(before, f.store, f.api, BOT), /selected channels/);
    await run(f, ",userinfo", TARGET);
    await run(f, ",commandsettings rule userinfo deny " + USERROLE, OWNER);
    await assert.rejects(run(f, ",userinfo", TARGET), /blocks this role/);
    await run(f, ",userinfo", OWNER);
    await run(f, ",commandsettings rule warn allow " + USERROLE, OWNER);
    await assert.rejects(run(f, ",warn " + ACTOR + " denied", TARGET), /permission/i);
    await assert.rejects(run(f, ",commandsettings rule commandsettings deny " + MODROLE, OWNER), /must stay available/);
    const id = f.store.settings(GUILD).commandRules.find(rule => rule.command === "userinfo" && rule.kind === "role").id;
    await run(f, ",commandsettings unrule " + id, OWNER); await run(f, ",userinfo", TARGET);
});

test("Role menus replace only their own roles, enforce the selection limit and recheck unsafe roles", async t => {
    const f = fixture(t);
    f.roles.push({ id: ROLE, name: "Blue", position: 11, permissions: "0" });
    await run(f, ',rolemenu create "Choose a color" 1', OWNER);
    const { id } = f.store.get("SELECT id FROM role_menus");
    await run(f, ",rolemenu add " + id + " " + USERROLE, OWNER);
    await run(f, ",rolemenu add " + id + " " + ROLE, OWNER);
    await assert.rejects(run(f, ",rolemenu add " + id + " " + MODROLE, OWNER), /without moderation permissions/);
    await run(f, ",rolemenu post " + id + " " + CHANNEL, OWNER);
    const panel = f.postedMessages.at(-1), pick = panel.components[0].components[0];
    assert.equal(pick.max_values, 1);
    const choose = values => featureAction(interaction(TARGET, panel.id, pick.custom_id, values), f.store, f.api, BOT);
    await assert.rejects(choose([ROLE, USERROLE]), /valid options/);
    await assert.rejects(choose([MODROLE]), /valid options/);
    await choose([ROLE]); assert.deepEqual(f.members.get(TARGET).roles, [ROLE]);
    f.channels[0].permission_overwrites.push({ type: 0, id: USERROLE, allow: PERMS.MESSAGES.toString(), deny: "0" });
    await assert.rejects(choose([USERROLE]), /management permissions in a channel/);
    assert.deepEqual(f.members.get(TARGET).roles, [ROLE]);
    f.channels[0].permission_overwrites = [];
    await assert.rejects(run(f, ",fakepermissions grant " + USERROLE + " warnings", OWNER), /role menus/);
    await run(f, ",rolemenu delete " + id, OWNER); await assert.rejects(choose([ROLE]), /no longer active/);
});

test("Reminders persist, deliver once to their owner, and support safe snooze and cancellation", async t => {
    const f = fixture(t), response = await run(f, ",remind 2h private reminder text", ACTOR);
    assert.equal(title(response), "Reminder scheduled"); assert.doesNotMatch(response.embeds[0].description, /private reminder text/);
    const row = f.store.get("SELECT * FROM reminders WHERE user=?", ACTOR);
    assert.throws(() => reminderControl(f.store, TARGET, row.id, "cancel"), /isn't yours/);
    await Promise.all([reminderTimers(f.store, f.api, row.due + 1), reminderTimers(f.store, f.api, row.due + 1)]);
    assert.equal(f.postedMessages.length, 1); assert.equal(f.calls.find(call => call.route === "/users/@me/channels").body.recipient_id, ACTOR);
    const receipt = f.postedMessages[0];
    assert.equal(receipt.embeds[0].description, "private reminder text");
    assert.throws(() => reminderControl(f.store, ACTOR, row.id, "s10", CHANNEL), /already been snoozed/);
    reminderControl(f.store, ACTOR, row.id, "s10", receipt.id);
    assert.equal(f.store.get("SELECT state FROM reminders WHERE id=?", row.id).state, "pending");
    await run(f, ",remind cancel " + row.id, ACTOR);
    await reminderTimers(f.store, f.api, row.due + 5_000_000);
    assert.equal(f.postedMessages.length, 1);
});

test("Staff approvals require private review, another authorized moderator, and one execution", async t => {
    const f = fixture(t);
    f.channels.push({ id: STAFF, guild_id: GUILD, type: 0, permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: PERMS.VIEW.toString() }, { id: MODROLE, type: 0, allow: PERMS.VIEW.toString(), deny: "0" }] });
    await assert.rejects(run(f, ",case approvalrule ban on " + CHANNEL, OWNER), /everyone cannot view/);
    await run(f, ",case approvalrule ban on " + STAFF, OWNER);
    assert.equal(title(await run(f, ",ban " + TARGET + " needs review")), "Awaiting staff approval");
    assert.equal(f.bans.size, 0); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases").n, 0);
    const row = f.store.get("SELECT * FROM moderation_approvals");
    await assert.rejects(run(f, ",case approve " + row.id), /Another moderator/);
    await assert.rejects(run(f, ",case approve " + row.id, TARGET), /Moderation permissions/);
    const response = await run(f, ",case approve " + row.id, OWNER);
    assert.equal(title(response), "Moderation request approved"); assert.equal(f.bans.size, 1);
    const audit = f.store.get("SELECT * FROM cases"), note = f.store.get("SELECT * FROM notes WHERE kind='staff approval'");
    assert.equal(audit.actor, ACTOR); assert.equal(note.actor, OWNER);
    await assert.rejects(run(f, ",case approve " + row.id, OWNER), /already decided/);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases").n, 1);
});

test("Pending approval cannot perform an action after the requester loses permission", async t => {
    const f = fixture(t);
    f.channels.push({ id: STAFF, guild_id: GUILD, type: 0, permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: PERMS.VIEW.toString() }] });
    await run(f, ",case approvalrule kick on " + STAFF, OWNER);
    await run(f, ",kick " + TARGET + " review");
    const row = f.store.get("SELECT id FROM moderation_approvals");
    f.roles.find(role => role.id === MODROLE).permissions = PERMS.VIEW.toString();
    assert.equal(title(await run(f, ",case approve " + row.id, OWNER)), "Moderation request needs review");
    assert.ok(f.members.has(TARGET)); assert.equal(f.store.get("SELECT COUNT(*) AS n FROM cases").n, 0);
});

test("Permission audit identifies risky roles, public children under private categories and changes since baseline", async t => {
    const f = fixture(t);
    f.channels.push({ id: STAFF, type: 4, guild_id: GUILD, permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: PERMS.VIEW.toString() }] });
    f.channels[0].parent_id = STAFF;
    await assert.rejects(run(f, ",role audit", ACTOR), /permission/i);
    await run(f, ",role auditbaseline", OWNER);
    assert.match((await run(f, ",role audit channels", OWNER)).embeds[0].description, /public under private category/);
    f.roles.find(role => role.id === USERROLE).permissions = PERMS.BAN.toString();
    f.channels[0].permission_overwrites.push({ id: GUILD, type: 0, allow: "0", deny: PERMS.VIEW.toString() });
    const changes = (await run(f, ",role audit changes", OWNER)).embeds[0].description;
    assert.match(changes, /Gained Ban Members/); assert.match(changes, /Became private/);
});

test("Last.fm compares artist charts, reports album counts and ranks only current opted-in members", async t => {
    const f = fixture(t);
    for (const [id, name] of [[ACTOR, "left"], [TARGET, "right"]]) f.store.run("INSERT INTO lastfm_accounts VALUES (?,?)", id, name);
    const client = async (method, name, period, page, options) => {
        if (method === "user.getTopArtists") { assert.equal(options.limit, 50); return { topartists: { artist: [{ name: "Shared" }, { name }] } }; }
        if (method === "album.getInfo") return { album: { artist: options.artist, name: options.album, userplaycount: "7", listeners: "100", playcount: "800" } };
        if (method === "artist.getInfo") return { artist: { stats: { userplaycount: name === "left" ? "20" : "10" } } };
        assert.fail(method);
    };
    assert.match((await run(f, ",fm compare " + TARGET, ACTOR, null, client)).embeds[0].description, /33% overlap/);
    assert.match((await run(f, ',fm album "Daft Punk" Discovery', ACTOR, null, client)).embeds[0].description, /7 plays/);
    await run(f, ",fm participate on", TARGET, null, client);
    const ranks = () => run(f, ',fm whoknows "Daft Punk"', ACTOR, null, client);
    const ranked = (await ranks()).embeds[0].description;
    assert.match(ranked, new RegExp(TARGET + "> · 10 plays")); assert.doesNotMatch(ranked, new RegExp(ACTOR));
    f.members.delete(TARGET); assert.match((await ranks()).embeds[0].description, /No participating members/);
    assert.equal(f.store.get("SELECT COUNT(*) AS n FROM lastfm_guilds").n, 0);
});

test("Last.fm album and artist lookups use public-user parameters and separate cache entries", async () => {
    const calls = [];
    const client = lastfmClient("a".repeat(32), async url => {
        calls.push(url.searchParams);
        return Response.json(url.searchParams.get("method") === "album.getInfo" ? { album: { userplaycount: "4" } } : { artist: { stats: { userplaycount: "8" } } });
    });
    await client("album.getInfo", "listener", "overall", 1, { artist: "Artist", album: "First" });
    await client("album.getInfo", "listener", "overall", 1, { artist: "Artist", album: "Second" });
    await client("artist.getInfo", "listener", "overall", 1, { artist: "Artist" });
    assert.deepEqual(calls.map(url => url.get("album")), ["First", "Second", null]); assert.ok(calls.every(url => url.get("username") === "listener"));
});

test("Caption editors accept uploads and allow only the original requester to change or finish the image", async t => {
    const f = fixture(t), cmd = { ...f.command(",caption Test this image"), ...parsePrefix(",caption Test this image", ",", [image]) };
    const broker = { online: () => true, async submit(job) { assert.equal(job.source, image.url); return { image: png, format: job.style.format }; } };
    const output = await executeCommand(cmd, f.store, f.api, BOT, broker), row = f.store.get("SELECT * FROM image_edits");
    assert.equal(output.files[0].name, "sonata-caption.png"); assert.equal(JSON.parse(row.data).top, "Test this image");
    const edit = actor => interaction(actor, OTHER, "sncaption:" + row.id + ":edit");
    assert.throws(() => featureForm(edit(TARGET), f.store), /belongs to/);
    assert.equal(featureForm(edit(ACTOR), f.store).data.components.length, 2);
    const styled = await featureAction(interaction(ACTOR, OTHER, "sncaption:" + row.id + ":style", ["theme:rose"]), f.store, f.api, BOT, broker);
    assert.equal(JSON.parse(f.store.get("SELECT data FROM image_edits").data).theme, "paper");
    styled.onDelivered();
    assert.equal(JSON.parse(f.store.get("SELECT data FROM image_edits").data).theme, "rose");
    const gif = await featureAction(interaction(ACTOR, OTHER, "sncaption:" + row.id + ":format"), f.store, f.api, BOT, broker);
    assert.equal(gif.files[0].name, "sonata-caption.gif");
    gif.onDelivered();
    const undo = await featureAction(interaction(ACTOR, OTHER, "sncaption:" + row.id + ":undo"), f.store, f.api, BOT, broker);
    assert.equal(undo.files[0].name, "sonata-caption.png");
    undo.onDelivered();
    const finish = await featureAction(interaction(ACTOR, OTHER, "sncaption:" + row.id + ":done"), f.store, f.api, BOT, broker);
    finish.onDelivered();
    assert.throws(() => featureForm(edit(ACTOR), f.store), /expired/);
    assert.equal(parseSlash({ name: "download", options: [{ name: "caption", options: [{ name: "caption", value: "Photo" }, { name: "image", type: 11, value: image.id }] }] }, { [image.id]: image }).options.image, image);
});

test("Sticker maker uploads the exact preview once and checks permission at publication", async t => {
    const f = fixture(t), cmd = { ...f.command(',sticker make "Weekend mood"'), ...parsePrefix(',sticker make "Weekend mood"', ",", [image]) };
    const broker = { online: () => true, async submit(job) { assert.equal(job.style.sticker, true); return { image: png, format: "png" }; } };
    const output = await executeCommand(cmd, f.store, f.api, BOT, broker);
    const control = output.components.flatMap(row => row.components).find(item => item.label === "Add to server");
    const create = actor => {
        const data = interaction(actor, OTHER, control.custom_id);
        data.message.attachments = [{ ...image, filename: "sonata-sticker.png", size: png.length, width: 320, height: 320 }];
        return featureAction(data, f.store, f.api, BOT, broker);
    };
    const fetchPreview = t.mock.method(globalThis, "fetch", async url => {
        assert.equal(url, image.url);
        return new Response(png);
    });
    const role = f.roles.find(role => role.id === MODROLE), permissions = role.permissions;
    role.permissions = (BigInt(permissions) & ~PERMS.CREATE_EXPRESSIONS).toString();
    await assert.rejects(create(ACTOR), /permission/i);
    await assert.rejects(create(TARGET), /belongs to/);
    assert.equal(fetchPreview.mock.callCount(), 0);
    role.permissions = permissions;
    assert.match((await create(ACTOR)).content, /Sticker added/);
    await assert.rejects(create(ACTOR), /expired/);
    const posts = f.calls.filter(call => call.method === "POST" && call.route.endsWith("/stickers"));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].form.get("name"), "Weekend mood");
    assert.deepEqual(Buffer.from(await posts[0].form.get("file").arrayBuffer()), png);
});

test("Caption results cannot claim a voice connection or substitute the wrong format", async () => {
    const bridge = new MusicBridge(); bridge.poll(BOT, true); bridge.channels.set(GUILD, STAFF);
    const id = "999999999999999997", pending = bridge.submit({ id, guild: GUILD, channel: CHANNEL, kind: "caption", source: image.url, style: {} });
    assert.throws(() => bridge.complete({ id, title: "Image", description: "", format: "gif" }, png), /Invalid rendered image/);
    bridge.complete({ id, title: "Image", description: "", format: "png", disconnected: true }, png);
    assert.equal((await pending).image, png); assert.equal(bridge.channels.get(GUILD), STAFF);
});
