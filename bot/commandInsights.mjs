/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embed } from "./discord.mjs";

export function commandInsights(store, guild, days = 30) {
    const day = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
    const outcomes = store.all("SELECT outcome,SUM(n) AS n FROM command_results WHERE guild=? AND day>=? GROUP BY outcome", guild, day);
    const commands = store.all("SELECT name,SUM(n) AS total,SUM(CASE WHEN outcome='success' THEN n ELSE 0 END) AS success,SUM(CASE WHEN outcome!='success' THEN n ELSE 0 END) AS issues FROM command_results WHERE guild=? AND day>=? GROUP BY name ORDER BY total DESC,name LIMIT 15", guild, day);
    const failures = store.all("SELECT name,SUM(n) AS n FROM command_results WHERE guild=? AND day>=? AND outcome!='success' GROUP BY name ORDER BY n DESC,name LIMIT 10", guild, day);
    return { days, outcomes: Object.fromEntries(outcomes.map(row => [row.outcome, row.n])), commands, failures, total: outcomes.reduce((n, row) => n + row.n, 0) };
}

export function insightsCommand(context, store) {
    const stats = commandInsights(store, context.guild.id, context.command.options.days ?? 30);
    if (context.command.sub === "failures") return embed(`Command issues · past ${stats.days} days`, stats.failures.map(row => `\`${row.name}\`: ${row.n}`).join("\n") || "No command issues recorded in this period.");
    if (context.command.sub === "commands") return embed(`Popular commands · past ${stats.days} days`, stats.commands.map(row => `\`${row.name}\`: ${row.total} attempts · ${row.success} succeeded · ${row.issues} issues`).join("\n") || "No command results recorded yet.");
    return embed(`Command insights · past ${stats.days} days`, `Attempts: ${stats.total}\n${Object.entries(stats.outcomes).map(([outcome, n]) => `${outcome.replaceAll("_", " ")}: ${n}`).join("\n")}\n\nCounts are kept for ninety days. No command arguments or message text are stored. Result tracking starts with this update; older usage totals remain available in the dashboard.`);
}
