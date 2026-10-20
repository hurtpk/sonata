/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Is there a newer Sonata? Reads the top of the changelog on GitHub (the page
// can't reach GitHub itself). And updating: right inside Discord (no window),
// or — as a fallback — by opening Install Sonata.bat.

import { spawn } from "child_process";
import { IpcMainInvokeEvent, shell } from "electron";
import { existsSync, readFileSync } from "fs";
import { delimiter, dirname, join } from "path";

const REPO = "https://github.com/hurtpk/sonata";
const CHANGELOG = "https://raw.githubusercontent.com/hurtpk/sonata/main/sonata/changelog.ts";

/** The newest version on GitHub, and its title. */
export async function sonataLatest(_: IpcMainInvokeEvent) {
    try {
        const res = await fetch(CHANGELOG, { headers: { "cache-control": "no-cache" } });
        if (!res.ok) return null;
        // Only the start is needed — the newest entry is always first.
        const text = (await res.text()).slice(0, 20_000);
        const version = text.match(/version:\s*"([\w.]+)"/)?.[1];
        const title = text.match(/title:\s*"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\(.)/g, "$1");
        return version ? { version, title: title ?? "" } : null;
    } catch {
        return null;
    }
}

/** Install Sonata.bat in Sonata's own folder: from Equicord's built files, a few folders up. */
function findInstaller() {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
        const bat = join(dir, "src", "userplugins", "sonata", "Install Sonata.bat");
        if (existsSync(bat)) return bat;
        const up = dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    return null;
}

/* ── Updating right inside Discord ──
   What the installer does, without a window: download the new Sonata, keep Equicord on
   Sonata's version (with its small fixes), install any new parts, and rebuild. Discord
   then loads the new files when it restarts — it's already connected to this Equicord,
   so nothing needs connecting again. */

type Step = "download" | "equicord" | "parts" | "build" | "done" | "error";
interface UpdateJob { step: Step; startedAt: number; error?: string; failedStep?: Step; log: string; equicordChanged: boolean; from?: string; to?: string; }
let job: UpdateJob | null = null;

/** The Equicord folder this Discord runs from (the one with src/userplugins/sonata in it). */
function equicordRoot() {
    let dir = __dirname;
    for (let i = 0; i < 6; i++) {
        if (existsSync(join(dir, "src", "userplugins", "sonata", "index.tsx")) && existsSync(join(dir, "package.json"))) return dir;
        const up = dirname(dir);
        if (up === dir) break;
        dir = up;
    }
    return null;
}

/** Runs a command with no window. The arguments are always fixed here, never typed by anyone. */
function run(cmd: string, args: string[], cwd: string, ms = 600_000): Promise<{ code: number; out: string; }> {
    return new Promise(resolve => {
        const extra = [process.env.ProgramFiles && join(process.env.ProgramFiles, "Git", "cmd"), process.env.ProgramFiles && join(process.env.ProgramFiles, "nodejs"), process.env.APPDATA && join(process.env.APPDATA, "npm")].filter(Boolean);
        const env = { ...process.env, PATH: [process.env.PATH, ...extra].join(delimiter), CI: "1", FORCE_COLOR: "0" };
        // pnpm is a .cmd file on Windows, which needs a shell to start: one command line, with
        // paths quoted (a Windows user name can have spaces in it).
        const viaShell = process.platform === "win32" && cmd === "pnpm";
        const child = viaShell
            ? spawn([cmd, ...args.map(a => /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, "")}"` : a)].join(" "), { cwd, env, windowsHide: true, shell: true })
            : spawn(cmd, args, { cwd, env, windowsHide: true });
        let out = "";
        const add = (d: Buffer) => { out += d.toString(); if (out.length > 40_000) out = out.slice(-20_000); };
        child.stdout?.on("data", add);
        child.stderr?.on("data", add);
        const timer = setTimeout(() => { try { child.kill(); } catch { } out += "\n(took too long — stopped)"; }, ms);
        child.on("error", e => { clearTimeout(timer); resolve({ code: -1, out: `${out}\n${e.message}` }); });
        child.on("close", code => { clearTimeout(timer); resolve({ code: code ?? -1, out }); });
    });
}

const readPin = (sonata: string) => {
    try { return readFileSync(join(sonata, "equicord-version.txt"), "utf8").split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith("#")) ?? null; } catch { return null; }
};
const versionOf = (sonata: string) => {
    try { return readFileSync(join(sonata, "sonata", "changelog.ts"), "utf8").match(/version:\s*"([\w.]+)"/)?.[1]; } catch { return undefined; }
};

async function doUpdate(eq: string) {
    const sonata = join(eq, "src", "userplugins", "sonata");
    const j = job!;
    const fail = (msg: string, out = "") => { j.failedStep = j.step; j.step = "error"; j.error = msg; j.log = out.slice(-4000); };
    j.from = versionOf(sonata);

    // 1. The new Sonata.
    j.step = "download";
    const oldPin = readPin(sonata);
    const pull = await run("git", ["-C", sonata, "pull", "--ff-only"], eq, 180_000);
    if (pull.code !== 0) return fail(/not found|ENOENT|not recognized/i.test(pull.out) ? "Git isn't installed (or can't be found)." : "Couldn't download the update — Sonata's folder may have been changed by hand.", pull.out);
    j.to = versionOf(sonata);

    // 2. Equicord on the version Sonata is made for, with its small fixes — the same rules as the installer:
    //    only when this Equicord was set up by Sonata, or was already on Sonata's previous version.
    j.step = "equicord";
    const pin = readPin(sonata);
    const head = (await run("git", ["-C", eq, "rev-parse", "HEAD"], eq, 30_000)).out.trim();
    const managed = existsSync(join(eq, ".git", "sonata-installed")) || (!!oldPin && head === oldPin);
    if (pin && head !== pin && managed) {
        const checkout = () => run("git", ["-C", eq, "checkout", "--quiet", "-B", "sonata", pin], eq, 120_000);
        let co = await checkout();
        if (co.code !== 0) { await run("git", ["-C", eq, "fetch", "--quiet", "origin"], eq, 300_000); co = await checkout(); }
        if (co.code !== 0) {
            // Changes in Equicord's own files stop the switch — usually from installing its parts (pnpm-lock.yaml)
            // or an older set of Sonata's fixes. Put them aside (git stash keeps them) and try again.
            await run("git", ["-C", eq, "stash", "push", "--quiet", "-m", "Sonata: Equicord changes put aside before switching versions"], eq, 60_000);
            co = await checkout();
        }
        if (co.code === 0) j.equicordChanged = true;
        else return fail("Couldn't put Equicord on the version Sonata needs.", co.out);
    }
    const patch = join(sonata, "equicord-fixes.patch");
    if (existsSync(patch) && (await run("git", ["-C", eq, "apply", "--reverse", "--check", patch], eq, 30_000)).code !== 0) {
        if ((await run("git", ["-C", eq, "apply", "--whitespace=nowarn", patch], eq, 30_000)).code !== 0) {
            // An older set of the fixes is in there: put those files back, then add the new set.
            const files = [...readFileSync(patch, "utf8").matchAll(/^diff --git a\/(\S+)/gm)].map(m => m[1]);
            for (const f of files) await run("git", ["-C", eq, "checkout", "--quiet", "HEAD", "--", f], eq, 30_000);
            await run("git", ["-C", eq, "apply", "--whitespace=nowarn", patch], eq, 30_000);
        }
    }

    // 3. New parts: Equicord's (only if it changed version, or they're missing) and Sonata's own.
    j.step = "parts";
    if (j.equicordChanged || !existsSync(join(eq, "node_modules"))) {
        const inst = await run("pnpm", ["install"], eq);
        if (inst.code !== 0) return fail("Couldn't install Equicord's parts.", inst.out);
    }
    if (existsSync(join(sonata, "package.json"))) {
        const parts = await run("pnpm", ["install", "--dir", sonata, "--ignore-workspace", "--lockfile=false", "--prod", "--no-optional"], eq);
        if (parts.code !== 0) return fail("Couldn't install Sonata's parts.", parts.out);
    }

    // 4. Rebuild.
    j.step = "build";
    const build = await run("pnpm", ["build"], eq);
    if (build.code !== 0) return fail("The rebuild didn't work.", build.out);
    j.step = "done";
    j.log = "";
}

/** Starts an update in the background (once at a time). */
export function sonataUpdateStart(_: IpcMainInvokeEvent) {
    if (job && job.step !== "done" && job.step !== "error") return { ok: true as const };
    const eq = equicordRoot();
    if (!eq) return { ok: false as const, error: "Couldn't find Sonata's folder from here." };
    if (!existsSync(join(eq, "src", "userplugins", "sonata", ".git"))) return { ok: false as const, error: "This Sonata was copied in by hand, so it can't update itself — run Install Sonata.bat once to switch it over." };
    job = { step: "download", startedAt: Date.now(), log: "", equicordChanged: false };
    void doUpdate(eq).catch(e => { if (job) { job.step = "error"; job.error = String(e?.message ?? e); } });
    return { ok: true as const };
}

/** How the update is going. */
export function sonataUpdateStatus(_: IpcMainInvokeEvent) {
    return job;
}

/** Opens the installer (it asks before changing anything), or Sonata's GitHub page if it can't be found. */
export async function sonataRunUpdater(_: IpcMainInvokeEvent) {
    const bat = findInstaller();
    if (bat && process.platform === "win32") {
        const err = await shell.openPath(bat);
        if (!err) return "installer";
    }
    await shell.openExternal(REPO);
    return "github";
}
