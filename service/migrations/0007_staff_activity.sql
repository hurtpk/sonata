/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
CREATE TABLE IF NOT EXISTS staff_activity (id INTEGER PRIMARY KEY, actor TEXT NOT NULL, area TEXT NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS staff_activity_actor_kind ON staff_activity (actor, kind, area, at);
CREATE INDEX IF NOT EXISTS staff_activity_at ON staff_activity (at);
CREATE INDEX IF NOT EXISTS audit_actor_at ON audit (actor, at);
