/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
CREATE TABLE IF NOT EXISTS bot_flows (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bot_sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS bot_sessions_expiry ON bot_sessions(expires);
