/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { COMMANDS, slashName } from "../../bot/commands.mjs";
import { FEATURE_GROUPS } from "../../bot/featureGroups.mjs";
import { reference } from "./reference.mjs";
import { fixture, OWNER, TARGET, GUILD, BOT } from "../../bot/test/fixture.mjs";
import { dashboardRequest, guildEvent, DASHBOARD_ACTIONS } from "../../bot/dashboard.mjs";
import { executeCommand } from "../../bot/moderation.mjs";
import { MusicBridge } from "../../bot/musicBridge.mjs";
import { createApplication } from "../application.mjs";
import { openStore, hash, random } from "../store.mjs";

const sample = fixture({ after() {} }), identity = openStore(":memory:"), token = random(), csrf = random();
Object.defineProperty(sample.storage.sql, "databaseSize", { get: () => sample.db.prepare("PRAGMA page_count").get().page_count * sample.db.prepare("PRAGMA page_size").get().page_size });
sample.channels[0].name = "general";
sample.roles.find(role => sample.members.get(BOT).roles.includes(role.id)).managed = true;
sample.guild.name = "Harbor Studio"; guildEvent("GUILD_CREATE", sample.guild, sample.store);
const bot = { store: sample.store, api: sample.api, music: new MusicBridge(), session: { userId: BOT }, env: { DASHBOARD_OWNER_IDS: OWNER }, status: () => ({ connected: true, musicOnline: true, paused: false }) };
const authenticate = () => identity.run("INSERT OR IGNORE INTO bot_sessions VALUES (?,?,?,?,?)", hash(token), OWNER, "preview-owner", csrf, Date.now() + 43_200_000);
authenticate();
identity.run("INSERT INTO bot_sessions VALUES (?,?,?,?,?)", hash(random()), TARGET, "sample-moderator", random(), Date.now() + 43_200_000);
identity.run("INSERT INTO users (id,username,name,first_seen,last_seen,version) VALUES (?,?,?,?,?,?)", TARGET, "sample-moderator", "Sample moderator", Date.now() - 86400_000, Date.now(), "2026.10.29b");
sample.store.saveSettings(GUILD, { ...sample.store.settings(GUILD), aliases: { rules: "tag show rules" } }, OWNER, "Dashboard: alias set");
sample.store.saveSettings(GUILD, { ...sample.store.settings(GUILD), dm: true }, OWNER, "Dashboard: settings dm");
sample.store.run("INSERT INTO owner_server_notes VALUES (?,?,?,?,?)", GUILD, "Review the log channel before inviting more moderators.", JSON.stringify(["testing"]), OWNER, Date.now());
for (let i = 0; i < 7; i++) sample.store.run("INSERT INTO resource_usage VALUES (?,?,?,?,?)", new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10), 80 + i * 13, 25_000 + i * 1000, (i + 1) * 3_000_000, i + 2);
const application = createApplication({ publicUrl: "http://127.0.0.1:4175", adminIds: [OWNER], demo: true }, identity, undefined, async name => readFile(new URL("../public/" + name, import.meta.url)), async (path, actor, input) => dashboardRequest(new Request("https://bot.internal/dashboard/" + path, { method: input ? "POST" : "GET", headers: { "X-Sonata-User": actor }, body: input ? JSON.stringify(input) : undefined }), bot, command => executeCommand(command, sample.store, sample.api, BOT)));

const groups = {
    Moderation: "ban tempban softban banlist unban kick timeout untimeout nickname warn warnings warnremove warnclear escalation jailsetup jail unjail case modstats",
    Security: "honeypot automod antiraid antinuke lockdown nicknamepolicy verification",
    Music: "fm voice voicemaster play pause resume skip stop queue nowplaying volume shuffle remove loop seek filter voteskip musicsettings",
    Community: "welcome goodbye autorole autonick joinlogs autoresponder tag poll giveaway levels ticket appeals afk",
    Media: "download emoji sticker sonata",
};
const catalog = COMMANDS.flatMap(command => (command.options[0]?.type === 1 ? command.options : [{ ...command, name: "" }]).map(sub => ({
    name: [command.name, sub.name].filter(Boolean).join(" "),
    description: sub.description,
    slashName: slashName([command.name, sub.name].filter(Boolean).join(" ")),
    options: sub.options,
    category: Object.keys(groups).find(key => groups[key].split(" ").includes(command.name)) ?? "Server tools",
    aliases: command.aliases,
    websiteSetup: DASHBOARD_ACTIONS[command.name]?.includes(sub.name === "" ? "run" : sub.name) ?? false,
    ...reference(command, sub.name === "" ? command : sub),
})));
const files = { "/": ["index.html", "text/html"], "/style.css": ["style.css", "text/css"], "/app.js": ["app.js", "text/javascript"] };
createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.headers.host !== "127.0.0.1:4175" || req.headers.origin && req.headers.origin !== "http://127.0.0.1:4175") { res.writeHead(403); res.end(); return; }
    if (path === "/preview-session.json" && req.method === "GET") { authenticate(); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ csrf, owner: OWNER, target: TARGET, guild: GUILD })); return; }
    if (path === "/production" || ["/dm-sans.ttf", "/dashboard", "/admin", "/site.js", "/site.css", "/embed.js", "/embed.css", "/bot.js", "/bot.css", "/owner-bot.js", "/admin-tools.js", "/dashboard-extras.js", "/bot-profile.js", "/admin-app.js", "/dashboard-style.css"].includes(path)) { req.headers.cookie = "sonata_bot=" + token; if (path === "/production") req.url = "/"; await application(req, res); return; }
    if (path.startsWith("/api/")) { req.headers.cookie = "sonata_bot=" + token; await application(req, res); return; }
    if (/^\/(owner-console|command-setup|site-info|site-scrollbars)\.(js|css)$/.test(path)) { res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/css"); res.end(await readFile(new URL("../public" + path, import.meta.url))); return; }
    if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
    if (["/favicon.png", "/apple-touch-icon.png"].includes(path)) { res.setHeader("Content-Type", "image/png"); res.end(await readFile(new URL("../public" + path, import.meta.url))); return; }
    if (path === "/features.json") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(FEATURE_GROUPS)); return; }
    if (path === "/catalog.json") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(catalog)); return; }
    const file = files[path];
    if (!file) { res.writeHead(404); res.end("Not found"); return; }
    try { res.setHeader("Content-Type", `${file[1]}; charset=utf-8`); res.end(await readFile(new URL(file[0], import.meta.url))); }
    catch { res.writeHead(500); res.end("Preview file unavailable"); }
}).listen(4175, "127.0.0.1", () => console.log("Sonata design preview: http://127.0.0.1:4175"));
