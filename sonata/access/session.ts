/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { PlainSettings, Settings } from "@api/Settings";
import type { PluginNative } from "@utils/types";
import { UserStore } from "@webpack/common";

import { LATEST } from "../changelog";
import { ACCESS_ENABLED, ACCESS_SERVICE_URL, type AccessResult } from "./config";

let state: AccessResult = { status: ACCESS_ENABLED ? "activation" : "disabled" };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;
let apply: ((result: AccessResult) => void) | undefined;
let generation = 0;
let inFlight = false;
export const accessSnapshot = () => state;
export const subscribeAccess = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const canUseSonata = () => !ACCESS_ENABLED || (state.status === "allowed" && state.userId === UserStore.getCurrentUser()?.id);
export const accessAtBoot = () => !ACCESS_ENABLED || (PlainSettings.plugins.Sonata?.sonataAccessOrigin === ACCESS_SERVICE_URL && Number(PlainSettings.plugins.Sonata?.sonataAccessUntil) > Date.now());

export function rememberAccess(result: AccessResult) {
    const store = Settings.plugins.Sonata;
    const reload = accessAtBoot() !== (result.status === "allowed") || (result.status === "allowed" && store.sonataAccessUser !== result.userId);
    store.sonataAccessOrigin = ACCESS_SERVICE_URL;
    store.sonataAccessUser = result.userId ?? "";
    store.sonataAccessUntil = result.status === "allowed" ? result.until ?? 0 : 0;
    return reload;
}

export async function checkAccess(action: "check" | "begin" | "finish" | "disconnect" = "check") {
    if (!ACCESS_ENABLED || inFlight) return;
    const userId = UserStore.getCurrentUser()?.id;
    if (!userId) return;
    const current = generation;
    inFlight = true;
    let result: AccessResult;
    try {
        if (IS_WEB) throw new Error("Managed activation is currently available in the desktop app.");
        const native = VencordNative.pluginHelpers.Sonata as PluginNative<typeof import("./native")>;
        result = action === "begin" ? await native.accessBegin(userId, LATEST) : action === "finish" ? await native.accessFinish(userId) : action === "disconnect" ? await native.accessDisconnect(userId) : await native.accessCheck(userId, LATEST);
        if (result.status === "disabled") result = { status: "unavailable", userId, message: "Fully restart Discord to load this build's activation settings." };
    } catch (error) { result = { status: "unavailable", userId, message: error instanceof Error && IS_WEB ? error.message : "Couldn't reach Sonata's activation service. Try again." }; }
    finally { if (current === generation) inFlight = false; }
    if (current !== generation || userId !== UserStore.getCurrentUser()?.id) return;
    state = result;
    for (const listener of listeners) listener();
    apply?.(result);
}

export function startAccess(onChange: (result: AccessResult) => void) {
    apply = onChange;
    generation++;
    inFlight = false;
    void checkAccess();
    timer = setInterval(() => { if (state.status !== "waiting") void checkAccess(); }, 300_000);
}

export function stopAccess() {
    generation++;
    inFlight = false;
    apply = undefined;
    clearInterval(timer);
    timer = undefined;
}

export async function openAccessDashboard() {
    if (IS_WEB) return;
    const native = VencordNative.pluginHelpers.Sonata as PluginNative<typeof import("./native")>;
    await native.accessDashboard();
}
