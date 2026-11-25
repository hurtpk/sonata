/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const sonata = path.resolve(__dirname, "..");
const root = path.resolve(sonata, "../../..");
const dummy = new Proxy(function () { return dummy; }, { get: (_target, key) => key === "__esModule" ? true : dummy });

function patches(file) {
    const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
    }).outputText;
    const exports = {};
    vm.runInNewContext(source, {
        exports,
        require: name => name === "@utils/types" ? { __esModule: true, default: plugin => plugin, OptionType: dummy } : dummy
    });
    return exports.default.patches;
}

function apply(source, patch) {
    for (const replacement of [].concat(patch.replacement)) {
        const match = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)").replaceAll(/#\{intl::\w+\}/g, "\\.MEMBER_SINCE"), replacement.match.flags);
        assert.match(source, match);
        const replace = typeof replacement.replace === "function" ? (...args) => replacement.replace(...args).replaceAll("$self", "plugin") : replacement.replace.replaceAll("$self", "plugin");
        source = source.replace(match, replace);
    }
    new vm.Script(source);
    return source;
}

test("Profile section extraction accepts badges and reordered section properties", () => {
    const patch = patches("src/plugins/_core/concatenatedComponentExtractor.tsx")[2];
    const source = "function section(e){let{children:c,heading:h,showNitroIcon:n=false,badge:b}=e;return[c,h,n,b]}";
    let section;
    vm.runInNewContext(apply(source, patch), { plugin: { setNewCustomizationSection: value => { section = value; } } });
    assert.equal(section.name, "section");
});

test("Sidebar profile sections do not require the wishlist to follow member since", () => {
    const patch = patches("src/equicordplugins/_api/profileSections.ts")[0];
    const source = "function profile(user){return [x({heading:intl.string(intl.MEMBER_SINCE),children:x({userId:user.id})}),x({widgets:[]})]}";
    assert.match(apply(source, patch), /renderProfileSections\(\{userId:user.id,isSideBar:true\}\)/);
});

test("Stage callbacks keep the channel from the outer component", () => {
    const patch = patches("src/plugins/showHiddenChannels/index.tsx").find(p => String(p.find).includes("screenMessage"));
    const source = 'function stage(e){let{channel:c}=e,p=false;return {style:{height:`calc(100% - ${p})`,paddingTop:p},disableGradients:false,renderBottomCenter:()=>1,renderChatToasts:function(){return 2},screenMessage:p?{mainText:"Popout"}:null,children:!p&&3}}';
    for (const hidden of [false, true]) {
        const channel = {};
        const context = { plugin: { isHiddenChannel: value => { assert.equal(value, channel); return hidden; }, HiddenChannelLockScreen: () => "locked" } };
        vm.runInNewContext(apply(source, patch), context);
        const props = context.stage({ channel });
        assert.equal(props.renderBottomCenter(), hidden ? null : 1);
        assert.equal(props.renderChatToasts(), hidden ? null : 2);
        assert.equal(props.children, hidden ? "locked" : 3);
        assert.equal(props.disableGradients, hidden);
        assert.equal(props.style === undefined, hidden);
    }
});

test("Better Folders accepts Discord's leading temporary variables", () => {
    const patch = patches("src/plugins/betterFolders/index.tsx")[0];
    const source = "function bar(e){let n,a,{disableAppDownload:u=platform.isPlatformEmbedded,isOverlay:o=false}=e;return {isBetterFolders,betterFoldersExpandedIds}}";
    const result = apply(source, { replacement: patch.replacement[0] });
    const context = { platform: { isPlatformEmbedded: true } };
    vm.runInNewContext(result, context);
    assert.equal(context.bar({ isBetterFolders: true, betterFoldersExpandedIds: 4 }).betterFoldersExpandedIds, 4);
});

test("Platform patch updates identify properties while preserving connection fields", () => {
    const patch = patches("src/userplugins/sonata/features/platformSpoofer/index.tsx")[0];
    const source = 'function identify(properties){return {token:"test",capabilities:1767421,properties:properties,presence:null}}';
    const context = { plugin: { getPlatform: () => ({ browser: "Discord Android" }) } };
    vm.runInNewContext(apply(source, { replacement: patch.replacement[1] }), context);
    const payload = context.identify({ os: "Windows", browser: "Discord Client" });
    assert.equal(payload.properties.browser, "Discord Android");
    assert.equal(payload.properties.os, "Windows");
    assert.equal(payload.token, "test");
    assert.equal(payload.presence, null);
});
