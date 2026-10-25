/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Equicord only reports a patch that stopped working in the console, as a
// warning or error from its patcher. This listens for those messages from the
// moment Sonata loads — before Discord's code is patched — and keeps them.

import { Logger } from "@utils/Logger";

/** A pattern as inline code in a copied report, so pasting it into Discord doesn't turn * and _ into italics. */
export function code(s: string) {
    if (!s) return "";
    return s.includes("`") ? "`` " + s + " ``" : "`" + s + "`";
}

export type ProblemKind = "noEffect" | "errored" | "groupUndone";

export interface Problem {
    kind: ProblemKind;
    plugin: string;
    /** The pattern that didn't match (as Equicord printed it). */
    match: string;
    /** Set for "group undone" reports. */
    find?: string;
    moduleId?: string;
    error?: string;
    at: number;
}

const NO_EFFECT = /^Patch by (.+?) had no effect \(Module id is (.+?)\): ([\s\S]*)$/;
const ERRORED = /^Patch by (.+?) errored \(Module id is (.+?)\): ([\s\S]*?)\n?$/;
const GROUP = /^Undoing patch group ([\s\S]+?) by (.+?) because replacement ([\s\S]+?) (?:had no effect|errored)$/;

/** Turn one of the patcher's log lines into a problem, if it is one. */
export function parse(args: unknown[], at = Date.now()): Problem | null {
    const [first, second] = args;
    if (typeof first !== "string") return null;
    let m = first.match(NO_EFFECT);
    if (m) return { kind: "noEffect", plugin: m[1], moduleId: m[2], match: m[3].trim(), at };
    m = first.match(ERRORED);
    if (m) return { kind: "errored", plugin: m[1], moduleId: m[2], match: m[3].trim(), error: second instanceof Error ? second.message : second != null ? String(second) : undefined, at };
    m = first.match(GROUP);
    if (m) return { kind: "groupUndone", plugin: m[2], find: m[1], match: m[3].trim(), at };
    return null;
}

const problems: Problem[] = [];
const listeners = new Set<() => void>();

export const getProblems = () => problems;
export function onProblem(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function record(args: unknown[]) {
    const p = parse(args);
    if (!p) return;
    // The same patch can fail in several modules; keep one entry each.
    if (problems.some(x => x.kind === p.kind && x.plugin === p.plugin && x.match === p.match && x.find === p.find)) return;
    problems.push(p);
    listeners.forEach(l => l());
}

let installed = false;

/** Start listening. Safe to call more than once. */
export function installRecorder() {
    if (installed) return;
    installed = true;
    const proto = Logger.prototype as any;
    for (const level of ["warn", "error"] as const) {
        const original = proto[level];
        proto[level] = function (this: Logger, ...args: any[]) {
            if (this.name === "WebpackPatcher") {
                try { record(args); } catch { }
            }
            return original.apply(this, args);
        };
    }
}
