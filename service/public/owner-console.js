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

export async function mountOwnerConsole(root, api) {
    let tab = "health", guild = "", servers = [], policy, version = 0, lookupPage = 0, lookupId = "";
    root.classList.add("owner-console");
    const tabs = [["health", "Server checks"], ["messages", "Send message"], ["operations", "Rollouts & maintenance"], ["history", "Configuration history"], ["resources", "Resources"], ["sessions", "Sessions"], ["lookup", "Account lookup"], ["notes", "Server notes"]];
    root.innerHTML = `<nav class="console-tabs" aria-label="Owner tools">${tabs.map(([id, label]) => `<button data-console-tab="${id}" aria-selected="${id === tab}">${label}</button>`).join("")}</nav><div class="console-toolbar"><label>Server<select id="console-server"></select></label><button id="console-refresh">Refresh</button></div><p class="console-notice" role="status" hidden></p><div class="console-body"></div>`;
    const body = root.querySelector(".console-body"), notice = root.querySelector(".console-notice"), select = root.querySelector("#console-server");
    const showNotice = text => { notice.textContent = text; notice.hidden = false; };
    try { servers = (await api("servers")).servers; guild = servers[0]?.id ?? ""; select.innerHTML = servers.map(server => `<option value="${server.id}">${escape(server.name)} · ${server.id}</option>`).join(""); } catch (error) { showNotice(error.message); }
    const serverQuery = () => `?guild=${encodeURIComponent(guild)}`;
    async function render() {
        const current = ++version; notice.hidden = true; body.innerHTML = empty("Loading…");
        root.querySelector(".console-toolbar label").hidden = !["health", "history", "notes", "messages"].includes(tab);
        for (const button of root.querySelectorAll("[data-console-tab]")) button.setAttribute("aria-selected", String(button.dataset.consoleTab === tab));
        try {
            let html;
            if (["health", "history", "notes", "messages"].includes(tab) && !guild) { body.innerHTML = empty("No installed servers are available."); return; }
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
                html = `<h2>Dashboard sessions</h2><p>Revoking a session signs that browser out on its next request. This does not revoke Discord itself or plugin activation.</p><form data-console-form="revoke-all" class="console-inline">${field("userId", "Revoke all sessions for an account", "", 'required pattern="[0-9]{17,20}" placeholder="Discord user ID"')}<button type="submit">Revoke all…</button></form>${data.sessions.length ? table(["Account", "Kind / browser", "Created / active", "Expires", ""], data.sessions.map(session => [`${escape(session.username)}<small>${session.user_id}</small>`, `${escape(session.kind)}<small>${escape(session.agent || "Browser details not recorded")}</small>`, `${date(session.created)}<small>${date(session.last_seen)}</small>`, date(session.expires), `<button data-revoke="${session.id}">Revoke…</button>`])) : empty("No active dashboard sessions.")}`;
            }
            if (tab === "lookup") html = `<h2>Account lookup</h2><p>Search plugin activation, access restrictions, Sonata staff access and current dashboard access in the bot's servers.</p><form data-console-form="lookup" class="console-inline">${field("id", "Discord user ID", lookupId, 'required pattern="[0-9]{17,20}"')}<button type="submit">Look up</button></form><div id="lookup-results"></div>`;
            if (tab === "notes") {
                const data = await api("notes" + serverQuery());
                html = `<h2>Private server notes</h2><p>Visible only in this Sonata owner view.</p><form data-console-form="notes"><label>Note<textarea name="note" maxlength="4000" rows="6">${escape(data.note)}</textarea></label>${field("labels", "Labels, separated by commas", data.labels.join(", "), 'placeholder="testing, needs support"')}<button type="submit">Save note</button></form>${data.at ? `<p>Updated ${date(data.at)} by ${escape(data.actor)}.</p>` : ""}`;
            }
            if (current === version) body.innerHTML = html;
        } catch (error) { if (current === version) { body.innerHTML = empty("This tool could not load."); showNotice(error.message); } }
    }
    async function lookup() {
        const data = await api(`lookup?id=${encodeURIComponent(lookupId)}&page=${lookupPage}`), result = root.querySelector("#lookup-results");
        if (!result) return;
        result.innerHTML = `<h3>${escape(data.activation?.name || data.activation?.username || data.id)}</h3><div class="console-metrics">${[["Activation", data.activation ? data.activation.blocked ? "Blocked" : "Allowed" : "Not activated"], ["Active devices", data.devices], ["Sonata access", data.admin?.owner ? "Owner" : data.admin ? data.admin.permissions.join(", ") : "No staff access"], ["Last check-in", date(data.activation?.last_seen)]].map(([label, value]) => `<article><span>${label}</span><strong>${escape(value)}</strong></article>`).join("")}</div>${data.activation?.reason ? `<p>Restriction note: ${escape(data.activation.reason)}</p>` : ""}${table(["Server", "Dashboard access", "Reason"], data.access.map(entry => [escape(entry.name), entry.allowed ? "Allowed" : "Denied", entry.serverOwner ? "Server owner" : entry.explicitlyAllowed ? "Explicit allowlist" : entry.administratorsAllowed ? "Current permissions checked" : "Administrator access disabled"]))}<div class="console-inline"><button data-lookup-page="-1" ${lookupPage ? "" : "disabled"}>← Previous</button><span>Server scan page ${lookupPage + 1}</span><button data-lookup-page="1" ${data.more ? "" : "disabled"}>Next →</button></div>`;
    }
    root.addEventListener("click", async event => {
        const button = event.target.closest("button"); if (!button) return;
        if (button.dataset.consoleTab) { tab = button.dataset.consoleTab; await render(); return; }
        if (button.id === "console-refresh") { await render(); return; }
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
    select.addEventListener("change", () => { guild = select.value; void render(); });
    await render();
}

document.addEventListener("sonata-admin", async event => {
    if (!event.detail.owner) return;
    const session = event.detail, nav = document.querySelector(".bot-owner-nav"), body = document.querySelector(".admin-body");
    const button = document.createElement("button"), panel = document.createElement("section"); button.textContent = "Owner tools"; button.className = "quiet"; panel.className = "extra-admin-panel"; panel.hidden = true; nav.append(button); body.append(panel);
    const api = async (path, input) => { const response = await fetch(path === "servers" ? "/api/admin/bot" : "/api/admin/console/" + path, { method: input ? "POST" : "GET", credentials: "same-origin", headers: input ? { "Content-Type": "application/json", "X-CSRF-Token": session.csrf } : {}, body: input ? JSON.stringify(input) : undefined }); const value = await response.json(); if (!response.ok) throw Error(value.error); return value; };
    button.addEventListener("click", () => { for (const item of body.children) item.hidden = item !== panel; for (const item of nav.querySelectorAll("button")) item.setAttribute("aria-selected", String(item === button)); if (!panel.children.length) void mountOwnerConsole(panel, api); });
});
