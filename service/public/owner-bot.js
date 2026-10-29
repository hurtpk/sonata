/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const ownerElement = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const ownerGet = id => document.getElementById(id);
let botServers = [], botBlacklist = [], ownerBotCsrf = "", ownerServerAction;
const actionNames = { leave: "Leave server", blacklist: "Blacklist and leave", unblacklist: "Remove from blacklist" };
function confirmServerAction(action, guild, name, reason = "") {
    ownerServerAction = { action, guild, reason };
    ownerGet("owner-server-action-title").textContent = actionNames[action];
    ownerGet("owner-server-action-target").textContent = `${name || "Server"} · ${guild}`;
    ownerGet("owner-server-action-description").textContent = action === "unblacklist" ? "This server can invite Sonata again. Removing it from the blacklist does not add the bot back automatically." : `Sonata will leave this server. History is kept, and pending timed actions are cancelled.${action === "blacklist" ? " The bot will leave again if someone adds it back." : " The server can invite the bot again."}`;
    ownerGet("owner-server-action-error").hidden = true;
    ownerGet("owner-server-dialog").showModal();
}
function ownerCards() {
    const list = ownerGet("owner-server-list"), query = ownerGet("owner-server-search").value.toLowerCase(); list.replaceChildren();
    for (const server of botServers.filter(value => `${value.name} ${value.id}`.toLowerCase().includes(query))) {
        const card = ownerElement("article", null, "bot-server-card"), icon = ownerElement("div", String(server.name || "S").slice(0, 2).toUpperCase(), "server-avatar");
        if (/^(?:a_)?[a-f0-9]+$/.test(server.icon ?? "")) { const image = ownerElement("img"); image.src = `https://cdn.discordapp.com/icons/${server.id}/${server.icon}.webp?size=128`; image.alt = ""; icon.replaceChildren(image); }
        const link = ownerElement("a", "View server details ↗"); link.href = `/?owner=1&guild=${server.id}`;
        const actions = ownerElement("div", null, "owner-server-actions"); actions.append(link);
        for (const action of ["leave", "blacklist"]) { const button = ownerElement("button", actionNames[action], "quiet"); button.type = "button"; button.addEventListener("click", () => confirmServerAction(action, server.id, server.name)); actions.append(button); }
        card.append(icon, ownerElement("h3", server.name || "Server"), ownerElement("p", `${server.member_count == null ? "Members not reported" : `${server.member_count.toLocaleString()} members`} · Boost level ${server.premium_tier ?? 0}`), ownerElement("p", server.id), actions); list.append(card);
    }
    ownerGet("owner-bot-empty").hidden = botServers.length > 0;
    ownerGet("owner-blacklist-list").replaceChildren();
    for (const server of botBlacklist) {
        const row = ownerElement("article", null, "owner-blacklist-row"), details = ownerElement("div");
        details.append(ownerElement("strong", server.name || "Unknown server"), ownerElement("p", server.id, "mono"));
        if (server.reason) details.append(ownerElement("p", server.reason));
        if (server.last_error) details.append(ownerElement("p", `Leave failed: ${server.last_error} Automatic retry is pending.`, "owner-leave-error"));
        const button = ownerElement("button", "Remove from blacklist", "quiet"); button.type = "button"; button.addEventListener("click", () => confirmServerAction("unblacklist", server.id, server.name));
        row.append(details, button); ownerGet("owner-blacklist-list").append(row);
    }
    ownerGet("owner-blacklist-empty").hidden = botBlacklist.length > 0;
}
async function loadOwnerBot() {
    ownerGet("owner-bot-refresh").disabled = true; ownerGet("owner-bot-error").hidden = true;
    try {
        const sessionResponse = await fetch("/api/admin/session", { credentials: "same-origin" }), session = await sessionResponse.json();
        if (!sessionResponse.ok) throw new Error(session.error || "Sign in with your Sonata administrator account.");
        ownerBotCsrf = session.csrf;
        const response = await fetch("/api/admin/bot", { credentials: "same-origin" }), data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load the bot overview.");
        botServers = data.servers; botBlacklist = data.blacklist || []; ownerCards();
        const stats = ownerGet("owner-bot-stats"); stats.replaceChildren();
        for (const [label, value, hint] of [["Servers", botServers.length, "Currently installed"], ["Command uses", data.totals.commands, "Past ninety days"], ["Moderation cases", data.totals.cases, "Across the bot’s servers"], ["Open tickets", data.totals.openTickets, "Awaiting support"]]) { const item = ownerElement("article"); item.append(ownerElement("span", label), ownerElement("b", Number(value || 0).toLocaleString()), ownerElement("small", hint)); stats.append(item); }
        ownerGet("owner-bot-health").textContent = `${data.status.connected ? "● Online" : data.status.paused ? "● Paused" : "● Reconnecting"} · Music ${data.status.musicOnline ? "connected" : "offline"} · ${data.commands} slash commands`;
    } catch (error) { ownerGet("owner-bot-error").textContent = error.message; ownerGet("owner-bot-error").hidden = false; }
    finally { ownerGet("owner-bot-refresh").disabled = false; }
}
ownerGet("activation-tab").addEventListener("click", () => { ownerGet("activation-area").hidden = false; ownerGet("owner-bot-panel").hidden = true; ownerGet("activation-tab").setAttribute("aria-selected", "true"); ownerGet("owner-bot-tab").setAttribute("aria-selected", "false"); });
ownerGet("owner-bot-tab").addEventListener("click", () => { ownerGet("activation-area").hidden = true; ownerGet("owner-bot-panel").hidden = false; ownerGet("activation-tab").setAttribute("aria-selected", "false"); ownerGet("owner-bot-tab").setAttribute("aria-selected", "true"); void loadOwnerBot(); });
ownerGet("owner-bot-refresh").addEventListener("click", () => void loadOwnerBot()); ownerGet("owner-server-search").addEventListener("input", ownerCards);
ownerGet("server-blacklist-form").addEventListener("submit", event => { event.preventDefault(); confirmServerAction("blacklist", ownerGet("server-blacklist-id").value.trim(), "Server", ownerGet("server-blacklist-reason").value.trim()); });
ownerGet("owner-server-action-cancel").addEventListener("click", () => ownerGet("owner-server-dialog").close());
ownerGet("owner-server-action-form").addEventListener("submit", async event => {
    event.preventDefault(); ownerGet("owner-server-action-confirm").disabled = true; ownerGet("owner-server-action-error").hidden = true;
    try {
        const response = await fetch("/api/admin/bot/action", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRF-Token": ownerBotCsrf }, body: JSON.stringify(ownerServerAction) }), result = await response.json();
        if (!response.ok) throw new Error(result.error || "The server action could not be completed.");
        ownerGet("owner-server-dialog").close(); ownerGet("server-blacklist-form").reset(); await loadOwnerBot();
        ownerGet("owner-bot-notice").textContent = result.warning ? `Blacklist saved. Sonata could not leave yet: ${result.warning} It will retry automatically.` : ownerServerAction.action === "leave" ? "Sonata left the server." : ownerServerAction.action === "blacklist" ? "Server blacklisted. Sonata will leave if added again." : "Server removed from the blacklist.";
        ownerGet("owner-bot-notice").hidden = false;
    } catch (error) { ownerGet("owner-server-action-error").textContent = error.message; ownerGet("owner-server-action-error").hidden = false; }
    finally { ownerGet("owner-server-action-confirm").disabled = false; }
});
