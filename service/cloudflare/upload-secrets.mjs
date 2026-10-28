/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

import { validId } from "../protocol.mjs";

const values = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
const url = new URL(values.PUBLIC_URL);
if (url.protocol !== "https:" || url.origin !== values.PUBLIC_URL) throw new Error("Set PUBLIC_URL in service/.env to your exact HTTPS workers.dev address first.");
if (!validId(values.DISCORD_CLIENT_ID) || !values.DISCORD_CLIENT_SECRET || !values.ADMIN_USER_IDS?.split(",").every(id => validId(id.trim()))) throw new Error("Fill in the Discord application ID, secret and administrator IDs in service/.env first.");
const secrets = Object.fromEntries(["PUBLIC_URL", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "ADMIN_USER_IDS"].map(key => [key, values[key]]));
const child = spawn(process.execPath, [fileURLToPath(new URL("./node_modules/wrangler/bin/wrangler.js", import.meta.url)), "secret", "bulk"], { cwd: fileURLToPath(new URL("./", import.meta.url)), stdio: ["pipe", "inherit", "inherit"], windowsHide: true });
child.stdin.end(JSON.stringify(secrets));
child.once("error", () => { process.stderr.write("Couldn't start Cloudflare's deployment tool. Run npm install in service/cloudflare first.\n"); process.exitCode = 1; });
child.once("exit", code => { process.exitCode = code ?? 1; });
