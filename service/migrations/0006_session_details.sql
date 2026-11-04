/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
CREATE TABLE IF NOT EXISTS session_details (id TEXT UNIQUE NOT NULL,kind TEXT NOT NULL,hash TEXT NOT NULL,user_id TEXT NOT NULL,created INTEGER NOT NULL,last_seen INTEGER NOT NULL,agent TEXT NOT NULL,PRIMARY KEY(kind,hash));
INSERT OR IGNORE INTO session_details SELECT lower(hex(randomblob(16))),'admin',hash,user_id,expires-43200000,expires-43200000,'' FROM sessions;
INSERT OR IGNORE INTO session_details SELECT lower(hex(randomblob(16))),'dashboard',hash,user_id,expires-43200000,expires-43200000,'' FROM bot_sessions;
