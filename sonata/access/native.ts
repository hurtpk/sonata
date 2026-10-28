/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash, randomBytes } from "crypto";
import { app, type IpcMainInvokeEvent, safeStorage, shell } from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

import { ACCESS_ENABLED, ACCESS_SERVICE_URL, type AccessResult } from "./config";

interface Grant { userId: string; token: string; until: number; admin: boolean; blocked: boolean; }
const grants = new Map<string, Grant>();
const pending = new Map<string, { id: string; verifier: string; version: string; }>();
let loaded = false;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isId = (value: unknown): value is string => typeof value === "string" && /^\d{17,20}$/.test(value);
const isVersion = (value: unknown): value is string => typeof value === "string" && /^[\w.+-]{1,40}$/.test(value);
const isToken = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const key = (id: string) => `${ACCESS_SERVICE_URL}:${id}`;
const file = () => join(app.getPath("userData"), "sonata-access.enc");
const encryptedStorage = () => safeStorage.isEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");

function load() {
    if (loaded) return;
    loaded = true;
    if (!encryptedStorage() || !existsSync(file())) return;
    const parsed: unknown = JSON.parse(safeStorage.decryptString(readFileSync(file())));
    if (!isObject(parsed)) return;
    for (const [id, value] of Object.entries(parsed)) if (isObject(value) && isId(value.userId) && isToken(value.token) && typeof value.until === "number" && typeof value.admin === "boolean" && typeof value.blocked === "boolean") grants.set(id, { userId: value.userId, token: value.token, until: value.until, admin: value.admin, blocked: value.blocked });
}

function save() {
    if (!encryptedStorage()) return false;
    try { writeFileSync(`${file()}.tmp`, safeStorage.encryptString(JSON.stringify(Object.fromEntries(grants))), { mode: 0o600 }); renameSync(`${file()}.tmp`, file()); return true; }
    catch { return false; }
}

async function request(path: string, data: object, token?: string): Promise<Record<string, unknown>> {
    const base = new URL(ACCESS_SERVICE_URL);
    if (base.origin !== ACCESS_SERVICE_URL || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))) throw new Error("The activation service address is invalid.");
    const response = await fetch(`${base.origin}${path}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(12_000), headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
    let text = "", size = 0;
    if (!response.body) throw new Error("No activation response.");
    const decoder = new TextDecoder();
    for await (const chunk of response.body) { size += chunk.length; if (size > 65_536) throw new Error("The activation response is too large."); text += decoder.decode(chunk, { stream: true }); }
    const result: unknown = JSON.parse(text + decoder.decode());
    if ([401, 403].includes(response.status)) return { status: "activation" };
    if (!response.ok || !isObject(result)) throw new Error("The activation service is unavailable.");
    return result;
}

export async function accessCheck(_: IpcMainInvokeEvent, userId: unknown, version: unknown): Promise<AccessResult> {
    if (!ACCESS_ENABLED) return { status: "disabled" };
    if (!isId(userId) || !isVersion(version)) return { status: "activation", message: "Open a Discord account before activating Sonata." };
    try { load(); } catch { grants.clear(); }
    const grant = grants.get(key(userId));
    if (!grant) return { status: "activation", userId };
    try {
        const result = await request("/api/check-in", { userId, version }, grant.token);
        if (result.status === "activation" || result.userId !== userId) { grants.delete(key(userId)); save(); return { status: "activation", userId }; }
        if (result.status === "blocked") { grant.blocked = true; grant.until = 0; grant.admin = false; save(); return { status: "blocked", userId }; }
        if (result.status !== "allowed") throw new Error("Invalid activation response.");
        grant.blocked = false; grant.admin = result.admin === true; grant.until = Date.now() + 86400_000; save();
        return { status: "allowed", userId, admin: grant.admin, until: grant.until };
    } catch {
        if (grant.blocked) return { status: "blocked", userId };
        return grant.until > Date.now() ? { status: "allowed", userId, admin: grant.admin, until: grant.until, message: "The service is offline. Your last verified access works for up to 24 hours." } : { status: "unavailable", userId, message: "Couldn't check access. Try again when the service is available." };
    }
}

export async function accessBegin(_: IpcMainInvokeEvent, userId: unknown, version: unknown): Promise<AccessResult> {
    if (!ACCESS_ENABLED) return { status: "disabled" };
    if (!isId(userId) || !isVersion(version)) return { status: "activation", message: "Open a Discord account before activating Sonata." };
    try {
        const verifier = randomBytes(32).toString("hex"), challenge = createHash("sha256").update(verifier).digest("hex");
        const result = await request("/api/activation/start", { userId, version, challenge });
        if (!isToken(result.id)) throw new Error("Invalid activation response.");
        pending.set(userId, { id: result.id, verifier, version });
        await shell.openExternal(`${ACCESS_SERVICE_URL}/activate?id=${result.id}`);
        return { status: "waiting", userId };
    } catch { return { status: "unavailable", userId, message: "Couldn't start activation. Check that the service is available." }; }
}

export async function accessFinish(_: IpcMainInvokeEvent, userId: unknown): Promise<AccessResult> {
    if (!isId(userId)) return { status: "activation" };
    const pair = pending.get(userId);
    if (!pair) return { status: "activation", userId, message: "Start activation again to get a new sign-in link." };
    try {
        const result = await request("/api/activation/finish", { id: pair.id, verifier: pair.verifier });
        if (result.status === "waiting") return { status: "waiting", userId, message: "Finish signing in in your browser, then press Finish activation." };
        try { load(); } catch { grants.clear(); }
        if (result.status === "blocked") {
            pending.delete(userId);
            const old = grants.get(key(userId));
            if (old) { old.blocked = true; old.until = 0; old.admin = false; save(); }
            return { status: "blocked", userId };
        }
        if (result.status !== "allowed" || result.userId !== userId || !isToken(result.token)) throw new Error("Invalid activation response.");
        const grant: Grant = { token: result.token, userId, until: Date.now() + 86400_000, blocked: false, admin: result.admin === true };
        grants.set(key(userId), grant); pending.delete(userId);
        const persisted = save();
        return { status: "allowed", userId, until: grant.until, admin: grant.admin, message: persisted ? undefined : "Access is active for this session. Activate again after restarting if encrypted storage is unavailable." };
    } catch { return { status: "unavailable", userId, message: "Couldn't finish activation. Retry, or start again if the sign-in link expired." }; }
}

export async function accessDisconnect(_: IpcMainInvokeEvent, userId: unknown): Promise<AccessResult> {
    if (!isId(userId)) return { status: "activation" };
    let message: string | undefined;
    try { load(); const grant = grants.get(key(userId)); if (grant) await request("/api/disconnect", {}, grant.token); }
    catch { message = "Disconnected locally. The service couldn't be reached to revoke the old device credential."; }
    grants.delete(key(userId)); pending.delete(userId); save();
    return { status: "activation", userId, message };
}

export async function accessDashboard(_: IpcMainInvokeEvent) {
    if (!ACCESS_ENABLED) return { ok: false };
    try {
        const base = new URL(ACCESS_SERVICE_URL);
        if (base.origin !== ACCESS_SERVICE_URL || (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))) return { ok: false };
        await shell.openExternal(`${base.origin}/admin`);
        return { ok: true };
    } catch { return { ok: false }; }
}
