/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { COMMANDS, parsePrefix, parseSlash, slashName } from "../../bot/commands.mjs";
import { videoLimit } from "../../bot/music/videoSource.mjs";
import { reference } from "./reference.mjs";

const entries = COMMANDS.flatMap(command => (command.options[0]?.type === 1 ? command.options : [command]).map(sub => ({
    name: sub === command ? command.name : `${command.name} ${sub.name}`,
    command, sub, slashName: slashName(sub === command ? command.name : `${command.name} ${sub.name}`), options: sub.options, ...reference(command, sub),
})));
const source = (await readFile(new URL("app.js", import.meta.url), "utf8")).split("const cases =")[0].replace(/^import .*;$/gm, "");
const sandbox = { document: {}, setTimeout, clearTimeout };
runInNewContext(source + ";globalThis.exampleFor=(c,mode)=>{state.mode=mode;return example(c)};globalThis.cardFor=commandCard;", sandbox);
const file = { id: "987654321098765432", filename: "evidence.png", size: 1000, content_type: "image/png", url: "https://cdn.discordapp.com/attachments/123456789012345678/234567890123456789/evidence.png" };

test("every real command form has detailed documentation and all parameter descriptions", () => {
    assert.equal(new Set(entries.map(entry => entry.name)).size, entries.length);
    for (const entry of entries) {
        assert.ok(entry.description.length > 140, entry.name);
        assert.ok(entry.permissions.length > 5, entry.name);
        assert.deepEqual(entry.parameters.map(option => option.name), entry.options.map(option => option.name), entry.name);
        assert.ok(entry.parameters.every(option => option.description.length > 15), entry.name);
    }
    assert.throws(() => reference({ name: "undocumented", options: [], permission: 0n }, { name: "undocumented", options: [], description: "New command" }), /Missing command documentation/);
});

test("every copied prefix example selects the correct real command and arguments", () => {
    for (const entry of entries) {
        const parsed = parsePrefix(sandbox.exampleFor(entry, "prefix"), ",", entry.attachment ? [file] : []);
        assert.equal(parsed.name, entry.command.name, entry.name);
        assert.equal(parsed.sub, entry.sub === entry.command ? "" : entry.sub.name, entry.name);
        for (const option of entry.exampleOptions) assert.equal(parsed.options[option.name], option.value, `${entry.name}.${option.name}`);
        if (entry.attachment) assert.equal(parsed.options[entry.attachment], file, entry.name);
    }
});

test("every slash example validates against Discord's registered option schema", () => {
    for (const entry of entries) {
        const options = entry.exampleOptions.map(option => ({ ...option }));
        if (entry.attachment) options.push({ name: entry.attachment, type: 11, value: file.id });
        const grouped = entry.sub !== entry.command;
        const [root, sub] = entry.slashName.split(" ");
        const parsed = parseSlash({ name: root, options: sub ? [{ name: sub, type: 1, options }] : options }, { [file.id]: file });
        assert.equal(parsed.sub, grouped ? entry.sub.name : "", entry.name);
        for (const option of entry.exampleOptions) assert.equal(parsed.options[option.name], option.value, `${entry.name}.${option.name}`);
    }
});

test("media documentation distinguishes file and boosted video limits", () => {
    const download = entries.find(entry => entry.name === "download attachment");
    assert.match(download.description, /8 MiB \(8,388,608 bytes\)/);
    assert.match(download.detail, /any Discord attachment type/);
    assert.match(download.detail, /not an upload/);
    const social = entries.find(entry => entry.name === "sonata");
    for (const tier of [0, 1, 2, 3]) assert.ok(social.description.includes(`${videoLimit({ premium_tier: tier }) / 1024 / 1024} MiB`));
    assert.match(social.description, /3 minutes/);
    assert.match(entries.find(entry => entry.name === "emoji add").description, /256 KiB \(262,144 bytes\)/);
    assert.match(entries.find(entry => entry.name === "sticker add").description, /512 KiB \(524,288 bytes\)/);
    assert.match(entries.find(entry => entry.name === "modstats staff").parameters.find(option => option.name === "days").description, /Omit for all recorded history/);
});

test("rendering escapes source text and does not pretend copied commands attach files", () => {
    const original = entries.find(entry => entry.name === "download attachment");
    const html = sandbox.cardFor({ ...original, description: '<img src=x onerror="alert(1)">', permissions: "<script>bad</script>", aliases: [] });
    assert.ok(html.includes("&lt;img"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes("<script>bad"));
    assert.match(html, /copied command does not attach a file/);
    assert.equal(sandbox.exampleFor(original, "prefix"), ",download attachment");
});
