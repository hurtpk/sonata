/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

function dashboardSearchEntries(server, tools) {
    const entries = [
        ...[["Overview", "overview"], ["Settings", "configure"], ["Commands", "command-access"], ["Ticket Manager", "tickets"], ["Activity & cases", "usage"]].map(([name, tab]) => ({ kind: "Pages", name, tab, detail: "Open this dashboard section." })),
    ];
    if (!server.manageable) return entries.filter(entry => ["overview", "usage"].includes(entry.tab));
    entries.push({ kind: "Settings", name: "Logging setup", detail: "Create a private category and message, voice, user, channel, role, ban and moderation log channels.", logging: true });
    for (const tool of tools.filter(tool => (tool.name !== "antinuke" || server.serverOwner) && (tool.name !== "fakepermissions" || server.administrator))) for (const action of tool.options) {
        entries.push({ kind: "Settings", name: `${labels[tool.name] || tool.name} · ${action.name}`, detail: action.description, keywords: `${tool.name} ${JSON.stringify(action.options || [])}`, tool: tool.name, action: action.name });
    }
    for (const name of server.commandNames || []) entries.push({ kind: "Commands", name, detail: "View this command and its enable/disable controls.", command: name });
    for (const row of server.cases || []) entries.push({ kind: "Cases", name: `Case #${row.n} · ${row.kind}`, detail: `${row.status} · ${row.reason}`, keywords: `${row.n} ${row.actor} ${row.target}`, case: row.n });
    for (const row of server.tickets || []) entries.push({ kind: "Tickets", name: server.channels.find(channel => channel.id === row.channel)?.name || `Ticket ${row.id}`, detail: `${row.state} · Owner ${row.owner} · Assigned ${row.claimed || "unclaimed"}`, keywords: `${row.id} ${row.channel} ${row.owner} ${row.claimed}`, ticket: row.channel });
    return entries;
}

const dashboardSearch = $("dashboard-search"), dashboardResults = $("dashboard-search-results");
let dashboardSearchRequest = 0;
async function searchDashboard() {
    const server = current, query = dashboardSearch.value.trim().toLowerCase().replace(/^[,/]/, ""), revision = ++dashboardSearchRequest;
    dashboardResults.replaceChildren(); dashboardResults.hidden = !server || query.length < 2;
    if (dashboardResults.hidden) return;
    dashboardResults.append(el("p", "Searching…", "small"));
    let tools = [];
    try { tools = server.manageable ? await loadDashboardForms() : []; }
    catch { if (current === server && revision === dashboardSearchRequest) dashboardResults.replaceChildren(el("p", "Settings search is unavailable. Other results are shown below.", "small")); }
    if (current !== server || revision !== dashboardSearchRequest) return;
    dashboardResults.replaceChildren();
    const matches = dashboardSearchEntries(server, tools).filter(entry => query.split(/\s+/).every(word => `${entry.name} ${entry.detail} ${entry.keywords || ""}`.toLowerCase().includes(word)));
    for (const kind of ["Pages", "Settings", "Commands", "Cases", "Tickets"]) {
        const group = matches.filter(entry => entry.kind === kind); if (!group.length) continue;
        const section = el("section"); section.append(el("h3", `${kind} · ${group.length}`));
        for (const entry of group.slice(0, 5)) {
            const button = el("button", null, "dashboard-search-result"); button.type = "button";
            button.append(el("strong", entry.name), el("small", String(entry.detail || "").slice(0, 180)));
            button.addEventListener("click", async () => {
                dashboardResults.hidden = true;
                if (current !== server) return;
                try {
                    if (entry.tab) await openTab(entry.tab);
                    else if (entry.logging) { await openTab("configure"); if (current?.guild.id === server.guild.id) renderLoggingSetup(current); }
                    else if (entry.tool) {
                        await openTab("configure"); if (current?.guild.id !== server.guild.id) return;
                        $("tool-select").value = entry.tool; renderActions(entry.action);
                        document.querySelector(".settings-editor").hidden = false;
                        if ($("dashboard-extra")) $("dashboard-extra").hidden = true;
                        if ($("logging-setup-panel")) $("logging-setup-panel").hidden = true;
                        document.querySelector(".settings-editor").scrollIntoView({ behavior: "smooth", block: "start" });
                    } else if (entry.command) {
                        await openTab("command-access"); if (current?.guild.id !== server.guild.id) return;
                        const input = $("command-access-search"); input.value = entry.command; input.dispatchEvent(new Event("input")); input.focus();
                    } else {
                        await openTab(entry.case ? "usage" : "tickets"); if (current?.guild.id !== server.guild.id) return;
                        const target = $(entry.case ? `case-record-${entry.case}` : `ticket-record-${entry.ticket}`);
                        if (target) { target.tabIndex = -1; target.focus(); target.scrollIntoView({ behavior: "smooth", block: "center" }); }
                    }
                } catch (error) { showError(error); }
            }); section.append(button);
        }
        dashboardResults.append(section);
    }
    if (!matches.length) dashboardResults.append(el("p", "No matches. Try a command, setting, case number, ticket channel or user ID.", "small"));
    dashboardResults.append(el("p", "Searches this server’s available commands and settings, the latest 30 accessible cases, and up to 100 accessible tickets.", "search-scope"));
}
dashboardSearch.addEventListener("input", () => void searchDashboard());
dashboardSearch.addEventListener("focus", () => { if (dashboardSearch.value.trim().length >= 2) void searchDashboard(); });
dashboardSearch.addEventListener("keydown", event => {
    if (["ArrowDown", "Enter"].includes(event.key) && !dashboardResults.hidden) { event.preventDefault(); const first = dashboardResults.querySelector("button"); if (event.key === "Enter") first?.click(); else first?.focus(); }
    if (event.key === "Escape") dashboardResults.hidden = true;
});
dashboardResults.addEventListener("keydown", event => {
    const buttons = [...dashboardResults.querySelectorAll("button")], index = buttons.indexOf(event.target);
    if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); buttons[Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.focus(); }
    if (event.key === "Escape") { dashboardResults.hidden = true; dashboardSearch.focus(); dashboardResults.hidden = true; }
});
document.addEventListener("click", event => { if (!event.target.closest(".dashboard-search")) dashboardResults.hidden = true; });
document.addEventListener("sonata-server", () => { dashboardSearchRequest++; dashboardSearch.value = ""; dashboardResults.hidden = true; dashboardResults.replaceChildren(); });
