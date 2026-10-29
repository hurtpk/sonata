/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import test from "node:test";

import { COMMANDS } from "../commands.mjs";
import { help, helpInteraction, helpPage } from "../help.mjs";

const OWNER = "222222222222222222", BOT = "444444444444444444";
const click = (message, component, values, actor = OWNER) => helpInteraction({ member: { user: { id: actor } }, message: { ...message, author: { id: BOT } }, data: { custom_id: component.custom_id, component_type: component.type, ...(values ? { values } : {}) } }, BOT);

test("Help opens a category overview with unique Discord controls", () => {
    const response = help({ actor: OWNER, options: {} });
    assert.match(response.embeds[0].description, /282 commands across 8 categories/);
    assert.match(response.embeds[0].description, /\[Sonata dashboard\]\(https:\/\/sonata\.hurts\.workers\.dev\)/);
    const ids = response.components.flatMap(row => row.components.map(component => component.custom_id));
    assert.equal(new Set(ids).size, ids.length);
    assert(ids.every(id => id.length <= 100));
    assert.equal(response.components[0].components[0].options.length, 9);
    assert(response.components[1].components.every(button => button.emoji && !button.label));
});

test("Selecting a category and paging edits the message and preserves the menu lifetime", () => {
    const home = helpPage(OWNER), select = home.components[0].components[0];
    const first = click(home, select, ["server"]); assert.equal(first.type, 7);
    assert.match(first.data.embeds[0].description, /prefix view/);
    const next = click(first.data, first.data.components[1].components[2]); assert.equal(next.type, 7);
    assert.notEqual(next.data.embeds[0].description, first.data.embeds[0].description); assert.match(next.data.embeds[0].footer.text, /Page 2/);
    assert.equal(next.data.components[1].components[0].disabled, false);
    assert.equal(next.data.components[0].components[0].custom_id.split(":")[2], select.custom_id.split(":")[2]);
    const previous = click(next.data, next.data.components[1].components[0]); assert.match(previous.data.embeds[0].description, /prefix view/);
    const back = click(next.data, next.data.components[1].components[1]); assert.match(back.data.embeds[0].description, /8 categories/);
});

test("Category pages cover every command form without truncation", () => {
    const home = helpPage(OWNER), found = [];
    for (const option of home.components[0].components[0].options.filter(option => option.value !== "all")) {
        let message = helpPage(OWNER, option.value);
        while (true) {
            assert(message.embeds[0].description.length < 1800);
            found.push(...[...message.embeds[0].description.matchAll(/\*\*([^*]+)\*\*/g)].map(match => match[1]));
            const next = message.components[1].components[2];
            if (next.disabled) break;
            message = click(message, next).data;
        }
    }
    const expected = COMMANDS.flatMap(command => command.options[0]?.type === 1 ? command.options.map(sub => `${command.name} ${sub.name}`) : [command.name]);
    assert.deepEqual(found.sort(), expected.sort());
});

test("Foreign users, expired menus and forged controls cannot change the help message", () => {
    const home = helpPage(OWNER), select = home.components[0].components[0];
    for (const response of [click(home, select, ["server"], BOT), click(home, select, ["constructor"]), click(home, { ...select, custom_id: "snhelp:forged" }, ["server"])]) { assert.equal(response.type, 4); assert.equal(response.data.flags, 64); }
    const expired = helpPage(OWNER, "home", 0, Date.now() - 1000);
    assert.match(click(expired, expired.components[0].components[0], ["server"]).data.embeds[0].description, /expired/);
});
