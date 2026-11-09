/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { COMMANDS, parseSlash, slashCommands, slashName } from "../commands.mjs";

test("Every existing command form has exactly one registered slash path with the original schema", async () => {
    const registered = slashCommands(), catalog = JSON.parse(await readFile(new URL("../../service/public/catalog.json", import.meta.url)));
    assert.equal(registered.length, 62); assert.equal(catalog.length, 334);
    const paths = new Map();
    for (const command of registered) {
        assert(command.options.length <= 25);
        for (const sub of command.options[0]?.type === 1 ? command.options : [command]) {
            const path = command.name + (sub === command ? "" : " " + sub.name);
            assert(!paths.has(path)); paths.set(path, sub.options);
        }
    }
    assert.equal(paths.size, catalog.length);
    for (const command of COMMANDS) for (const form of command.options[0]?.type === 1 ? command.options : [command]) {
        const name = command.name + (form === command ? "" : " " + form.name), path = slashName(name);
        assert.deepEqual(paths.get(path), form.options, name);
        assert.equal(catalog.find(row => row.name === name).slashName, path);
        const [root, action] = path.split(" ");
        const values = form.options.filter(option => option.required).map(option => ({ name: option.name, type: option.type, value: option.choices?.[0].value ?? ({ 3: "x".repeat(Math.max(1, option.min_length ?? 1)).slice(0, option.max_length ?? 100), 4: option.min_value ?? 1, 5: true, 6: "333333333333333333", 7: "888888888888888888", 8: "777777777777777777", 11: "attachment" })[option.type] }));
        const data = { name: root, options: action ? [{ name: action, type: 1, options: values }] : values }, attachments = { attachment: { filename: "proof.png" } };
        const parsed = parseSlash(data, attachments);
        assert.equal(parsed.name, command.name); assert.equal(parsed.sub, form === command ? "" : form.name);
    }
});
