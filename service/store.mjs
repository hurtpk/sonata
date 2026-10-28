/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export { hash, random, validId, validToken } from "./protocol.mjs";

export function openStore(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    db.exec(readFileSync(new URL("./migrations/0001_initial.sql", import.meta.url), "utf8"));
    const run = (sql, ...params) => db.prepare(sql).run(...params);
    const get = (sql, ...params) => db.prepare(sql).get(...params);
    const all = (sql, ...params) => db.prepare(sql).all(...params);
    const transaction = fn => { db.exec("BEGIN IMMEDIATE"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } };
    return { db, run, get, all, batch(statements) { return transaction(() => statements.map(([sql, ...params]) => run(sql, ...params))); }, cleanup() {
        const now = Date.now();
        for (const table of ["devices", "pairings", "flows", "sessions"]) run(`DELETE FROM ${table} WHERE expires < ?`, now);
        run("DELETE FROM users WHERE blocked=0 AND COALESCE(last_seen,registered_at) < ?", now - 90 * 86400_000);
        run("DELETE FROM audit WHERE at < ?", now - 90 * 86400_000);
    } };
}
