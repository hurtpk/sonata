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

const source = fs.readFileSync(path.join(__dirname, "../features/profileTools/statusAvatar/index.tsx"), "utf8");
const compiled = ts.transpileModule(source + "\nexports.apply = applyAvatarForStatus;", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture({ configured = true, fetch, patch } = {}) {
    let id = "A", status = "online";
    const requests = [], listeners = new Set();
    const store = { onlineAvatar: configured ? "configured" : "", idleAvatar: "idle-image", dndAvatar: "", invisibleAvatar: "", revertOnStop: true, paused: false };
    const context = {
        exports: {},
        fetch: fetch ?? (async url => ({ blob: async () => url })),
        FileReader: class { readAsDataURL(value) { this.result = value; queueMicrotask(() => this.onloadend()); } },
        require: name => {
            if (name === "@api/UserSettings") return { getUserSettingLazy: () => ({ getSetting: () => status }) };
            if (name === "@utils/Logger") return { Logger: class { error() {} } };
            if (name === "@utils/types") return { __esModule: true, default: value => value, OptionType: {} };
            if (name.endsWith("featureSettings")) return { defineFeatureSettings: () => ({ store }) };
            if (name === "@webpack/common") return {
                Constants: { Endpoints: { USER: userId => "/users/" + userId } },
                UserStore: { getCurrentUser: () => id ? { id, getAvatarURL: () => "original-" + id } : undefined },
                UserSettingsProtoStore: { addChangeListener: fn => listeners.add(fn), removeChangeListener: fn => listeners.delete(fn) },
                RestAPI: { patch: request => { requests.push({ id, avatar: request.body.avatar }); return patch ? patch(request) : Promise.resolve(); } }
            };
            return {};
        }
    };
    vm.runInNewContext(compiled, context);
    return { plugin: context.exports.default, apply: context.exports.apply, requests, listeners, store, account: value => { id = value; }, status: value => { status = value; for (const fn of listeners) fn(); } };
}

test("Status Avatar never restores a picture when it did not change one", async () => {
    const state = fixture({ configured: false });
    await state.plugin.start();
    await state.plugin.stop();
    assert.equal(state.requests.length, 0);
    assert.equal(state.listeners.size, 0);
});

test("Switching accounts never restores the old account's picture onto the new account", async () => {
    const state = fixture();
    await state.plugin.start();
    state.account("B");
    state.status("idle");
    await state.apply("idle");
    await state.plugin.stop();
    assert.deepEqual(state.requests, [{ id: "A", avatar: "configured" }]);
});

test("Disabling Status Avatar restores the original only on the account it changed", async () => {
    const state = fixture();
    await state.plugin.start();
    await state.plugin.stop();
    assert.deepEqual(state.requests, [{ id: "A", avatar: "configured" }, { id: "A", avatar: "original-A" }]);
});

test("An old snapshot finishing after an account switch cannot overwrite the new snapshot", async () => {
    const old = deferred();
    const state = fixture({ fetch: url => url === "original-A" ? old.promise : Promise.resolve({ blob: async () => url }) });
    const firstStart = state.plugin.start();
    state.account("B");
    await state.plugin.stop();
    await state.plugin.start();
    old.resolve({ blob: async () => "original-A" });
    await firstStart;
    await state.plugin.stop();
    assert.deepEqual(state.requests, [{ id: "B", avatar: "configured" }, { id: "B", avatar: "original-B" }]);
    assert.equal(state.listeners.size, 0);
});

test("A late request from an old run cannot mark a new run as having changed an avatar", async () => {
    const old = deferred();
    let first = true;
    const state = fixture({ patch: () => { if (first) { first = false; return old.promise; } return Promise.resolve(); } });
    const firstStart = state.plugin.start();
    while (!state.requests.length) await new Promise(resolve => setImmediate(resolve));
    state.account("B");
    await state.plugin.stop();
    state.store.onlineAvatar = "";
    await state.plugin.start();
    old.resolve();
    await firstStart;
    await state.plugin.stop();
    assert.deepEqual(state.requests, [{ id: "A", avatar: "configured" }]);
});

test("Failed avatar changes do not trigger an unwanted restore", async () => {
    const state = fixture({ patch: () => Promise.reject(new Error("Unavailable")) });
    await state.plugin.start();
    await state.plugin.stop();
    assert.deepEqual(state.requests, [{ id: "A", avatar: "configured" }]);
});
