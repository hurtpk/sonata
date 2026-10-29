/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { slashCommands } from "./commands.mjs";
import { discordApi, inviteUrl, isId } from "./discord.mjs";

const origin = "https://sonata.hurts.workers.dev/bot-api";
const mode = process.argv[2] ?? "--check";

async function main() {
    const applicationId = process.env.DISCORD_APPLICATION_ID, token = process.env.DISCORD_BOT_TOKEN, secret = process.env.BOT_CONTROL_SECRET;
    if (!isId(applicationId) || !token || !secret || secret.length < 32) throw new Error("Fill DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in bot/.env. Keep the generated BOT_CONTROL_SECRET.");
    if (process.env.PUBLIC_URL !== origin) throw new Error("PUBLIC_URL must match this deployment's Sonata Bot workers.dev address.");
    if (["--check", "--register", "--profile"].includes(mode)) {
        const api = discordApi(token), app = await api("/applications/@me");
        if (app.id !== applicationId) throw new Error("The bot token belongs to a different Discord application.");
        const user = await api("/users/@me");
        if (mode === "--profile") {
            const profile = JSON.parse(await readFile(new URL("./profile/profile.json", import.meta.url), "utf8")), banner = await readFile(new URL("./profile/banner.png", import.meta.url));
            if (typeof profile.description !== "string" || profile.description.length > 400 || banner.length > 1_000_000) throw new Error("Choose a short profile description and a banner under 1 MB.");
            const updated = await api("/users/@me", { method: "PATCH", body: { banner: `data:image/png;base64,${banner.toString("base64")}` } });
            await api("/applications/@me", { method: "PATCH", body: { description: profile.description } });
            if (updated.avatar !== user.avatar) throw new Error("Discord changed the avatar unexpectedly. Check the bot profile.");
            process.stdout.write("Updated Sonata's transparent banner and bio. Kept the avatar.\n");
            return;
        }
        process.stdout.write(`Verified Sonata Bot application ${app.id}, bot user ${user.id}.\n`);
        const flags = BigInt(app.flags_new ?? app.flags ?? 0);
        process.stdout.write(`Server Members Intent: ${flags & ((1n << 14n) | (1n << 15n)) ? "enabled" : "needs enabling"}. Message Content Intent: ${flags & ((1n << 18n) | (1n << 19n)) ? "enabled" : "needs enabling"}.\n`);
        if (mode === "--register") {
            const guild = process.env.TEST_GUILD_ID;
            if (guild && !isId(guild)) throw new Error("TEST_GUILD_ID must be a Discord server ID, or empty for global commands.");
            await api(`/applications/${app.id}${guild ? `/guilds/${guild}` : ""}/commands`, { method: "PUT", body: slashCommands() });
            process.stdout.write(`Registered ${slashCommands().length} ${guild ? "test-server" : "global"} slash commands.\n`);
        }
        process.stdout.write(`Invite: ${inviteUrl(app.id)}\n`);
        return;
    }
    if (mode === "--upload") {
        const secrets = { DISCORD_APPLICATION_ID: applicationId, DISCORD_BOT_TOKEN: token, BOT_CONTROL_SECRET: secret };
        await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [fileURLToPath(new URL("./node_modules/wrangler/bin/wrangler.js", import.meta.url)), "secret", "bulk"], { cwd: fileURLToPath(new URL("./", import.meta.url)), windowsHide: true, stdio: ["pipe", "inherit", "inherit"] });
            child.stdin.on("error", () => reject(new Error("Cloudflare's tool did not accept the private configuration.")));
            child.once("error", () => reject(new Error("Could not start Wrangler. Run npm install in the bot folder.")));
            child.once("exit", code => code === 0 ? resolve() : reject(new Error("Cloudflare did not finish saving the bot secrets.")));
            child.stdin.end(JSON.stringify(secrets));
        });
        return;
    }
    if (["--upload-music", "--upload-dashboard"].includes(mode)) {
        const name = mode === "--upload-music" ? "MUSIC_BRIDGE_SECRET" : "BOT_DASHBOARD_SECRET", key = process.env[name];
        if (!key || key.length < 32) throw new Error(`Configure a separate ${name} of at least 32 characters first.`);
        await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [fileURLToPath(new URL("./node_modules/wrangler/bin/wrangler.js", import.meta.url)), "secret", "bulk"], { cwd: fileURLToPath(new URL("./", import.meta.url)), windowsHide: true, stdio: ["pipe", "inherit", "inherit"] });
            child.stdin.on("error", () => reject(new Error("Cloudflare could not accept the service key.")));
            child.once("error", () => reject(new Error("Could not start Wrangler.")));
            child.once("exit", code => code === 0 ? resolve() : reject(new Error("Cloudflare did not finish saving the service key.")));
            child.stdin.end(JSON.stringify({ [name]: key, ...(mode === "--upload-dashboard" ? { DASHBOARD_OWNER_IDS: process.env.DASHBOARD_OWNER_IDS || "779172192461783110" } : {}) }));
        });
        return;
    }
    if (["--start", "--stop", "--status"].includes(mode)) {
        const response = await fetch(`${origin}/control/${mode.slice(2)}`, { method: mode === "--status" ? "GET" : "POST", redirect: "manual", headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(25_000) });
        if (!response.ok) throw new Error(`The bot control endpoint returned ${response.status}.`);
        const status = await response.json();
        process.stdout.write(JSON.stringify(status, null, 2) + "\n");
        return;
    }
    throw new Error("Use --check, --register, --profile, --upload, --upload-music, --upload-dashboard, --start, --stop or --status.");
}

main().catch(error => { process.stderr.write(error.message + "\n"); process.exitCode = 1; });
