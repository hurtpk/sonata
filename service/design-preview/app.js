/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { mountOwnerConsole } from "/owner-console.js";
import { mountCommandSetup } from "/command-setup.js";
import { mountGuides, mountStatus } from "/site-info.js";

const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const state = { forms: [], server: null, csrf: "", setupCommand: "alias set", catalog: [], featureGroups: [], featureFlags: {}, featureAdmins: true, previewRole: "owner", category: "All", search: "", page: 0, mode: "prefix", section: "overview", prefix: ",", automod: true, protection: true, videos: false, logs: true };
let toastTimer;
const copyTimers = new WeakMap();
const pageOrder = ["home", "dashboard", "commands", "status", "guides", "owner"];
let activeView, pageTransition, routeRevision = 0;
function notify(message) { clearTimeout(toastTimer); $("#toast").textContent = message; $("#toast").hidden = false; toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 3500); }
function route() {
    const hash = location.hash.slice(1);
    const view = hash.startsWith("guide-") ? "guides" : ["commands", "dashboard", "guides", "status", "owner"].includes(hash) ? hash : "home";
    const changed = activeView && activeView !== view, direction = pageOrder.indexOf(view) > pageOrder.indexOf(activeView) ? 1 : -1, revision = ++routeRevision;
    activeView = view; pageTransition?.skipTransition();
    const commit = () => {
        if (revision !== routeRevision) return;
        all(".view").forEach(element => { element.hidden = element.id !== `view-${view}`; });
        all("[data-view]").forEach(link => { if (link.dataset.view === view) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
        if (view === "commands") renderCommands();
        if (view === "dashboard") renderWorkspace();
        if (view === "guides") mountGuides($("#view-guides"));
        if (view === "status") void mountStatus($("#view-status"), () => previewApi("/api/status"));
        if (view === "owner") void mountOwnerConsole($("#owner-console"), (path, input) => previewApi(path === "servers" ? "/api/admin/bot" : "/api/admin/console/" + path, input));
        if (hash.startsWith("guide-")) document.getElementById(hash)?.scrollIntoView(); else window.scrollTo(0, 0);
    };
    const animate = changed && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.documentElement.dataset.pageDirection = direction > 0 ? "forward" : "backward";
    if (animate && document.startViewTransition) {
        pageTransition = document.startViewTransition(commit);
        pageTransition.ready.catch(() => false); pageTransition.finished.catch(() => false);
    } else {
        for (const element of all(".view")) for (const animation of element.getAnimations()) animation.cancel();
        commit();
        if (animate) $(`#view-${view}`).animate([{ transform: `translateX(${direction * 40}px)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], { duration: 240, easing: "cubic-bezier(.2,.7,.2,1)" });
    }
}
function example(command) {
    const slash = state.mode === "slash";
    const options = command.exampleOptions.map(option => {
        let value = String(option.value);
        if (option.type === 6) value = `<@${value}>`;
        if (option.type === 7) value = `<#${value}>`;
        if (option.type === 8) value = `<@&${value}>`;
        if (!slash && /\s/.test(value)) value = `"${value}"`;
        return (slash ? `${option.name}:` : "") + value;
    });
    if (!slash && command.name === "settings videoembeds") return `${state.prefix}settings videoembeds on all`;
    return (slash ? "/" + (command.slashName ?? command.name) : state.prefix + command.name) + (options.length ? " " + options.join(" ") : "");
}
function commandCard(command) {
    const prefix = state.mode === "slash" ? "/" : state.prefix;
    const displayedName = state.mode === "slash" ? command.slashName ?? command.name : command.name;
    const syntax = prefix + displayedName + " " + command.options.map(option => option.type === 11 ? `[upload ${option.name}${option.required ? ": required" : ""}]` : option.required ? `<${option.name}>` : `[${option.name}]`).join(" ");
    const parameters = command.parameters.length ? `<dl class="command-parameters">${command.parameters.map(option => `<div><dt><code>${escape(option.name)}</code><span>${option.required ? "Required" : "Optional"}</span></dt><dd>${escape(option.description)}${option.acceptedCommands ? `<details class="setup-targets"><summary>Supported commands and arguments</summary>${option.acceptedCommands.map(target => `<p><code>${escape(target.command)} ${escape(target.syntax)}</code><br>${escape(target.description)}</p>`).join("")}</details>` : ""}</dd></div>`).join("")}</dl>` : '<p class="no-arguments">This command takes no arguments.</p>';
    const bodyId = "command-" + command.name.replace(/\s+/g, "-");
    return `<article class="command-card" data-command="${escape(command.name)}"><header><h2>${escape(prefix + displayedName)}</h2><div class="command-actions"><button class="command-expand" data-expand="${escape(bodyId)}" aria-controls="${escape(bodyId)}" aria-expanded="false" aria-label="Show details for ${escape(command.name)}"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>${state.forms.some(form => form.name === command.name.split(" ")[0] && form.options.some(action => action.name === (command.name.split(" ")[1] ?? "run"))) ? `<button data-setup="${escape(command.name)}">Configure ↗</button>` : ""}<button data-copy="${escape(example(command))}" aria-label="Copy ${escape(command.name)} example">Copy ↗</button></div></header><div class="command-body" id="${escape(bodyId)}" hidden><div class="command-body-inner"><p class="command-description">${escape(command.description)}</p>${command.detail ? `<p class="command-detail">${escape(command.detail)}</p>` : ""}<div class="command-permissions"><span>PERMISSIONS</span>${escape(command.permissions)}</div><div class="syntax">${escape(syntax.trim())}</div><code class="example"><span>EXAMPLE</span>${escape(example(command))}</code>${command.attachment ? `<p class="attachment-instruction">Attach a real file in the <strong>${escape(command.attachment)}</strong> field or upload it on the same prefix-command message. The copied command does not attach a file.</p>` : ""}<section class="command-arguments" aria-label="Arguments for ${escape(command.name)}"><h3>Arguments</h3>${parameters}</section>${command.aliases.length ? `<p class="alias-note">Built-in prefix aliases for this command family: ${command.aliases.map(alias => `<code>${escape(state.prefix + alias)}</code>`).join(", ")}. Some aliases select a specific subcommand; check the behavior above.</p>` : ""}</div></div></article>`;
}
function renderCommands() {
    const categories = new Map([["All", state.catalog.length]]);
    for (const { category } of state.catalog) categories.set(category, (categories.get(category) ?? 0) + 1);
    $("#categories").innerHTML = [...categories].map(([category, count]) => `<button data-category="${escape(category)}" aria-pressed="${state.category === category}">${escape(category)} <span class="category-count">${count}</span></button>`).join("");
    const list = state.catalog.filter(command => (state.category === "All" || command.category === state.category) && `${command.name} ${command.description} ${command.detail} ${command.permissions} ${command.parameters.map(option => option.description).join(" ")} ${command.aliases.join(" ")}`.toLowerCase().includes(state.search)).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base", numeric: true }));
    const pages = Math.max(1, Math.ceil(list.length / 10));
    state.page = Math.min(state.page, pages - 1);
    $("#command-total").textContent = `${state.catalog.length} command forms`;
    $("#command-list").innerHTML = list.slice(state.page * 10, state.page * 10 + 10).map(commandCard).join("") || '<p class="empty">No commands found. Try another search or category.</p>';
    $("#catalog-position").textContent = `${list.length ? state.page * 10 + 1 : 0}–${Math.min(list.length, state.page * 10 + 10)} of ${list.length} commands`;
    $("#previous").disabled = state.page === 0;
    $("#next").disabled = state.page >= pages - 1;
    all("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode)));
}
const cases = [["1042", "Mira", "Warning", "Jules", "Repeated spam", "12 min ago"], ["1041", "Rowan", "Timeout", "Avery", "Chat disruption", "38 min ago"], ["1040", "Finley", "Ban", "Jules", "Malicious links", "2 hours ago"], ["1039", "Casey", "Warning", "Avery", "Off-topic messages", "3 hours ago"]];
const caseTable = full => `<div class="table-wrap"><table><thead><tr><th>CASE</th><th>MEMBER</th><th>ACTION</th>${full ? "<th>MODERATOR</th><th>REASON</th>" : ""}<th>WHEN</th></tr></thead><tbody>${cases.map(row => `<tr><td>#${row[0]}</td><td>${row[1]}</td><td><span class="action-badge">${row[2]}</span></td>${full ? `<td>${row[3]}</td><td>${row[4]}</td>` : ""}<td class="muted">${row[5]}</td></tr>`).join("")}</tbody></table></div>`;
const toggleRow = (key, title, detail) => `<div class="setting-row"><div>${title}<p>${detail}</p></div><button class="toggle" role="switch" aria-label="${title}" aria-checked="${state[key]}" data-toggle="${key}"></button></div>`;
const statStrip = `<div class="stat-strip"><div><span>Members</span><strong>1,248</strong><small>+32 this month</small></div><div><span>Cases · 30 days</span><strong>24</strong><small>4 this week</small></div><div><span>Commands · 30 days</span><strong>862</strong><small>+18% this month</small></div></div>`;
function renderWorkspace() {
    const labels = { commands: ["Command setup", "Configure commands or run moderation actions with the same permission checks as Discord."], features: ["Features", "Enable or pause Sonata’s feature groups."], overview: ["Overview", "A quick look at your server."], settings: ["Server settings", "Adjust how Sonata works in your server."], cases: ["Cases & evidence", "Moderation history, reasons, and attachments."], activity: ["Activity", "Sonata actions and command usage over the last 30 days."] };
    const [title, description] = labels[state.section];
    $("#workspace-title").innerHTML = `${title}<span>.</span>`;
    $("#workspace-description").textContent = description;
    all(".workspace-rail [data-section]").forEach(button => { if (button.dataset.section === state.section) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current"); });
    let body;
    if (state.section === "overview") body = statStrip + `<div class="panel-grid"><article class="panel"><div class="panel-heading"><h2>Recent cases</h2><button data-section="cases">View all →</button></div>${caseTable(false)}</article><article class="panel"><div class="panel-heading"><h2>Server protection</h2><button data-section="settings">Configure →</button></div>${[["AutoMod", state.automod], ["Join protection", state.protection], ["Event logging", state.logs], ["Automatic video embeds", state.videos]].map(([label, enabled]) => `<div class="setting-row"><span>${label}</span><span class="${enabled ? "state" : "muted"}">${enabled ? "Enabled" : "Off"}</span></div>`).join("")}</article></div>`;
    if (state.section === "settings") body = `<div class="settings-stack"><article class="panel"><div class="panel-heading"><h2>General</h2></div><label class="setting-row"><span>Command prefix<p>Used alongside slash commands.</p></span><input id="prefix-input" maxlength="5" value="${escape(state.prefix)}" aria-label="Command prefix"></label>${toggleRow("videos", "Automatic video embeds", "Upload supported standalone video links.")}${toggleRow("logs", "Event logging", "Record member, channel, and voice events.")}</article><article class="panel"><div class="panel-heading"><h2>Protection</h2></div>${toggleRow("automod", "AutoMod", "Filter unwanted words, spam, and mentions.")}${toggleRow("protection", "Join protection", "Apply your configured rules to new members.")}</article><div class="save-row"><span>Sample server. These settings do not affect Discord.</span><button class="primary" id="save-settings">Save preview <span>↗</span></button></div></div>`;
    if (state.section === "features") {
        const canManage = state.previewRole === "owner" || state.previewRole === "admin" && state.featureAdmins;
        body = '<article class="panel feature-preview"><div class="panel-heading"><h2>Feature groups</h2><span class="sample-badge">SAMPLE</span></div><div class="feature-preview-role"><span>Preview role</span><div class="command-mode">' + [["owner", "Owner"], ["admin", "Administrator"], ["manager", "Manager"]].map(([id, label]) => '<button data-preview-role="' + id + '" aria-pressed="' + (state.previewRole === id) + '">' + label + '</button>').join("") + '</div></div>' + (state.previewRole === "owner" ? '<div class="setting-row"><div>Allow administrators to manage features<p>The server owner always keeps control.</p></div><button class="toggle" role="switch" aria-label="Allow administrators to manage features" aria-checked="' + state.featureAdmins + '" data-feature-admins="true"></button></div>' : '') + (!canManage ? '<p class="feature-preview-note">Only the owner and permitted administrators can change feature groups.</p>' : '') + state.featureGroups.map(group => '<div class="setting-row"><div>' + escape(group.name) + '<p>' + escape(group.description) + '</p></div><button class="toggle" role="switch" aria-label="' + escape(group.name) + '" aria-checked="' + (state.featureFlags[group.id] !== false) + '" data-feature="' + group.id + '"' + (canManage ? '' : ' disabled') + '></button></div>').join('') + '<p class="feature-preview-note">Preview changes stay here. Saved settings and history are kept; timed punishments still expire.</p></article>';
    }
    if (state.section === "cases") body = `<article class="panel"><div class="panel-heading"><h2>Moderation cases</h2><span class="sample-badge">4 SAMPLE RECORDS</span></div>${caseTable(true)}<p class="case-note">Each case can keep its reason, moderator, and image or video evidence. These four records are illustrative.</p></article>`;
    if (state.section === "activity") body = statStrip + `<div class="panel-grid"><article class="panel activity-chart"><div class="panel-heading"><h2>Commands this week</h2><span class="sample-badge">SAMPLE</span></div><div class="activity-bars">${[37, 58, 43, 82, 60, 95, 71].map((value, i) => `<div class="activity-bar" style="height:${value}%" title="${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i]}: ${value} sample commands"><span>${["M", "T", "W", "T", "F", "S", "S"][i]}</span></div>`).join("")}</div></article><article class="panel"><div class="panel-heading"><h2>Most used</h2></div>${[["play", "246"], ["sonata", "182"], ["userinfo", "94"], ["warn", "24"]].map(([name, count]) => `<div class="setting-row"><code>${escape(state.prefix + name)}</code><span class="muted">${count} uses</span></div>`).join("")}</article></div>`;
    $("#workspace-body").innerHTML = state.section === "commands" ? `<div class="panel setup-panel"><p class="preview-setup-note">Local sample server. Sample member ID: <code>${state.target}</code>. Actions affect only this preview.</p><div id="command-setup"></div></div>` : body;
    if (state.section === "commands") mountCommandSetup($("#command-setup"), state.forms, state.server, async input => { const result = await previewApi("/api/bot/action", input); state.server = await previewApi("/api/bot/server?guild=" + state.server.guild.id); state.prefix = state.server.settings.prefix; return result; }, state.setupCommand, state.catalog);
}
document.addEventListener("click", async event => {
    const button = event.target.closest("button, a") ?? event.target.closest(".command-card header")?.querySelector("[data-expand]");
    if (!button) return;
    if (button.dataset.section) { state.section = button.dataset.section; if (location.hash === "#dashboard") renderWorkspace(); else location.hash = "dashboard"; }
    if (button.dataset.setup) { state.setupCommand = button.dataset.setup; state.section = "commands"; location.hash = "dashboard"; }
    if (button.dataset.category) { state.category = button.dataset.category; state.page = 0; renderCommands(); }
    if (button.dataset.mode) { state.mode = button.dataset.mode; renderCommands(); }
    if (button.dataset.expand) {
        const body = document.getElementById(button.dataset.expand);
        const opening = button.getAttribute("aria-expanded") !== "true", start = body.getBoundingClientRect().height;
        for (const animation of body.getAnimations()) animation.cancel();
        button.setAttribute("aria-expanded", String(opening));
        button.setAttribute("aria-label", `${opening ? "Hide" : "Show"} details for ${button.closest(".command-card").dataset.command}`);
        body.hidden = false; body.inert = !opening; body.setAttribute("aria-hidden", String(!opening));
        if (matchMedia("(prefers-reduced-motion: reduce)").matches) body.hidden = !opening;
        else {
            const animation = body.animate([{ height: `${start}px`, opacity: opening ? .55 : 1 }, { height: `${opening ? body.scrollHeight : 0}px`, opacity: opening ? 1 : 0 }], { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)" });
            animation.finished.then(() => { if (button.getAttribute("aria-expanded") === String(opening)) body.hidden = !opening; }).catch(() => false);
        }
    }
    if (button.dataset.copy) {
        button.dataset.copyLabel ??= button.textContent; button.dataset.copyAria ??= button.getAttribute("aria-label");
        try {
            await navigator.clipboard.writeText(button.dataset.copy); clearTimeout(copyTimers.get(button));
            button.textContent = "Copied ✓"; button.classList.add("is-copied"); button.setAttribute("aria-label", "Example copied");
            copyTimers.set(button, setTimeout(() => { button.textContent = button.dataset.copyLabel; button.classList.remove("is-copied"); button.setAttribute("aria-label", button.dataset.copyAria); }, 1800));
            notify("Example copied.");
        } catch { clearTimeout(copyTimers.get(button)); button.textContent = button.dataset.copyLabel; button.classList.remove("is-copied"); button.setAttribute("aria-label", button.dataset.copyAria); notify("Copy unavailable. Select the example text to copy it."); }
    }
    if (button.dataset.action === "invite") notify("Preview only. The final button will open Sonata’s Discord invite.");
    if (button.dataset.previewRole) { state.previewRole = button.dataset.previewRole; renderWorkspace(); }
    if (button.dataset.featureAdmins && state.previewRole === "owner") { state.featureAdmins = !state.featureAdmins; renderWorkspace(); }
    if (button.dataset.feature && (state.previewRole === "owner" || state.previewRole === "admin" && state.featureAdmins)) { state.featureFlags[button.dataset.feature] = state.featureFlags[button.dataset.feature] === false; renderWorkspace(); }
    if (button.dataset.toggle) { state[button.dataset.toggle] = !state[button.dataset.toggle]; button.setAttribute("aria-checked", String(state[button.dataset.toggle])); }
    if (button.dataset.accent) { document.body.classList.toggle("blue-accent", button.dataset.accent === "blue"); all("[data-accent]").forEach(option => { const selected = option === button; option.classList.toggle("selected", selected); option.setAttribute("aria-pressed", String(selected)); }); }
    if (button.id === "previous") { state.page--; renderCommands(); $("#command-list").scrollIntoView({ block: "start" }); }
    if (button.id === "next") { state.page++; renderCommands(); $("#command-list").scrollIntoView({ block: "start" }); }
    if (button.id === "save-settings") { const prefix = $("#prefix-input").value.trim(); if (!prefix || /\s/.test(prefix)) { notify("Use a prefix of 1–5 characters without spaces."); return; } state.prefix = prefix; notify("Saved in this preview session. No server settings changed."); }
    if (button.classList.contains("server-choice")) notify("Harbor Studio is the sample server for this design.");
});
$("#command-search").addEventListener("input", event => { state.search = event.target.value.trim().toLowerCase(); state.page = 0; renderCommands(); });
window.addEventListener("hashchange", route);
async function previewApi(path, input) { const response = await fetch(path, { method: input ? "POST" : "GET", headers: input ? {"Content-Type":"application/json", "X-CSRF-Token":state.csrf} : {}, body: input ? JSON.stringify(input) : undefined }); const value = await response.json(); if (!response.ok) throw Error(value.error || "Request failed."); return value; }
async function start() { try { const identity = await previewApi("/preview-session.json"); state.csrf = identity.csrf; const session = await previewApi("/api/bot/session"); const ownerLink = $(".owner-link"); ownerLink.hidden = !session.owner; ownerLink.textContent = session.sonataOwner ? "Owner" : "Admin"; if (!session.sonataOwner) { ownerLink.href = "/admin"; delete ownerLink.dataset.view; } state.target = identity.target; state.forms = (await previewApi("/api/bot/forms")).forms; state.server = await previewApi("/api/bot/server?guild=" + identity.guild); const response = await fetch("/catalog.json"); if (!response.ok) throw Error("Command list unavailable"); state.catalog = await response.json(); const features = await fetch("/features.json"); if (!features.ok) throw Error("Feature list unavailable"); state.featureGroups = await features.json(); route(); } catch { $("#command-list").innerHTML = '<p class="empty">The command reference could not load. Refresh this preview to try again.</p>'; notify("Command reference could not load."); } }
start();
