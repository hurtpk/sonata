/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Types for the vendored qrcode-generator build (the subset Sonata uses).
// qrcode-generator — Copyright (c) 2009 Kazuhiko Arase — MIT license.

export interface QRCode {
    addData(data: string, mode?: "Numeric" | "Alphanumeric" | "Byte" | "Kanji"): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
}

declare function qrcode(typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H"): QRCode;

declare namespace qrcode {
    let stringToBytes: (s: string) => number[];
}

export default qrcode;
