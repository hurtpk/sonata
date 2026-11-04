/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { commandFailures, errorReply, recordCommandFailure } from "../commandFailures.mjs";
import { dashboardRequest } from "../dashboard.mjs";
import { executeCommand } from "../moderation.mjs";
import { fixture, ACTOR, GUILD, BOT, TARGET } from "./fixture.mjs";

test("Failures keep stable codes, normalized video links and redacted diagnostics after normal cleanup",async t=>{
    const f=fixture(t),command=f.command(',sonata https://www.tiktok.com/@creator/video/123?secret=private');
    const code=recordCommandFailure(f.store,command,new Error('Failed https://cdn.example/video?token=private Bearer secret-value'));
    assert.equal(code,'S000001');assert.deepEqual(errorReply(code),{content:'Error code: S000001',allowed_mentions:{parse:[]}});
    assert.equal(recordCommandFailure(f.store,command,new Error('Duplicate')) ,code);
    let rows=commandFailures(f.store,new URLSearchParams()).failures;assert.equal(rows.length,1);assert.equal(rows[0].source,'https://www.tiktok.com/@creator/video/123');assert.equal(rows[0].detail,'Failed https://cdn.example/video [credential]');
    f.store.run('UPDATE command_failures SET at=1');f.store.cleanup();rows=commandFailures(f.store,new URLSearchParams({q:code})).failures;assert.equal(rows.length,1);
    await assert.rejects(executeCommand(f.command(`,ban ${ACTOR}`,TARGET),f.store,f.api,BOT),/permissions/);assert.equal(commandFailures(f.store,new URLSearchParams()).total,2);
});

test("Failure pages have no gaps, exact code lookup and escaped command search",async t=>{
    const f=fixture(t);for(let i=0;i<55;i++)recordCommandFailure(f.store,{...f.command(',ping'),name:i===0?'literal%':'ping'},new Error('Failed'));
    const first=commandFailures(f.store,new URLSearchParams());assert.equal(first.failures.length,50);assert(first.next);
    const next=commandFailures(f.store,new URLSearchParams({before:first.next}));assert.equal(next.failures.length,5);assert.equal(next.next,null);assert.equal(new Set([...first.failures,...next.failures].map(row=>row.id)).size,55);
    assert.equal(commandFailures(f.store,new URLSearchParams({q:'%'})).failures.length,1);assert.equal(commandFailures(f.store,new URLSearchParams({q:GUILD})).total,55);
    assert.throws(()=>commandFailures(f.store,new URLSearchParams({before:'not-a-page'})),/valid failure page/);
});

test("Only owner or health-scoped administrators can browse all command failures",async t=>{
    const f=fixture(t),bot={store:f.store,api:f.api,env:{DASHBOARD_OWNER_IDS:ACTOR},session:{userId:BOT}};
    recordCommandFailure(f.store,f.command(',ping'),new Error('Diagnostic'));
    const request=(actor,scope)=>new Request('https://bot/dashboard/owner/failures',{headers:{'X-Sonata-User':actor,'X-Sonata-Permissions':scope}});
    assert.equal((await dashboardRequest(request(ACTOR,''),bot)).failures[0].detail,'Diagnostic');
    assert.equal((await dashboardRequest(request(BOT,'health'),bot)).failures.length,1);
    await assert.rejects(dashboardRequest(request(BOT,'servers'),bot),/Only the bot owner/);
});
