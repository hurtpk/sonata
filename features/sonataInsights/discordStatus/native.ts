/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Discord Status's network side: Discord's own public status page
// (discordstatus.com), read here because Discord's page isn't allowed to
// contact other sites. No account, no key.

import { IpcMainInvokeEvent } from "electron";

export type Health = "operational" | "degraded_performance" | "partial_outage" | "major_outage" | "under_maintenance";
export interface StatusPart { id: string; name: string; status: Health; group?: string; }
export interface StatusIncident { id: string; name: string; status: string; impact: string; link: string; started: number; updated: number; latest?: string; parts: string[]; }
export interface StatusMaintenance { id: string; name: string; status: string; link: string; from: number; to: number; }
export interface StatusSummary { indicator: "none" | "minor" | "major" | "critical" | "maintenance"; description: string; parts: StatusPart[]; incidents: StatusIncident[]; maintenance: StatusMaintenance[]; checked: number; }

const str = (v: unknown, max = 500) => typeof v === "string" ? v.slice(0, max) : "";
const time = (v: unknown) => { const t = Date.parse(String(v ?? "")); return Number.isFinite(t) ? t : 0; };
const link = (v: unknown) => typeof v === "string" && /^https:\/\/(stspg\.io|discordstatus\.com)\//.test(v) ? v : "https://discordstatus.com";

export async function statusSummary(_: IpcMainInvokeEvent): Promise<{ ok: true; summary: StatusSummary; } | { ok: false; error: string; }> {
    try {
        const res = await fetch("https://discordstatus.com/api/v2/summary.json", { headers: { accept: "application/json" } });
        if (!res.ok) return { ok: false, error: `Discord's status page answered ${res.status}` };
        const j: any = await res.json();
        const names = new Map<string, string>((j.components ?? []).map((c: any) => [c.id, str(c.name, 80)]));
        const parts: StatusPart[] = (j.components ?? []).filter((c: any) => !c.group).map((c: any) => ({
            id: str(c.id, 40), name: str(c.name, 80), status: c.status, group: c.group_id ? names.get(c.group_id) : undefined,
        }));
        const incidents: StatusIncident[] = (j.incidents ?? []).map((i: any) => ({
            id: str(i.id, 40), name: str(i.name, 200), status: str(i.status, 40), impact: str(i.impact, 20), link: link(i.shortlink),
            started: time(i.started_at ?? i.created_at), updated: time(i.updated_at),
            latest: str(i.incident_updates?.[0]?.body, 600) || undefined,
            parts: (i.components ?? []).map((c: any) => str(c.name, 80)),
        }));
        const maintenance: StatusMaintenance[] = (j.scheduled_maintenances ?? []).map((m: any) => ({
            id: str(m.id, 40), name: str(m.name, 200), status: str(m.status, 40), link: link(m.shortlink), from: time(m.scheduled_for), to: time(m.scheduled_until),
        }));
        const ind = j.status?.indicator;
        return {
            ok: true,
            summary: {
                indicator: ["none", "minor", "major", "critical", "maintenance"].includes(ind) ? ind : "none",
                description: str(j.status?.description, 120) || "Unknown",
                parts, incidents, maintenance, checked: Date.now(),
            },
        };
    } catch {
        return { ok: false, error: "Couldn't reach Discord's status page" };
    }
}
