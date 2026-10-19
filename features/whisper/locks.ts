/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Choosing who can read a secret, and the keys for reading them.

import type { Keyring, Opened, Seal } from "./codec";
import { getBook, getPairs, labelFor, loadKeys, Pair, pairById, pairKey, pairWith } from "./keys";

/** Who can read a secret, as picked in the window. */
export type Choice = { kind: "sonata"; } | { kind: "password"; password: string; } | { kind: "pair"; userId: string; };

export async function sealOf(c: Choice): Promise<Seal | null> {
    if (c.kind === "sonata") return { kind: "sonata" };
    if (c.kind === "password") return c.password ? { kind: "password", password: c.password } : null;
    await loadKeys();
    const p = pairWith(c.userId);
    return p ? { kind: "pair", pairId: p.id, key: await pairKey(p) } : null;
}

export async function keyring(extra: string[] = []): Promise<Keyring> {
    await loadKeys();
    return {
        passwords: [...extra, ...getBook().map(b => b.password)],
        pairKey: async id => { const p = pairById(id); return p ? pairKey(p) : null; },
    };
}

export function lockLabel(l: Opened["lock"]) {
    if (l.kind === "sonata") return "Anyone with Sonata";
    if (l.kind === "password") return labelFor(l.password) ?? "A password";
    const p = pairById(l.pairId);
    return p ? `Just you & ${p.name}` : "Just the two of you";
}

export const lockIcon = (l: Opened["lock"]) => l.kind === "sonata" ? "🤫" : l.kind === "password" ? "🔑" : "🤝";

/** The same lock again, for replying. */
export function choiceFrom(l: Opened["lock"]): Choice {
    if (l.kind === "password") return { kind: "password", password: l.password };
    if (l.kind === "pair") { const p: Pair | undefined = pairById(l.pairId); return p ? { kind: "pair", userId: p.userId } : { kind: "sonata" }; }
    return { kind: "sonata" };
}

export const choiceKey = (c: Choice) => c.kind === "sonata" ? "s" : c.kind === "password" ? `p:${c.password}` : `f:${c.userId}`;
export { getPairs };
