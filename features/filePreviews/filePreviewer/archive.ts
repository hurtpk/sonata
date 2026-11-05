/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The window side of archive previews: asks Sonata's native preview cache
// (previewCache.ts) to open archives and extract files on a background thread.

import { unzipSync } from "fflate";

import { MediaNative } from "../../_shared/media";
import { ArchiveEntry, ArchiveError, parseListing } from "./archiveText";

export type { ArchiveEntry } from "./archiveText";
export { ArchiveError, childrenOf } from "./archiveText";

export class Archive {
    private constructor(public entries: ArchiveEntry[], public extract: (path: string) => Promise<Uint8Array>) { }

    static async open(url: string, filename: string): Promise<Archive> {
        const native = MediaNative;
        if (native) {
            const result = await native.openArchive(url, filename);
            if (!result.ok) throw new ArchiveError(result.error);
            return new Archive(parseListing(result.listing), async path => {
                const entry = await native.extractFromArchive(result.id, path);
                if (!entry.ok) throw new ArchiveError(entry.error);
                return entry.data;
            });
        }
        if (!/\.zip$/i.test(filename)) throw new ArchiveError("RAR and 7z previews need the Discord desktop app.");
        const response = await fetch(url, { credentials: "omit" });
        const reader = response.body?.getReader();
        if (!response.ok || !reader) throw new ArchiveError("Could not fetch this ZIP.");
        const chunks: Uint8Array<ArrayBuffer>[] = [];
        let size = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 50 * 1024 * 1024) throw new ArchiveError("This ZIP exceeds the 50 MB browser preview limit.");
                chunks.push(value);
            }
        } finally {
            await reader.cancel();
        }
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        const entries = new Map<string, ArchiveEntry>();
        const names = new Map<string, string>();
        unzipSync(bytes, { filter: ({ name, originalSize }) => {
            const parts = name.replaceAll("\\", "/").split("/").filter(Boolean);
            if (!parts.length || parts.some(part => part === "." || part === ".." || /[\x00-\x1f]/.test(part))) return false;
            for (let length = 1; length <= parts.length; length++) {
                const path = parts.slice(0, length).join("/");
                const dir = length < parts.length || name.endsWith("/");
                if (dir && entries.has(path)) continue;
                if (entries.size >= 1000) throw new ArchiveError("This ZIP has too many entries to preview in the browser.");
                entries.set(path, { path, name: parts[length - 1], dir, size: dir ? 0 : originalSize, modified: null, encrypted: false });
                if (!dir) names.set(path, name);
            }
            return false;
        } });
        return new Archive([...entries.values()], async path => {
            const entry = entries.get(path);
            const name = names.get(path);
            if (!entry || !name || entry.size > 10 * 1024 * 1024) throw new ArchiveError("This file cannot be opened in the browser preview.");
            const data = unzipSync(bytes, { filter: info => info.name === name && info.originalSize >= 0 && info.originalSize <= 10 * 1024 * 1024 });
            if (!Object.hasOwn(data, name)) throw new ArchiveError("Could not extract this file.");
            return data[name];
        });
    }

    /** Nothing to do: the cached archive stays until you switch channels. */
    close() { }
}
