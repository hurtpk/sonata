/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT, name TEXT, first_seen INTEGER, last_seen INTEGER, version TEXT, blocked INTEGER NOT NULL DEFAULT 0, blocked_at INTEGER, reason TEXT NOT NULL DEFAULT '', registered_at INTEGER NOT NULL DEFAULT (unixepoch()*1000));
CREATE TABLE IF NOT EXISTS devices (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pairings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, challenge TEXT NOT NULL, version TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS flows (hash TEXT PRIMARY KEY, pairing_id TEXT, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, at INTEGER NOT NULL, reason TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS users_last_seen ON users(last_seen);
CREATE INDEX IF NOT EXISTS devices_expiry ON devices(expires);
CREATE INDEX IF NOT EXISTS pairings_expiry ON pairings(expires);
CREATE INDEX IF NOT EXISTS flows_expiry ON flows(expires);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE INDEX IF NOT EXISTS audit_time ON audit(at);
