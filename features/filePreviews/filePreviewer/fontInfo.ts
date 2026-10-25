/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Read a font's own name ("Inter", "Bold") from its 'name' table. Works for
// TTF/OTF; WOFF/WOFF2 are compressed, so those just show the file name.

export interface FontInfo { family?: string; style?: string; fullName?: string; version?: string; }

export function readFontInfo(bytes: Uint8Array): FontInfo {
    try {
        const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const tag = v.getUint32(0);
        // TrueType (0x00010000), OpenType CFF ('OTTO'), or 'true'
        if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return {};
        const numTables = v.getUint16(4);
        let nameOffset = -1;
        for (let i = 0; i < numTables; i++) {
            const rec = 12 + i * 16;
            if (v.getUint32(rec) === 0x6e616d65 /* 'name' */) { nameOffset = v.getUint32(rec + 8); break; }
        }
        if (nameOffset < 0) return {};
        const count = v.getUint16(nameOffset + 2);
        const strings = nameOffset + v.getUint16(nameOffset + 4);
        const found: Record<number, string> = {};
        for (let i = 0; i < count; i++) {
            const r = nameOffset + 6 + i * 12;
            const platform = v.getUint16(r);
            const nameId = v.getUint16(r + 6);
            const len = v.getUint16(r + 8);
            const off = strings + v.getUint16(r + 10);
            if (![1, 2, 4, 5, 16, 17].includes(nameId)) continue;
            let text = "";
            if (platform === 3 || platform === 0) {
                for (let j = 0; j + 1 < len; j += 2) text += String.fromCharCode(v.getUint16(off + j));
            } else if (platform === 1) {
                for (let j = 0; j < len; j++) text += String.fromCharCode(v.getUint8(off + j));
            } else continue;
            // Prefer Windows/Unicode names over Mac ones.
            if (!found[nameId] || platform !== 1) found[nameId] = text;
        }
        return {
            family: found[16] || found[1],
            style: found[17] || found[2],
            fullName: found[4],
            version: found[5]?.replace(/^Version\s*/i, ""),
        };
    } catch {
        return {};
    }
}
