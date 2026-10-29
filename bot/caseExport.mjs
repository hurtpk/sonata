/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embed, fail, PERMS } from "./discord.mjs";

const csv = value => { let text = String(value ?? ""); if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) || /^\d{15,}$/.test(text)) text = "'" + text; return `"${text.replaceAll('"', '""')}"`; };

export function caseExport(context, store) {
    const { guild, command } = context, o = command.options, format = o.format ?? "json";
    if (command.prefix) context.botPermission(PERMS.ATTACH, true);
    const found = store.all("SELECT * FROM cases WHERE guild=? AND target=? AND n<? ORDER BY n DESC LIMIT 101", guild.id, o.member, o.before ?? 2147483647), more = found.length > 100;
    const cases = found.slice(0, 100).map(row => ({ ...row, notes: store.all("SELECT kind,value,actor,at FROM notes WHERE guild=? AND n=? ORDER BY at LIMIT 100", guild.id, row.n) }));
    if (!cases.length) fail("No cases were found for this user on this page.");
    const report = { serverId: guild.id, userId: o.member, exportedAt: new Date().toISOString(), notesPerCaseLimit: 100, moreCases: more, cases }, fields = ["n", "kind", "target", "actor", "reason", "at", "duration", "status", "detail", "notes"];
    const text = format === "json" ? JSON.stringify(report, null, 2) : format === "csv" ? [fields.map(csv).join(","), ...cases.map(row => fields.map(key => csv(key === "notes" ? JSON.stringify(row.notes) : row[key])).join(","))].join("\r\n") : `Sonata case report\nServer: ${guild.id}\nUser: ${o.member}\nExported: ${report.exportedAt}\n\n` + cases.map(row => `Case #${row.n}: ${row.kind}\nStatus: ${row.status}\nModerator: ${row.actor}\nDate: ${new Date(row.at).toISOString()}\nReason: ${row.reason}\nDetails: ${row.detail}\n${row.notes.map(note => `${note.kind} by ${note.actor}: ${note.value}`).join("\n")}`).join("\n\n");
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 2_000_000) fail("This report is too large. Export fewer recent cases with the before cursor.");
    return { ...embed("Case report ready", `${cases.length} cases, with up to one hundred notes and evidence references per case.${more ? ` More cases remain. Export again with before ${cases.at(-1).n}.` : ""}\nEvidence links are included; attachment bytes are not copied. Prefix exports appear in this channel; slash exports are private.`), files: [{ name: `sonata-cases-${o.member}-${cases.at(-1).n}.${format === "text" ? "txt" : format}`, type: format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/plain", bytes }] };
}
