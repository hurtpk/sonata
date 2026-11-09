/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { createHash } from "crypto";
import { app, type IpcMainInvokeEvent } from "electron";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { createConnection, createServer, type Server } from "net";
import { join } from "path";

interface State { ack: string; ping: string; }
interface Request { operation: "claim" | "read"; userId: string; channelId: string; messageId: string; ackId: string; oldestId: string; bypass: boolean; }
const isId = (value: unknown): value is string => typeof value === "string" && /^\d{15,21}$/.test(value);
const isCursor = (value: unknown): value is string => value === "0" || isId(value);
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
let server: Server | undefined;
let starting: Promise<void> | undefined;

function location() {
    const directory = join(app.getPath("appData"), "Sonata");
    const identity = createHash("sha256").update(process.platform === "win32" ? directory.toLowerCase() : directory).digest("hex");
    const endpoint = process.platform === "win32" ? { path: `\\\\.\\pipe\\sonata-dm-pings-${identity.slice(0, 24)}` } : { host: "127.0.0.1", port: 49152 + parseInt(identity.slice(0, 4), 16) % 12000 };
    return { directory, file: join(directory, "dm-pings.json"), endpoint };
}

function validRequest(value: unknown): value is Request {
    return isObject(value) && (value.operation === "claim" || value.operation === "read") && isId(value.userId) && isId(value.channelId) && isId(value.messageId) && isCursor(value.ackId) && isCursor(value.oldestId) && typeof value.bypass === "boolean";
}

function startCoordinator() {
    if (server?.listening) return Promise.resolve();
    if (starting) return starting;
    starting = new Promise<void>(resolve => {
        const { directory, file, endpoint } = location();
        const states = new Map<string, State>();
        try {
            if (statSync(file).size <= 2_000_000) {
                const data = readFileSync(file, "utf8");
                const saved: unknown = JSON.parse(data);
                if (isObject(saved)) for (const [key, state] of Object.entries(saved).slice(-10_000)) {
                    const [userId, channelId, extra] = key.split(":");
                    if (!extra && isId(userId) && isId(channelId) && isObject(state) && isCursor(state.ack) && isCursor(state.ping)) states.set(key, { ack: state.ack, ping: state.ping });
                }
            }
        } catch { states.clear(); }
        const candidate = createServer(socket => {
            let input = "";
            socket.setEncoding("utf8");
            socket.setTimeout(1000, () => socket.destroy());
            socket.on("error", () => socket.destroy());
            socket.on("data", chunk => {
                input += chunk;
                if (input.length > 1024) { socket.destroy(); return; }
                if (!input.includes("\n")) return;
                socket.removeAllListeners("data");
                let allowed: boolean | null = null;
                try {
                    const request: unknown = JSON.parse(input.trim());
                    if (validRequest(request)) {
                        const key = `${request.userId}:${request.channelId}`;
                        const state = states.get(key) ?? { ack: "0", ping: "0" };
                        const previous = `${state.ack}:${state.ping}`;
                        if (BigInt(request.ackId) > BigInt(state.ack)) state.ack = request.ackId;
                        if (request.operation === "read") {
                            if (BigInt(request.messageId) > BigInt(state.ack)) state.ack = request.messageId;
                            allowed = true;
                        } else {
                            allowed = BigInt(request.messageId) > BigInt(state.ack) && BigInt(request.messageId) > BigInt(state.ping)
                                && (request.bypass || (BigInt(state.ping) <= BigInt(state.ack) && (request.oldestId === request.messageId || BigInt(state.ack) >= BigInt(request.oldestId))));
                            if (allowed) state.ping = request.messageId;
                        }
                        states.delete(key);
                        states.set(key, state);
                        if (states.size > 10_000) {
                            const [oldest] = states.keys();
                            states.delete(oldest);
                        }
                        if (previous !== `${state.ack}:${state.ping}`) {
                            mkdirSync(directory, { recursive: true });
                            const temporary = `${file}.${process.pid}.tmp`;
                            writeFileSync(temporary, JSON.stringify(Object.fromEntries(states)), { mode: 0o600 });
                            renameSync(temporary, file);
                        }
                    }
                } catch { allowed = null; }
                socket.end(JSON.stringify({ sonataDmPing: 1, allowed }) + "\n");
            });
        });
        candidate.once("error", () => { resolve(); });
        candidate.listen(endpoint, () => { server = candidate; candidate.unref(); resolve(); });
    }).finally(() => { starting = undefined; });
    return starting;
}

function requestCoordinator(request: Request): Promise<boolean | null | undefined> {
    return new Promise(resolve => {
        const socket = createConnection(location().endpoint);
        let input = "";
        socket.setEncoding("utf8");
        socket.setTimeout(500, () => { socket.destroy(); resolve(null); });
        socket.once("connect", () => socket.write(JSON.stringify(request) + "\n"));
        socket.once("error", error => { resolve("code" in error && ["ENOENT", "ECONNREFUSED"].includes(String(error.code)) ? undefined : null); });
        socket.once("end", () => { resolve(null); });
        socket.on("data", chunk => {
            input += chunk;
            if (input.length > 128) { socket.destroy(); resolve(null); return; }
            if (!input.includes("\n")) return;
            let result: boolean | null = null;
            try {
                const reply: unknown = JSON.parse(input.trim());
                if (isObject(reply) && reply.sonataDmPing === 1 && typeof reply.allowed === "boolean") result = reply.allowed;
            } catch { result = null; }
            socket.destroy();
            resolve(result);
        });
    });
}

async function coordinate(request: Request): Promise<boolean | null> {
    try {
        let result = await requestCoordinator(request);
        if (result !== undefined) return result;
        await startCoordinator();
        result = await requestCoordinator(request);
        return result ?? null;
    } catch { return null; }
}

export async function onePingClaim(_: IpcMainInvokeEvent, userId: unknown, channelId: unknown, messageId: unknown, ackId: unknown, oldestId: unknown, bypass: unknown): Promise<boolean | null> {
    const request = { operation: "claim", userId, channelId, messageId, ackId, oldestId, bypass };
    return validRequest(request) ? coordinate(request) : null;
}

export async function onePingRead(_: IpcMainInvokeEvent, userId: unknown, channelId: unknown, messageId: unknown): Promise<boolean | null> {
    const request = { operation: "read", userId, channelId, messageId, ackId: "0", oldestId: "0", bypass: false };
    return validRequest(request) ? coordinate(request) : null;
}
