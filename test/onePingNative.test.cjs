/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const { fork } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

if (process.env.SONATA_PING_TEST_CHILD) {
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../features/onePingPerDM/native.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const context = { exports: {}, process, require: name => name === "electron" ? { app: { getPath: () => process.env.SONATA_PING_TEST_ROOT } } : require(name) };
    vm.runInNewContext(compiled, context);
    process.on("message", async ({ id, method, args }) => {
        const result = await context.exports[method](null, ...args);
        process.send({ id, result });
    });
    process.send({ ready: true });
} else {
    test("Multiple Discord processes share an atomic ping claim, read reset and durable failover", { timeout: 30_000 }, async t => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "sonata-dm-ping-test-"));
        const children = [];
        t.after(async () => {
            await Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? undefined : new Promise(resolve => { child.once("exit", resolve); child.kill(); })));
            assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
            assert.ok(path.basename(root).startsWith("sonata-dm-ping-test-"));
            fs.rmSync(root, { recursive: true, force: true });
        });
        async function client() {
            const child = fork(__filename, [], { env: { ...process.env, SONATA_PING_TEST_CHILD: "1", SONATA_PING_TEST_ROOT: root }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
            children.push(child);
            let serial = 0;
            const pending = new Map();
            await new Promise((resolve, reject) => {
                child.once("error", reject);
                child.on("message", data => {
                    if (data.ready) resolve();
                    else { pending.get(data.id)?.(data.result); pending.delete(data.id); }
                });
                child.stderr.on("data", data => reject(new Error(data.toString())));
            });
            return { child, call: (method, ...args) => new Promise(resolve => { const id = ++serial; pending.set(id, resolve); child.send({ id, method, args }); }) };
        }
        const clients = await Promise.all([client(), client(), client()]);
        const user = "779172192461783110", channel = "100000000000000001";
        const m1 = "200000000000000001", m2 = "200000000000000002", m3 = "200000000000000003", m4 = "200000000000000004";
        const claim = (c, id, ack = "0", oldest = m1, bypass = false, u = user, ch = channel) => c.call("onePingClaim", u, ch, id, ack, oldest, bypass);
        assert.equal(await clients[0].call("onePingClaim", "invalid", channel, m1, "0", m1, false), null);
        assert.equal(fs.existsSync(path.join(root, "Sonata")), false, "Invalid renderer inputs cannot create state");
        const first = await Promise.all(clients.map(c => claim(c, m1)));
        assert.equal(first.filter(Boolean).length, 1);
        assert.equal(first.filter(x => x === false).length, 2);
        assert.deepEqual(await Promise.all(clients.map(c => claim(c, m2))), [false, false, false]);
        await clients[1].call("onePingRead", user, channel, m2);
        assert.equal(await claim(clients[2], m3), true, "Read in another build resets even with a stale local oldest-unread cursor");
        assert.equal(await claim(clients[0], m3), false, "The same message cannot ping twice");
        await clients[0].call("onePingRead", user, channel, m1);
        assert.equal(await claim(clients[1], m4), false, "Late read acknowledgements cannot reopen an unread epoch");
        assert.equal(await claim(clients[1], m4, "0", m1, true), true, "Configured mention exceptions can ping during an unread epoch");
        assert.equal(await claim(clients[2], m4, "0", m1, true), false, "Exceptions are still deduplicated across builds");
        assert.equal(await claim(clients[0], m1, "0", m1, false, "779172192461783111"), true, "Another account has an independent limit");
        assert.equal(await claim(clients[0], m1, "0", m1, false, user, "100000000000000002"), true, "Each conversation has an independent limit");
        assert.equal(await claim(clients[0], m2, "0", m1, false, user, "100000000000000003"), false, "Opening a previously unread conversation does not produce an extra ping");
        const state = JSON.parse(fs.readFileSync(path.join(root, "Sonata/dm-pings.json"), "utf8"));
        assert.deepEqual(Object.keys(state[user + ":" + channel]).sort(), ["ack", "ping"]);
        await Promise.all(clients.map(c => new Promise(resolve => { c.child.once("exit", resolve); c.child.kill(); })));
        const restarted = await client();
        assert.equal(await claim(restarted, m4), false, "A crashed coordinator cannot replay the last notification");
        await restarted.call("onePingRead", user, channel, m4);
        const m5 = "200000000000000005";
        assert.equal(await claim(restarted, m5), true, "A replacement coordinator accepts new pings after a read");
        assert.equal(await claim(restarted, m5, "bad"), null);
    });
}
