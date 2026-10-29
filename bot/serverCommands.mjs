/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { channel, command, duration, member, option, role, sub, text } from "./commandOptions.mjs";
import { PERMS } from "./discord.mjs";

const integer = (name, description, min, max, required = true) => option(name, 4, description, required, { min_value: min, max_value: max });
const choices = (name, description, values) => option(name, 3, description, true, { choices: values.map(value => ({ name: value, value })) });
export const SERVER_COMMANDS = [
    command("antiraid", "Configure join-spike and new-account protection", PERMS.ADMIN, [
        sub("setup", "Configure and enable join protection", [channel([0, 5]), integer("joins", "Joins that trigger a raid alert", 3, 50), integer("seconds", "Join counting window", 5, 300), integer("age", "Minimum account age in hours, zero disables", 0, 720), choices("action", "What happens to flagged arrivals", ["alert", "quarantine"])]),
        sub("off", "Disable join protection"), sub("view", "Show join protection settings"), sub("clear", "End the current raid protection window"),
    ]),
    command("antinuke", "Owner-only protection against destructive audit events", 0n, [
        sub("setup", "Configure audit-event protection", [channel([0, 5]), integer("limit", "Actions by one account that trigger protection", 2, 20), integer("seconds", "Action counting window", 10, 300), choices("action", "Alert only or remove dangerous roles", ["alert", "strip"])]),
        sub("off", "Disable destructive-action protection"), sub("view", "Show protection settings"),
        sub("trust", "Trust or untrust an account", [member(), option("enabled", 5, "Exempt this account")]),
        sub("restore", "Restore unchanged roles saved by protection", [member()]),
    ]),
    command("eventlog", "Configure logs for Discord server changes", PERMS.GUILD, [
        sub("set", "Enable one kind of event log", [choices("type", "Event category", ["channels", "roles", "members", "voice", "bans", "messages", "joins"]), channel([0, 5])]),
        sub("off", "Disable one kind of event log", [choices("type", "Event category", ["channels", "roles", "members", "voice", "bans", "messages", "joins"])]), sub("view", "Show configured event logs"),
    ]),
    command("escalation", "Configure warning expiry and automatic consequences", PERMS.ADMIN, [
        sub("set", "Set an action at an active warning count", [integer("warnings", "Active warning count", 1, 20), choices("action", "Automatic action", ["timeout", "kick", "ban"]), option("duration", 3, "Timeout duration, default one hour", false)]),
        sub("remove", "Remove a warning threshold", [integer("warnings", "Warning threshold", 1, 20)]),
        sub("expiry", "Expire active warnings after this many days", [integer("days", "Days, or zero for no expiry", 0, 365)]),
        sub("exempt", "Exempt or unexempt a role", [role(), option("enabled", 5, "Exempt this role")]), sub("view", "Show warning rules and exemptions"),
    ]),
    command("appeals", "Configure ban appeals and inspect their case records", PERMS.BAN, [
        sub("setup", "Enable ban DM appeal forms", [channel([0, 5])]), sub("off", "Disable new appeals"), sub("view", "Show appeal configuration"),
        sub("list", "Browse recent ban appeals"), sub("case", "View a case and its appeal", [integer("case", "Original ban case number", 1, 2147483647)]),
    ]),
    command("ticket", "Create private support tickets and transcripts", 0n, [
        sub("setup", "Choose ticket category, staff role and transcript channel", [option("category", 7, "Private ticket category", true, { channel_types: [4] }), role(), channel([0, 5])]),
        sub("panel", "Post an open-ticket button", [channel([0, 5])]), sub("open", "Open your private support ticket", [text("topic", "What you need help with")]),
        sub("claim", "Claim this ticket as staff"), sub("close", "Save a transcript and close this ticket"), sub("reopen", "Reopen this closed ticket"), sub("transcript", "Export the latest messages from this ticket"),
        sub("view", "Show ticket configuration"), sub("off", "Disable new tickets"),
        sub("archive", "Archive a closed ticket record, keeping its channel"),
        sub("categoryadd", "Add a ticket type with its own category and staff role", [text("name", "Ticket type name"), option("category", 7, "Discord category", true, { channel_types: [4] }), role()]), sub("categoryremove", "Remove a ticket type", [text("name", "Ticket type name")]),
        sub("openin", "Open a ticket in a specific support queue", [text("category", "Configured ticket type"), text("topic", "What you need help with")]),
        sub("priority", "Set this ticket's priority", [choices("priority", "Ticket priority", ["low", "normal", "high", "urgent"])]), sub("assign", "Assign this ticket to support staff", [member()]), sub("idle", "Configure staff reminders for inactive tickets", [integer("hours", "Inactive hours, zero disables", 0, 168), channel([0, 5], false)]),
    ]),
    command("giveaway", "Run persistent button-entry giveaways", 0n, [
        sub("start", "Create a timed giveaway in this channel", [duration(), integer("winners", "Number of winners", 1, 10), text("prize", "The giveaway prize"), option("role", 8, "Required role", false), integer("age", "Minimum account age in days", 0, 365, false)]),
        sub("end", "Draw winners now", [text("message", "Giveaway message ID")]), sub("reroll", "Draw replacements excluding previous winners", [text("message", "Giveaway message ID")]),
        sub("cancel", "Cancel without drawing winners", [text("message", "Giveaway message ID")]), sub("list", "Browse recent giveaways"),
    ]),
];
