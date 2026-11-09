/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

function renderLoggingSetup(server, saved = "") {
    if (!server?.manageable) return;
    const layout = document.querySelector(".settings-layout");
    let root = $("logging-setup-panel");
    if (!root) { root = el("article", null, "panel padded logging-setup-panel"); root.id = "logging-setup-panel"; layout.append(root); }
    root.hidden = false; root.replaceChildren();
    document.querySelector(".settings-editor").hidden = true;
    if ($("dashboard-extra")) $("dashboard-extra").hidden = true;
    root.append(el("h2", "Logging setup"), el("p", "Choose which events to log and where they go. Create private log channels or use channels you already have.", "small"));
    const form = el("form"), fields = el("div", null, "logging-fields"), routes = el("div", null, "logging-routes"), notice = el("p", saved, "small"), review = el("p", "", "logging-review");
    notice.setAttribute("role", "status");
    const field = (text, tag = "select") => { const label = el("label", text), input = el(tag); label.append(input); fields.append(label); return input; };
    const category = field("Logging category"); fill(category, [["", "Create a new category"], ...server.channels.filter(channel => channel.type === 4).map(channel => [channel.id, channel.name])]);
    const name = field("New category name", "input"); name.value = "Sonata Logs"; name.maxLength = 100;
    const role = field("Who can view newly created logs?"); fill(role, [["", "Server owner and administrators"], ...server.roles.filter(role => role.id !== server.guild.id).map(role => [role.id, role.name])]);
    root.append(form); form.append(fields, el("h3", "Log channels"), el("p", "Select a destination per type. Multiple types can share a channel. Only checked types are changed.", "small"), routes);
    const types = [
        ["messages", "Message logs", "Deleted messages and deletion audit entries.", "message-logs", server.settings.eventlogs?.messages],
        ["voice", "Voice logs", "Voice joins, leaves, moves and disconnections.", "voice-logs", server.settings.eventlogs?.voice],
        ["users", "User logs", "Member joins, leaves, nickname and member changes.", "user-logs", server.settings.eventlogs?.members || server.settings.eventlogs?.joins || server.settings.joinlogs],
        ["channels", "Channel logs", "Channels created, changed and deleted.", "channel-logs", server.settings.eventlogs?.channels],
        ["roles", "Role logs", "Roles created, changed and deleted.", "role-logs", server.settings.eventlogs?.roles],
        ["bans", "Ban logs", "Members banned and unbanned.", "ban-logs", server.settings.eventlogs?.bans],
        ["moderation", "Moderation logs", "Sonata cases, moderators, actions and reasons.", "mod-logs", server.settings.logChannel],
    ];
    const entries = types.map(([type, title, description, defaultName, destination]) => {
        const row = el("section", null, "logging-route"), label = el("label", null, "logging-route-heading"), check = el("input"), text = el("span"), select = el("select"), channelName = el("input");
        check.type = "checkbox"; check.checked = !types.some(type => type[4]) || !!destination; text.append(el("strong", title), el("small", description)); label.append(check, text);
        fill(select, [["", "Create a new channel"], ...server.channels.filter(channel => [0, 5].includes(channel.type)).map(channel => [channel.id, `# ${channel.name}`])]);
        if (server.channels.some(channel => channel.id === destination)) select.value = destination;
        else if (destination) { const unavailable = el("option", "Saved channel (unavailable)"); unavailable.value = destination; select.append(unavailable); select.value = destination; }
        select.setAttribute("aria-label", `${title} destination`); channelName.setAttribute("aria-label", `${title} new channel name`);
        channelName.value = defaultName; channelName.maxLength = 100; channelName.pattern = "[a-z0-9][a-z0-9-]{0,99}";
        row.append(label, select, channelName); routes.append(row);
        return { type, check, select, channelName };
    });
    const save = el("button", "Set up logs", "primary"); save.type = "submit";
    form.append(review, save, notice);
    const canManage = server.serverOwner || server.administrator || server.canCreateTicketSpace;
    if (!canManage) notice.textContent = "Manage Server and Manage Channels are required to set up logging.";
    const update = () => {
        for (const entry of entries) {
            entry.select.disabled = !entry.check.checked; entry.channelName.hidden = !entry.check.checked || !!entry.select.value;
            entry.channelName.required = entry.check.checked && !entry.select.value;
        }
        const selected = entries.filter(entry => entry.check.checked), fresh = new Set(selected.filter(entry => !entry.select.value).map(entry => entry.channelName.value));
        name.parentElement.hidden = !!category.value || !fresh.size; name.required = !category.value && !!fresh.size;
        save.disabled = !canManage || !selected.length;
        save.textContent = fresh.size ? "Set up logs" : "Save";
        const staff = server.roles.find(entry => entry.id === role.value);
        const visibility = [staff ? "@" + staff.name : "", "server owner", "administrators", server.serverOwner || server.administrator ? "" : "you"].filter(Boolean).join(", ");
        review.textContent = `${fresh.size} new channels${fresh.size && !category.value ? " and 1 category" : ""}. ${selected.length} log types selected.${fresh.size ? ` New channels visible to: ${visibility}.` : ""} Existing channels keep their permissions.`;
    };
    form.addEventListener("input", update); form.addEventListener("change", update); update();
    let pending = false;
    form.addEventListener("submit", async event => {
        event.preventDefault(); if (pending || current !== server || !form.reportValidity()) return;
        pending = true; save.disabled = true; notice.textContent = "Setting up log channels…";
        for (const input of form.querySelectorAll("input,select")) input.disabled = true;
        try {
            const response = await api("/api/bot/action", { guild: server.guild.id, name: "logging-setup", sub: "apply", options: { category: category.value, name: name.value, role: role.value, routes: entries.filter(entry => entry.check.checked).map(entry => ({ type: entry.type, channel: entry.select.value, name: entry.channelName.value })) } });
            if (current !== server) return;
            server.settings = response.settings; renderSavedSettings(); renderFeatureStatus();
            for (const channel of response.created) if (!server.channels.some(value => value.id === channel.id)) server.channels.push(channel);
            server.needsRefresh = true;
            renderLoggingSetup(server, "Logging is configured. New events will go to the selected channels.");
        } catch (error) { if (current === server) notice.textContent = error.message; }
        finally { pending = false; for (const input of form.querySelectorAll("input,select")) input.disabled = false; update(); }
    });
    root.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("logging-setup-open").addEventListener("click", () => renderLoggingSetup(current));
document.addEventListener("sonata-server", () => { $("logging-setup-panel")?.remove(); });
document.addEventListener("click", event => {
    if (event.target.closest("#tool-list button,#dashboard-extra-nav button") && $("logging-setup-panel")) $("logging-setup-panel").hidden = true;
});
