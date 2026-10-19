/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The window side of archive previews: asks Sonata's native preview cache
// (previewCache.ts) to open archives and extract files on a background thread.

import { MediaNative } from "../_shared/media";
import { ArchiveEntry, ArchiveError, parseListing } from "./archiveText";

export type { ArchiveEntry } from "./archiveText";
export { ArchiveError, childrenOf } from "./archiveText";

export class Archive {
    private constructor(private id: string, public entries: ArchiveEntry[]) { }

    static async open(url: string, filename: string): Promise<Archive> {
        if (!MediaNative) throw new ArchiveError("Previewing archives needs the Discord desktop app.");
        const r = await MediaNative.openArchive(url, filename);
        if (!r.ok) throw new ArchiveError(r.error);
        return new Archive(r.id, parseListing(r.listing));
    }

    async extract(path: string): Promise<Uint8Array> {
        const r = await MediaNative!.extractFromArchive(this.id, path);
        if (!r.ok) throw new ArchiveError(r.error);
        return r.data;
    }

    /** Nothing to do: the cached archive stays until you switch channels. */
    close() { }
}
