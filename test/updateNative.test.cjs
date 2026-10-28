/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = readFileSync(path.join(__dirname, "../sonata/updateNative.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

async function update({ installFails = false, buildFails = false, dependenciesExist = true, windows = false } = {}) {
    const root = path.resolve("/sonata-updater-fixture"), sonata = path.join(root, "src/userplugins/sonata"), calls = [];
    const files = new Set([path.join(root, "package.json"), path.join(sonata, "index.tsx"), path.join(sonata, ".git"), path.join(sonata, "package.json")]);
    if (dependenciesExist) files.add(path.join(root, "node_modules"));
    const processMock = { platform: windows ? "win32" : "linux", env: { PATH: "test-path", LOCALAPPDATA: path.resolve("/sonata-test-local") } };
    const spawn = (command, args, options) => {
        if (typeof args === "object" && !Array.isArray(args)) { options = args; args = []; }
        const line = [command, ...args].join(" ");
        calls.push({ command, args, line, options });
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
        queueMicrotask(() => {
            if (line.includes("rev-parse")) child.stdout.emit("data", Buffer.from("same-pin\n"));
            const install = command === "pnpm" ? args[0] === "install" && !args.includes("--dir") : line.startsWith("pnpm install ") && !line.includes("--dir");
            const build = line === "pnpm build";
            const failed = (install && installFails) || (build && buildFails);
            if (failed) child.stderr.emit("data", Buffer.from(install ? "Dependency install failed" : "Compile failed"));
            child.emit("close", failed ? 1 : 0);
        });
        return child;
    };
    const imports = {
        child_process: { spawn }, electron: { shell: {} }, path,
        fs: { existsSync: file => files.has(file), readFileSync: file => file.endsWith("equicord-version.txt") ? "same-pin" : 'version: "2026.10.28"' },
    };
    const module = { exports: {} };
    vm.runInNewContext(compiled, { exports: module.exports, require: name => { assert(name in imports, name); return imports[name]; }, __dirname: path.join(root, "dist/desktop"), process: processMock, Buffer, setTimeout, clearTimeout });
    assert.equal(module.exports.sonataUpdateStart({}).ok, true);
    for (let i = 0; i < 100; i++) {
        const job = module.exports.sonataUpdateStatus({});
        if (["done", "error"].includes(job.step)) return { job, calls, root };
        await new Promise(resolve => setImmediate(resolve));
    }
    assert.fail("Updater did not finish");
}

test("An unchanged Equicord checkout refreshes dependencies before building", async () => {
    const { job, calls, root } = await update();
    assert.equal(job.step, "done"); assert.equal(job.equicordChanged, false);
    const install = calls.findIndex(call => call.line === "pnpm install --no-frozen-lockfile");
    const build = calls.findIndex(call => call.line === "pnpm build");
    assert(install >= 0 && build > install);
    assert.equal(calls[install].options.cwd, root); assert.equal(calls[install].options.env.CI, "1");
    assert(calls[install].options.env.PATH.startsWith(path.join(path.resolve("/sonata-test-local"), "Sonata", "tools") + path.delimiter));
    assert(calls.some(call => call.args.includes("--dir")));
});

test("A failed dependency refresh stops before building and keeps the install error", async () => {
    const { job, calls } = await update({ installFails: true });
    assert.equal(job.step, "error"); assert.equal(job.failedStep, "parts");
    assert.match(job.error, /refresh Equicord's dependencies/); assert.equal(job.log, "Dependency install failed");
    assert(!calls.some(call => call.line === "pnpm build"));
});

test("A real build failure is reported after the dependency refresh", async () => {
    const { job } = await update({ buildFails: true });
    assert.equal(job.failedStep, "build"); assert.equal(job.log, "Compile failed");
});

test("Missing dependencies are installed, and Windows keeps its hidden shell launch", async () => {
    const { job, calls } = await update({ dependenciesExist: false, windows: true });
    assert.equal(job.step, "done");
    const install = calls.find(call => call.line === "pnpm install --no-frozen-lockfile");
    assert(install); assert.equal(install.options.shell, true); assert.equal(install.options.windowsHide, true);
});
