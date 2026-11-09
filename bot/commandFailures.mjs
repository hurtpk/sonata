/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { videoSource } from "./music/videoSource.mjs";

export function recordCommandFailure(store, command, error) {
    let source = "";
    if (command.name === "sonata") try { source = videoSource(command.options?.url); } catch { source = ""; }
    const detail = String(error.message || error).replace(/https:\/\/[^\s<>]+/g, raw => { try { const url = new URL(raw); return url.origin + url.pathname; } catch { return "[URL]"; } }).replace(/(?:Bot|Bearer)\s+\S+/gi, "[credential]").slice(0, 1500);
    store.run("INSERT INTO command_failures (request,guild,channel,actor,name,outcome,detail,source,at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(request) DO NOTHING", command.id, command.guild || "", command.channel || "", command.actor || "", [command.name, command.sub].filter(Boolean).join(" ").slice(0, 150), error.outcome || "failed", detail, source, Date.now());
    if (typeof command.raw === "string" && command.raw.length <= 4000) store.run("INSERT INTO failure_commands (request,command) VALUES (?,?) ON CONFLICT(request) DO NOTHING", command.id, command.raw);
    const row = store.get("SELECT id FROM command_failures WHERE request=?", command.id);
    return `S${String(row.id).padStart(6, "0")}`;
}

export const errorReply = code => ({ content: `Error code: ${code}`, allowed_mentions: { parse: [] } });

export function commandFailures(store, params) {
    const before = params.get("before"), query = (params.get("q") || "").trim().slice(0, 150);
    if (before && !/^[1-9]\d{0,14}$/.test(before)) throw new Error("Choose a valid failure page.");
    const code = /^S?0*(\d+)$/i.exec(query)?.[1] || "0";
    const rows = store.all("SELECT * FROM command_failures WHERE id<? AND (?='' OR id=? OR guild=? OR name LIKE ? ESCAPE '\\') ORDER BY id DESC LIMIT 51", before ? Number(before) : Number.MAX_SAFE_INTEGER, query, Number(code), query, `%${query.replace(/[\\%_]/g, "\\$&")}%`);
    return { failures: rows.slice(0, 50).map(row => ({ ...row, command: store.get("SELECT command FROM failure_commands WHERE request=?", row.request)?.command ?? null, code: `S${String(row.id).padStart(6, "0")}` })), next: rows.length > 50 ? String(rows[49].id) : null, total: store.get("SELECT COUNT(*) AS n FROM command_failures").n };
}

export function submittedCommand(data, slash = false) {
    if (!slash) return typeof data.content === "string" ? data.content.slice(0, 4000) : "";
    const parts = [];
    function visit(options) { for (const option of options ?? []) { if ([1, 2].includes(option.type)) { parts.push(option.name); visit(option.options); } else { const value = option.type === 11 ? data.data.resolved?.attachments?.[option.value]?.filename ?? "attachment" : option.value; parts.push(`${option.name}:${typeof value === "string" && /\s/.test(value) ? JSON.stringify(value) : value}`); } } }
    visit(data.data?.options);
    return `/${data.data?.name ?? ""}${parts.length ? " " + parts.join(" ") : ""}`.slice(0, 4000);
}
