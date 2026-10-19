/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

export interface WebhookResult {
    ok: boolean;
    status: number;
    body: any;
}

export interface WebhookFile {
    /** Attachment file name, e.g. "screenshot.png" */
    name: string;
    /** MIME type, e.g. "image/png" — falls back to application/octet-stream if blank */
    contentType: string;
    /** Raw file bytes, base64-encoded. IPC across the contextBridge only carries
     *  JSON-safe values, so the renderer sends bytes this way rather than a Blob/File. */
    dataBase64: string;
}

async function doFetch(url: string, init?: RequestInit): Promise<WebhookResult> {
    try {
        const res = await fetch(url, init);
        const text = await res.text();
        let parsed: any = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON, keep raw text */ }
        return { ok: res.ok, status: res.status, body: parsed ?? text };
    } catch (e: any) {
        // Network-level failure (DNS, offline, etc) rather than an HTTP
        // error response — surface it the same shape so the caller doesn't
        // need two different error paths.
        return { ok: false, status: 0, body: { message: String(e?.message ?? e) } };
    }
}

export function sendWebhook(
    _event: IpcMainInvokeEvent,
    url: string,
    method: "POST" | "PATCH",
    body: any,
    files?: WebhookFile[],
): Promise<WebhookResult> {
    if (files && files.length) {
        // File uploads have to go as multipart/form-data: the JSON payload rides
        // along as a "payload_json" part, and each file is its own "files[n]"
        // part. Discord pairs a part up with that array index on its own, so no
        // "attachments" metadata array is needed for a plain upload — see
        // https://discord.com/developers/docs/reference#uploading-files
        //
        // This relies on the same global fetch that doFetch already uses also
        // exposing FormData/Blob (true for any Node/Electron new enough to have
        // fetch at all, since they come from the same undici implementation).
        const form = new FormData();
        form.append("payload_json", JSON.stringify(body));
        files.forEach((f, i) => {
            const bytes = Buffer.from(f.dataBase64, "base64");
            const blob = new Blob([bytes], { type: f.contentType || "application/octet-stream" });
            form.append(`files[${i}]`, blob, f.name || `file${i}`);
        });
        // No Content-Type header here on purpose — fetch derives the
        // multipart boundary itself from the FormData body.
        return doFetch(url, { method, body: form });
    }

    return doFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export function getWebhookMessage(
    _event: IpcMainInvokeEvent,
    url: string,
): Promise<WebhookResult> {
    return doFetch(url);
}

/** Remove a message this webhook sent. */
export function deleteWebhookMessage(_event: IpcMainInvokeEvent, url: string): Promise<WebhookResult> {
    if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+\/messages\/\d+$/.test(url)) return Promise.resolve({ ok: false, status: 0, body: { message: "Not a webhook message address" } });
    return doFetch(url, { method: "DELETE" });
}

/** Talk to your own private-replies Worker (only https, and only the /api/ paths it serves). */
export function privateRepliesApi(_event: IpcMainInvokeEvent, workerUrl: string, path: string, method: "GET" | "POST" | "PUT" | "DELETE", body: unknown, secret: string): Promise<WebhookResult> {
    let base: URL;
    try { base = new URL(workerUrl); } catch { return Promise.resolve({ ok: false, status: 0, body: { message: "That isn't a web address" } }); }
    if (base.protocol !== "https:" || !/^\/api\/[\w/-]{1,80}$/.test(path)) return Promise.resolve({ ok: false, status: 0, body: { message: "Not allowed" } });
    return doFetch(new URL(path, base.origin).toString(), {
        method,
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: body == null || method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
    });
}

/** A picture's bytes from the web (for picking a colour from it). https only, 8 MB at most. */
export async function fetchImageBytes(_event: IpcMainInvokeEvent, url: string): Promise<Uint8Array | null> {
    if (!/^https:\/\//i.test(url)) return null;
    try {
        const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 Sonata" } });
        if (!res.ok || Number(res.headers.get("content-length") ?? 0) > 8 * 1048576) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        return bytes.length > 8 * 1048576 ? null : bytes;
    } catch { return null; }
}
