/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const installer = fs.readFileSync(path.join(__dirname, "../Install Sonata.bat"), "utf8").replace(/\r\n/g, "\n");
const section = (start, end) => {
    const from = installer.indexOf(`\n:${start}\n`), to = installer.indexOf(`\n:${end}\n`, from + 1);
    assert(from >= 0 && to > from);
    return installer.slice(from, to);
};

function runInstaller(t, mode, { nodeVersion = "v24.0.0", installedPnpm = "", requiredPnpm = "pnpm@12.8.1", nodeFails = false, npmFails = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonata-installer-"));
    t.after(() => {
        const target = fs.realpathSync(dir), parent = fs.realpathSync(os.tmpdir());
        assert.equal(path.dirname(target), parent); assert(path.basename(target).startsWith("sonata-installer-"));
        fs.rmSync(target, { recursive: true, force: true });
    });
    const base = path.join(dir, "test user & spaces"), root = path.join(base, "Equicord"), bin = path.join(base, "bin"), local = path.join(base, "Local"), sonata = path.join(root, "src/userplugins/sonata"), tools = path.join(local, "Sonata/tools");
    for (const folder of [root, bin, sonata, tools]) fs.mkdirSync(folder, { recursive: true });
    const write = (name, contents) => fs.writeFileSync(name, contents.replace(/\r?\n/g, "\r\n"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ packageManager: requiredPnpm }));
    fs.writeFileSync(path.join(sonata, "package.json"), "{}");
    const log = path.join(base, "calls.jsonl"), marker = path.join(base, "node-upgraded"), npmStub = path.join(base, "npm-stub.cjs"), pnpmStub = path.join(base, "pnpm-stub.cjs");
    write(path.join(bin, "node.cmd"), `@echo off\nif not "%~1"=="-v" goto real\nif exist "%TEST_MARKER%" (echo v24.0.0) else (echo %TEST_NODE_VERSION%)\nexit /b 0\n:real\n"${process.execPath}" %*\nexit /b %errorlevel%\n`);
    write(path.join(bin, "npm.cmd"), `@echo off\n"${process.execPath}" "${npmStub}" %*\nexit /b %errorlevel%\n`);
    write(path.join(bin, "pnpm.cmd"), "@echo off\necho 11.10.0\nexit /b 0\n");
    fs.writeFileSync(pnpmStub, "const fs=require('node:fs');fs.appendFileSync(process.env.TEST_LOG,JSON.stringify({tool:'pnpm',args:process.argv.slice(2)})+'\\n');");
    fs.writeFileSync(npmStub, `const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);fs.appendFileSync(process.env.TEST_LOG,JSON.stringify({tool:'npm',args})+'\\n');if(process.env.TEST_NPM_FAIL==='1')process.exit(1);const prefix=args[args.indexOf('--prefix')+1],version=args.find(arg=>/^pnpm@/.test(arg)).slice(5);fs.mkdirSync(prefix,{recursive:true});fs.writeFileSync(path.join(prefix,'pnpm.cmd'),'@echo off\\r\\nif "%~1"=="--version" (echo '+version+' & exit /b 0)\\r\\n"${process.execPath.replace(/\\/g, "\\\\")}" "${pnpmStub.replace(/\\/g, "\\\\")}" %*\\r\\nexit /b %errorlevel%\\r\\n');`);
    if (installedPnpm) write(path.join(tools, "pnpm.cmd"), `@echo off\nif "%~1"=="--version" (echo ${installedPnpm} & exit /b 0)\n"${process.execPath}" "${pnpmStub}" %*\nexit /b %errorlevel%\n`);
    const toolBody = section("preparetools", "knownpaths");
    const rebuild = section("rebuild", "preparetools");
    const parts = section("sonataparts", "matchequicord");
    const freshStart = installer.indexOf("\n:build\n"), freshEnd = installer.indexOf('call :step "Installing into Discord"', freshStart);
    assert(freshStart >= 0 && freshEnd > freshStart);
    const fresh = installer.slice(freshStart, freshEnd) + "exit /b 0\n";
    const entry = mode === "prepare" ? "preparetools" : mode === "install" ? "build" : "rebuild";
    const script = `@echo off\nsetlocal EnableExtensions\ncall :${entry}\nif errorlevel 1 exit /b 1\ncall pnpm --version\nexit /b %errorlevel%\n${toolBody}\n${rebuild}\n${fresh}\n${parts}\n:knownpaths\nexit /b 0\n:step\nexit /b 0\n:matchequicord\nexit /b 0\n:failed\nexit /b 1\n:installnode\necho node-upgrade>>"%TEST_NODE_LOG%"\nif "%TEST_NODE_FAIL%"=="1" exit /b 1\ntype nul > "%TEST_MARKER%"\nexit /b 0\n`;
    const bat = path.join(dir, "test.cmd"); write(bat, script);
    const result = spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/c", bat], { cwd: root, encoding: "utf8", timeout: 15000, windowsHide: true,
        env: { ...process.env, EQ: root, TARGET: sonata, LOCALAPPDATA: local, PATH: bin + path.delimiter + path.join(process.env.SystemRoot, "System32"), TEST_MARKER: marker, TEST_NODE_LOG: path.join(base, "node.log"), TEST_NODE_VERSION: nodeVersion, TEST_NODE_FAIL: nodeFails ? "1" : "0", TEST_NPM_FAIL: npmFails ? "1" : "0", TEST_LOG: log },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line)) : [];
    return { result, calls, output: result.stdout + result.stderr, nodeUpgraded: fs.existsSync(marker) };
}

const windowsTest = process.platform === "win32" ? test : test.skip;

windowsTest("Installer updates old Node and pnpm and puts the required pnpm ahead of an old global command", t => {
    const f = runInstaller(t, "prepare", { nodeVersion: "v18.0.0", installedPnpm: "11.10.0" });
    assert.equal(f.result.status, 0, f.output); assert(f.nodeUpgraded); assert.match(f.output, /12\.8\.1/);
    assert.equal(f.calls.length, 1); assert(f.calls[0].args.includes("pnpm@12.8.1"));
});

windowsTest("Matching tool versions are reused without a package download", t => {
    const f = runInstaller(t, "prepare", { installedPnpm: "12.8.1" });
    assert.equal(f.result.status, 0, f.output); assert.equal(f.calls.length, 0); assert.equal(f.nodeUpgraded, false);
});

for (const mode of ["install", "repair"]) windowsTest(`${mode} prepares missing pnpm and refreshes dependencies before building`, t => {
    const f = runInstaller(t, mode);
    assert.equal(f.result.status, 0, f.output);
    assert.deepEqual(f.calls.map(call => [call.tool, ...call.args.slice(0, 2)]), [["npm", "install", "--global"], ["pnpm", "install", "--no-frozen-lockfile"], ["pnpm", "install", "--dir"], ["pnpm", "build"]]);
    for (const call of f.calls.filter(call => call.tool === "pnpm" && call.args[0] === "install")) assert(call.args.includes("--fix-lockfile"));
});

windowsTest("A Node upgrade that fails stops before pnpm setup", t => {
    const f = runInstaller(t, "repair", { nodeVersion: "v18.0.0", nodeFails: true });
    assert.equal(f.result.status, 1, f.output); assert.equal(f.calls.length, 0);
});

windowsTest("A pnpm download that fails stops before dependency installs and build", t => {
    const f = runInstaller(t, "repair", { npmFails: true });
    assert.equal(f.result.status, 1, f.output); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].tool, "npm");
});

windowsTest("An unexpected package manager pin is rejected before invoking npm", t => {
    const f = runInstaller(t, "prepare", { requiredPnpm: "npm@12.8.1" });
    assert.equal(f.result.status, 1, f.output); assert.equal(f.calls.length, 0); assert.match(f.output, /required pnpm version/);
});
