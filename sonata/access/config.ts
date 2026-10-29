/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const ACCESS_SERVICE_URL: string = "https://sonata.hurts.workers.dev";
export const ACCESS_ENABLED = ACCESS_SERVICE_URL.length > 0;

export interface AccessResult {
    status: "disabled" | "activation" | "waiting" | "allowed" | "blocked" | "unavailable";
    userId?: string;
    admin?: boolean;
    until?: number;
    message?: string;
}
