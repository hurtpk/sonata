/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const $ = id => document.getElementById(id);
let ownerMode = new URLSearchParams(location.search).get("owner") === "1", listRequest = 0;
let session, servers = [], forms = [], selected, current, requestId = 0;
let formsRequest, featureServer, settingsServer;
const ticketTools = [
    ["Discord channels", [
        ["create-category", "Create category", "Organize ticket channels in Discord."],
        ["create-text", "Create text channel", "Add a regular channel or a private staff channel."],
    ]],
    ["Ticket settings", [
        ["setup", "Ticket setup", "Choose the category, staff role, and transcript channel."],
        ["intake", "Intake form", "Choose the support or commission questions."],
        ["panel", "Post panel", "Add the ticket button to a channel."],
        ["off", "Pause new tickets", "Stop accepting new requests."],
    ]],
    ["Routing and reminders", [
        ["categoryadd", "Add or edit a queue", "Send a ticket type to a category and staff role."],
        ["categoryremove", "Remove a queue", "Remove a routing option for future tickets."],
        ["idle", "Inactivity reminders", "Notify staff when a ticket goes quiet."],
    ]],
];
const ticketFieldLabels = {
    setup: { category: "Ticket category", role: "Ticket staff role", channel: "Transcript channel" },
    panel: { channel: "Channel for the ticket panel" },
    idle: { hours: "Hours of inactivity", channel: "Reminder channel" },
    categoryadd: { name: "Queue name", category: "Ticket category", role: "Ticket staff role" },
    categoryremove: { name: "Queue name" },
    assign: { member: "Staff member’s Discord ID" },
};
const ticketActions = { claim: "Claim", close: "Close & save transcript", reopen: "Reopen", transcript: "Save transcript", archive: "Archive", rename: "Rename", priority: "Set priority", assign: "Assign" };
const labels = { autonick: "Automatic nicknames", autorole: "Automatic roles", autoresponder: "Automatic replies", welcome: "Welcome messages", goodbye: "Goodbye messages", joinlogs: "Join & leave logs", honeypot: "Honeypot", jail: "Jail", jailsetup: "Jail setup", ban: "Bans", kick: "Kicks", warn: "Warnings", nicknamepolicy: "Nickname policies", fakepermissions: "Bot-only permissions", commandsettings: "Command access", rolemenu: "Role menus", case: "Staff approvals", commandstats: "Command insights", musicsettings: "Music and DJs", role: "Roles and permission audit", settings: "General settings", antiraid: "Join protection", antinuke: "Anti-nuke", eventlog: "Message, channel & event logs", escalation: "Warning rules", appeals: "Ban appeals", verification: "Verification", levels: "Levels and rewards", alias: "Command shortcuts", automod: "AutoMod", ticket: "Support tickets", lockdown: "Incident lockdown" };
const el = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
const date = value => value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : "Unavailable";
async function api(path, input) { const response = await fetch(path, { method: input ? "POST" : "GET", credentials: "same-origin", headers: input ? { "Content-Type": "application/json", "X-CSRF-Token": session.csrf } : {}, body: input ? JSON.stringify(input) : undefined }); const data = await response.json(); if (!response.ok) throw Object.assign(new Error(data.error || "The request could not be completed."), { status: response.status }); return data; }
function showError(error) { $("bot-error").textContent = error?.message || ""; $("bot-error").hidden = !error; }
function mark(server, className) { const node = el("div", String(server.name || "S").slice(0, 2).toUpperCase(), className); if (/^(?:a_)?[a-f0-9]+$/.test(server.icon ?? "")) { const image = el("img"); image.src = `https://cdn.discordapp.com/icons/${server.id}/${server.icon}.webp?size=128`; image.alt = ""; node.replaceChildren(image); } return node; }
function renderServers() { $("server-list").replaceChildren(); for (const server of servers.filter(value => `${value.name} ${value.id}`.toLowerCase().includes($("server-search").value.toLowerCase()))) { const button = el("button", null, server.id === selected ? "selected" : ""), text = el("span"); text.append(el("strong", server.name || "Server"), el("small", server.member_count == null ? server.id : `${server.member_count.toLocaleString()} last reported members`)); button.append(mark(server, "server-avatar"), text); button.addEventListener("click", () => void loadServer(server.id)); $("server-list").append(button); } }
function metric(label, value, description) { const node = el("article"); node.title = description; node.append(el("span", label), el("b", value == null ? "—" : Number(value).toLocaleString()), el("small", description)); return node; }
function emptyState(title, description, label, action) {
    const root = el("div", null, "dashboard-empty"); root.append(el("h3", title), el("p", description));
    if (label && current?.manageable) { const button = el("button", label, "quiet"); button.type = "button"; button.addEventListener("click", action); root.append(button); }
    return root;
}
function breakdown(id, entries) {
    $(id).replaceChildren();
    if (!entries.length) {
        const messages = {
            "moderation-breakdown": ["No moderation actions yet", "Actions appear here after staff use Sonata’s moderation commands."],
            "usage-breakdown": ["No commands used yet", "Try a Sonata command in Discord to start seeing usage totals."],
            "outcome-breakdown": ["No results yet", "Command successes and failures appear here once Sonata is used."],
            "failure-breakdown": ["No command issues recorded", "There are no recorded command failures for this period."],
        };
        $(id).append(emptyState(...messages[id], id === "failure-breakdown" ? null : "Browse commands", () => void openTab("command-access"))); return;
    }
    for (const [name, count] of entries.slice(0, 12)) { const row = el("div", null, "metric-row"); row.append(el("span", name), el("strong", count)); $(id).append(row); }
}
function renderDetails(tab = "overview") {
    const { guild, stats } = current; $("server-title").textContent = guild.name; $("server-subtitle").textContent = `Server ID ${guild.id}`; $("server-mark").replaceWith(Object.assign(mark(guild, "server-mark"), { id: "server-mark" })); $("bot-state").textContent = current.status.connected ? "Bot online" : "Bot reconnecting"; $("bot-state").classList.toggle("offline", !current.status.connected);
    $("server-stats").replaceChildren(metric("Members", guild.approximate_member_count, "Current Discord estimate"), metric("Online", guild.approximate_presence_count, "Current Discord estimate"), metric("Cases · 30d", stats.total, "Past thirty days"), metric("Commands · 30d", stats.totalUses, "Past thirty days"));
    $("server-details").replaceChildren(); for (const [key, value] of [["Owner ID", guild.owner_id], ["Bot joined", date(current.botJoined)], ["Boost level", guild.premium_tier ?? 0], ["Boosts", guild.premium_subscription_count ?? 0], ["Language", guild.preferred_locale || "Unavailable"], ["Music service", current.status.musicOnline ? "Connected" : "Offline"]]) $("server-details").append(el("dt", key), el("dd", value));
    renderFeatureStatus();
    renderSavedSettings();
    $("readonly-note").hidden = current.manageable; $("tab-configure").hidden = true; $("activity-cases").hidden = !current.manageable; document.querySelector('[data-tab="configure"]').disabled = !current.manageable;
    breakdown("moderation-breakdown", Object.entries(stats.actions).sort((a, b) => b[1] - a[1])); breakdown("usage-breakdown", stats.usage.map(value => [value.name, value.n]));
    breakdown("outcome-breakdown", Object.entries(current.insights.outcomes).map(([name, n]) => [name.replaceAll("_", " "), n])); breakdown("failure-breakdown", current.insights.failures.map(value => [value.name, value.n]));
    document.querySelector('[data-tab="command-access"]').disabled = !current.manageable;
    document.querySelector('[data-tab="tickets"]').disabled = !current.manageable;
    for (const name of ["roles", "channels"]) document.querySelector(`[data-tab="${name}"]`).disabled = !current.manageable;
    featureServer = undefined;
    $("settings-form").hidden = true;
    document.querySelector(".settings-layout > .settings-editor").hidden = false;
    $("action-result").hidden = true;
    renderRecords();
    void openTab(current.manageable ? tab : "overview");
    document.dispatchEvent(new CustomEvent("sonata-server", { detail: { current, session, selected } }));
}

function renderFeatureStatus() {
    const config = current.settings || {}, root = $("feature-status");
    root.replaceChildren();
    for (const [label, value, group] of [["Join protection", config.antiraid, "security"], ["Anti-nuke", config.antinuke, "security"], ["Verification", config.verification, "community"], ["Levels", config.levels, "community"], ["Ban appeals", config.appeals, "community"], ["Tickets", config.tickets, "community"]]) {
        const row = el("div", null, "feature-row");
        row.append(el("span", label), el("span", current.manageable ? setupStatus(value, config.disabledFeatures?.includes(group)) : "Server access required"));
        root.append(row);
    }
    if (current.manageable && !config.logChannel && !Object.values(config.eventlogs || {}).some(Boolean)) root.append(emptyState("Logging is not configured", "Choose which events to log and create their destination channels.", "Set up logging", async () => { await openTab("configure"); renderLoggingSetup(current); }));
}

function setupStatus(config, paused = false) {
    if (!config || config.enabled === undefined) return "Not set up";
    return paused || config.enabled === false ? "Paused" : "On";
}

async function openSavedSetting(tool, action) {
    const guild = current?.guild.id;
    await openTab("configure"); if (!guild || current?.guild.id !== guild) return;
    $("tool-select").value = tool; renderActions(action);
    document.querySelector(".settings-editor").hidden = false;
    if ($("dashboard-extra")) $("dashboard-extra").hidden = true;
    if ($("logging-setup-panel")) $("logging-setup-panel").hidden = true;
    document.querySelector(".settings-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSavedSettings() {
    const root = $("saved-settings"); root.replaceChildren();
    if (!current.manageable) return;
    const settings = current.settings, channelName = id => current.channels.find(channel => channel.id === id)?.name || "Unavailable channel";
    const logs = [...Object.entries(settings.eventlogs || {}), ...(settings.logChannel ? [["moderation", settings.logChannel]] : [])].filter(([, id]) => id), logNames = { moderation: "Moderation", messages: "Messages", voice: "Voice", members: "Members", joins: "Joins & leaves", channels: "Channels", roles: "Roles", bans: "Bans" };
    const logValue = logs.slice(0, 3).map(([type, id]) => `${logNames[type] || type} → #${channelName(id)}`).join("\n") + (logs.length > 3 ? `\n+${logs.length - 3} more` : "");
    const videoCount = Object.values(settings.videoEmbeds || {}).filter(Boolean).length, videoConfigured = settings.videoEmbeds !== undefined || settings.videoEmbedsAll !== undefined;
    const snapshots = [
        ["Prefix", settings.prefix || ",", "On", () => void openSavedSetting("settings", "prefix")],
        ["Embed color", "#" + (settings.embedColor ?? 0xffad91).toString(16).padStart(6, "0"), "On", () => void openSavedSetting("settings", "embedcolor")],
        ["Log channels", logValue || (settings.logChannel ? `Moderation → #${channelName(settings.logChannel)}` : "Choose where logs go"), logs.length || settings.logChannel ? settings.disabledFeatures?.includes("logging") ? "Paused" : "On" : "Not set up", async () => { await openTab("configure"); renderLoggingSetup(current); }],
        ["Automatic videos", settings.videoEmbedsAll ? "All channels" : videoCount ? `${videoCount} channels` : "No channels selected", settings.videoEmbedsAll || videoCount ? settings.disabledFeatures?.includes("media") ? "Paused" : "On" : videoConfigured ? "Paused" : "Not set up", () => void openSavedSetting("settings", "videoembeds")],
        ["Tickets", settings.tickets ? `#${channelName(settings.tickets.category)}` : "Choose a category and staff role", setupStatus(settings.tickets, settings.disabledFeatures?.includes("community")), () => void openTab("tickets")],
        ["Punishment DMs", settings.dm ? "Send the member a DM" : "Do not send a DM", settings.dm ? "On" : "Off", () => void openSavedSetting("settings", "dm")],
    ];
    for (const [label, value, status, edit] of snapshots) {
        const card = el("article", null, "saved-setting"), header = el("div"), button = el("button", status === "Not set up" ? "Set up" : "Edit", "quiet"); button.type = "button";
        header.append(el("h3", label), el("small", status, "setting-status")); card.append(header, el("p", value), button); button.addEventListener("click", edit); root.append(card);
    }
}

async function renderFeatures() {
    const server = current, guild = selected, root = $("feature-manager");
    if (featureServer === server) return;
    featureServer = server;
    root.replaceChildren(el("p", "Loading features…", "small"));
    try { const value = await api("/api/bot/features?guild=" + encodeURIComponent(guild)); if (current === server) draw(value); }
    catch (error) { if (current === server) { featureServer = undefined; root.replaceChildren(el("p", error.message, "error")); } }
    function draw(data) {
        server.settings.disabledFeatures = data.groups.filter(group => !group.enabled).map(group => group.id);
        root.replaceChildren(el("h2", "Bot features"), el("p", "These switches also pause automatic events such as logging, welcome messages and filters. Command toggles only control command use. Saved settings and history are kept.", "small"));
        const notice = el("p", "", "small"); notice.setAttribute("role", "status");
        if (data.serverOwner) {
            const label = el("label", null, "feature-group-access"), check = el("input"); check.type = "checkbox"; check.checked = data.administrators;
            label.append(check, el("span", "Let administrators change bot features")); root.append(label);
            check.addEventListener("change", async () => { check.disabled = true; try { const value = await api("/api/bot/features", { guild, administrators: check.checked }); if (current === server) draw(value); } catch (error) { check.checked = !check.checked; notice.textContent = error.message; } finally { check.disabled = false; } });
        }
        if (!data.canManage) root.append(el("p", "Only the server owner and permitted administrators can change these switches.", "small"));
        const list = el("div", null, "feature-group-list");
        for (const group of data.groups) {
            const label = el("label", null, "feature-group-row"), text = el("span"), toggle = el("input"); text.append(el("strong", group.name), el("small", group.description)); toggle.type = "checkbox"; toggle.setAttribute("role", "switch"); toggle.setAttribute("aria-label", group.name); toggle.checked = group.enabled; toggle.disabled = !data.canManage; label.append(text, toggle); list.append(label);
            toggle.addEventListener("change", async () => { for (const input of list.querySelectorAll("input")) input.disabled = true; try { const value = await api("/api/bot/features", { guild, group: group.id, enabled: toggle.checked }); if (current === server) draw(value); } catch (error) { toggle.checked = !toggle.checked; notice.textContent = error.message; for (const input of list.querySelectorAll("input")) input.disabled = !data.canManage; } });
        }
        root.append(list, notice); renderSavedSettings(); renderFeatureStatus();
    }
}
function renderRecords() {
    $("case-list").replaceChildren(); for (const row of current.cases || []) { const card = el("article", null, "record"); card.id = `case-record-${row.n}`; card.append(el("h3", `#${row.n} · ${row.kind}`), el("small", `${row.status} · ${date(row.at)}`), el("p", `Target: ${row.target}\nModerator: ${row.actor}\n${row.reason}`)); $("case-list").append(card); } if (!current.cases?.length) $("case-list").append(emptyState("No accessible cases yet", "Sonata creates cases when moderators warn, kick, ban or restrict someone. Viewing cases requires moderation permissions.", "Browse commands", () => void openTab("command-access")));
}

async function renderTicketMaster(server, created) {
    const status = $("ticket-config-status"), tools = $("ticket-tools"), list = $("ticket-list"), editor = $("ticket-config-editor");
    status.textContent = "Loading ticket controls…";
    tools.replaceChildren();
    list.replaceChildren();
    editor.replaceChildren();
    let actions;
    try {
        actions = (await loadDashboardForms()).find(form => form.name === "ticket")?.options ?? [];
    } catch (error) {
        if (current === server) status.textContent = error.message;
        return;
    }
    if (current !== server) return;
    const config = server.settings.tickets;
    const state = config ? `${config.enabled ? "Accepting new tickets" : "New tickets paused"} · ${config.intake === "commission" ? "Commission form" : "Support form"}` : "Choose Ticket setup to configure this server.";
    status.textContent = created ? `Created ${created.channel.name}. ${state}` : state;
    const available = new Map(actions.map(action => [action.name, action]));
    const channels = new Map(server.channels.map(channel => [channel.id, channel]));
    const defaultChannel = channels.has(config?.panel?.channel) ? config.panel.channel : server.channels.find(channel => [0, 5].includes(channel.type))?.id;
    const setupValues = {
        setup: { category: created?.parent || config?.category, role: created?.role || config?.role, channel: created?.private ? created.channel.id : config?.log },
        intake: { mode: config?.intake || "support" },
        panel: { channel: created?.channel.type === 0 && !created.private ? created.channel.id : config?.panel?.channel },
        idle: { hours: config?.idle?.hours ?? 0, channel: config?.idle?.channel },
    };
    const toolButtons = new Map();
    const selectTool = (name, focus = true) => {
        $("ticket-toolbox").open = true;
        const tool = toolButtons.get(name);
        if (!tool || tool.button.disabled) return false;
        for (const { button } of toolButtons.values()) button.setAttribute("aria-expanded", String(button === tool.button));
        if (name.startsWith("create-")) renderTicketSpace(server, editor, name.slice(7), created?.parent, focus);
        else renderTicketAction(server, editor, available.get(name), tool.title, defaultChannel, setupValues[name], { focus, description: tool.description });
        return true;
    };
    for (const [heading, group] of ticketTools) {
        const section = el("section", null, "ticket-tool-group");
        section.append(el("h3", heading));
        for (const [name, title, description] of group) {
            const create = name.startsWith("create-");
            if (!create && !available.has(name)) continue;
            const button = el("button", null, "quiet");
            button.type = "button";
            button.disabled = create ? !server.canCreateTicketSpace : !defaultChannel || (!config && name !== "setup") || (name === "panel" && !config?.enabled);
            button.setAttribute("aria-expanded", "false");
            button.setAttribute("aria-controls", editor.id);
            button.append(el("strong", title), el("small", description));
            button.addEventListener("click", () => selectTool(name));
            toolButtons.set(name, { button, title, description });
            section.append(button);
        }
        tools.append(section);
    }
    if (!server.canCreateTicketSpace) tools.firstElementChild.append(el("p", "Creating channels requires Manage Server and Manage Channels.", "ticket-help"));
    renderSavedTickets(server, available, defaultChannel, selectTool);
    const start = created?.channel.type === 4 ? "create-text" : created && !created.private && config?.enabled ? "panel" : "setup";
    if (!selectTool(start, Boolean(created))) editor.append(el("p", "Create or choose a text channel before setting up tickets.", "ticket-help"));
    if (config && !created) $("ticket-toolbox").open = false;
    for (const row of server.tickets || []) {
        const info = row.details ? JSON.parse(row.details) : {}, channel = channels.get(row.channel);
        const card = el("article", null, "record"), controls = el("div", null, "record-actions"), editor = el("div"); card.id = `ticket-record-${row.channel}`;
        const link = el("a", "Open in Discord ↗");
        link.href = `https://discord.com/channels/${server.guild.id}/${row.channel}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        controls.append(link);
        if (row.transcript && /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(row.transcript)) {
            const transcript = el("a", "View transcript ↗");
            transcript.href = row.transcript;
            transcript.target = "_blank";
            transcript.rel = "noopener noreferrer";
            controls.append(transcript);
        }
        card.append(el("h3", channel ? `#${channel.name}` : "Ticket"), el("p", `${row.state[0].toUpperCase()}${row.state.slice(1)} · ${info.category || "general"} queue · ${info.priority || "normal"} priority`, "ticket-help"), el("p", `Owner: ${row.owner} · Assigned: ${row.claimed || "Unclaimed"}`, "ticket-help"));
        const options = row.state === "open" ? ["claim", "close", "rename", "priority", "assign"] : row.state === "closed" ? ["reopen", "rename", "archive"] : [];
        for (const name of [...options, "transcript"]) {
            if (!available.has(name)) continue;
            const button = el("button", ticketActions[name], "quiet");
            button.type = "button";
            button.addEventListener("click", () => renderTicketAction(server, editor, available.get(name), ticketActions[name], row.channel, { name: channel?.name, priority: info.priority, member: row.claimed }));
            controls.append(button);
        }
        card.append(controls, editor);
        list.append(card);
    }
    if (!list.children.length) list.append(emptyState("No accessible ticket conversations yet", "Members open tickets from a posted panel. Only conversations in channels you can view appear here.", config?.enabled ? "Post a ticket panel" : "Set up tickets", () => selectTool(config?.enabled ? "panel" : "setup")));
}

function renderSavedTickets(server, available, channel, selectTool) {
    const root = $("ticket-systems"), config = server.settings.tickets;
    root.replaceChildren();
    const channelName = id => server.channels.find(value => value.id === id)?.name || (id ? `Unavailable channel (${id})` : "Not set");
    const roleName = id => server.roles.find(value => value.id === id)?.name || "Unavailable role";
    const editor = $("ticket-config-editor");
    const open = (name, title, defaults, description) => {
        $("ticket-toolbox").open = true;
        renderTicketAction(server, editor, available.get(name), title, channel, defaults, { description });
    };
    const action = (root, title, run, disabled = false) => {
        const button = el("button", title, "quiet"); button.type = "button"; button.disabled = disabled;
        button.addEventListener("click", run); root.append(button);
    };
    if (!config) {
        const empty = el("div", null, "ticket-empty");
        empty.append(el("h3", "No ticket system configured"), el("p", "Set up a category, staff role and transcript channel to start accepting tickets.", "ticket-help"));
        action(empty, "Create ticket setup", () => selectTool("setup"), !channel);
        root.append(empty); return;
    }
    const summary = el("div", null, "ticket-summary");
    for (const [label, value] of [["Status", config.enabled ? "Accepting tickets" : "Paused"], ["Form", config.intake === "commission" ? "Commission" : "Support"], ["Open tickets", (server.tickets || []).filter(row => row.state === "open").length]]) {
        const item = el("div"); item.append(el("small", label), el("strong", value)); summary.append(item);
    }
    root.append(summary);
    const card = el("article", null, "ticket-system-card"), controls = el("div", null, "record-actions");
    card.append(el("h3", "Default ticket system"));
    const details = el("dl", null, "ticket-system-details");
    for (const [key, value] of [["Category", channelName(config.category)], ["Staff role", roleName(config.role)], ["Transcripts", channelName(config.log)], ["Reminders", config.idle?.hours ? `After ${config.idle.hours} hours` : "Off"]]) details.append(el("dt", key), el("dd", value));
    card.append(details, controls);
    action(controls, "Edit setup", () => selectTool("setup"), !channel);
    action(controls, "Edit form", () => selectTool("intake"), !channel);
    action(controls, "Post panel", () => selectTool("panel"), !channel || !config.enabled);
    action(controls, config.enabled ? "Pause tickets" : "Resume tickets", () => selectTool(config.enabled ? "off" : "setup"), !channel);
    action(controls, "Delete setup", () => renderTicketManagement(server, editor, "reset"));
    root.append(card);
    const queueHeader = el("div", null, "ticket-section-heading"); queueHeader.append(el("h3", "Routing queues"));
    action(queueHeader, "Add queue", () => selectTool("categoryadd"), !channel); root.append(queueHeader);
    const queues = el("div", null, "ticket-saved-grid");
    for (const [name, queue] of Object.entries(config.categories || {})) {
        const entry = el("article", null, "ticket-system-card"), buttons = el("div", null, "record-actions");
        entry.append(el("h4", name), el("p", `${channelName(queue.category)} · ${roleName(queue.role)}`, "ticket-help"), buttons);
        action(buttons, "Edit", () => open("categoryadd", `Edit ${name}`, { name, category: queue.category, role: queue.role }, "Update this queue’s category and staff role. Keep its name to update the saved queue."), !channel);
        action(buttons, "Remove", () => open("categoryremove", `Remove ${name}`, { name }, "Remove this routing queue for future tickets. Existing ticket conversations are kept."), !channel);
        queues.append(entry);
    }
    if (!queues.children.length) queues.append(el("p", "No extra queues. Tickets use the default setup.", "ticket-help"));
    root.append(queues);
    const panels = config.panels ?? (config.panel ? [config.panel] : []), panelHeader = el("div", null, "ticket-section-heading");
    panelHeader.append(el("h3", `Posted panels · ${panels.length}`)); root.append(panelHeader);
    const panelList = el("div", null, "ticket-saved-grid");
    for (const panel of panels) {
        const entry = el("article", null, "ticket-system-card"), buttons = el("div", null, "record-actions"), link = el("a", "View in Discord");
        link.href = `https://discord.com/channels/${server.guild.id}/${panel.channel}/${panel.message}`; link.target = "_blank"; link.rel = "noopener noreferrer";
        entry.append(el("h4", `# ${channelName(panel.channel)}`), el("small", `Message ${panel.message}`), buttons); buttons.append(link);
        const hidden = !server.channels.some(value => value.id === panel.channel);
        action(buttons, "Update panel", () => renderTicketManagement(server, editor, "panel-update", panel.message), hidden);
        action(buttons, "Remove", () => renderTicketManagement(server, editor, "panel-delete", panel.message));
        panelList.append(entry);
    }
    if (!panelList.children.length) panelList.append(el("p", "No saved panels. Post one to let members open tickets.", "ticket-help"));
    root.append(panelList);
}

function renderTicketManagement(server, root, sub, message) {
    $("ticket-toolbox").open = true;
    const title = sub === "reset" ? "Delete ticket setup" : sub === "panel-delete" ? "Remove ticket panel" : "Update ticket panel";
    const description = sub === "reset" ? "Remove the saved setup and routing queues. Remove panels and archive ticket conversations first. Discord channels and saved transcripts are kept." : sub === "panel-delete" ? "Delete this panel message from Discord. Existing tickets are kept." : "Refresh this panel with the current intake form and routing queues.";
    const { form, submit, notice } = ticketForm(root, title, description, title, true);
    form.addEventListener("submit", async event => {
        event.preventDefault(); if (submit.disabled || current !== server) return; submit.disabled = true;
        try {
            await api("/api/bot/action", { guild: server.guild.id, name: "ticket-manage", sub, options: { message } });
            if (current === server) await loadServer(server.guild.id, "tickets", true);
        } catch (error) { notice.textContent = error.message; }
        finally { submit.disabled = false; }
    });
}

function ticketForm(root, title, description, submitLabel, focus) {
    const form = el("form", null, "ticket-action-form");
    form.append(el("h3", title), el("p", description, "ticket-help"));
    const fields = el("div", null, "ticket-fields");
    const submit = el("button", submitLabel, "primary");
    submit.type = "submit";
    const notice = el("p", "", "ticket-help");
    notice.setAttribute("role", "status");
    form.append(fields, submit, notice);
    root.replaceChildren(form);
    if (focus) {
        const heading = form.querySelector("h3");
        heading.tabIndex = -1;
        heading.focus();
    }
    return { form, fields, submit, notice };
}

function renderTicketSpace(server, root, kind, defaultParent, focus) {
    const category = kind === "category";
    const title = category ? "Create category" : "Create text channel";
    const description = category ? "Add a new category to this Discord server." : "Choose where the channel goes and who can see it.";
    const { form, fields, submit, notice } = ticketForm(root, title, description, title, focus);
    const field = (label, name, tag) => {
        const wrapper = el("label", label), control = el(tag);
        control.name = name;
        wrapper.append(control);
        fields.append(wrapper);
        return control;
    };
    const name = field(category ? "Category name" : "Channel name", "name", "input");
    name.required = true;
    name.maxLength = 100;
    name.placeholder = category ? "Commission Tickets" : "ticket-transcripts";
    let visibility;
    if (!category) {
        const parent = field("Parent category", "parent", "select");
        fill(parent, server.channels.filter(channel => channel.type === 4).map(channel => [channel.id, channel.name]), "No category");
        parent.value = defaultParent || server.settings.tickets?.category || "";
        if (parent.selectedIndex < 0) parent.value = "";
        visibility = field("Who can see this channel?", "visibility", "select");
        fill(visibility, [["inherit", "Use category or server permissions"], ...(server.canCreatePrivateTicketSpace ? [["staff", "Private staff channel"]] : [])]);
        const role = field("Staff role with access", "role", "select");
        fill(role, server.roles.filter(entry => entry.id !== server.guild.id).map(entry => [entry.id, entry.name]), "Choose a staff role…");
        role.value = server.settings.tickets?.role || "";
        const update = () => {
            role.disabled = visibility.value !== "staff";
            role.required = !role.disabled;
            role.parentElement.hidden = role.disabled;
        };
        visibility.addEventListener("change", update);
        update();
    }
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (server.ticketSpacePending || current !== server) return;
        server.ticketSpacePending = true;
        submit.disabled = true;
        notice.textContent = "Creating in Discord…";
        const options = Object.fromEntries(new FormData(form));
        try {
            const { channel } = await api("/api/bot/action", { guild: server.guild.id, name: "ticket-space", sub: kind, options });
            if (current !== server) return;
            server.channels.push(channel);
            settingsServer = undefined;
            if (!$("tab-tickets").hidden) await renderTicketMaster(server, { channel, parent: category ? channel.id : options.parent, role: options.role, private: options.visibility === "staff" });
        } catch (error) {
            notice.textContent = error.message;
        } finally {
            server.ticketSpacePending = false;
            submit.disabled = false;
        }
    });
}

function renderTicketAction(server, root, action, title, channel, defaults = {}, { focus = true, description = action.description } = {}) {
    const submitLabel = { setup: "Save setup", intake: "Save form", idle: "Save reminders", categoryadd: "Save queue", categoryremove: "Remove queue" }[action.name] || title;
    const { form, fields, submit, notice } = ticketForm(root, title, description, submitLabel, focus);
    for (const field of action.options || []) {
        const label = renderOption("ticket", { ...action, documentation: undefined }, { ...field, description: ticketFieldLabels[action.name]?.[field.name] || field.description });
        const control = label.querySelector("[data-option]");
        if (defaults[field.name] != null) control.value = defaults[field.name];
        fields.append(label);
    }
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (submit.disabled || current !== server) return;
        submit.disabled = true;
        const options = {};
        for (const control of form.querySelectorAll("[data-option]")) {
            if (control.value !== "") options[control.dataset.option] = control.dataset.type === "4" ? Number(control.value) : control.value;
        }
        try {
            const { result } = await runDashboardAction({ guild: server.guild.id, channel, name: "ticket", sub: action.name, options });
            if (current !== server) return;
            $("bot-notice").textContent = (result.embeds || []).map(value => `${value.title}\n${value.description}`).join("\n\n");
            $("bot-notice").hidden = false;
            await loadServer(server.guild.id, "tickets", true);
        } catch (error) {
            notice.textContent = error.message;
        } finally { submit.disabled = false; }
    });
}
function fill(select, values, placeholder) { select.replaceChildren(); if (placeholder) { const option = el("option", placeholder); option.value = ""; select.append(option); } for (const [value, label] of values) { const option = el("option", label); option.value = value; select.append(option); } }
function renderTools() { const allowed = forms.filter(form => (form.name !== "antinuke" || current.guild.owner_id === session.id) && (form.name !== "fakepermissions" || current.administrator)).sort((a, b) => a.name === "settings" ? -1 : b.name === "settings" ? 1 : (labels[a.name] || a.name).localeCompare(labels[b.name] || b.name)); fill($("tool-select"), allowed.map(form => [form.name, labels[form.name] || form.name])); fill($("command-channel"), (current.channels || []).filter(channel => [0, 5].includes(channel.type)).map(channel => [channel.id, `# ${channel.name}`])); renderActions(); }
function renderToolList() {
    const query = $("tool-search").value.trim().toLowerCase(), list = $("tool-list"); list.replaceChildren();
    const categories = [
        ["General & access", "settings commandsettings alias commandstats fakepermissions"],
        ["Moderation & cases", "ban tempban softban unban kick timeout untimeout warn warnings clearwarn clearwarnings jail jailsetup unjail case modstats purge"],
        ["Security & AutoMod", "antinuke antiraid automod honeypot nicknamepolicy lockdown verification"],
        ["Community & tickets", "ticket appeals welcome goodbye joinlogs autorole autonick autoresponder levels rolemenu giveaway afk tag poll"],
        ["Logs & server tools", "eventlog role channel slowmode lock unlock hide unhide stick"],
        ["Music & media", "musicsettings voicemaster voice download emoji sticker fm"],
    ];
    const groups = new Map();
    for (const option of $("tool-select").options) {
        const form = forms.find(value => value.name === option.value);
        if (query) {
            for (const action of form?.options || []) {
                const searchable = `${option.text} ${form.name} ${action.name} ${action.description} ${JSON.stringify(action.options || [])} ${JSON.stringify(action.documentation || {})}`.toLowerCase();
                if (!query.split(/\s+/).every(word => searchable.includes(word))) continue;
                const button = el("button", `${option.text} · ${action.name}`); button.type = "button";
                button.setAttribute("aria-pressed", String(option.value === $("tool-select").value && action.name === $("action-select").value));
                button.addEventListener("click", () => { $("tool-select").value = option.value; $("action-result").hidden = true; renderActions(action.name); }); list.append(button);
            }
            continue;
        }
        const button = el("button", option.text); button.type = "button"; button.setAttribute("aria-pressed", String(option.value === $("tool-select").value));
        button.append(el("small", `${form.options.length} actions`));
        button.addEventListener("click", () => { $("tool-select").value = option.value; $("action-result").hidden = true; renderActions(); });
        const category = categories.find(([, names]) => names.split(" ").includes(option.value))?.[0] || "More tools";
        if (!groups.has(category)) groups.set(category, []);
        groups.get(category).push(button);
    }
    if (!query) for (const [name] of [...categories, ["More tools"]]) {
        const buttons = groups.get(name); if (!buttons?.length) continue;
        const group = el("details", null, "settings-category"), summary = el("summary"), grid = el("div", null, "settings-card-grid");
        group.setAttribute("name", "settings-category"); summary.append(el("strong", name), el("span", `${buttons.length} ${buttons.length === 1 ? "tool" : "tools"}`));
        grid.append(...buttons); group.append(summary, grid); list.append(group);
    }
    if (!list.children.length) list.append(el("p", "No matching commands or settings."));
}
function renderCommandManager() {
    const server = current, root = $("command-manager"); root.replaceChildren();
    const canManage = server.canManageCommands ?? (server.serverOwner === true || server.administrator === true);
    const search = el("input"), filter = el("select"), toolbar = el("div", null, "command-manager-toolbar"), list = el("div", null, "command-toggle-list"), notice = el("p", "", "small");
    search.id = "command-access-search"; search.type = "search"; search.placeholder = "Search commands…"; search.setAttribute("aria-label", "Find commands to enable or disable");
    fill(filter, [["all", "All commands"], ["enabled", "On"], ["disabled", "Off"]]); filter.setAttribute("aria-label", "Filter command status");
    toolbar.append(search, filter); notice.setAttribute("role", "status");
    if (server.settings.disabledFeatures?.length) {
        const warning = el("p", "Some bot features are paused. You can turn them back on in Settings → Bot features.", "small"); root.append(warning);
    }
    const pages = el("div", null, "command-manager-pages"), previous = el("button", "Previous", "quiet"), next = el("button", "Next", "quiet"), count = el("span");
    previous.type = next.type = "button"; pages.append(previous, count, next); root.append(toolbar, list, pages, notice);
    let page = 0, pending = false;
    if (!canManage) notice.textContent = "Manage Server is required to change command access.";
    function draw() {
        list.replaceChildren();
        const disabled = server.settings.disabledCommands || [], protectedNames = ["help", "dashboard", "commandsettings", "fakepermissions"];
        const names = server.commandNames || [], query = search.value.trim().toLowerCase().replace(/^[,/]/, "");
        const blocked = name => disabled.some(value => name === value || name.startsWith(value + " "));
        const matches = name => name.includes(query) && (filter.value === "all" || blocked(name) === (filter.value === "disabled"));
        const roots = names.filter(name => !name.includes(" ") && (matches(name) || names.some(child => child.startsWith(name + " ") && matches(child)))).sort((a, b) => a.localeCompare(b));
        page = Math.min(page, Math.max(0, Math.ceil(roots.length / 10) - 1));
        for (const name of roots.slice(page * 10, page * 10 + 10)) {
            const card = el("article", null, "command-toggle-card"), header = el("div", null, "command-toggle-row"), children = names.filter(child => child.startsWith(name + " ") && (query || filter.value !== "all" ? matches(child) : true));
            const expand = el("button", children.length ? `${name} · ${children.length} ${children.length === 1 ? "action" : "actions"}` : name, "command-root"); expand.type = "button";
            const sublist = el("div", null, "command-children"); sublist.hidden = !query && filter.value === "all";
            expand.disabled = !children.length; expand.setAttribute("aria-expanded", String(!sublist.hidden));
            expand.addEventListener("click", () => { sublist.hidden = !sublist.hidden; expand.setAttribute("aria-expanded", String(!sublist.hidden)); });
            const editor = el("div", null, "command-inline-editor"); editor.hidden = true;
            header.append(expand, controls(name, editor)); card.append(header, editor);
            for (const child of children) { const row = el("div", null, "command-toggle-row"), childEditor = el("div", null, "command-inline-editor"); childEditor.hidden = true; row.append(el("span", child), controls(child, childEditor)); sublist.append(row, childEditor); }
            if (children.length) card.append(sublist);
            list.append(card);
        }
        if (!roots.length) list.append(el("p", "No commands match this search.", "small"));
        previous.disabled = page === 0; next.disabled = (page + 1) * 10 >= roots.length;
        count.textContent = `${roots.length} commands · Page ${page + 1}/${Math.max(1, Math.ceil(roots.length / 10))}`;
        function controls(name, editor) {
            const actions = el("div", null, "command-row-actions"), configure = el("button", "Configure", "quiet"); configure.type = "button";
            configure.id = "configure-command-" + encodeURIComponent(name); editor.id = "command-editor-" + encodeURIComponent(name);
            configure.setAttribute("aria-controls", editor.id); configure.setAttribute("aria-expanded", "false");
            configure.addEventListener("click", () => {
                editor.hidden = !editor.hidden; configure.textContent = editor.hidden ? "Configure" : "Close"; configure.setAttribute("aria-expanded", String(!editor.hidden));
                if (!editor.hidden && !editor.children.length) document.dispatchEvent(new CustomEvent("sonata-command-configure", { detail: { server, root: editor, name } }));
                if (!editor.hidden) editor.scrollIntoView({ behavior: "smooth", block: "nearest" });
            });
            actions.append(configure, toggle(name)); return actions;
        }
        function toggle(name) {
            const parent = name.split(" ")[0], inherited = name !== parent && disabled.includes(parent), locked = protectedNames.includes(parent);
            const label = el("label", null, "command-access-toggle"), check = el("input"); check.type = "checkbox"; check.setAttribute("role", "switch"); check.setAttribute("aria-label", `Enable ${name}`);
            check.checked = !blocked(name); check.disabled = pending || locked || inherited || !canManage || !server.channels.some(channel => [0, 5].includes(channel.type));
            label.title = locked ? "Help and permission controls stay available." : inherited ? `Enable ${parent} first.` : "Applies to prefix, slash and dashboard commands.";
            label.append(el("small", locked ? "Required" : inherited ? "Parent off" : check.checked ? "On" : "Off"), check);
            check.addEventListener("change", async () => {
                if (pending) return;
                pending = true;
                for (const control of list.querySelectorAll("input")) control.disabled = true;
                notice.textContent = "Saving…";
                try {
                    await runDashboardAction({ guild: server.guild.id, channel: server.channels.find(channel => [0, 5].includes(channel.type)).id, name: "commandsettings", sub: check.checked ? "enable" : "disable", options: { command: name } });
                    if (current === server) notice.textContent = `${name} is ${check.checked ? "on" : "off"}.`;
                } catch (error) { if (current === server) notice.textContent = error.message; }
                finally { pending = false; if (current === server) draw(); }
            });
            return label;
        }
    }
    search.addEventListener("input", () => { page = 0; draw(); }); filter.addEventListener("change", () => { page = 0; draw(); });
    previous.addEventListener("click", () => { page--; draw(); }); next.addEventListener("click", () => { page++; draw(); });
    draw();
}
function renderActions(actionName) { const form = forms.find(value => value.name === $("tool-select").value); $("selected-tool-title").textContent = labels[form?.name] || "Settings"; fill($("action-select"), (form?.options || []).map(action => [action.name, action.description])); if (typeof actionName === "string") $("action-select").value = actionName; renderToolList(); renderFields(); }
function renderFields() {
    const form = forms.find(value => value.name === $("tool-select").value), action = form?.options.find(value => value.name === $("action-select").value); $("action-fields").replaceChildren(); $("action-description").textContent = action?.documentation ? action.documentation.description + " " + action.documentation.detail + " Required: " + action.documentation.permissions : action?.description || "Choose an action.";
    const video = form?.name === "settings" && action?.name === "videoembeds";
    const snipe = form?.name === "settings" && action?.name === "snipe";
    $("command-channel").closest("label").hidden = video || snipe;
    if (video) { renderVideoFields(); return; }
    if (snipe) $("action-fields").append(el("p", "Applies to every channel, including new channels. Sonata must be able to view the channel to collect deletions. Keeps 15 recent deletions per channel by default.", "small"));
    for (const field of action?.options || []) $("action-fields").append(renderOption(form.name, action, field));
}
function renderOption(name, action, field) {
        const commandChoice = name === "commandsettings" && field.name === "command";
        const label = el("label", field.description), control = el(commandChoice || field.choices || [7, 8].includes(field.type) ? "select" : field.max_length > 200 ? "textarea" : "input"); control.dataset.option = field.name; control.dataset.type = field.type;
        if (commandChoice) fill(control, (current.commandNames || []).filter(name => !["help", "dashboard", "fakepermissions", "commandsettings"].includes(name.split(" ")[0])).map(name => [name, `${name}${(current.settings.disabledCommands || []).some(value => name === value || name.startsWith(`${value} `)) ? " (disabled)" : ""}`]), "Choose a command…");
        else if (field.choices) fill(control, field.choices.map(choice => [choice.value, choice.name]), field.required ? "Choose…" : "Use default");
        else if (field.type === 7) fill(control, (current.channels || []).filter(channel => !field.channel_types || field.channel_types.includes(channel.type)).map(channel => [channel.id, `${channel.type === 4 ? "Category" : "#"} ${channel.name}`]), field.required ? "Choose a channel…" : "Use default");
        else if (field.type === 8) fill(control, (current.roles || []).filter(role => role.id !== selected).map(role => [role.id, role.name]), field.required ? "Choose a role…" : "No role requirement");
        else if (field.type === 5) control.type = "checkbox";
        else if (field.type === 4) { control.type = "number"; control.min = field.min_value ?? 0; if (field.max_value != null) control.max = field.max_value; }
        else { if (field.max_length) control.maxLength = field.max_length; if (field.type === 6) { control.inputMode = "numeric"; control.placeholder = "Discord user ID"; } }
        if (name === "settings" && action.name === "snipe") {
            if (field.name === "limit") control.value = current.settings?.snipeLimit ?? 15;
            if (field.name === "require_manage_messages") control.checked = current.settings?.snipeRequireManageMessages !== false;
        }
        if (name === "settings" && action.name === "prefix" && field.name === "prefix") control.value = current.settings.prefix || ",";
        if (name === "settings" && action.name === "embedcolor" && field.name === "color") control.value = "#" + (current.settings.embedColor ?? 0xffad91).toString(16).padStart(6, "0");
        if (name === "settings" && action.name === "modlog" && field.name === "channel") control.value = current.settings.logChannel || "";
        if (name === "settings" && action.name === "dm" && field.name === "enabled") control.checked = !!current.settings.dm;
        if (field.type !== 5) control.required = !!field.required; label.append(control); const help = action.documentation?.parameters.find(parameter => parameter.name === field.name); if (help) label.append(el("small", help.description)); return label;
}
function renderVideoFields() {
    const settings = current.settings || {}, ids = Object.entries(settings.videoEmbeds || {}).filter(([,enabled]) => enabled).map(([id]) => id), root = $("action-fields");
    const enabledLabel = el("label", "Automatic video embeds", "video-toggle"), enabled = el("input"); enabled.type = "checkbox"; enabled.id = "video-enabled"; enabled.checked = !!settings.videoEmbedsAll || ids.length > 0; enabledLabel.prepend(enabled);
    const scopeLabel = el("label", "Apply to"), scope = el("select"); scope.id = "video-scope"; fill(scope, [["selected", "Selected channels"], ["all", "All channels"]]); scope.value = settings.videoEmbedsAll ? "all" : "selected"; scopeLabel.append(scope);
    const picker = el("fieldset", null, "video-channels"), legend = el("legend", "Channels"), search = el("input"), list = el("div", null, "video-channel-list"), summary = el("p", "", "small"), allNote = el("p", "Includes new channels. Sonata still needs permission to view, send messages and attach files.", "small");
    search.type = "search"; search.placeholder = "Find a channel"; search.setAttribute("aria-label", "Find a video channel"); summary.setAttribute("aria-live", "polite");
    for (const channel of (current.channels || []).filter(channel => [0,5].includes(channel.type))) {
        const label = el("label", `# ${channel.name}`), checkbox = el("input"); checkbox.type = "checkbox"; checkbox.value = channel.id; checkbox.checked = ids.includes(channel.id); label.prepend(checkbox); list.append(label);
    }
    const update = () => { const all = scope.value === "all"; picker.hidden = all; allNote.hidden = !all; summary.textContent = `${list.querySelectorAll("input:checked").length} channels selected`; };
    search.addEventListener("input", () => { const query = search.value.toLowerCase(); for (const label of list.children) label.hidden = !label.textContent.toLowerCase().includes(query); });
    const roles = el("fieldset", null, "video-channels"), roleSearch = el("input"), roleList = el("div", null, "video-channel-list video-role-list");
    roleSearch.type = "search"; roleSearch.placeholder = "Find a role"; roleSearch.setAttribute("aria-label", "Find an allowed role");
    for (const role of current.roles.filter(role => role.id !== current.guild.id).sort((a, b) => b.position - a.position)) {
        const label = el("label", role.name), checkbox = el("input");
        checkbox.type = "checkbox"; checkbox.value = role.id; checkbox.checked = settings.videoEmbedRoles?.includes(role.id) ?? false;
        label.prepend(checkbox); roleList.append(label);
    }
    roleSearch.addEventListener("input", () => { const query = roleSearch.value.trim().toLowerCase(); for (const label of roleList.children) label.hidden = !label.textContent.toLowerCase().includes(query) && !label.firstChild.value.includes(query); });
    roles.append(el("legend", "Allowed roles"), el("p", "Select up to 25 roles for automatic embeds, including links sent with Sonata’s name or mention. Leave all roles unchecked to allow everyone.", "small"), roleSearch, roleList);
    scope.addEventListener("change", update); list.addEventListener("change", update); picker.append(legend, search, list, summary); root.append(enabledLabel, scopeLabel, picker, allNote, roles); update();
}
function showResult(result) { $("action-result").hidden = false; $("action-result").classList.remove("error-result"); $("action-result").textContent = (result.embeds || []).map(value => `${value.title}\n${value.description}`).join("\n\n"); }
function showTab(name) { for (const button of document.querySelectorAll("[data-tab]")) { const active = button.dataset.tab === name; button.setAttribute("aria-selected", String(active)); $(`tab-${button.dataset.tab}`).hidden = !active; } document.dispatchEvent(new CustomEvent("sonata-dashboard-tab", { detail: name })); }
function loadDashboardForms() {
    return formsRequest ??= api("/api/bot/forms").then(value => value.forms).catch(error => {
        formsRequest = undefined;
        throw error;
    });
}

async function runDashboardAction(input) {
    const server = current;
    const response = await api("/api/bot/action", input);
    if (server && current === server && server.guild.id === input.guild) {
        if (response.settings) server.settings = response.settings;
        server.needsRefresh = true;
        renderFeatureStatus(); renderSavedSettings();
    }
    return response;
}

async function openTab(name) {
    if (name === "records") name = "usage";
    showTab(name);
    const server = current;
    if (!server?.manageable) return;
    if (name === "command-access") { renderCommandManager(); return; }
    if (name === "configure") void renderFeatures();
    if (server.needsRefresh && ["tickets", "usage"].includes(name)) { await loadServer(server.guild.id, name, true); return; }
    if (name === "tickets") { await renderTicketMaster(server); return; }
    if (name !== "configure" || settingsServer === server) return;
    settingsServer = server;
    $("settings-form").hidden = true;
    $("selected-tool-title").textContent = "Loading settings…";
    $("tool-list").replaceChildren();
    try {
        forms = await loadDashboardForms();
        if (current !== server) return;
        renderTools();
        $("settings-form").hidden = false;
        document.querySelector(".settings-editor").hidden = true;
    } catch (error) {
        if (current !== server) return;
        settingsServer = undefined;
        $("selected-tool-title").textContent = error.message;
    }
}

async function loadServer(id, tab = "overview", keepVisible = false) {
    const request = ++requestId;
    if (!keepVisible || selected !== id) {
        current = undefined;
        $("server-workspace").hidden = true;
        $("select-server").hidden = false;
        $("server-loading").hidden = false;
        $("bot-notice").hidden = true;
    }
    selected = id;
    renderServers();
    showError();
    try {
        const data = await api(`${ownerMode ? "/api/admin/bot/server" : "/api/bot/server"}?guild=${encodeURIComponent(id)}`);
        if (request !== requestId) return;
        const active = keepVisible ? document.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab : tab;
        current = data;
        $("select-server").hidden = true;
        $("server-workspace").hidden = false;
        renderDetails(active);
        const params = new URLSearchParams(location.search);
        params.set("guild", id);
        if (!ownerMode) params.delete("owner");
        history.replaceState(null, "", "/dashboard?" + params);
    } catch (error) {
        if (request !== requestId) return;
        if ([401, 403, 404].includes(error.status)) {
            current = undefined;
            $("server-workspace").hidden = true;
            $("select-server").hidden = false;
        }
        showError(error);
    } finally {
        if (request === requestId) $("server-loading").hidden = true;
    }
}
async function refresh() {
    const revision = ++listRequest, detailAtStart = requestId;
    showError();
    $("server-list").setAttribute("aria-busy", "true");
    $("no-servers").hidden = true;
    try {
        const data = await api(ownerMode ? "/api/admin/bot" : "/api/bot/servers");
        if (revision !== listRequest) return;
        servers = data.servers;
        renderServers();
        $("no-servers").hidden = servers.length > 0;
        $("server-list").setAttribute("aria-busy", "false");
        if (selected && servers.some(server => server.id === selected)) {
            if (detailAtStart === requestId) void loadServer(selected);
        } else if (servers.length === 1) {
            void loadServer(servers[0].id);
        } else {
            requestId++;
            selected = undefined;
            current = undefined;
            $("server-workspace").hidden = true;
            $("select-server").hidden = false;
            $("server-loading").hidden = true;
        }
    } catch (error) {
        if (revision === listRequest) showError(error);
    } finally {
        if (revision === listRequest) $("server-list").setAttribute("aria-busy", "false");
    }
}
function renderScope() { $("list-label").textContent = ownerMode ? "All bot servers" : "My servers"; for (const button of document.querySelectorAll("[data-server-scope]")) button.setAttribute("aria-pressed", String((button.dataset.serverScope === "all") === ownerMode)); }
for (const button of document.querySelectorAll("[data-server-scope]")) button.addEventListener("click", () => {
    const next = button.dataset.serverScope === "all"; if (next === ownerMode) return;
    ownerMode = next; requestId++; selected = undefined; current = undefined; servers = []; $("server-search").value = ""; renderServers(); renderScope(); $("server-workspace").hidden = true; $("select-server").hidden = false; $("server-loading").hidden = true;
    const params = new URLSearchParams(location.search); params.delete("guild"); if (ownerMode) params.set("owner", "1"); else params.delete("owner"); history.replaceState(null, "", "/dashboard?" + params); void refresh();
});
$("server-search").addEventListener("input", renderServers); $("bot-refresh").addEventListener("click", () => void refresh()); $("tool-select").addEventListener("change", renderActions); $("action-select").addEventListener("change", renderFields); for (const button of document.querySelectorAll("[data-tab]")) button.addEventListener("click", () => void openTab(button.dataset.tab));
$("tool-search").addEventListener("input", renderToolList);
$("settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    const server = current, name = $("tool-select").value, sub = $("action-select").value, button = $("apply-settings");
    if (!server?.manageable || button.disabled) return;
    button.disabled = true;
    showError();
    const options = {};
    for (const input of $("action-fields").querySelectorAll("[data-option]")) {
        const type = Number(input.dataset.type);
        if (type === 5) options[input.dataset.option] = input.checked;
        else if (input.value !== "") options[input.dataset.option] = type === 4 ? Number(input.value) : input.value;
    }
    try {
        if ($("video-scope")) {
            options.enabled = $("video-enabled").checked;
            options.all = $("video-scope").value === "all";
            const channels = [...$("action-fields").querySelectorAll(".video-channel-list:not(.video-role-list) input:checked")].map(input => input.value);
            const roles = [...$("action-fields").querySelectorAll(".video-role-list input:checked")].map(input => input.value);
            if (roles.length > 25) throw Error("Choose up to 25 allowed roles.");
            options.roles = roles.join(" ") || "all";
            if (!options.all && options.enabled && !channels.length) throw Error("Choose at least one channel, or select All channels.");
            if (!options.all && channels.length) options.channels = channels.join(" ");
        }
        const { result } = await runDashboardAction({ guild: server.guild.id, channel: $("command-channel").value, name, sub, options });
        if (current !== server || $("tool-select").value !== name || $("action-select").value !== sub) return;
        if (name === "commandsettings" || name === "settings" && sub === "videoembeds") renderFields();
        showResult(result);
    } catch (error) {
        if (current === server) {
            $("action-result").hidden = false;
            $("action-result").classList.add("error-result");
            $("action-result").textContent = error.message;
        }
    } finally { button.disabled = false; }
});
$("bot-logout").addEventListener("click", async () => { try { await api("/api/bot/logout", {}); window.top.location.assign("/"); } catch (error) { showError(error); } });
async function start() { if (ownerMode) { $("bot-login").href = "/auth/start"; $("list-label").textContent = "ALL BOT SERVERS"; } try { session = await api("/api/bot/session"); const canViewAll = session.sonataOwner || session.permissions?.includes("servers"); $("server-scope").hidden = !canViewAll; if (!canViewAll) ownerMode = false; renderScope(); $("bot-user").textContent = `@${session.username}`; $("owner-link").hidden = !session.owner; $("owner-link").textContent = session.sonataOwner ? "Owner" : "Admin"; $("bot-logout").hidden = false; $("bot-workspace").hidden = false; selected = new URLSearchParams(location.search).get("guild"); await refresh(); } catch (error) { $("bot-signin").hidden = false; if (error.status !== 401) { $("bot-workspace").hidden = false; showError(error); } } }
void start();
