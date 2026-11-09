/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const base = path.join(__dirname, "..");
const guilds = [{ id: "100000000000000001", name: "Sonata configuration", icon: null }, { id: "100000000000000002", name: "Another server", icon: null }];

function fixture() {
    let query = "";
    const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.length === 1 ? children[0] : children } }) };
    const common = { React, Dialog: "Dialog", TextInput: "TextInput", Popout: "Popout", useRef: () => ({ current: null }), useState: () => [query, value => { query = value; }], useStateFromStores: (_stores, select) => select(), lodash: { isEqual() {} }, GuildMemberStore: { getMemberIds: () => ["a", "b"] }, GuildStore: { getGuilds: () => Object.fromEntries(guilds.map(guild => [guild.id, guild])) }, IconUtils: { getGuildIconURL: () => null } };
    const context = { exports: {}, require: name => name === "@webpack/common" ? common : name === "@components/Button" ? { Button: "Button" } : name === "@utils/discord" ? { getGuildAcronym: guild => guild.name[0] } : {} };
    const source = fs.readFileSync(path.join(base, "features/serverInsights/serverInfo/GuildHeader.tsx"), "utf8") + "\nexports.ServerList = ServerList;";
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
    return context.exports;
}
function nodes(node, predicate) {
    if (!node || typeof node !== "object") return [];
    if (Array.isArray(node)) return node.flatMap(item => nodes(item, predicate));
    return [...(predicate(node) ? [node] : []), ...nodes(node.props?.children, predicate)];
}
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function html(node) {
    if (node == null || node === false) return "";
    if (Array.isArray(node)) return node.map(html).join("");
    if (typeof node !== "object") return escape(node);
    if (node.type === "Popout") return html(node.props.children({}));
    const tag = node.type === "Button" ? "button" : node.type;
    const attrs = Object.entries(node.props).filter(([key, value]) => !["children", "ref", "variant", "size"].includes(key) && !key.startsWith("on") && value != null && typeof value !== "object").map(([key, value]) => ` ${key === "className" ? "class" : key}="${escape(value)}"`).join("");
    return `<${tag}${attrs}>${html(node.props.children)}</${tag}>`;
}

test("The server switcher sits in the server bar, searches IDs and names, and selects without a native dropdown", () => {
    const component = fixture();
    let selected, closed = false;
    const header = component.GuildHeader({ guild: guilds[0], onChange: id => { selected = id; } });
    const popout = nodes(header, node => node.type === "Popout")[0];
    const button = popout.props.children({});
    assert.equal(button.props["aria-label"], "Change server");
    assert.equal(nodes(header, node => node.type === "select").length, 0);
    const picker = popout.props.renderPopout({ closePopout: () => { closed = true; } });
    const list = component.ServerList(picker.props);
    nodes(list, node => node.type === "TextInput")[0].props.onChange(guilds[1].id);
    const result = component.ServerList(picker.props);
    const options = nodes(result, node => node.type === "Button");
    assert.equal(options.length, 1); options[0].props.onClick();
    assert.equal(selected, guilds[1].id); assert.equal(closed, true);
});

const executable = process.env.SONATA_TEST_BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
test("The Insights server arrow stays inside the right edge at narrow and wide panel widths", { skip: !fs.existsSync(executable) }, async () => {
    const browser = await require("puppeteer-core").launch({ executablePath: executable, headless: true });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1040, height: 500 });
        const component = fixture();
        const css = fs.readFileSync(path.join(base, "features/_shared/window.css"), "utf8") + fs.readFileSync(path.join(base, "features/serverInsights/serverInfo/styles.css"), "utf8");
        const header = html(component.GuildHeader({ guild: { ...guilds[0], name: "A long server name that should wrap without hiding the server picker" }, onChange() {} }));
        await page.setContent(`<meta charset="utf-8"><style>body{margin:0;padding:30px;background:#09090b;color:#eee;font:14px Arial}*{box-sizing:border-box}button{font:inherit;color:inherit;background:transparent}main{--tl-line:#2a292f;--sw-card:#151519;--text-muted:#aaa;--text-normal:#eee;width:800px}.vc-gp-server-switch{width:36px;height:36px}</style><style>${css}</style><main>${header}<p>Server details, roles and members</p></main>`);
        for (const width of [340, 550, 800]) {
            await page.$eval("main", (element, width) => { element.style.width = width + "px"; }, width);
            const rects = await page.evaluate(() => {
                const header = document.querySelector(".vc-gp-hero").getBoundingClientRect();
                const arrow = document.querySelector('[aria-label="Change server"]').getBoundingClientRect();
                return { inside: arrow.right <= header.right && arrow.top >= header.top && arrow.bottom <= header.bottom, rightGap: header.right - arrow.right, width: arrow.width, overflow: document.querySelector(".vc-gp-hero").scrollWidth > header.width };
            });
            assert.equal(rects.inside, true, JSON.stringify(rects)); assert.ok(rects.rightGap <= 22, JSON.stringify(rects)); assert.ok(rects.width >= 30); assert.equal(rects.overflow, false);
        }
        await page.screenshot({ path: path.join(os.tmpdir(), "sonata-insights-verified.png") });
    } finally { await browser.close(); }
});
