/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../features/onePingPerDM/index.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const message = (id, channel = "dm") => ({ id, channel_id: channel, author: { id: "sender" }, mentions: [], mention_everyone: false });

function fixture(native) {
    const oldest = new Map(), channels = new Map([["dm", { type: 1 }], ["group", { type: 3 }], ["guild", { type: 0 }]]);
    const settings = { shareAcrossBuilds: true, channelToAffect: "both_dms", allowMentions: false, allowEveryone: false, ignoreUsers: "", alwaysPlaySound: false };
    const ack = new Map(), played = [], account = { id: "me" };
    const context = {
        exports: {}, IS_WEB: false, VencordNative: { pluginHelpers: { Sonata: native } }, queueMicrotask,
        require: name => name === "@utils/types" ? { __esModule: true, default: value => value, OptionType: {} }
            : name === "@utils/constants" ? { Devs: { ProffDea: {} } }
                : name === "@webpack" ? { findByPropsLazy: () => ({ playNotificationSound: sound => played.push(sound) }) }
                : name.endsWith("/enums") ? { ChannelType: { DM: 1, GROUP_DM: 3 } }
                    : name.endsWith("featureSettings") ? { defineFeatureSettings: () => ({ store: settings }) }
                        : { ChannelStore: { getChannel: id => channels.get(id) }, ReadStateStore: { getOldestUnreadMessageId: id => oldest.get(id), ackMessageId: id => ack.get(id) }, UserStore: { getCurrentUser: () => account } }
    };
    vm.runInNewContext(compiled, context);
    const plugin = context.exports.default;
    plugin.start();
    return { plugin, settings, oldest, ack, played, account };
}

function notificationHandler(plugin, mode, disabled = false, notify = true) {
    const played = [], shown = [];
    const native = 'new(class{MESSAGE_CREATE(e){let a=!N.A.isSoundDisabled(s);if(selected&&(a&&P.A.playNotificationSound("message3",.4),true)||!notify)return!1;if(desktopOff){a&&P.A.playNotificationSound(s,.4);return!1}P.A.showNotification({sound:a?s:void 0,volume:.4,onClick(){}})}})';
    let patched = native;
    for (const replacement of [plugin.patches[0].replacement].flat()) {
        const pattern = new RegExp(replacement.match.source.replaceAll("\\i", "[$\\w]+"), replacement.match.flags);
        const next = patched.replace(pattern, replacement.replace.replaceAll("$self", "plugin"));
        assert.notEqual(next, patched, "Notification patch matches the native sound decision");
        patched = next;
    }
    const handler = vm.runInNewContext(patched, {
        plugin, notify, selected: mode === "selected", desktopOff: mode === "sound-only", s: "message1",
        N: { A: { isSoundDisabled: () => disabled } },
        P: { A: { playNotificationSound: sound => played.push(sound), showNotification: options => { shown.push(options); if (options.sound) played.push(options.sound); } } }
    });
    return { send: value => handler.MESSAGE_CREATE({ message: value }), played, shown };
}

for (const mode of ["selected", "sound-only", "desktop"]) {
    test(`One unread ping and read reset work for ${mode} notifications`, () => {
        const { plugin, oldest } = fixture();
        const native = notificationHandler(plugin, mode);
        oldest.set("dm", "100");
        native.send(message("100"));
        native.send(message("101"));
        assert.equal(native.played.length, 1);
        if (mode === "desktop") assert.equal(native.shown.length, 2, "Later desktop notifications still appear");
        oldest.set("dm", "102");
        native.send(message("102"));
        assert.equal(native.played.length, 2);
    });
}

test("Reading a DM and separate conversations do not inherit another DM's sound limit", () => {
    const { plugin, oldest } = fixture();
    oldest.set("dm", "100");
    assert.equal(plugin.shouldPlaySound(message("101"), true), false);
    assert.equal(plugin.shouldPlaySound(message("200", "group"), true), true);
    oldest.delete("dm");
    assert.equal(plugin.shouldPlaySound(message("102"), true), true);
});

test("Channel selection, mentions and everyone exceptions keep their configured behavior", () => {
    const { plugin, oldest, settings } = fixture();
    oldest.set("dm", "100"); oldest.set("group", "100");
    assert.equal(plugin.shouldPlaySound(message("101", "guild"), true), true);
    settings.channelToAffect = "group_dm";
    assert.equal(plugin.shouldPlaySound(message("101"), true), true);
    assert.equal(plugin.shouldPlaySound(message("101", "group"), true), false);
    settings.channelToAffect = "user_dm";
    assert.equal(plugin.shouldPlaySound(message("101", "group"), true), true);
    settings.channelToAffect = "both_dms"; settings.allowMentions = true;
    assert.equal(plugin.shouldPlaySound({ ...message("101"), mentions: [{ id: "me" }] }, true), true);
    assert.equal(plugin.shouldPlaySound({ ...message("101"), mentions: [{ id: "other" }] }, true), false);
    settings.allowEveryone = true;
    assert.equal(plugin.shouldPlaySound({ ...message("101", "group"), mention_everyone: true }, true), true);
});

test("Ignored user IDs accept commas and whitespace without ignoring partial matches", () => {
    const { plugin, oldest, settings } = fixture();
    oldest.set("dm", "100"); settings.ignoreUsers = "first,sender\nthird";
    assert.equal(plugin.shouldPlaySound(message("101"), true), true);
    settings.ignoreUsers = "first, sender-extra";
    assert.equal(plugin.shouldPlaySound(message("101"), true), false);
});

test("Disabled sounds remain silent unless overridden, and overriding still suppresses repeat pings", () => {
    for (const mode of ["selected", "sound-only", "desktop"]) {
        const { plugin, oldest, settings } = fixture();
        const native = notificationHandler(plugin, mode, true);
        oldest.set("dm", "100");
        native.send(message("100"));
        assert.equal(native.played.length, 0);
        settings.alwaysPlaySound = true;
        native.send(message("100"));
        native.send(message("101"));
        assert.equal(native.played.length, 1);
    }
});

const flush = () => new Promise(resolve => setImmediate(resolve));

test("Shared claims preserve the selected-channel sound and leave notification popups intact", async () => {
    for (const mode of ["selected", "sound-only", "desktop"]) {
        const claims = [];
        const f = fixture({ onePingClaim: async (...args) => { claims.push(args); return args[2] === "100"; } });
        const native = notificationHandler(f.plugin, mode);
        f.oldest.set("dm", "100");
        native.send(message("100")); native.send(message("101"));
        assert.equal(native.played.length, 0, "Native audio is suppressed while claiming");
        await flush();
        assert.deepEqual(f.played, [mode === "selected" ? "message3" : "message1"]);
        assert.equal(claims.length, 2);
        assert.equal(claims[0][0], "me");
        if (mode === "desktop") assert.equal(native.shown.length, 2);
    }
});

test("Account switches, logout, disabling and already-read messages cancel pending shared sounds", async () => {
    for (const cancel of [f => { f.account.id = "other"; }, f => f.plugin.flux.LOGOUT(), f => f.plugin.stop(), f => { f.settings.shareAcrossBuilds = false; }, f => f.ack.set("dm", "100")]) {
        let finish;
        const f = fixture({ onePingClaim: () => new Promise(resolve => { finish = resolve; }) });
        assert.equal(f.plugin.shouldPlaySound(message("100"), true), false);
        cancel(f); finish(true);
        await flush();
        assert.equal(f.played.length, 0);
    }
});

test("Read acknowledgements are private-channel scoped, account scoped and ignore non-message read states", async () => {
    const reads = [];
    const f = fixture({ onePingRead: async (...args) => { reads.push(args); } });
    f.ack.set("dm", "101");
    f.plugin.flux.CHANNEL_LOCAL_ACK.call(f.plugin, { channelId: "dm" });
    f.plugin.flux.BULK_ACK.call(f.plugin, { channels: [{ channelId: "group", messageId: "200", readStateType: 0 }, { channelId: "guild", messageId: "300" }] });
    f.plugin.flux.MESSAGE_ACK.call(f.plugin, { channelId: "dm", messageId: "400", readStateType: 1 });
    await flush();
    assert.deepEqual(reads, [["me", "dm", "101"], ["me", "group", "200"]]);
    f.plugin.flux.CHANNEL_ACK({ channelId: "dm", messageId: "500" }); f.account.id = "other";
    await flush();
    assert.equal(reads.length, 2);
});

test("Missing native helpers and coordinator failures retain local behavior", async () => {
    const missing = fixture({});
    assert.equal(missing.plugin.shouldPlaySound(message("100"), true), true);
    for (const result of [async () => null, async () => { throw new Error("IPC unavailable"); }]) {
        const f = fixture({ onePingClaim: result });
        f.oldest.set("dm", "100");
        f.plugin.shouldPlaySound(message("100"), true);
        f.plugin.shouldPlaySound(message("101"), true);
        await flush();
        assert.deepEqual(f.played, ["message1"]);
    }
});

test("Mentions still use shared deduplication, while guild and disabled sounds never consume a claim", async () => {
    const claims = [];
    const f = fixture({ onePingClaim: async (...args) => { claims.push(args); return true; } });
    f.settings.allowMentions = true;
    f.plugin.shouldPlaySound({ ...message("100"), mentions: [{ id: "me" }] }, true);
    assert.equal(f.plugin.shouldPlaySound(message("200", "guild"), true), true);
    assert.equal(f.plugin.shouldPlaySound(message("300"), false), false);
    await flush();
    assert.equal(claims.length, 1); assert.equal(claims[0][5], true);
    f.settings.shareAcrossBuilds = false;
    assert.equal(f.plugin.shouldPlaySound(message("400"), true), true);
});

test("Discord's notification eligibility checks still suppress muted and otherwise ineligible DMs", async () => {
    let calls = 0;
    const f = fixture({ onePingClaim: async () => { calls++; return true; } });
    notificationHandler(f.plugin, "desktop", false, false).send(message("100"));
    notificationHandler(f.plugin, "sound-only", false, false).send(message("101"));
    await flush();
    assert.equal(calls, 0); assert.equal(f.played.length, 0);
});
