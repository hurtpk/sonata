/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Text data: CSV / TSV / JSON / YAML / Markdown / plain text, each into the
// others where it makes sense (a table becomes a list of rows, Markdown
// becomes a web page, and so on).

import yaml from "js-yaml";

import { extOf } from "./formats";

// ─── CSV ───

export function parseDelimited(text: string, sep: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === "\"") { if (text[i + 1] === "\"") { cell += "\""; i++; } else quoted = false; }
            else cell += c;
        } else if (c === "\"" && !cell) quoted = true;
        else if (c === sep) { row.push(cell); cell = ""; }
        else if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(cell); rows.push(row); row = []; cell = "";
        } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c !== ""));
}

const cellOut = (v: unknown, sep: string) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, "\"\"")}"` : s;
};

/** Rows of objects (from JSON / YAML) → a table: one column per key. */
function toTable(value: unknown): string[][] {
    if (Array.isArray(value)) {
        if (value.every(Array.isArray)) return value.map(r => (r as unknown[]).map(c => c as string));
        if (value.every(v => v && typeof v === "object")) {
            const keys = [...new Set(value.flatMap(v => Object.keys(v as object)))];
            return [keys, ...value.map(v => keys.map(k => (v as any)[k]))];
        }
        return [["value"], ...value.map(v => [v as string])];
    }
    if (value && typeof value === "object") return [["key", "value"], ...Object.entries(value).map(([k, v]) => [k, v as string])];
    return [["value"], [value as string]];
}

/** A table → rows of objects keyed by the header row (numbers and true/false come back as such). */
function fromTable(rows: string[][]): Record<string, unknown>[] {
    const [head = [], ...body] = rows;
    const typed = (s: string): unknown => s === "" ? "" : /^-?\d+(\.\d+)?$/.test(s) && !/^-?0\d/.test(s) ? Number(s) : s === "true" ? true : s === "false" ? false : s;
    return body.map(r => Object.fromEntries(head.map((h, i) => [h || `column${i + 1}`, typed(r[i] ?? "")])));
}

// ─── Markdown → HTML ───

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(s: string) {
    return esc(s)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => /^https?:/i.test(src) ? `<img alt="${alt}" src="${src}">` : alt)
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => /^(https?:|mailto:|#)/i.test(href) ? `<a href="${href}">${t}</a>` : t)
        .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
        .replace(/\*([^*]+)\*|_([^_]+)_/g, (_, a, b) => `<em>${a ?? b}</em>`)
        .replace(/~~([^~]+)~~/g, "<del>$1</del>")
        .replace(/\|\|([^|]+)\|\|/g, "<span class=\"spoiler\">$1</span>");
}

export function markdownToHtml(md: string, title = "Document") {
    const lines = md.replace(/\r\n?/g, "\n").split("\n");
    const out: string[] = [];
    let i = 0;
    const para: string[] = [];
    const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para.length = 0; } };
    while (i < lines.length) {
        const l = lines[i];
        let m: RegExpMatchArray | null;
        if (/^```/.test(l)) {
            flush();
            const lang = l.slice(3).trim(), code: string[] = [];
            while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
            out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(code.join("\n"))}</code></pre>`);
            i++;
            continue;
        }
        if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); }
        else if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { flush(); out.push("<hr>"); }
        else if (/^>\s?/.test(l)) {
            flush();
            const q: string[] = [];
            while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
            out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
            continue;
        } else if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
            flush();
            const ordered = /^\s*\d/.test(l), items: string[] = [];
            while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
                const t = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, "");
                const box = t.match(/^\[( |x)\]\s+(.*)$/i);
                items.push(box ? `<li><input type="checkbox" disabled${box[1] !== " " ? " checked" : ""}> ${inline(box[2])}</li>` : `<li>${inline(t)}</li>`);
            }
            out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
            continue;
        } else if (/^\|.*\|\s*$/.test(l) && /^\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) {
            flush();
            const cells = (r: string) => r.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
            const head = cells(l);
            i += 2;
            const body: string[][] = [];
            while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
            out.push(`<table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
            continue;
        } else if (!l.trim()) flush();
        else para.push(l.trim());
        i++;
    }
    flush();
    return page(title, out.join("\n"));
}

function page(title: string, body: string) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
body { max-width: 760px; margin: 40px auto; padding: 0 20px; font: 16px/1.6 system-ui, "Segoe UI", sans-serif; color: #1f2328; background: #fff; }
pre { background: #f6f8fa; padding: 12px 14px; border-radius: 8px; overflow: auto; } code { font-family: Consolas, ui-monospace, monospace; font-size: 0.92em; }
:not(pre) > code { background: #eff1f3; padding: 0.1em 0.35em; border-radius: 4px; }
blockquote { margin: 0; padding: 0 1em; border-left: 4px solid #d0d7de; color: #59636e; }
table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: 6px 12px; } th { background: #f6f8fa; }
.spoiler { background: #1f2328; color: transparent; border-radius: 3px; } .spoiler:hover { color: #fff; }
img { max-width: 100%; }
@media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } pre, th { background: #161b22; } :not(pre) > code { background: #262c36; } th, td { border-color: #30363d; } }
</style></head><body>
${body}
</body></html>
`;
}

// ─── Any → any ───

/** What's in a data file, read by its type. */
function read(text: string, ext: string): { value: unknown; table?: string[][]; text: string; markdown?: boolean; } {
    if (ext === "csv" || ext === "tsv") {
        const table = parseDelimited(text, ext === "tsv" ? "\t" : guessSeparator(text));
        return { value: fromTable(table), table, text };
    }
    if (ext === "json") {
        try { return { value: JSON.parse(text), text }; } catch (e) { throw new Error(`This JSON has a mistake in it: ${e instanceof Error ? e.message : e}`); }
    }
    if (ext === "yaml" || ext === "yml") {
        try { return { value: yaml.load(text), text }; } catch (e) { throw new Error(`This YAML has a mistake in it: ${e instanceof Error ? e.message.split("\n")[0] : e}`); }
    }
    return { value: text, text, markdown: ext === "md" || ext === "markdown" };
}

/** CSV files use commas, semicolons (in much of Europe) or tabs. */
function guessSeparator(text: string) {
    const first = text.split(/\r?\n/, 1)[0];
    const counts = [",", ";", "\t", "|"].map(s => [s, first.split(s).length] as const).sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 1 ? counts[0][0] : ",";
}

export async function convertData(file: File, target: string): Promise<string> {
    const text = await file.text();
    const ext = extOf(file.name) || (file.type === "application/json" ? "json" : "txt");
    const { value, table, markdown } = read(text, ext);
    const title = file.name.replace(/\.[^.]+$/, "");
    switch (target) {
        case "json": return JSON.stringify(value, null, 2) + "\n";
        case "json-min": return JSON.stringify(value);
        case "yaml": return yaml.dump(value);
        case "csv": case "tsv": {
            const sep = target === "tsv" ? "\t" : ",";
            const rows = table ?? (typeof value === "string" ? value.split(/\r?\n/).map(l => [l]) : toTable(value));
            return rows.map(r => r.map(c => cellOut(c, sep)).join(sep)).join("\r\n") + "\r\n";
        }
        case "html": {
            if (markdown || typeof value === "string") return markdownToHtml(markdown ? text : "```\n" + text + "\n```", title);
            const rows = table ?? toTable(value);
            const [head, ...body] = rows;
            return page(title, `<table><thead><tr>${head.map(h => `<th>${esc(String(h ?? ""))}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${esc(typeof c === "object" ? JSON.stringify(c) : String(c ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        }
        case "txt": {
            if (typeof value === "string") return markdown ? stripMarkdown(text) : text;
            return table ? table.map(r => r.join("\t")).join("\n") : yaml.dump(value);
        }
        default: throw new Error(`Can't make ${target} files`);
    }
}

const stripMarkdown = (md: string) => md
    .replace(/```[^\n]*\n([\s\S]*?)```/g, "$1")
    .replace(/^#{1,6}\s+/gm, "").replace(/^>\s?/gm, "").replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__|~~|\|\|)(.*?)\1/g, "$2").replace(/([*_])(.*?)\1/g, "$2").replace(/`([^`]+)`/g, "$1");
