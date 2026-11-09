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
import { buildCommand } from "../public/command-builder.js";

const entries = COMMANDS.flatMap(command => (command.options[0]?.type === 1 ? command.options : [command]).map(sub => ({
    name: sub === command ? command.name : `${command.name} ${sub.name}`,
    command, sub, slashName: slashName(sub === command ? command.name : `${command.name} ${sub.name}`), options: sub.options, ...reference(command, sub),
})));
const source = (await readFile(new URL("app.js", import.meta.url), "utf8")).split("const cases =")[0].replace(/^import .*;$/gm, "");
const sandbox = { document: {}, setTimeout, clearTimeout };
runInNewContext(source + ";globalThis.exampleFor=(c,mode)=>{state.mode=mode;return example(c)};globalThis.cardFor=commandCard;", sandbox);
const file = { id: "987654321098765432", filename: "evidence.png", size: 1000, content_type: "image/png", url: "https://cdn.discordapp.com/attachments/123456789012345678/234567890123456789/evidence.png" };

test("The command builder produces prefix syntax accepted by the bot for every documented form", () => {
    for (const command of entries) {
        const values = Object.fromEntries(command.exampleOptions.map(({ name, value, type }) => [name, type === 5 ? value ? "on" : "off" : value]));
        const result = buildCommand(command, values, "!", "prefix");
        const parsed = parsePrefix(result, "!", command.options.some(option => option.type === 11) ? [file] : []);
        assert.equal(parsed?.name, command.command.name, command.name);
        assert.equal(parsed?.sub, command.sub === command.command ? "" : command.sub.name, command.name);
    }
});

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


test("Saved ticket systems show queues and legacy panels with working edit controls", async () => {
    const source = await readFile(new URL("../public/bot.js", import.meta.url), "utf8");
    const nodes = new Map(), edits = [], tools = [];
    const node = (tag, text, className) => ({ tag, textContent: text, className, children: [], append(...values) { this.children.push(...values); }, replaceChildren() { this.children = []; }, addEventListener(type, callback) { this[type] = callback; } });
    for (const id of ["ticket-systems", "ticket-toolbox", "ticket-config-editor"]) nodes.set(id, node("div"));
    const context = { $: id => nodes.get(id), el: node, renderTicketAction: (...args) => edits.push(args) };
    runInNewContext(source.slice(source.indexOf("function renderSavedTickets("), source.indexOf("function renderTicketManagement(")), context);
    const server = { guild: { id: "111111111111111111" }, channels: [{ id: "1", name: "Support" }, { id: "2", name: "Tickets" }], roles: [{ id: "3", name: "Staff" }], tickets: [{ state: "open" }], settings: { tickets: { enabled: true, category: "1", role: "3", log: "2", categories: { reports: { category: "1", role: "3" } }, panel: { channel: "2", message: "999999999999999999" } } } };
    context.renderSavedTickets(server, new Map([["categoryadd", { name: "categoryadd" }]]), "2", name => tools.push(name));
    const flatten = node => [node, ...node.children.flatMap(flatten)];
    const saved = flatten(nodes.get("ticket-systems"));
    assert.ok(saved.some(node => node.textContent === "Default ticket system"));
    assert.ok(saved.some(node => node.textContent === "reports"));
    assert.ok(saved.some(node => node.href?.endsWith("/2/999999999999999999")));
    saved.find(node => node.textContent === "Edit").click();
    assert.equal(nodes.get("ticket-toolbox").open, true);
    assert.equal(edits[0][4], "2");
    assert.equal(edits[0][5].name, "reports");
    assert.equal(edits[0][5].role, "3");
    saved.find(node => node.textContent === "Pause tickets").click();
    assert.deepEqual(tools, ["off"]);
    context.renderSavedTickets({ ...server, settings: {} }, new Map(), "2", name => tools.push(name));
    assert.ok(flatten(nodes.get("ticket-systems")).some(node => node.textContent === "No ticket system configured"));
});

test("Dashboard command switches respect parent disables and protected commands", async () => {
    const source = await readFile(new URL("../public/bot.js", import.meta.url), "utf8");
    const flatten = node => [node, ...node.children.flatMap(flatten)];
    const el = (tag, text) => ({ tag, textContent: text, children: [], value: "", append(...children) { this.children.push(...children); }, replaceChildren() { this.children = []; }, setAttribute(key, value) { this[key] = value; }, addEventListener(type, callback) { this[type] = callback; }, scrollIntoView() {}, querySelectorAll(tag) { return flatten(this).filter(node => node.tag === tag); } });
    const root = el("div"), calls = [], server = { canManageCommands: true, guild: { id: "111111111111111111" }, channels: [{ id: "222222222222222222", type: 0 }], settings: { disabledCommands: ["ticket"] }, commandNames: ["ban", "help", "ticket", "ticket setup", "ticket panel"] };
    const configureEvents = [];
    const context = { $: () => root, el, current: server, CustomEvent: class { constructor(type, input) { this.type = type; this.detail = input.detail; } }, document: { dispatchEvent: event => configureEvents.push(event) }, fill: (select, choices) => { select.value = choices[0][0]; }, runDashboardAction: async input => { calls.push(input); server.settings.disabledCommands = input.sub === "enable" ? [] : [input.options.command]; } };
    runInNewContext(source.slice(source.indexOf("function renderCommandManager()"), source.indexOf("function renderActions(")), context);
    context.renderCommandManager();
    const toggle = name => flatten(root).find(node => node["aria-label"] === `Enable ${name}`);
    assert.equal(toggle("help").disabled, true);
    assert.equal(toggle("ticket setup").checked, false);
    assert.equal(toggle("ticket setup").disabled, true);
    toggle("ticket").checked = true;
    await toggle("ticket").change();
    assert.equal(calls[0].sub, "enable");
    assert.equal(calls[0].options.command, "ticket");
    assert.equal(toggle("ticket setup").disabled, false);
    flatten(root).find(node => node.id === "configure-command-ticket%20setup").click();
    assert.equal(configureEvents[0].type, "sonata-command-configure");
    assert.equal(configureEvents[0].detail.name, "ticket setup");
    toggle("ban").checked = false;
    await toggle("ban").change();
    assert.equal(calls[1].sub, "disable");
    assert.equal(calls[1].options.command, "ban");
    assert.equal(toggle("ban").checked, false);
    server.canManageCommands = false;
    context.renderCommandManager();
    assert.equal(toggle("ticket").disabled, true);
    delete server.canManageCommands;
    server.serverOwner = true;
    context.renderCommandManager();
    assert.equal(toggle("ticket").disabled, false);
    server.serverOwner = false;
    server.administrator = true;
    context.renderCommandManager();
    assert.equal(toggle("ticket").disabled, false);
    server.administrator = false;
    context.renderCommandManager();
    assert.equal(toggle("ticket").disabled, true);
});

test("Command configuration mounts inside its selected command without adding a tab", async () => {
    const source = await readFile(new URL("../public/command-setup.js", import.meta.url), "utf8");
    const listeners = new Map(), mounted = [], server = { manageable: true }, root = { isConnected: true, classList: { add() {} } };
    const context = { URLSearchParams, location: { search: "" }, document: { addEventListener: (type, callback) => listeners.set(type, callback) }, loadDashboardForms: async () => [], fetch: async () => ({ ok: true, json: async () => [] }), runDashboardAction() {} };
    runInNewContext(source.replace("export function mountCommandSetup", "function mountCommandSetup"), context);
    context.mountCommandSetup = (...args) => mounted.push(args);
    await listeners.get("sonata-server")({ detail: { current: server } });
    await listeners.get("sonata-command-configure")({ detail: { server, root, name: "alias set" } });
    assert.equal(mounted[0][0], root);
    assert.equal(mounted[0][4], "alias set");
});

test("Saved setup separates missing configuration, paused features and active settings", async () => {
    const source = await readFile(new URL("../public/bot.js", import.meta.url), "utf8"), context = {};
    runInNewContext(source.slice(source.indexOf("function setupStatus("), source.indexOf("async function openSavedSetting(")), context);
    assert.equal(context.setupStatus(undefined), "Not set up");
    assert.equal(context.setupStatus({ enabled: false }), "Paused");
    assert.equal(context.setupStatus({ enabled: true }), "On");
    assert.equal(context.setupStatus({ enabled: true }, true), "Paused");
});

test("Dashboard-wide search indexes accessible settings, commands, cases and tickets without exposing restricted tools", async () => {
    const source = await readFile(new URL("../public/dashboard-search.js", import.meta.url), "utf8");
    const context = { labels: { settings: "General settings" } };
    runInNewContext(source.slice(source.indexOf("function dashboardSearchEntries("), source.indexOf("const dashboardSearch =")), context);
    const server = { manageable: true, serverOwner: false, administrator: false, channels: [{ id: "1", name: "ticket-support" }], commandNames: ["snipe", "ban"], cases: [{ n: 12, kind: "warn", reason: "Repeated spam", actor: "staff-id", target: "member-id", status: "completed" }], tickets: [{ id: "ticket-id", channel: "1", owner: "ticket-owner", state: "open" }] };
    const tools = [{ name: "settings", options: [{ name: "snipe", description: "Deleted message history" }] }, { name: "antinuke", options: [{ name: "setup" }] }, { name: "fakepermissions", options: [{ name: "grant" }] }];
    const entries = context.dashboardSearchEntries(server, tools);
    assert.ok(entries.some(entry => entry.logging));
    assert.ok(entries.some(entry => entry.tool === "settings" && entry.action === "snipe"));
    assert.ok(entries.some(entry => entry.command === "ban"));
    assert.ok(entries.some(entry => entry.case === 12 && entry.keywords.includes("member-id")));
    assert.ok(entries.some(entry => entry.ticket === "1" && entry.name === "ticket-support"));
    assert.ok(!entries.some(entry => ["antinuke", "fakepermissions"].includes(entry.tool)));
    const readonly = context.dashboardSearchEntries({ ...server, manageable: false }, tools);
    assert.ok(readonly.every(entry => entry.kind === "Pages" && ["overview", "usage"].includes(entry.tab)));
});

test("Settings search finds nested commands and opens their exact action", async () => {
    const dashboard = await readFile(new URL("../public/bot.js", import.meta.url), "utf8");
    const nodes = new Map();
    const node = () => ({ children: [], value: "", hidden: false, append(child) { this.children.push(child); }, replaceChildren() { this.children = []; }, setAttribute(key, value) { this[key] = value; }, addEventListener(type, callback) { this[type] = callback; } });
    for (const id of ["tool-search", "tool-list", "tool-select", "action-select", "action-result", "selected-tool-title"]) nodes.set(id, node());
    nodes.get("tool-select").options = [{ value: "settings", text: "General settings" }];
    nodes.get("tool-select").value = "settings";
    nodes.get("tool-search").value = "snipe";
    const context = {
        $: id => nodes.get(id),
        forms: [{ name: "settings", options: [{ name: "prefix", description: "Set prefix" }, { name: "snipe", description: "Set deleted message history for all channels" }] }],
        labels: { settings: "General settings" },
        el: (tag, text) => Object.assign(node(), { tag, textContent: text }),
        fill: (select, values) => { select.value = values[0]?.[0] || ""; },
        renderFields() {},
    };
    runInNewContext(dashboard.slice(dashboard.indexOf("function renderToolList()"), dashboard.indexOf("function renderFields()")), context);
    context.renderToolList();
    assert.equal(nodes.get("tool-list").children.length, 1);
    assert.equal(nodes.get("tool-list").children[0].textContent, "General settings · snipe");
    nodes.get("tool-list").children[0].click();
    assert.equal(nodes.get("action-select").value, "snipe");
    assert.equal(nodes.get("tool-list").children[0]["aria-pressed"], "true");
    nodes.get("tool-search").value = "deleted message";
    context.renderToolList();
    assert.equal(nodes.get("tool-list").children[0].textContent, "General settings · snipe");
    context.forms.push({ name: "eventlog", options: [{ name: "set", description: "Enable one kind of event log", options: [{ choices: [{ name: "voice", value: "voice" }] }] }] });
    nodes.get("tool-select").options.push({ value: "eventlog", text: "Message, channel & event logs" });
    for (const query of ["message logs", "channel logs", "voice logs"]) {
        nodes.get("tool-search").value = query;
        context.renderToolList();
        assert.equal(nodes.get("tool-list").children[0].textContent, "Message, channel & event logs · set");
    }
    nodes.get("tool-search").value = "not-a-real-command";
    context.renderToolList();
    assert.equal(nodes.get("tool-list").children[0].textContent, "No matching commands or settings.");
    nodes.get("tool-search").value = "";
    context.renderToolList();
    assert.equal(nodes.get("tool-list").children[0].tag, "details");
    assert.equal(nodes.get("tool-list").children[0].children[0].children[0].textContent, "General & access");
});
