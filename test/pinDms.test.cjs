/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const base = path.join(__dirname, '..');
const React = { createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : { type, props: props ?? {}, children } };
const classes = (...parts) => parts.filter(Boolean).join(' ');
function load(file, require) {
    const context = { exports: {}, React, require };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(base, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
    return context.exports;
}
const effects = load('features/_shared/NameEffects.tsx', name => name === '@utils/misc' ? { classes } : {});
const { StyledName } = load('features/pinDms/style.tsx', name => name === '@utils/misc' ? { classes } : name.includes('accent') ? { GRADIENTS: [] } : effects);
const labels = [
    { name: '˶ᵔ ᵕ ᵔ˶', color: 0xffffff, style: { mode: 'gradient', gradient: 'custom', a: '#ffffff', b: '#f6c7ff', angle: 90, effects: ['shine', 'glow', 'sparkles', 'flow'] } },
    { name: '⪩. .⪨', color: 0x8f8f8f, style: { mode: 'solid', effects: ['shine', 'glow'] } },
    { name: '$$$', color: 0x2ecc71, style: { mode: 'solid', effects: ['shine', 'glow', 'sparkles'] } },
    { name: 'A long pinned category name that should truncate', color: 0xffffff, style: { mode: 'solid', effects: ['sparkles'] } }
];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function html(node) {
    if (node == null || node === false) return '';
    if (Array.isArray(node)) return node.map(html).join('');
    if (typeof node !== 'object') return escape(node);
    if (node.type == null) return html(node.children);
    const attrs = Object.entries(node.props).map(([key, value]) => key === 'style' ? ' style="' + escape(Object.entries(value).map(([k, v]) => k + ':' + v).join(';')) + '"' : value === true ? ' ' + key : value == null ? '' : ' ' + (key === 'className' ? 'class' : key) + '="' + escape(value) + '"').join('');
    return '<' + node.type + attrs + '>' + html(node.children) + '</' + node.type + '>';
}

test('Sparkles separates the label state from its positioned particles', () => {
    const name = StyledName(labels[0]);
    assert(name.props.className.includes('vc-namefx-has-sparkles'));
    assert(!name.props.className.split(' ').includes('vc-namefx-sparkles'));
    assert.equal(name.children[1].children[0].props.className, 'vc-namefx-sparkles');
    assert(effects.effectClasses(['sparkles', 'glow'], false).includes('vc-namefx-has-sparkles'));
});

const executable = process.env.SONATA_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
test('Sparkle category names remain inside native headers at narrow widths and zoom levels', { skip: !fs.existsSync(executable) }, async () => {
    const browser = await require('puppeteer-core').launch({ executablePath: executable, headless: true });
    try {
        const page = await browser.newPage();
        const css = fs.readFileSync(path.join(base, 'features/pinDms/styles.css'), 'utf8') + fs.readFileSync(path.join(base, 'features/_shared/nameEffects.css'), 'utf8');
        await page.setContent('<!doctype html><meta charset="utf-8"><style>body{background:#000;color:#ddd;font:14px Arial;--font-display:Arial;--channels-default:#ddd;margin:20px}.columns{display:flex;gap:24px}.section{height:24px;overflow:hidden;margin-top:12px}.native-header{height:24px;padding:0 8px 4px 16px;display:flex;align-items:center}.native-text{flex:1;margin-right:8px;overflow:hidden;text-overflow:ellipsis}' + css + '</style><div class="columns">' + [120, 280].map(width => '<div style="width:' + width + 'px">' + labels.map(label => '<div class="section"><div class="vc-pindms-header"><h2 class="native-header vc-pindms-section-container"><span class="native-text vc-pindms-header-text">' + html(StyledName(label)) + '</span><svg class="vc-pindms-collapse-icon" viewBox="0 0 24 24"><path stroke="white" d="M9 5l6 7-6 7"/></svg></h2></div></div>').join('') + '</div>').join('') + '</div>');
        await page.$$eval('.vc-pindms-name', names => names.forEach(name => name.classList.replace('vc-namefx-has-sparkles', 'vc-namefx-sparkles')));
        assert(await page.$eval('.vc-pindms-name', name => getComputedStyle(name).position === 'absolute'), 'The old class reproduces the misplaced label');
        await page.$$eval('.vc-pindms-name', names => names.forEach(name => name.classList.replace('vc-namefx-sparkles', 'vc-namefx-has-sparkles')));
        for (const deviceScaleFactor of [1, 1.25, 1.5]) {
            await page.setViewport({ width: 500, height: 210, deviceScaleFactor });
            const rows = await page.$$eval('.vc-pindms-name', names => names.map(name => {
                const text = name.firstElementChild, r = text.getBoundingClientRect(), h = name.closest('h2').getBoundingClientRect();
                return { name: text.textContent, position: getComputedStyle(name).position, top: r.top - h.top, bottom: h.bottom - r.bottom, height: r.height };
            }));
            for (const row of rows) {
                assert.equal(row.position, 'relative', JSON.stringify(row));
                assert(row.top >= 0 && row.bottom >= 0 && row.height <= 24, JSON.stringify(row));
            }
        }
        await page.screenshot({ path: path.join(os.tmpdir(), 'sonata-pin-labels-verified.png') });
    } finally {
        await browser.close();
    }
});
