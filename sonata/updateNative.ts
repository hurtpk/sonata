/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Is there a newer Sonata? Reads the top of the changelog on GitHub (the page
// can't reach GitHub itself). And the Update button: opens Install Sonata.bat,
// which shows what changed and asks before it updates anything.

import { IpcMainInvokeEvent, shell } from "electron";
import { existsSync } from "fs";
import { dirname, join } from "path";

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
