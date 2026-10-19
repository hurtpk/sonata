/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Reading 7-Zip's file listings — no Discord or Electron dependencies, so it's
// shared by the native side (archiveNative.ts) and Discord's window.

export interface ArchiveEntry {
    path: string;
    name: string;
    dir: boolean;
    size: number;
    modified: string | null;
    encrypted: boolean;
}

export class ArchiveError extends Error { }

/** Parse `7zz l -slt -ba` output into entries (folders implied by paths are added). */
export function parseListing(text: string): ArchiveEntry[] {
    const entries = new Map<string, ArchiveEntry>();
    for (const block of text.split(/\r?\n\r?\n+/)) {
        const fields: Record<string, string> = {};
        for (const raw of block.split(/\r?\n/)) {
            // Drop any progress-indicator junk (it redraws itself with backspaces).
            const line = raw.includes("\b") ? raw.slice(raw.lastIndexOf("\b") + 1) : raw;
            const i = line.indexOf(" = ");
            if (i > 0) fields[line.slice(0, i)] = line.slice(i + 3);
        }
        const rawPath = fields.Path;
        if (!rawPath) continue;
        const path = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
        const dir = fields.Folder === "+" || /D/.test(fields.Attributes ?? "");
        entries.set(path, {
            path,
            name: path.split("/").pop() || path,
            dir,
            size: dir ? 0 : Number(fields.Size) || 0,
            modified: fields.Modified || null,
            encrypted: fields.Encrypted === "+",
        });
    }
    // Make sure every parent folder exists as an entry.
    for (const e of [...entries.values()]) {
        const parts = e.path.split("/");
        for (let i = 1; i < parts.length; i++) {
            const parent = parts.slice(0, i).join("/");
            if (!entries.has(parent)) entries.set(parent, { path: parent, name: parts[i - 1], dir: true, size: 0, modified: null, encrypted: false });
        }
    }
    return [...entries.values()];
}

/** Direct children of a folder ("" = root), folders first, then by name. */
export function childrenOf(entries: ArchiveEntry[], folder: string) {
    const prefix = folder ? folder + "/" : "";
    return entries
        .filter(e => e.path.startsWith(prefix) && e.path !== folder && !e.path.slice(prefix.length).includes("/"))
        .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function explain(errText: string, code: number): string {
    if (/Wrong password|encrypted/i.test(errText)) return "This archive is password-protected, so it can't be previewed.";
    if (/Can ?not open the file as archive|Unexpected end|is not archive/i.test(errText)) return "This doesn't look like a valid archive (it may be damaged or incomplete).";
    if (/Unsupported/i.test(errText)) return "This archive uses a compression method that can't be opened here.";
    if (/Data Error|CRC Failed/i.test(errText)) return "The archive is damaged.";
    return errText.trim().split("\n").filter(Boolean).pop() || `7-Zip stopped with code ${code}`;
}

// A password that's never right: makes encrypted archives fail fast instead of prompting.
export const NO_PASSWORD = "-p\u0001opticord";

export function listingError(threw: boolean, err: string, code: number) {
    // A crash while reading the file list = locked (encrypted) list or a damaged file.
    return threw && !err.trim() ? "This archive is password-protected (or damaged), so it can't be previewed." : explain(err, code);
}
