/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export type PreviewKind = "pdf" | "table" | "text" | "archive" | "font" | "video";

const TEXT_EXT = new Set([
    "txt", "md", "markdown", "log", "json", "jsonc", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "java", "c", "h", "cpp", "hpp", "cc",
    "cs", "go", "rs", "rb", "php", "html", "htm", "css", "scss", "xml", "svg", "yml", "yaml", "ini", "cfg", "conf", "toml", "sh", "bash",
    "zsh", "bat", "cmd", "ps1", "sql", "lua", "kt", "kts", "swift", "dart", "r", "pl", "vue", "svelte", "gradle", "properties", "env",
    "gitignore", "dockerfile", "makefile", "diff", "patch", "srt", "vtt", "nfo", "rtf",
]);

export const LIMITS: Record<PreviewKind, number> = {
    // PDFs and archives go through the on-disk preview cache (cleared when you switch channels).
    pdf: 1024 * 1048576,
    table: 10 * 1048576,
    text: 5 * 1048576,
    // Streamed to a temp file and read by 7-Zip from disk — never held in memory.
    archive: 1024 * 1048576,
    font: 20 * 1048576,
    // Streamed as it plays — never downloaded in full.
    video: Infinity,
};

const ARCHIVE_EXT = new Set(["rar", "7z", "zip"]);
const FONT_EXT = new Set(["ttf", "otf", "woff", "woff2"]);

export function extensionOf(filename: string) {
    const lower = filename.toLowerCase();
    if (lower === "dockerfile" || lower === "makefile") return lower;
    const dot = lower.lastIndexOf(".");
    return dot >= 0 ? lower.slice(dot + 1) : "";
}

/** What kind of preview a file gets, or null if it can't be previewed. */
export function previewKind(filename: string, contentType?: string | null): PreviewKind | null {
    const ext = extensionOf(filename);
    if (ext === "pdf" || contentType === "application/pdf") return "pdf";
    if (ARCHIVE_EXT.has(ext)) return "archive";
    if (FONT_EXT.has(ext) || contentType?.startsWith("font/")) return "font";
    if (ext === "mkv" || contentType === "video/x-matroska") return "video";
    if (ext === "csv" || ext === "tsv" || contentType === "text/csv") return "table";
    if (TEXT_EXT.has(ext) || contentType?.startsWith("text/")) return "text";
    return null;
}

export function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** Decode bytes as text; null if it's clearly a binary file. */
export function decodeText(bytes: Uint8Array): string | null {
    const sample = bytes.subarray(0, 8192);
    let zeros = 0;
    for (const b of sample) if (b === 0) zeros++;
    if (zeros > sample.length * 0.01) return null;
    return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}

/** Pick the delimiter that splits the first lines most consistently. */
export function guessDelimiter(text: string, filename = ""): string {
    if (extensionOf(filename) === "tsv") return "\t";
    const head = text.split(/\r?\n/).slice(0, 10).filter(Boolean);
    let best = ",", bestScore = -1;
    for (const d of [",", ";", "\t", "|"]) {
        const counts = head.map(l => l.split(d).length - 1);
        if (!counts.length || counts[0] === 0) continue;
        const consistent = counts.filter(c => c === counts[0]).length;
        const score = consistent * 100 + counts[0];
        if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
}

/** RFC 4180-style CSV: quoted fields, "" escapes, and line breaks inside quotes. */
export function parseCsv(text: string, delimiter: string, maxRows = Infinity): { rows: string[][]; truncated: boolean; } {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
            } else field += c;
            continue;
        }
        if (c === '"' && field === "") { quoted = true; continue; }
        if (c === delimiter) { row.push(field); field = ""; continue; }
        if (c === "\n" || c === "\r") {
            if (c === "\r" && text[i + 1] === "\n") i++;
            row.push(field); field = "";
            rows.push(row); row = [];
            if (rows.length >= maxRows) return { rows, truncated: i < text.length - 1 };
            continue;
        }
        field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return { rows, truncated: false };
}
