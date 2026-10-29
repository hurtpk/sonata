/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS case_files (id TEXT PRIMARY KEY,guild TEXT NOT NULL,n INTEGER NOT NULL,actor TEXT NOT NULL,channel TEXT NOT NULL,message TEXT NOT NULL,filename TEXT NOT NULL,type TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS case_files_case ON case_files(guild,n);
CREATE TABLE IF NOT EXISTS sticky_messages (guild TEXT NOT NULL, channel TEXT PRIMARY KEY, content TEXT NOT NULL, message TEXT NOT NULL, original TEXT NOT NULL, actor TEXT NOT NULL, error TEXT NOT NULL DEFAULT '');
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
CREATE TABLE IF NOT EXISTS onboarding (guild TEXT NOT NULL, target TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(guild,target));
CREATE TABLE IF NOT EXISTS user_prefixes (user TEXT PRIMARY KEY, prefix TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS voice_rooms (guild TEXT NOT NULL, channel TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS security_events (id TEXT PRIMARY KEY, guild TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS security_events_recent ON security_events(guild,actor,kind,at);
CREATE TABLE IF NOT EXISTS voice_activity (guild TEXT NOT NULL, user TEXT NOT NULL, channel TEXT NOT NULL, PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS forms (id TEXT PRIMARY KEY, actor TEXT NOT NULL, guild TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS appeals (guild TEXT NOT NULL, n INTEGER NOT NULL, target TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, channel TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', PRIMARY KEY(guild,n));
CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, guild TEXT NOT NULL, owner TEXT NOT NULL, channel TEXT NOT NULL, state TEXT NOT NULL, claimed TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, transcript TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS tickets_owner ON tickets(guild,owner,state);
CREATE TABLE IF NOT EXISTS giveaways (id TEXT PRIMARY KEY, guild TEXT NOT NULL, channel TEXT NOT NULL, message TEXT NOT NULL, due INTEGER NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS giveaway_entries (id TEXT NOT NULL, user TEXT NOT NULL, PRIMARY KEY(id,user));
CREATE TABLE IF NOT EXISTS xp (guild TEXT NOT NULL, user TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0, last INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS afk (guild TEXT NOT NULL, user TEXT NOT NULL, message TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS ticket_details (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bot_guilds (id TEXT PRIMARY KEY, data TEXT NOT NULL, joined INTEGER NOT NULL, seen INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS guild_blacklist (id TEXT PRIMARY KEY, actor TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, last_error TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS command_usage (guild TEXT NOT NULL, name TEXT NOT NULL, day TEXT NOT NULL, uses INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild,name,day));
CREATE TABLE IF NOT EXISTS command_results (guild TEXT NOT NULL, name TEXT NOT NULL, day TEXT NOT NULL, outcome TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guild,name,day,outcome));
CREATE TABLE IF NOT EXISTS recovery_members (guild TEXT NOT NULL, user TEXT NOT NULL, roles TEXT NOT NULL, PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS role_returns (guild TEXT NOT NULL, user TEXT NOT NULL, roles TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS music_audience (guild TEXT NOT NULL, user TEXT NOT NULL, channel TEXT NOT NULL, PRIMARY KEY(guild,user));
CREATE TABLE IF NOT EXISTS music_audience_ready (guild TEXT PRIMARY KEY);
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
        usage(guild, name) { storage.sql.exec("INSERT INTO command_usage VALUES (?,?,?,1) ON CONFLICT(guild,name,day) DO UPDATE SET uses=uses+1", guild, name, new Date().toISOString().slice(0, 10)); },
        outcome(guild, name, outcome) { storage.sql.exec("INSERT INTO command_results VALUES (?,?,?,?,1) ON CONFLICT(guild,name,day,outcome) DO UPDATE SET n=n+1", guild, name, new Date().toISOString().slice(0, 10), outcome); },
        schedule(guild, n, target, kind, due, detail = "") { storage.sql.exec("INSERT INTO jobs (id,guild,n,target,kind,due,detail) VALUES (?,?,?,?,?,?,?)", crypto.randomUUID(), guild, n, target, kind, due, detail); },
        cleanup() { storage.sql.exec("DELETE FROM command_results WHERE day<?", new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)); storage.sql.exec("DELETE FROM role_returns WHERE expires<=?", Date.now()); storage.sql.exec("DELETE FROM requests WHERE at<?", Date.now() - 7 * 86400_000); storage.sql.exec("DELETE FROM onboarding WHERE at<?", Date.now() - 7 * 86400_000); storage.sql.exec("DELETE FROM forms WHERE expires<?", Date.now()); storage.sql.exec("DELETE FROM security_events WHERE at<?", Date.now() - 3600_000); storage.sql.exec("DELETE FROM command_usage WHERE day<?", new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)); },
    };
}
