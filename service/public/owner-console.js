/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const date = value => value ? new Date(value).toLocaleString() : "Not recorded";
const field = (name, label, value = "", extra = "") => `<label>${label}<input name="${name}" value="${escape(value)}" ${extra}></label>`;
const empty = text => `<p class="console-empty">${text}</p>`;
const table = (headers, rows) => `<div class="console-table"><table><thead><tr>${headers.map(text => `<th>${text}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const number = value => value == null ? "Unavailable" : Number(value).toLocaleString();
const metric = (label, value, detail) => `<article><span>${label}</span><strong>${escape(value)}</strong><small>${detail}</small></article>`;

function overview({ checkedAt, deployment, accounts, sessions, activity, bot, resources, operations }, servers, serverCount) {
    const today = new Date(checkedAt).toISOString().slice(0, 10);
    const samples = new Map(resources?.days.map(day => [day.day, day.commands]));
    const days = Array.from({ length: 14 }, (_, i) => new Date(Date.parse(today) - (13 - i) * 86_400_000).toISOString().slice(0, 10));
    const peak = Math.max(1, ...days.map(day => samples.get(day) ?? 0));
    const totals = resources?.days.filter(day => day.day >= days[0] && day.day <= today)
        .reduce((sum, day) => ({ commands: sum.commands + day.commands, videos: sum.videos + day.videos, ms: sum.ms + day.processing_ms }), { commands: 0, videos: 0, ms: 0 });
    const chart = resources?.days.length ? `<svg viewBox="0 0 420 110" role="img" aria-label="Daily command counts over the last 14 UTC days"><path class="console-chart-grid" d="M0 20h420M0 60h420M0 109h420"/>${days.map((day, index) => {
        if (resources.measuredSince && day < resources.measuredSince) return "";
        const count = samples.get(day) ?? 0, height = Math.max(2, count / peak * 98);
        return `<rect x="${index * 30 + 3}" y="${109 - height}" width="24" height="${height}" rx="3" class="${day === today ? "today" : ""}"><title>${day}: ${number(count)} commands</title></rect>`;
    }).join("")}</svg><div class="console-chart-labels"><span>${days[0]}</span><span>${today} · UTC</span></div><details><summary>Daily counts</summary><ul class="console-overview-list">${days.slice().reverse().map(day => `<li><span>${day}</span><strong>${resources.measuredSince && day < resources.measuredSince ? "No data" : number(samples.get(day) ?? 0)}</strong></li>`).join("")}</ul></details>` : empty(resources ? "No command samples yet." : "Command activity is unavailable.");
    const states = [
        ["Discord gateway", bot ? bot.paused ? "Paused" : bot.connected ? "Connected" : "Offline" : "Unavailable", bot?.connected && !bot.paused],
        ["Music and video service", bot ? bot.musicOnline ? "Connected" : "Offline" : "Unavailable", bot?.musicOnline],
        ["Queued commands", number(bot?.queued)],
        ["Pending timed actions", number(bot?.pendingJobs)],
        ["Servers playing music", number(resources?.activeMusicServers)],
        ["Bot database", resources?.databaseBytes != null ? (resources.databaseBytes / 1048576).toFixed(2) + " MiB" : "Unavailable"],
    ];
    const alerts = [
        ...(!bot?.connected || bot.paused ? [states[0][0] + " · " + states[0][1]] : []),
        ...(bot && !bot.musicOnline ? ["Music and video service is offline."] : []),
        ...(bot?.error ? [bot.error] : []),
        ...(bot?.stickyErrors ? [number(bot.stickyErrors) + " sticky message errors"] : []),
        ...(resources?.alerts ?? []).map(alert => `${({ dailyCommands: "Daily commands", dailyVideoMiB: "Daily video transfer (MiB)", storageMiB: "Bot storage (MiB)", averageMs: "Average command time (ms)" })[alert.key] ?? alert.key}: ${alert.current} / ${alert.limit}`),
    ];
    return `<div class="console-overview-heading"><div><h2>Overview</h2><p>Checked ${date(checkedAt)}</p></div><span>Site ${escape(deployment)}</span></div>
        <div class="console-metrics console-summary">
            ${metric("Bot servers", number(serverCount), "Current installations")}
            ${metric("Plugin activations", number(accounts.activated), `${number(accounts.recent)} checked in within 24 hours`)}
            ${metric("Blocked plugin IDs", number(accounts.blocked), "Includes IDs blocked before activation")}
            ${metric("Dashboard sessions", number(sessions), "Unexpired browser sessions")}
            ${metric("Commands today", resources ? number(samples.get(today) ?? 0) : "Unavailable", "Since midnight UTC")}
        </div>
        <div class="console-overview-grid">
            <section class="console-card"><div class="console-card-heading"><h3>Command activity</h3><button data-console-tab="resources">Resources</button></div>${totals ? `<ul class="console-overview-list"><li><span>Commands in 14 days</span><strong>${number(totals.commands)}</strong></li><li><span>Average processing time</span><strong>${totals.commands ? number(Math.round(totals.ms / totals.commands)) + " ms" : "No samples"}</strong></li><li><span>Video transfers received</span><strong>${number(totals.videos)}</strong></li></ul>` : ""}${chart}</section>
            <section class="console-card"><div class="console-card-heading"><h3>Live services</h3><button data-console-tab="health">Server checks</button></div><ul class="console-overview-list">${states.map(([label, value, ok]) => `<li><span>${label}</span><strong${ok ? ' class="console-online"' : ""}>${escape(value)}</strong></li>`).join("")}</ul>${bot?.version ? `<small class="console-deployment">Bot ${escape(bot.version)}</small>` : ""}</section>
            <section class="console-card"><div class="console-card-heading"><h3>Needs attention</h3><button data-console-tab="operations">Operations</button></div>
                ${alerts.length ? `<ul class="console-alerts">${alerts.map(alert => `<li>${escape(alert)}</li>`).join("")}</ul>` : empty("No service alerts.")}
                ${operations ? `<ul class="console-overview-list"><li><span>Paused commands and groups</span><strong>${operations.maintenance.length}</strong></li><li><span>Restricted rollouts</span><strong>${operations.rollouts.length}</strong></li></ul>${[...operations.maintenance, ...operations.rollouts].length ? `<p>${escape([...operations.maintenance, ...operations.rollouts].join(", "))}</p>` : ""}` : empty("Rollout status is unavailable.")}
                ${bot?.failures.length ? `<h4>Recent command issues</h4><ul class="console-overview-list">${bot.failures.slice(0, 5).map(row => `<li><span>${escape(row.name)}</span><strong>${number(row.n)}</strong></li>`).join("")}</ul>` : ""}
            </section>
            <section class="console-card"><div class="console-card-heading"><h3>Recent access changes</h3><button data-console-tab="sessions">Sessions</button></div>${activity.length ? `<ul class="console-activity">${activity.map(row => `<li><strong>${escape(({ allowed: "Plugin access allowed", blocked: "Plugin access blocked", admin_granted: "Administrator access granted", admin_revoked: "Administrator access revoked", sessions_revoked: "Dashboard sessions revoked" })[row.action] ?? row.action.replaceAll("_", " "))}</strong><time>${date(row.at)}</time><small>Target ${escape(row.target)} · by ${escape(row.actor)}</small></li>`).join("")}</ul>` : empty("No access changes have been recorded.")}</section>
            <section class="console-card console-installations"><div class="console-card-heading"><h3>Newest bot installations</h3></div>${serverCount ? `<ul class="console-overview-list">${servers.slice(0, 6).map(server => `<li><span><a href="/dashboard?owner=1&amp;guild=${encodeURIComponent(server.id)}">${escape(server.name || "Discord server")}</a><small>${server.member_count == null ? "Member count unavailable" : number(server.member_count) + " reported members"}</small></span><time>${date(server.firstSeen)}</time></li>`).join("")}</ul>` : empty(serverCount === 0 ? "Sonata has no current installations." : "The server directory is unavailable.")}</section>
        </div>`;
}

function browserLabel(agent) {
    if (!agent) return "Browser details unavailable";
    const browser = /Edg(?:A|iOS)?\//.test(agent) ? "Edge" : /OPR\//.test(agent) ? "Opera" : /(?:Firefox|FxiOS)\//.test(agent) ? "Firefox" : /(?:Chrome|CriOS)\//.test(agent) ? "Chrome" : /Safari\//.test(agent) ? "Safari" : "Other browser";
    const platform = /iPhone/.test(agent) ? "iPhone" : /iPad/.test(agent) ? "iPad" : /Android/.test(agent) ? "Android" : /Windows/.test(agent) ? "Windows" : /Macintosh/.test(agent) ? "macOS" : /Linux/.test(agent) ? "Linux" : "";
    return [browser, platform].filter(Boolean).join(" · ");
}

export async function mountOwnerConsole(root, api) {
    let tab = "overview", guild = "", servers = [], serverCount, serverRequest, policy, version = 0, lookupPage = 0, lookupId = "";
    root.classList.add("owner-console");
    const groups = [
        ["Operations", [["overview", "Overview"], ["resources", "Resources"], ["operations", "Rollouts & maintenance"]]],
        ["Servers", [["health", "Server checks"], ["history", "Config history"], ["notes", "Server notes"], ["messages", "Send message"]]],
        ["Access", [["sessions", "Sessions"], ["lookup", "Account lookup"]]],
    ];
    root.innerHTML = `<header class="console-title"><h1>Sonata Owner</h1><button type="button" id="console-refresh">Refresh</button></header><nav class="console-tabs" aria-label="Owner tools">${groups.map(([label, tabs]) => `<div class="console-tab-group"><span>${label}</span><div>${tabs.map(([id, label]) => `<button type="button" data-console-tab="${id}" aria-current="${id === tab ? "page" : "false"}">${label}</button>`).join("")}</div></div>`).join("")}</nav><div class="console-toolbar" hidden><div class="console-server-field"><span>Server</span><details class="console-server-picker"><summary>Choose a server</summary><div class="console-server-menu"><label>Find an installed server<input type="search" placeholder="Server name or ID" autocomplete="off"></label><div class="console-server-results"></div></div></details></div></div><p class="console-notice" role="status" hidden></p><div class="console-body"></div>`;
    const body = root.querySelector(".console-body"), notice = root.querySelector(".console-notice");
    const picker = root.querySelector(".console-server-picker"), summary = picker.querySelector("summary"), search = picker.querySelector("input"), matches = picker.querySelector(".console-server-results");
    const showNotice = text => { notice.textContent = text; notice.hidden = false; };
    function updateServerPicker() {
        const current = servers.find(server => server.id === guild);
        summary.innerHTML = current ? `<span>${escape(current.name || "Discord server")}</span><small>${escape(current.id)}</small>` : "Choose a server";
        const query = search.value.trim().toLowerCase();
        const filtered = servers.filter(server => server.id.includes(query) || (server.name ?? "").toLowerCase().includes(query));
        matches.innerHTML = filtered.map(server => `<button type="button" data-server-id="${escape(server.id)}" aria-pressed="${server.id === guild}"><span>${escape(server.name || "Discord server")}</span><small>${escape(server.id)}</small></button>`).join("") || empty("No matching installed servers.");
    }
    async function loadServers() {
        const installed = (await api("servers")).servers;
        servers = installed;
        serverCount = servers.length;
        if (!servers.some(server => server.id === guild)) guild = servers[0]?.id ?? "";
        updateServerPicker();
    }
    const serverQuery = () => `?guild=${encodeURIComponent(guild)}`;
    const serverTabs = ["health", "history", "notes", "messages"];
    function refreshServers() {
        return serverRequest ??= loadServers().catch(() => {
            servers = []; guild = ""; serverCount = undefined; updateServerPicker();
        }).finally(() => { serverRequest = undefined; });
    }
    async function render(refreshDirectory = false) {
        const current = ++version; notice.hidden = true; body.innerHTML = empty("Loading…");
        root.querySelector(".console-toolbar").hidden = !serverTabs.includes(tab);
        body.classList.toggle("console-overview", tab === "overview");
        for (const button of root.querySelectorAll(".console-tabs [data-console-tab]")) button.setAttribute("aria-current", button.dataset.consoleTab === tab ? "page" : "false");
        try {
            let html;
            if (tab === "overview") {
                const [data] = await Promise.all([api("overview"), refreshServers()]);
                html = overview(data, servers, serverCount);
                if (current === version) body.innerHTML = html;
                return;
            }
            if (serverTabs.includes(tab) && (refreshDirectory || serverCount === undefined)) await refreshServers();
            else if (serverRequest && (serverTabs.includes(tab) || tab === "operations")) await serverRequest;
            if (current !== version) return;
            if (serverTabs.includes(tab) && !guild) { body.innerHTML = empty(serverCount === undefined ? "The server directory could not load." : "No installed servers are available."); return; }
            if (tab === "health") {
                const data = await api("check" + serverQuery());
                html = `<h2>${escape(data.name)}</h2><p>Read-only checks · ${date(data.checkedAt)}</p><div class="console-checks">${data.checks.map(check => `<article><span class="console-indicator ${check.ok ? "ok" : "issue"}">${check.ok ? "✓" : "!"}</span><div><h3>${escape(check.name)}</h3><p>${escape(check.detail)}</p></div></article>`).join("")}</div>`;
            }
            if (tab === "messages") {
                const data = await api("messages" + serverQuery());
                html = `<h2>Send a message</h2><p>Post as Sonata in the selected server. Mentions are sent without notifications. Only the Sonata owner can use this tool.</p><form data-console-form="message"><label>Channel<select name="channel" required>${data.channels.map(channel => `<option value="${channel.id}"># ${escape(channel.name || channel.id)}</option>`).join("")}</select></label><label>Message<textarea name="content" required maxlength="2000" rows="6" placeholder="Write your message"></textarea></label><button type="submit" ${data.channels.length ? "" : "disabled"}>Send message</button></form><div class="message-receipt" role="status"></div><h3>Recent messages</h3>${data.recent.length ? table(["Sent", "Owner", "Channel", ""], data.recent.map(message => [date(message.at), escape(message.actor), escape(data.channels.find(channel => channel.id === message.channel)?.name || message.channel), `<a href="https://discord.com/channels/${message.guild}/${message.channel}/${message.id}" target="_blank" rel="noopener noreferrer">Open message ↗</a>`])) : empty("No messages sent from this tool yet.")}`;
            }
            if (tab === "operations") {
                policy = await api("operations");
                const targets = policy.targets.map(target => `<option value="${escape(target)}">${escape(target)}</option>`).join("");
                html = `<h2>Command availability</h2><p>Maintenance pauses commands; rollouts limit commands to selected test servers. Help, dashboard access and punishment releases remain available. Native Discord AutoMod rules continue running.</p><div class="console-columns"><section><h3>Maintenance</h3><form data-console-form="maintenance"><label>Command or group<select name="target">${targets}</select></label>${field("message", "Notice shown to users", "", 'required maxlength="300" placeholder="Temporarily paused while we fix an issue."')}<button type="submit">Pause commands</button></form>${policy.maintenance.length ? table(["Target", "Notice", ""], policy.maintenance.map((rule, i) => [escape(rule.target), escape(rule.message), `<button data-remove-maintenance="${i}">Resume</button>`])) : empty("No commands are paused.")}</section><section><h3>Experimental rollouts</h3><form data-console-form="rollouts"><label>Command or group<select name="target">${policy.targets.filter(target => target !== "all").map(target => `<option>${escape(target)}</option>`).join("")}</select></label><fieldset><legend>Test servers</legend>${servers.map(server => `<label class="console-check"><input type="checkbox" name="guilds" value="${server.id}">${escape(server.name)}</label>`).join("")}</fieldset><button type="submit">Limit to selected servers</button></form>${policy.rollouts.length ? table(["Target", "Test servers", ""], policy.rollouts.map((rule, i) => [escape(rule.target), rule.guilds.map(id => escape(servers.find(server => server.id === id)?.name ?? id)).join(", "), `<button data-remove-rollouts="${i}">Release to everyone</button>`])) : empty("No restricted rollouts.")}</section></div>`;
            }
            if (tab === "history") {
                const data = await api("history" + serverQuery());
                html = `<h2>Configuration history</h2><p>The last 50 settings revisions are retained per server. Restore supports aliases, disabled commands, DM settings, log destinations and automatic embed settings. External Discord role, channel and AutoMod changes must be reconfigured through their setup commands.</p>${data.entries.map(entry => `<details class="console-revision"><summary><strong>${escape(entry.source)}</strong><span>${date(entry.at)} · ${escape(entry.actor)}</span></summary>${table(["Setting", "Before", "After"], entry.changes.map(change => [escape(change.key), `<pre>${escape(JSON.stringify(change.before, null, 2))}</pre>`, `<pre>${escape(JSON.stringify(change.after, null, 2))}</pre>`]))}${entry.changes.some(change => change.restorable) ? `<button data-restore="${entry.id}" data-keys="${escape(JSON.stringify(entry.changes.filter(change => change.restorable).map(change => change.key)))}">Restore these supported settings…</button>` : empty("This revision requires its setup command to make further changes.")}</details>`).join("") || empty("No settings changes have been recorded yet.")}`;
            }
            if (tab === "resources") {
                const data = await api("resources"), commands = data.days.reduce((sum, day) => sum + day.commands, 0), ms = data.days.reduce((sum, day) => sum + day.processing_ms, 0), bytes = data.days.reduce((sum, day) => sum + day.video_bytes, 0);
                html = `<h2>Measured resources</h2><p>Last 30 recorded days. Collection began ${escape(data.measuredSince ?? "when this version starts receiving commands")}. Video bytes measure transfers received from the media companion, including retries; they do not claim successful Discord delivery.</p><div class="console-metrics">${[["Commands", commands], ["Average processing", commands ? Math.round(ms / commands) + " ms" : "No samples"], ["Video received", (bytes / 1048576).toFixed(1) + " MiB"], ["Configuration + history", ((data.storedConfigurationBytes + data.historyBytes) / 1024).toFixed(1) + " KiB"], ["Bot database", data.databaseBytes === null ? "Unavailable" : (data.databaseBytes / 1048576).toFixed(2) + " MiB"], ["Pending jobs", data.pendingJobs], ["Music servers / requests", `${data.activeMusicServers} / ${data.queuedRequests}`]].map(([label, value]) => `<article><span>${label}</span><strong>${value}</strong></article>`).join("")}</div><p>${escape(data.hostQuotas)}</p>${data.alerts.length ? `<div class="console-notice">${data.alerts.map(alert => `${escape(alert.key)}: ${alert.current} exceeds your ${alert.limit} threshold.`).join("<br>")}</div>` : ""}<details class="console-revision"><summary>Resource alert thresholds</summary><p>Dashboard warnings for measured counters. Zero disables a threshold. These do not change provider limits or stop commands.</p><form data-console-form="budgets"><div class="console-columns">${[["dailyCommands", "Daily commands (UTC)"], ["dailyVideoMiB", "Daily binary video received (MiB, UTC)"], ["storageMiB", "Bot database size (MiB)"], ["averageMs", "Today’s average processing time (ms)"]].map(([key, label]) => field(key, label, data.budgets[key] ?? 0, 'type="number" min="0" max="1000000000" step="any"')).join("")}</div><button type="submit">Save thresholds</button></form></details>${data.days.length ? table(["Date", "Commands", "Processing", "Videos", "Received"], data.days.map(day => [escape(day.day), day.commands, day.processing_ms + " ms", day.videos, (day.video_bytes / 1048576).toFixed(1) + " MiB"])) : empty("No resource samples recorded yet.")}`;
            }
            if (tab === "sessions") {
                const data = await api("sessions");
                html = `<h2>Dashboard sessions</h2><p>Revoking a session signs that browser out on its next request.</p><div class="console-session-tools"><label>Find a session<input type="search" data-session-filter placeholder="Account, Discord ID or device"></label><span class="console-session-count" role="status">${data.sessions.length} shown</span></div>
                    <div class="console-sessions">${data.sessions.map(session => {
                        const device = browserLabel(session.agent);
                        return `<article class="console-session" data-session-search="${escape([session.username, session.user_id, session.kind, device].join(" ").toLowerCase())}"><div class="console-session-title"><div><strong>${escape(session.username)}</strong><small>${escape(session.user_id)}</small></div><button type="button" data-revoke="${escape(session.id)}">Revoke…</button></div><dl><div><dt>Device</dt><dd>${device}</dd></div><div><dt>Session type</dt><dd>${escape(session.kind)}</dd></div><div><dt>Last active</dt><dd>${date(session.last_seen)}</dd></div><div><dt>Expires</dt><dd>${date(session.expires)}</dd></div></dl><small>Created ${date(session.created)}</small>${session.agent ? `<details><summary>Browser details</summary><small>${escape(session.agent)}</small></details>` : ""}</article>`;
                    }).join("")}</div><p class="console-session-empty" ${data.sessions.length ? "hidden" : ""}>No matching sessions.</p><details class="console-revision"><summary>Revoke all sessions for an account</summary><form data-console-form="revoke-all" class="console-inline">${field("userId", "Discord user ID", "", 'required pattern="[0-9]{17,20}" placeholder="Discord user ID"')}<button type="submit">Revoke all…</button></form></details>`;
            }
            if (tab === "lookup") html = `<h2>Account lookup</h2><p>Search plugin activation, access restrictions, Sonata staff access and current dashboard access in the bot's servers.</p><form data-console-form="lookup" class="console-inline">${field("id", "Discord user ID", lookupId, 'required pattern="[0-9]{17,20}"')}<button type="submit">Look up</button></form><div id="lookup-results"></div>`;
            if (tab === "notes") {
                const data = await api("notes" + serverQuery());
                html = `<h2>Private server notes</h2><p>Visible only in this Sonata owner view.</p><form data-console-form="notes"><label>Note<textarea name="note" maxlength="4000" rows="6">${escape(data.note)}</textarea></label>${field("labels", "Labels, separated by commas", data.labels.join(", "), 'placeholder="testing, needs support"')}<button type="submit">Save note</button></form>${data.at ? `<p>Updated ${date(data.at)} by ${escape(data.actor)}.</p>` : ""}`;
            }
            if (current === version) body.innerHTML = html;
        } catch (error) { if (current === version) { body.innerHTML = empty("This tool could not load."); showNotice(error.message); } }
    }
    root.addEventListener("input", event => {
        if (!event.target.matches("[data-session-filter]")) return;
        const query = event.target.value.trim().toLowerCase();
        let count = 0;
        for (const session of body.querySelectorAll("[data-session-search]")) {
            session.hidden = !session.dataset.sessionSearch.includes(query);
            if (!session.hidden) count++;
        }
        body.querySelector(".console-session-count").textContent = count + " shown";
        body.querySelector(".console-session-empty").hidden = count > 0;
    });
    async function lookup() {
        const data = await api(`lookup?id=${encodeURIComponent(lookupId)}&page=${lookupPage}`), result = root.querySelector("#lookup-results");
        if (!result) return;
        result.innerHTML = `<h3>${escape(data.activation?.name || data.activation?.username || data.id)}</h3><div class="console-metrics">${[["Activation", data.activation ? data.activation.blocked ? "Blocked" : "Allowed" : "Not activated"], ["Active devices", data.devices], ["Sonata access", data.admin?.owner ? "Owner" : data.admin ? data.admin.permissions.join(", ") : "No staff access"], ["Last check-in", date(data.activation?.last_seen)]].map(([label, value]) => `<article><span>${label}</span><strong>${escape(value)}</strong></article>`).join("")}</div>${data.activation?.reason ? `<p>Restriction note: ${escape(data.activation.reason)}</p>` : ""}${table(["Server", "Dashboard access", "Reason"], data.access.map(entry => [escape(entry.name), entry.allowed ? "Allowed" : "Denied", entry.serverOwner ? "Server owner" : entry.explicitlyAllowed ? "Explicit allowlist" : entry.administratorsAllowed ? "Current permissions checked" : "Administrator access disabled"]))}<div class="console-inline"><button data-lookup-page="-1" ${lookupPage ? "" : "disabled"}>← Previous</button><span>Server scan page ${lookupPage + 1}</span><button data-lookup-page="1" ${data.more ? "" : "disabled"}>Next →</button></div>`;
    }
    root.addEventListener("click", async event => {
        const button = event.target.closest("button"); if (!button) return;
        if (button.dataset.consoleTab) { picker.open = false; tab = button.dataset.consoleTab; await render(true); return; }
        if (button.dataset.serverId) {
            if (!servers.some(server => server.id === button.dataset.serverId)) return;
            const changed = guild !== button.dataset.serverId;
            guild = button.dataset.serverId; picker.open = false; summary.focus(); updateServerPicker();
            if (changed) await render();
            return;
        }
        if (button.id === "console-refresh") { picker.open = false; await render(true); return; }
        if (button.dataset.lookupPage) { lookupPage += Number(button.dataset.lookupPage); try { await lookup(); } catch (error) { showNotice(error.message); } return; }
        try {
            button.disabled = true;
            if (button.dataset.removeMaintenance !== undefined || button.dataset.removeRollouts !== undefined) {
                const key = button.dataset.removeMaintenance !== undefined ? "maintenance" : "rollouts", index = Number(key === "maintenance" ? button.dataset.removeMaintenance : button.dataset.removeRollouts);
                const changed = { maintenance: policy.maintenance, rollouts: policy.rollouts, [key]: policy[key].filter((_, i) => i !== index) }; await api("operations", changed); await render(); showNotice("Command availability updated.");
            }
            if (button.dataset.restore && confirm("Restore the displayed supported settings to their Before values? The server ID is " + guild + ".")) { await api("history", { guild, id: button.dataset.restore, keys: JSON.parse(button.dataset.keys) }); await render(); showNotice("Settings restored as a new revision."); }
            if (button.dataset.revoke && confirm("Sign out this dashboard session?")) { await api("sessions", { id: button.dataset.revoke }); await render(); showNotice("Session revoked."); }
        } catch (error) { showNotice(error.message); } finally { button.disabled = false; }
    });
    root.addEventListener("submit", async event => {
        const form = event.target.closest("[data-console-form]"); if (!form) return; event.preventDefault();
        const data = new FormData(form), action = form.dataset.consoleForm, button = form.querySelector('button[type="submit"]'); button.disabled = true;
        try {
            if (action === "message") { const sent = await api("messages", { guild, channel: data.get("channel"), content: data.get("content") }); await render(); const receipt = root.querySelector(".message-receipt"); if (receipt) { const link = document.createElement("a"); link.href = sent.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Message sent. Open in Discord ↗"; receipt.append(link); } }
            if (["maintenance", "rollouts"].includes(action)) {
                const rule = action === "maintenance" ? { target: data.get("target"), message: data.get("message") } : { target: data.get("target"), guilds: data.getAll("guilds") };
                if (action === "rollouts" && !rule.guilds.length) throw Error("Select at least one test server.");
                await api("operations", { maintenance: policy.maintenance, rollouts: policy.rollouts, [action]: [...policy[action].filter(old => old.target !== rule.target), rule] }); await render(); showNotice("Command availability saved.");
            }
            if (action === "budgets") { await api("resources", { budgets: Object.fromEntries(["dailyCommands", "dailyVideoMiB", "storageMiB", "averageMs"].map(key => [key, Number(data.get(key))])) }); await render(); showNotice("Resource thresholds saved."); }
            if (action === "notes") { await api("notes", { guild, note: data.get("note"), labels: data.get("labels").split(",").map(text => text.trim()).filter(Boolean) }); await render(); showNotice("Private note saved."); }
            if (action === "lookup") { lookupId = data.get("id"); lookupPage = 0; await lookup(); }
            if (action === "revoke-all" && confirm(`Sign out every dashboard session for ${data.get("userId")}?`)) { await api("sessions", { userId: data.get("userId") }); await render(); showNotice("All sessions for this account revoked."); }
        } catch (error) { showNotice(error.message); } finally { button.disabled = false; }
    });
    picker.addEventListener("toggle", () => { if (picker.open) { search.value = ""; updateServerPicker(); search.focus(); } });
    picker.addEventListener("focusout", event => { if (!picker.contains(event.relatedTarget)) picker.open = false; });
    picker.addEventListener("keydown", event => {
        if (event.key === "Escape" && picker.open) { event.preventDefault(); picker.open = false; summary.focus(); }
        if (event.target === search && ["ArrowDown", "Enter"].includes(event.key)) {
            event.preventDefault();
            const first = matches.querySelector("button");
            if (event.key === "ArrowDown") first?.focus(); else first?.click();
        }
    });
    search.addEventListener("input", updateServerPicker);
    await render();
}

document.addEventListener("sonata-admin", async event => {
    if (!event.detail.owner) return;
    const session = event.detail, nav = document.querySelector(".bot-owner-nav"), body = document.querySelector(".admin-body");
    const button = document.createElement("button"), panel = document.createElement("section"); button.type = "button"; button.textContent = "Owner overview"; button.className = "quiet"; panel.className = "extra-admin-panel"; panel.hidden = true; nav.prepend(button); body.prepend(panel);
    const api = async (path, input) => { const response = await fetch(path === "servers" ? "/api/admin/bot" : "/api/admin/console/" + path, { method: input ? "POST" : "GET", credentials: "same-origin", headers: input ? { "Content-Type": "application/json", "X-CSRF-Token": session.csrf } : {}, body: input ? JSON.stringify(input) : undefined }); const value = await response.json(); if (!response.ok) throw Error(value.error); return value; };
    button.addEventListener("click", () => { for (const item of body.children) item.hidden = item !== panel; for (const item of nav.querySelectorAll("button")) item.setAttribute("aria-selected", String(item === button)); if (!panel.children.length) void mountOwnerConsole(panel, api); });
    button.click();
});
