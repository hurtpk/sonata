/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (guild TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cases (guild TEXT NOT NULL, n INTEGER NOT NULL, request TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, duration INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', PRIMARY KEY(guild,n));
CREATE INDEX IF NOT EXISTS cases_target ON cases(guild,target,n);
CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, guild TEXT NOT NULL, n INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS notes_case ON notes(guild,n);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, guild TEXT NOT NULL, n INTEGER NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, due INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'pending', detail TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,due);
CREATE TABLE IF NOT EXISTS restrictions (guild TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(guild,target,kind));
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS requests_at ON requests(at);
`;

const defaults = () => ({ prefix: ",", logChannel: "", dm: false, templates: {}, jailRole: "", jailChannel: "", automod: {} });

export function botStore(storage) {
    const all = (sql, ...params) => storage.sql.exec(sql, ...params).toArray();
    const get = (sql, ...params) => all(sql, ...params)[0];
    storage.sql.exec(SCHEMA);
    return {
        all, get, run: (sql, ...params) => { storage.sql.exec(sql, ...params); },
        settings(guild) { const row = get("SELECT data FROM settings WHERE guild=?", guild); return { ...defaults(), ...(row ? JSON.parse(row.data) : {}) }; },
        saveSettings(guild, value) { storage.sql.exec("INSERT INTO settings VALUES (?,?) ON CONFLICT(guild) DO UPDATE SET data=excluded.data", guild, JSON.stringify(value)); },
        claim(id) { return storage.transactionSync(() => { if (get("SELECT id FROM requests WHERE id=?", id)) return false; storage.sql.exec("INSERT INTO requests VALUES (?,?)", id, Date.now()); return true; }); },
        begin(command, kind, target, reason, duration = 0) {
            return storage.transactionSync(() => {
                const n = (get("SELECT MAX(n) AS n FROM cases WHERE guild=?", command.guild).n ?? 0) + 1;
                storage.sql.exec("INSERT INTO cases (guild,n,request,kind,target,actor,reason,at,duration,status) VALUES (?,?,?,?,?,?,?,?,?,?)", command.guild, n, command.id, kind, target, command.actor, reason, Date.now(), duration, "pending");
                return n;
            });
        },
        status(guild, n, status, detail = "") { storage.sql.exec("UPDATE cases SET status=?,detail=? WHERE guild=? AND n=?", status, detail.slice(0, 500), guild, n); },
        case(guild, n) { return get("SELECT * FROM cases WHERE guild=? AND n=?", guild, n); },
        addNote(guild, n, actor, kind, value) { storage.sql.exec("INSERT INTO notes VALUES (?,?,?,?,?,?,?)", crypto.randomUUID(), guild, n, actor, kind, value, Date.now()); },
        restriction(guild, target, kind) { const row = get("SELECT data FROM restrictions WHERE guild=? AND target=? AND kind=?", guild, target, kind); return row ? JSON.parse(row.data) : null; },
        saveRestriction(guild, target, kind, value) { storage.sql.exec("INSERT INTO restrictions VALUES (?,?,?,?) ON CONFLICT(guild,target,kind) DO UPDATE SET data=excluded.data", guild, target, kind, JSON.stringify(value)); },
        clearRestriction(guild, target, kind) { storage.sql.exec("DELETE FROM restrictions WHERE guild=? AND target=? AND kind=?", guild, target, kind); },
        cancelJobs(guild, target, kind) { storage.sql.exec("UPDATE jobs SET state='cancelled' WHERE guild=? AND target=? AND kind=? AND state='pending'", guild, target, kind); },
        schedule(guild, n, target, kind, due, detail = "") { storage.sql.exec("INSERT INTO jobs (id,guild,n,target,kind,due,detail) VALUES (?,?,?,?,?,?,?)", crypto.randomUUID(), guild, n, target, kind, due, detail); },
        cleanup() { storage.sql.exec("DELETE FROM requests WHERE at<?", Date.now() - 7 * 86400_000); },
    };
}
