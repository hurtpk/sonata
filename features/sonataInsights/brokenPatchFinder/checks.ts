/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Sonata Insights' checks: settings that can't be read, features that are
// stuck, and things that make Sonata or Discord heavier than they need to be.

import { DataStore } from "@api/index";
import { OptionType } from "@utils/types";

import { doctor, DoctorFeature } from "../../../sonata/doctorBridge";
import { layoutProblems } from "./layout";
import { code, getProblems } from "./recorder";

// ─── Settings ───

export interface SettingProblem { key: string; label: string; why: string; value: string; }

const preview = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s == null ? String(v) : s.length > 60 ? `${s.slice(0, 60)}…` : s; };

export function settingProblems(): SettingProblem[] {
    const d = doctor();
    if (!d) return [];
    const out: SettingProblem[] = [];
    for (const [key, def] of Object.entries<any>(d.defs)) {
        const v = d.store[key];
        if (v === undefined || !def || def.type === OptionType.COMPONENT || def.type === OptionType.CUSTOM) continue;
        const label = (def.description as string | undefined)?.replace(/^Internal:\s*/, "") || key;
        if (def.type === OptionType.STRING && typeof def.default === "string" && /^[[{]/.test(def.default)) {
            try {
                const parsed = JSON.parse(v);
                if (Array.isArray(parsed) !== def.default.startsWith("[")) out.push({ key, label, why: "Saved in the wrong shape", value: preview(v) });
            } catch {
                out.push({ key, label, why: "Can't be read (damaged)", value: preview(v) });
            }
        } else if ((def.type === OptionType.NUMBER || def.type === OptionType.SLIDER) && !Number.isFinite(Number(v))) {
            out.push({ key, label, why: "Not a number", value: preview(v) });
        } else if (def.type === OptionType.BOOLEAN && typeof v !== "boolean") {
            out.push({ key, label, why: "Should be on or off", value: preview(v) });
        } else if (def.type === OptionType.SELECT && Array.isArray(def.options) && !def.options.some((o: any) => o.value === v)) {
            out.push({ key, label, why: "Not one of the choices any more", value: preview(v) });
        }
    }
    return out;
}

const BACKUP_KEY = "Sonata_doctor_backup";

/** Puts a setting back to its default, keeping the old value in a backup first. */
export async function resetSetting(key: string) {
    const d = doctor();
    if (!d) return;
    const backup = (await DataStore.get(BACKUP_KEY)) ?? {};
    backup[key] = { value: d.store[key], at: Date.now() };
    await DataStore.set(BACKUP_KEY, backup);
    const def = d.defs[key];
    d.store[key] = typeof def?.default === "function" ? def.default() : def?.default ?? (def?.options?.find((o: any) => o.default)?.value);
}

// ─── Features ───

export const problemFeatures = (list: DoctorFeature[]) => list.filter(f => f.error || f.status === "paused" || f.status === "needs" || f.status === "apply-on" || f.status === "apply-off");

export function featureIssue(f: DoctorFeature): string | null {
    if (f.error) return `Didn't start: ${f.error}`;
    if (f.status === "paused") return `Paused — the built-in ${f.pausedBy ?? "plugin"} is on and does the same job`;
    if (f.status === "needs") return `Needs ${f.needs ?? "another feature"} to be on`;
    if (f.status === "apply-on") return "Switched on — reload to start it";
    if (f.status === "apply-off") return "Switched off — reload to stop it";
    return null;
}

// ─── Performance ───

export interface Hint { id: string; title: string; detail: string; fix?: { label: string; run(): void; }; }

export function performanceHints(): Hint[] {
    const d = doctor();
    if (!d) return [];
    const hints: Hint[] = [];
    const feats = d.features();
    const on = feats.filter(f => f.status === "active").length;
    if (on > 60) hints.push({ id: "count", title: `${on} features running`, detail: "That's a lot! Each adds a little to Discord's start-up and memory. Switch off ones you never use from the Features tab." });
    const slow = feats.filter(f => (f.startMs ?? 0) > 50).sort((a, b) => b.startMs! - a.startMs!);
    if (slow.length) hints.push({ id: "slow", title: "Slow to start", detail: `${slow.slice(0, 3).map(f => `${f.name} (${Math.round(f.startMs!)} ms)`).join(", ")} took the longest to start this session.` });
    return hints;
}

/** Frames per second over a couple of seconds (what Discord manages right now). */
export function measureFps(ms = 2500): Promise<number> {
    return new Promise(resolve => {
        let frames = 0;
        const start = performance.now();
        const tick = (now: number) => {
            frames++;
            if (now - start < ms) requestAnimationFrame(tick);
            else resolve(Math.round(frames * 1000 / (now - start)));
        };
        requestAnimationFrame(tick);
    });
}

export const memoryMb = () => {
    const m = (performance as any).memory;
    return m?.usedJSHeapSize ? Math.round(m.usedJSHeapSize / 1048576) : null;
};

// ─── The whole picture ───

export function summary() {
    const d = doctor();
    const feats = d?.features() ?? [];
    return {
        patches: getProblems().length,
        layout: layoutProblems().length,
        features: problemFeatures(feats).length,
        settings: settingProblems().length,
        performance: performanceHints().filter(h => h.fix).length,
        feats,
    };
}

export function fullReport() {
    const d = doctor();
    const feats = d?.features() ?? [];
    const lines = [
        "# Sonata Insights report",
        `Discord build: ${(window as any).GLOBAL_ENV?.SENTRY_TAGS?.buildId ?? "?"} · ${new Date().toISOString()}`,
        `Features on: ${feats.filter(f => f.on).length} of ${feats.length}`,
        "",
        "## Features with problems",
        ...problemFeatures(feats).map(f => `- ${f.name}: ${featureIssue(f)}`),
        "",
        "## Broken patches",
        ...getProblems().map(p => `- ${p.plugin}: ${p.kind} — ${p.find ? `find ${code(p.find)} · ` : ""}${code(p.match)}`),
        "",
        "## Settings that can't be read",
        ...settingProblems().map(p => `- ${p.key}: ${p.why} (${p.value})`),
        "",
        "## Discord's layout (names Sonata looks for that are gone)",
        ...layoutProblems().map(r => `- ${r.check.what}: ${r.missing.join(", ")}`),
        "",
        "## Slowest to start",
        ...feats.filter(f => f.startMs != null).sort((a, b) => b.startMs! - a.startMs!).slice(0, 10).map(f => `- ${f.name}: ${Math.round(f.startMs!)} ms`),
    ];
    return lines.join("\n");
}
