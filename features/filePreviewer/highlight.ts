/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Colours for code files, from the highlighter Discord already ships for code
// blocks in chat (highlight.js) — nothing extra to download. Discord only
// loads it once a code block has been on screen, so until then (or for a
// language it doesn't know) code shows plain, like before.

import { findByPropsLazy } from "@webpack";

const hljs: any = findByPropsLazy("highlight", "registerLanguage");

/** File extension → the language name highlight.js knows it by (and the name to show). */
const LANGS: Record<string, [string, string]> = {
    js: ["javascript", "JavaScript"], mjs: ["javascript", "JavaScript"], cjs: ["javascript", "JavaScript"], jsx: ["javascript", "JavaScript (JSX)"],
    ts: ["typescript", "TypeScript"], tsx: ["typescript", "TypeScript (TSX)"],
    json: ["json", "JSON"], jsonc: ["json", "JSON"],
    py: ["python", "Python"], java: ["java", "Java"], kt: ["kotlin", "Kotlin"], kts: ["kotlin", "Kotlin"],
    c: ["c", "C"], h: ["c", "C header"], cpp: ["cpp", "C++"], hpp: ["cpp", "C++ header"], cc: ["cpp", "C++"], cs: ["csharp", "C#"],
    go: ["go", "Go"], rs: ["rust", "Rust"], rb: ["ruby", "Ruby"], php: ["php", "PHP"], swift: ["swift", "Swift"], dart: ["dart", "Dart"],
    lua: ["lua", "Lua"], r: ["r", "R"], pl: ["perl", "Perl"], sql: ["sql", "SQL"],
    html: ["xml", "HTML"], htm: ["xml", "HTML"], xml: ["xml", "XML"], svg: ["xml", "SVG"], vue: ["xml", "Vue"], svelte: ["xml", "Svelte"],
    css: ["css", "CSS"], scss: ["scss", "SCSS"],
    yml: ["yaml", "YAML"], yaml: ["yaml", "YAML"], toml: ["ini", "TOML"], ini: ["ini", "INI"], cfg: ["ini", "Config"], conf: ["ini", "Config"], properties: ["properties", "Properties"], env: ["bash", "Environment"],
    sh: ["bash", "Shell"], bash: ["bash", "Bash"], zsh: ["bash", "Zsh"], bat: ["dos", "Batch"], cmd: ["dos", "Batch"], ps1: ["powershell", "PowerShell"],
    gradle: ["groovy", "Gradle"], dockerfile: ["dockerfile", "Dockerfile"], makefile: ["makefile", "Makefile"],
    diff: ["diff", "Diff"], patch: ["diff", "Diff"], md: ["markdown", "Markdown"], markdown: ["markdown", "Markdown"],
};

/** Plain-text kinds that read better wrapped (and have no colours). */
export const isCode = (ext: string) => ext in LANGS && ext !== "md" && ext !== "markdown";
export const languageName = (ext: string) => LANGS[ext]?.[1];

/** Bigger than this, colouring would make the window slow to open, so it stays plain. */
export const MAX_COLOURED = 400 * 1024;

/** The code as highlighted HTML (highlight.js escapes the text itself), or null to show it plain. */
export function highlight(text: string, ext: string): string | null {
    const lang = LANGS[ext]?.[0];
    if (!lang || text.length > MAX_COLOURED) return null;
    try {
        if (!hljs.getLanguage?.(lang)) return null;
        return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value as string;
    } catch {
        // Discord hasn't loaded its highlighter yet.
        return null;
    }
}
