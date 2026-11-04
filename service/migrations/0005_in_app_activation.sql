/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

CREATE TABLE IF NOT EXISTS in_app_devices (hash TEXT PRIMARY KEY REFERENCES devices(hash) ON DELETE CASCADE);
