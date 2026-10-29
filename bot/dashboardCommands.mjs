/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channel, command, member, option, role, sub, text } from "./commandOptions.mjs";
import { PERMS } from "./discord.mjs";
import { DELEGATED_COMMANDS } from "./commandAccess.mjs";

const number = (name, description, min, max, required = true) => option(name, 4, description, required, { min_value: min, max_value: max });
export const DASHBOARD_COMMANDS = [
    command("dashboard", "Open Sonata's server management dashboard", 0n),
    command("fakepermissions", "Grant roles permission to moderate through Sonata only", PERMS.ADMIN, [
        ...["grant", "revoke"].map(name => sub(name, `${name === "grant" ? "Grant" : "Revoke"} bot-only role access`, [role(), option("permission", 3, "Bot-only permission", true, { choices: Object.keys(DELEGATED_COMMANDS).map(value => ({ name: value, value })) })])),
        sub("view", "List bot-only role permissions", [option("role", 8, "Inspect one role", false)]),
    ], ["fakeperms"]),
    command("commandsettings", "Enable or disable commands in this server", PERMS.GUILD, [
        ...["disable", "enable"].map(name => sub(name, `${name === "disable" ? "Disable" : "Enable"} a command or subcommand`, [option("command", 3, "Command, or command and subcommand", true, { max_length: 64 })])), sub("view", "List disabled commands"),
    ]),
    command("commandstats", "View popular commands, failures and usage totals", PERMS.GUILD, [
        ...["summary", "commands", "failures"].map(name => sub(name, { summary: "Show command result totals", commands: "Show the most used commands", failures: "Show commands with the most issues" }[name], [number("days", "Past calendar days, default thirty", 1, 90, false)])),
    ]),
    command("nicknamepolicy", "Filter blocked phrases and excessive nickname symbols", PERMS.GUILD | PERMS.NICKNAMES, [
        sub("setup", "Enable the nickname policy", [number("symbols", "Maximum symbols in a name, default eight", 0, 32, false), option("fallback", 3, "Replacement nickname, default Member", false, { min_length: 1, max_length: 32 })]),
        sub("block", "Block a literal nickname phrase", [option("phrase", 3, "Blocked or impersonation phrase", true, { max_length: 40 })]),
        sub("unblock", "Remove a blocked phrase", [option("phrase", 3, "Phrase to remove", true, { max_length: 40 })]),
        sub("exempt", "Add or remove a role exemption", [role(), option("enabled", 5, "Exempt this role")]),
        sub("check", "Preview the policy for one member", [member()]), sub("off", "Disable nickname enforcement"), sub("view", "View nickname rules and exemptions"),
    ]),
    command("verification", "Configure member verification and approved roles", 0n, [
        sub("setup", "Enable verification with an approved basic role", [role(), number("age", "Minimum account age in hours", 0, 720)]), sub("panel", "Post a verification button", [channel([0, 5])]), sub("approve", "Approve a member with a staff override", [member()]), sub("off", "Disable verification"), sub("view", "View verification settings"),
    ]),
    command("levels", "Configure XP, rank cards, leaderboards and role rewards", 0n, [
        sub("enable", "Enable XP with an optional announcement channel", [channel([0, 5], false)]), sub("disable", "Pause XP gains while keeping ranks"), sub("rank", "Show a member's rank card", [option("member", 6, "Member to inspect", false)]), sub("leaderboard", "Browse XP leaders", [number("page", "Page number", 1, 1000, false)]), sub("reward", "Set a cumulative role reward", [number("level", "Required level", 1, 100), role()]), sub("unreward", "Remove a role reward", [number("level", "Reward level", 1, 100)]), sub("reset", "Reset one member's XP, keeping granted roles", [member()]), sub("view", "View XP settings and rewards"),
    ]),
    command("afk", "Set, clear or inspect an away status", 0n, [sub("set", "Set your away message", [option("message", 3, "Away message", false, { max_length: 200 })]), sub("clear", "Clear your away status"), sub("view", "View a member's away status", [member()])]),
    command("alias", "Configure server command shortcuts", PERMS.GUILD, [sub("set", "Create or replace a command alias", [text("name", "Shortcut name"), text("target", "Native command and optional fixed arguments")]), sub("remove", "Remove a custom alias", [text("name", "Shortcut name")]), sub("list", "List this server's custom aliases")]),
    command("modstats", "View moderation totals and staff activity", PERMS.TIMEOUT, [sub("summary", "Show case totals", [number("days", "Past days, default thirty", 1, 90, false)]), sub("staff", "Show one moderator's activity", [member(), number("days", "Past days", 1, 90, false)]), sub("actions", "Count moderation actions by type", [number("days", "Past days", 1, 90, false)]), sub("appeals", "Show appeal outcomes", [number("days", "Past days", 1, 90, false)])]),
    command("lockdown", "Lock selected text channels and restore saved permissions", PERMS.GUILD | PERMS.CHANNELS, [sub("start", "Lock channels selected by ID, or all text channels", [text("channels", "Channel IDs separated by commas, or all"), option("reason", 3, "Incident reason", false, { max_length: 300 })]), sub("restore", "Restore only unchanged lockdown permission bits"), sub("view", "Show the active lockdown and saved channels")]),
];
