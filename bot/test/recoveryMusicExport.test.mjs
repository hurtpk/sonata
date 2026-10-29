/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fixture, ACTOR, TARGET, GUILD, USERROLE, BOT, MODROLE, CHANNEL } from "./fixture.mjs";
import { recoveryEvent } from "../roleRecovery.mjs";
import { musicAudienceEvent } from "../musicPolicy.mjs";
import { executeCommand } from "../moderation.mjs";
import { PERMS, replyPayload } from "../discord.mjs";
import { helpPage, helpInteraction } from "../help.mjs";

function leave(f) { recoveryEvent("GUILD_MEMBER_UPDATE", { guild_id: GUILD, ...f.members.get(TARGET) }, f.store); recoveryEvent("GUILD_MEMBER_REMOVE", { guild_id: GUILD, user: { id: TARGET } }, f.store); f.members.get(TARGET).roles = []; }

test("Three-hour staff recovery is opt-in, preserves its deadline, restores only safe roles and expires", async t => {
    const f = fixture(t);
    leave(f); assert.equal(f.store.get("SELECT user FROM role_returns"), undefined);
    f.members.get(TARGET).roles = [USERROLE]; await f.execute(",role recovery on"); leave(f);
    const saved = f.store.get("SELECT * FROM role_returns"); assert(saved.expires > Date.now() + 10_799_000);
    recoveryEvent("GUILD_MEMBER_ADD", { guild_id: GUILD, ...f.members.get(TARGET) }, f.store); recoveryEvent("GUILD_MEMBER_REMOVE", { guild_id: GUILD, user: { id: TARGET } }, f.store); assert.equal(f.store.get("SELECT expires FROM role_returns").expires, saved.expires);
    await f.execute(`,role restore ${TARGET}`); assert(f.members.get(TARGET).roles.includes(USERROLE)); assert.equal(f.store.get("SELECT * FROM role_returns"), undefined);
    leave(f); f.store.run("UPDATE role_returns SET expires=?", Date.now() - 1); await assert.rejects(f.execute(`,role restore ${TARGET}`), /three-hour/); assert.deepEqual(f.members.get(TARGET).roles, []);
});

test("Recovery skips newly privileged roles and refuses restrictions or insufficient staff permissions", async t => {
    const f = fixture(t); await f.execute(",role recovery on"); leave(f);
    f.store.saveRestriction(GUILD, TARGET, "jail", {}); await assert.rejects(f.execute(`,role restore ${TARGET}`), /restrictions/); f.store.clearRestriction(GUILD, TARGET, "jail");
    f.roles.find(r => r.id === USERROLE).permissions = PERMS.ADMIN.toString(); const result = await f.execute(`,role restore ${TARGET}`); assert.match(result.embeds[0].description, /Skipped 1/); assert.deepEqual(f.members.get(TARGET).roles, []);
    f.roles.find(r => r.id === MODROLE).permissions = PERMS.VIEW.toString(); await assert.rejects(f.execute(",role recovery off"), /permissions/);
});

test("Case reports are guild scoped, preserve evidence and IDs, neutralize CSV formulas, and build a real attachment", async t => {
    const f = fixture(t); await f.execute(`,warn ${TARGET} =HYPERLINK(test)`); f.store.addNote(GUILD, 1, ACTOR, "evidence", "https://discord.com/channels/test");
    const json = await f.execute(`,case export ${TARGET}`), report = JSON.parse(new TextDecoder().decode(json.files[0].bytes)); assert.equal(report.userId, TARGET); assert.equal(report.cases[0].notes[0].kind, "evidence"); assert.equal(report.cases.length, 1);
    const csv = await f.execute(`,case export ${TARGET} csv`), text = new TextDecoder().decode(csv.files[0].bytes); assert(text.includes("'=HYPERLINK")); assert(text.includes("'" + TARGET));
    const { form } = replyPayload(csv); assert(form.get("files[0]") instanceof Blob); assert.equal(JSON.parse(form.get("payload_json")).attachments[0].filename, csv.files[0].name);
    await assert.rejects(f.execute(`,case export ${ACTOR}`), /No cases/); f.roles.find(r => r.id === MODROLE).permissions = PERMS.VIEW.toString(); await assert.rejects(f.execute(`,case export ${TARGET}`), /permissions/);
});

test("DJ mode protects playback controls and skip votes count only current human listeners", async t => {
    const f = fixture(t); f.roles.find(r => r.id === USERROLE).permissions = PERMS.CONNECT.toString(); f.channels[0].type = 2; f.voiceStates.set(TARGET, { channel_id: CHANNEL }); f.voiceStates.set(ACTOR, { channel_id: CHANNEL }); f.voiceStates.set(BOT, { channel_id: CHANNEL });
    await f.execute(",musicsettings mode dj"); const jobs = [], broker = { online: () => true, submit: async job => { jobs.push(job); return { title: "Confirmed", description: "Done" }; } };
    const run = content => executeCommand({ ...f.command(content), actor: TARGET }, f.store, f.api, BOT, broker);
    await assert.rejects(run(",filter bassboost"), /DJ role/); await assert.rejects(run(",voteskip"), /listener list/);
    musicAudienceEvent("GUILD_CREATE", { id: GUILD, voice_states: [TARGET, ACTOR, BOT].map(user_id => ({ user_id, channel_id: CHANNEL })) }, f.store);
    await run(",skip"); assert.equal(jobs[0].name, "voteskip"); assert.deepEqual(jobs[0].listeners.sort(), [TARGET, ACTOR].sort()); assert.equal(jobs[0].threshold, 50);
    await f.execute(`,musicsettings djrole ${USERROLE}`); await run(",filter nightcore"); assert.equal(jobs.at(-1).name, "filter");
    f.voiceStates.delete(ACTOR); await run(",voteskip"); assert.deepEqual(jobs.at(-1).listeners, [TARGET]);
});

test("Both home help arrows browse immediately and Home returns to the eight-category overview", () => {
    const home = helpPage(ACTOR), button = home.components[1].components[2]; assert.equal(button.disabled, false); assert.equal(home.components[1].components[0].disabled, false);
    const click = (message, control) => helpInteraction({ member: { user: { id: ACTOR } }, message: { ...message, author: { id: BOT } }, data: { custom_id: control.custom_id, component_type: 2 } }, BOT);
    const first = click(home, button); assert.equal(first.type, 7); assert.match(first.data.embeds[0].footer.text, /Page 1/);
    const last = click(home, home.components[1].components[0]); assert.equal(last.type, 7); assert.match(last.data.embeds[0].footer.text, /Page 10 of 10/);
    assert.match(click(first.data, first.data.components[1].components[1]).data.embeds[0].description, /8 categories/);
});
