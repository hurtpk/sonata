/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Calling Sonata's network side safely. New network code only arrives when
// Discord fully restarts, so until then a feature gets a friendly error back
// instead of crashing Discord.

export const NEEDS_RESTART = "Fully quit and reopen Discord to finish installing this — a quick reload isn't enough.";

export const hasNative = (name: string) => typeof (globalThis as any).VencordNative?.pluginHelpers?.Sonata?.[name] === "function";

export async function callNative<T = any>(name: string, ...args: unknown[]): Promise<T | { ok: false; error: string; }> {
    const fn = (globalThis as any).VencordNative?.pluginHelpers?.Sonata?.[name];
    if (typeof fn !== "function") return { ok: false, error: NEEDS_RESTART };
    try { return await fn(...args); } catch (e) {
        return { ok: false, error: e instanceof Error && e.message ? e.message : "Couldn't connect — try again in a moment" };
    }
}
