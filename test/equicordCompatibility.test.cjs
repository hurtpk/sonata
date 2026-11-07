/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const sonata = path.resolve(__dirname, "..");
const equicord = path.resolve(sonata, "../../..");
const pin = fs.readFileSync(path.join(sonata, "equicord-version.txt"), "utf8").split(/\r?\n/).find(line => /^[a-f0-9]{40}$/.test(line));
const patch = path.join(sonata, "equicord-fixes.patch");

function exportDefiner(source) {
    const tree = ts.createSourceFile("patchWebpack.ts", source, ts.ScriptTarget.Latest, true);
    let fn;
    function visit(node) {
        if (ts.isBinaryExpression(node) && node.left.getText(tree) === "this.d") fn = node.right.getText(tree);
        ts.forEachChild(node, visit);
    }
    visit(tree);
    assert(fn, "Webpack export definer exists");
    return vm.runInNewContext(ts.transpileModule("(" + fn + ")", { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
}

test("The shipped fixes apply to the pinned Equicord and support Discord's value exports", t => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "sonata-compatibility-"));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(fixture)), fs.realpathSync(os.tmpdir()));
        assert(path.basename(fixture).startsWith("sonata-compatibility-"));
        fs.rmSync(fixture, { recursive: true, force: true });
    });
    const files = [...fs.readFileSync(patch, "utf8").matchAll(/^diff --git a\/(\S+) /gm)].map(match => match[1]);
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
        fs.writeFileSync(path.join(fixture, file), execFileSync("git", ["show", pin + ":" + file], { cwd: equicord }));
    }
    const core = path.join(fixture, "src/webpack/patchWebpack.ts");
    const before = {};
    exportDefiner(fs.readFileSync(core, "utf8"))(before, {}, { A: class Store {} });
    assert.equal(before.A, undefined, "The pinned release reproduces the missing constructor");
    execFileSync("git", ["apply", "--whitespace=nowarn", patch], { cwd: fixture });
    execFileSync("git", ["apply", "--reverse", "--check", patch], { cwd: fixture });
    const define = exportDefiner(fs.readFileSync(core, "utf8"));
    const exported = {};
    class Store {}
    let current = 3;
    define(exported, { live: () => current }, { A: Store });
    assert.equal(new exported.A().constructor, Store);
    assert.equal(exported.live, 3);
    current = 4;
    assert.equal(exported.live, 4);
    assert.equal(Object.getOwnPropertyDescriptor(exported, "A").configurable, true);
    define(exported, {}, { A: null });
    assert.equal(exported.A, Store);
});
