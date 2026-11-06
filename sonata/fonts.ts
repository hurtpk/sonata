/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import bodoni from "file://../service/public/bodoni.woff2?base64";
import space from "file://../service/public/space.woff2?base64";

const fonts = [
    ["Sonata Bodoni", bodoni],
    ["Sonata Space", space],
] as const;
let faces: FontFace[] = [];

export function startFonts() {
    if (faces.length) return;
    faces = fonts.map(([family, data]) => {
        const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
        const face = new FontFace(family, bytes, { weight: "400 700" });
        document.fonts.add(face);
        return face;
    });
}

export function stopFonts() {
    for (const face of faces) document.fonts.delete(face);
    faces = [];
}
