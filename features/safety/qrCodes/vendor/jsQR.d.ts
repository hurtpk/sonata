/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Types for the vendored jsQR build (the subset Sonata uses).
export interface QRCode {
    data: string;
    location: unknown;
}
declare function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: { inversionAttempts?: "dontInvert" | "onlyInvert" | "attemptBoth" | "invertFirst"; }
): QRCode | null;
export default jsQR;
