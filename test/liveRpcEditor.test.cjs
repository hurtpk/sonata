/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.join(__dirname, "../features/liveRpcEditor/index.tsx");
const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "formStateToActivity");
const compiled = ts.transpileModule(`${fn.getText(source)}\nexports.convert = formStateToActivity;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const convert = context.exports.convert;

test("Activity presets missing type and flags use valid defaults instead of NaN", () => {
    assert.equal(convert({ name: " " }), null);
    const activity = convert({ name: "Example" });
    assert.equal(activity.type, 0);
    assert.equal(activity.flags, 1);
    assert.equal(convert({ name: "Example", type: 0, flags: 0 }).flags, 0);
});

test("Streaming presets preserve their buttons and copied activity fields", () => {
    const activity = convert({ name: "Example", type: 1, flags: 1, url: "https://example.com/live", buttons: ["Watch"], metadata: { button_urls: ["https://example.com/live"] }, id: "activity", created_at: 123, session_id: "session", platform: "desktop" });
    assert.equal(activity.url, "https://example.com/live");
    assert.equal(activity.buttons[0], "Watch");
    assert.equal(activity.metadata.button_urls[0], "https://example.com/live");
    assert.equal(activity.id, "activity");
    assert.equal(activity.created_at, 123);
    assert.equal(activity.session_id, "session");
    assert.equal(activity.platform, "desktop");
});
