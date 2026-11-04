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

const file = path.join(__dirname, "../features/fakeDms/index.tsx");
const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["isValidDateMs", "safeIsoTimestamp", "getMessageTimestampMs", "getMessageIdBigInt", "compareMessages", "detectIsDesc", "mergeMessagesStable", "serializeMessage", "hydratePersistedMessage"];
const functions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(source)).join("\n");
const compiled = ts.transpileModule(`${functions}\nexports.api = { ${names.join(",")} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = {
    exports: {}, Date,
    ChannelStore: { getChannel: () => ({ recipients: ["self", "author"] }) },
    UserStore: { getCurrentUser: () => ({ id: "self" }), getUser: () => undefined },
    createBotMessage: () => ({}),
    MessageRecord: class { constructor(value) { Object.assign(this, value); } },
    moment: { duration: value => ({ asMilliseconds: () => value }) },
};
vm.runInNewContext(compiled, context);
const api = context.exports.api;
const plain = value => JSON.parse(JSON.stringify(value));
const message = embeds => ({
    id: "1", timestamp: new Date("2026-11-04T10:00:00Z"), content: "Preview",
    author: { id: "author", username: "username", globalName: "Display name", getAvatarURL: () => "https://example.com/avatar.png" },
    embeds,
});

test("Fake DMs saves Discord's current embed and display name fields", () => {
    const saved = api.serializeMessage("channel", message([{
        rawTitle: "Title", rawDescription: "Description", color: "#c58d91",
        author: { name: "Creator", iconURL: "https://example.com/creator.png" },
        footer: { text: "Footer", iconURL: "https://example.com/footer.png" },
        fields: [{ rawName: "Field", rawValue: "Value", inline: true }],
    }]));
    assert.equal(saved.authorGlobalName, "Display name");
    assert.equal(saved.recipientUserId, "author");
    assert.equal(saved.embeds[0].title, "Title");
    assert.equal(saved.embeds[0].description, "Description");
    assert.equal(saved.embeds[0].color, 0xc58d91);
    assert.equal(saved.embeds[0].author.icon_url, "https://example.com/creator.png");
    assert.equal(saved.embeds[0].footer.icon_url, "https://example.com/footer.png");
    assert.deepEqual(plain(saved.embeds[0].fields), [{ name: "Field", value: "Value", inline: true }]);
    const restored = api.hydratePersistedMessage(saved);
    assert.equal(restored.author.globalName, "Display name");
    assert.equal(restored.author.getAvatarURL(), "https://example.com/avatar.png");
});

test("Fake DMs keeps raw custom embeds and handles embeds without fields", () => {
    const embed = { title: "Custom title", description: "Custom text", color: 0xc58d91, author: { name: "Creator", icon_url: "https://example.com/creator.png" }, fields: [{ name: "Name", value: "Value" }] };
    const saved = api.serializeMessage("channel", message([embed, { title: "No fields" }]));
    assert.deepEqual(plain(saved.embeds[0]), embed);
    assert.equal(saved.embeds[1].title, "No fields");
    assert.equal(saved.embeds[1].fields, undefined);
});

test("Fake DMs merges current Date timestamps and stored ISO timestamps in both directions", () => {
    const rows = [{ id: "old", timestamp: new Date("2026-11-04T10:00:00Z") }, { id: "new", timestamp: new Date("2026-11-04T12:00:00Z") }];
    const fake = [{ id: "fake", timestamp: "2026-11-04T11:00:00Z" }];
    assert.deepEqual(plain(api.mergeMessagesStable(rows, fake).map(row => row.id)), ["old", "fake", "new"]);
    assert.deepEqual(plain(api.mergeMessagesStable([...rows].reverse(), fake).map(row => row.id)), ["new", "fake", "old"]);
    assert.equal(api.safeIsoTimestamp(rows[0].timestamp), "2026-11-04T10:00:00.000Z");
});
