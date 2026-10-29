/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const EFFECTS = {
    off: { rate: 1, filter: "anull" },
    bassboost: { rate: 1, filter: "bass=g=6:f=110:w=0.6" },
    nightcore: { rate: 1.25, filter: "aresample=48000,asetrate=60000,aresample=48000" },
    vaporwave: { rate: 0.8, filter: "aresample=48000,asetrate=38400,aresample=48000" },
};

export function audioFilter(effect, volume) {
    if (!Object.hasOwn(EFFECTS, effect) || !Number.isFinite(volume) || volume < 0 || volume > 100) throw new Error("Choose an available effect and a volume from zero to one hundred.");
    return `${EFFECTS[effect].filter},volume=${volume / 100},alimiter=limit=0.95:level=false`;
}
