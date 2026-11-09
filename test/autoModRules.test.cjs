/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const vm = require("node:vm");

function compile(file, suffix = "", require = () => ({})) {
    const source = fs.readFileSync(path.join(__dirname, "../features/autoModRegex/", file), "utf8");
    const context = { exports: {}, require };
    vm.runInNewContext(ts.transpileModule(source + suffix, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText, context);
    return context.exports;
}
const { draftRule, rulePayload } = compile("rules.ts");
const valid = () => ({ ...draftRule(), name: "Custom words", keywords: "example" });
const original = () => ({ id: "100000000000000001", guild_id: "100000000000000002", name: "Existing rule", trigger_type: 1, event_type: 1, creator_id: "100000000000000003", enabled: true, actions: [{ type: 1, metadata: { custom_message: "Keep it civil", future_flag: true } }, { type: 9, metadata: { future: true } }], trigger_metadata: { keyword_filter: ["example"], regex_patterns: [" ^spaced$ "], future_setting: true }, exempt_roles: ["100000000000000004"], exempt_channels: ["100000000000000005"] });

test("New rules start paused, require content and enforce Discord keyword and regex limits", () => {
    const draft = valid();
    assert.equal(rulePayload(draft).enabled, false);
    assert.equal(rulePayload(draft).trigger_type, 1);
    assert.throws(() => rulePayload({ ...draft, keywords: "" }), /keyword or regex/);
    assert.throws(() => rulePayload({ ...draft, keywords: "x".repeat(61) }), /60 characters/);
    assert.throws(() => rulePayload({ ...draft, regex: "x".repeat(261) }), /260 characters/);
    assert.throws(() => rulePayload({ ...draft, regex: Array.from({ length: 11 }, (_, i) => `pattern${i}`).join("\n") }), /10 regex/);
    assert.throws(() => rulePayload({ ...draft, name: " " }), /name/);
});

test("Editing preserves exemptions, regex whitespace and unrecognized Discord fields and actions", () => {
    const rule = original();
    const body = rulePayload({ ...draftRule(rule), name: "Renamed" }, rule);
    assert.equal(body.name, "Renamed");
    assert.equal(body.trigger_metadata.future_setting, true);
    assert.deepEqual(Array.from(body.trigger_metadata.regex_patterns), rule.trigger_metadata.regex_patterns);
    assert.deepEqual(body.exempt_roles, rule.exempt_roles);
    assert.deepEqual(body.exempt_channels, rule.exempt_channels);
    assert.equal(body.actions.find(action => action.type === 1).metadata.future_flag, true);
    assert.equal(body.actions.find(action => action.type === 9).metadata.future, true);
    assert.equal("trigger_type" in body, false, "Immutable trigger type is omitted from edits");
    assert.throws(() => rulePayload({ ...draftRule(rule), trigger: 5 }, rule), /cannot be changed/);
});

test("Mention spam, preset lists and member profiles serialize their own trigger metadata", () => {
    const mention = rulePayload({ ...valid(), trigger: 5, mentions: "6", raid: true });
    assert.equal(mention.trigger_metadata.mention_total_limit, 6);
    assert.equal(mention.trigger_metadata.mention_raid_protection_enabled, true);
    assert.equal("keyword_filter" in mention.trigger_metadata, false);
    assert.throws(() => rulePayload({ ...valid(), trigger: 5, mentions: "51" }), /1 and 50/);
    assert.throws(() => rulePayload({ ...valid(), trigger: 4, presets: [] }), /at least one/);
    const profile = rulePayload({ ...valid(), trigger: 6 });
    assert.equal(profile.event_type, 2); assert.equal(profile.actions[0].type, 4);
    assert.equal(rulePayload({ ...valid(), trigger: 3 }).event_type, 1);
});

test("Actions require valid destinations and timeout permission; invalid rules cannot be saved", () => {
    assert.throws(() => rulePayload({ ...valid(), block: false }), /at least one action/);
    assert.throws(() => rulePayload({ ...valid(), alert: true }), /alert/);
    assert.throws(() => rulePayload({ ...valid(), timeout: true }), /Timeout Members/);
    assert.throws(() => rulePayload({ ...valid(), timeout: true, trigger: 3 }, undefined, true), /custom-word/);
    assert.throws(() => rulePayload({ ...valid(), timeout: true, seconds: "2419201" }, undefined, true), /28 days/);
    assert.throws(() => rulePayload({ ...valid(), roles: ["invalid"] }), /exempt/);
    assert.throws(() => rulePayload({ ...valid(), roles: Array(21).fill("100000000000000001") }), /20 exempt/);
    const body = rulePayload({ ...valid(), alert: true, alertChannel: "100000000000000009", timeout: true, seconds: "300" }, undefined, true);
    assert.equal(body.actions.find(action => action.type === 3).metadata.duration_seconds, 300);
});

const flush = () => new Promise(resolve => setImmediate(resolve));
const text = node => node == null ? "" : Array.isArray(node) ? node.map(text).join("") : typeof node === "object" ? text(node.props?.children) : typeof node === "function" ? "" : String(node);
function nodes(node, predicate) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(child => nodes(child, predicate));
    return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
function panelFixture() {
    let cursor = 0, effects = [], manage = true, listed = [original()];
    const hooks = [], requests = [], confirms = [];
    const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
    const Button = () => null;
    const common = {
        React, TextInput: "TextInput", TextArea: "TextArea", SearchableSelect: "SearchableSelect", lodash: { isEqual: assert.deepEqual },
        useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial; return [hooks[index], next => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next; }]; },
        useRef(initial) { const index = cursor++; return hooks[index] ??= { current: initial }; },
        useEffect(effect) { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(effect); } },
        useStateFromStores: (_stores, get) => get(),
        GuildStore: { getGuild: () => ({ id: "100000000000000002" }) },
        PermissionStore: { can: bit => bit === 1 ? manage : true }, PermissionsBits: { MANAGE_GUILD: 1, MODERATE_MEMBERS: 2, VIEW_CHANNEL: 3 },
        GuildRoleStore: { getSortedRoles: () => [] }, ChannelStore: { getMutableGuildChannelsForGuild: () => ({}) },
        Alerts: { show: options => confirms.push(options) },
        Constants: { Endpoints: { GUILD_AUTOMOD_RULES: id => `/guilds/${id}/auto-moderation/rules`, GUILD_AUTOMOD_RULE: (guild, rule) => `/guilds/${guild}/auto-moderation/rules/${rule}` } },
        RestAPI: Object.fromEntries(["get", "post", "patch", "del"].map(method => [method, async request => { requests.push({ method, ...request }); return { body: method === "get" ? listed : {} }; }]))
    };
    const compiled = compile("RulesPanel.tsx", "\nexports.Rules = Rules;", name => name === "@webpack/common" ? common : name === "@components/Button" ? { Button } : name === "./rules" ? { draftRule, rulePayload, TRIGGERS: compile("rules.ts").TRIGGERS } : { registerModerationPart() {} });
    let tree;
    function render() { cursor = 0; tree = compiled.Rules({ guildId: "100000000000000002" }); for (const effect of effects.splice(0)) effect(); return tree; }
    return { requests, confirms, render, deny: () => { manage = false; }, list: value => { listed = value; }, find: predicate => nodes(tree, predicate), button: name => nodes(tree, node => node.type === Button && text(node) === name)[0] };
}

test("The rule editor loads existing rules and sends scoped pause and confirmed-delete requests", async () => {
    const f = panelFixture(); f.render(); await flush(); f.render();
    assert.equal(f.requests[0].method, "get");
    const toggle = f.find(node => node.props?.label === "Pause Existing rule")[0];
    toggle.props.onChange(false); await flush(); f.render();
    assert.equal(f.requests.find(request => request.method === "patch").body.enabled, false);
    f.button("Delete").props.onClick();
    assert.equal(f.requests.some(request => request.method === "del"), false);
    f.confirms[0].onConfirm(); await flush();
    assert.equal(f.requests.find(request => request.method === "del").url, "/guilds/100000000000000002/auto-moderation/rules/100000000000000001");
});

test("Creating and editing rules use the correct endpoints and fail closed after permissions are revoked", async () => {
    const f = panelFixture(); f.render(); await flush(); f.render();
    f.button("Edit").props.onClick(); f.render();
    f.find(node => node.type === "TextInput" && node.props.placeholder === "Name this rule")[0].props.onChange("Updated rule");
    f.render(); f.button("Save rule").props.onClick(); await flush(); f.render();
    assert.equal(f.requests.find(request => request.method === "patch").body.name, "Updated rule");
    f.button("New rule").props.onClick(); f.render();
    f.find(node => node.type === "TextInput" && node.props.placeholder === "Name this rule")[0].props.onChange("New keyword rule");
    f.find(node => node.type === "TextArea" && node.props.placeholder === "One word or phrase per line")[0].props.onChange("example");
    f.render(); f.button("Save rule").props.onClick(); await flush(); f.render();
    const created = f.requests.find(request => request.method === "post");
    assert.equal(created.body.enabled, false); assert.equal(created.body.trigger_type, 1);
    f.button("Edit").props.onClick(); f.render();
    const staleSave = f.button("Save rule"); f.deny();
    const before = f.requests.length; staleSave.props.onClick(); await flush();
    assert.equal(f.requests.length, before, "No write is sent after Manage Server is lost");
});
