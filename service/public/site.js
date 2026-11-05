/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
import { mountGuides, mountStatus } from "/site-info.js";

const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const state = { forms: [], catalog: [], csrf: "", category: "All", search: "", page: 0, mode: "prefix", prefix: ",", authenticated: false, staff: false };
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
        if (view === "commands" && state.catalog.length) renderCommands();
        if (view === "dashboard") loadFrame("dashboard");
        if (view === "guides") mountGuides($("#view-guides"));
        if (view === "status") void mountStatus($("#view-status"), () => api("/api/status"));
        if (view === "owner") loadFrame("owner");
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
    return `<article class="command-card" data-command="${escape(command.name)}"><header><h2>${escape(prefix + displayedName)}</h2><div class="command-actions">${state.forms.some(form => form.name === command.name.split(" ")[0] && form.options.some(action => action.name === (command.name.split(" ")[1] ?? "run"))) ? `<button data-setup="${escape(command.name)}">Configure ↗</button>` : ""}<button class="command-expand" data-expand="${escape(bodyId)}" aria-controls="${escape(bodyId)}" aria-expanded="false" aria-label="Show details for ${escape(command.name)}"><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button data-copy="${escape(example(command))}" aria-label="Copy ${escape(command.name)} example">Copy ↗</button></div></header><div class="command-body" id="${escape(bodyId)}" hidden><div class="command-body-inner"><p class="command-description">${escape(command.description)}</p>${command.detail ? `<p class="command-detail">${escape(command.detail)}</p>` : ""}<div class="command-permissions"><span>PERMISSIONS</span>${escape(command.permissions)}</div><div class="syntax">${escape(syntax.trim())}</div><code class="example"><span>EXAMPLE</span>${escape(example(command))}</code>${command.attachment ? `<p class="attachment-instruction">Attach a real file in the <strong>${escape(command.attachment)}</strong> field or upload it on the same prefix-command message. The copied command does not attach a file.</p>` : ""}<section class="command-arguments" aria-label="Arguments for ${escape(command.name)}"><h3>Arguments</h3>${parameters}</section>${command.aliases.length ? `<p class="alias-note">Built-in prefix aliases for this command family: ${command.aliases.map(alias => `<code>${escape(state.prefix + alias)}</code>`).join(", ")}. Some aliases select a specific subcommand; check the behavior above.</p>` : ""}</div></div></article>`;
}
function renderCommands() {
    const categories = ["All", ...new Set(state.catalog.map(command => command.category))];
    $("#categories").innerHTML = categories.map(category => `<button data-category="${escape(category)}" aria-pressed="${state.category === category}">${escape(category)}</button>`).join("");
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
document.addEventListener("click", async event => {
    const button = event.target.closest("button, a") ?? event.target.closest(".command-card header")?.querySelector("[data-expand]");
    if (!button) return;

    if (button.dataset.setup) { state.setupCommand = button.dataset.setup; loadFrame("dashboard", state.setupCommand); location.hash = "dashboard"; }
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
    if (button.id === "previous") { state.page--; renderCommands(); $("#command-list").scrollIntoView({ block: "start" }); }
    if (button.id === "next") { state.page++; renderCommands(); $("#command-list").scrollIntoView({ block: "start" }); }

});
$("#command-search").addEventListener("input", event => { state.search = event.target.value.trim().toLowerCase(); state.page = 0; renderCommands(); });
window.addEventListener("hashchange", route);
async function api(path, input) { const response = await fetch(path, { method: input ? "POST" : "GET", headers: input ? {"Content-Type":"application/json", "X-CSRF-Token":state.csrf} : {}, body: input ? JSON.stringify(input) : undefined }); const value = await response.json(); if (!response.ok) throw Error(value.error || "Request failed."); return value; }
function loadFrame(view, command) {
    const frame = $(view === "owner" ? "#owner-frame" : "#dashboard-frame");
    if (!state.authenticated || view === "owner" && !state.staff) { frame.hidden = true; let notice = document.getElementById(view + "-signin"); if (!notice) { notice = document.createElement("section"); notice.id = view + "-signin"; notice.className = "live-signin"; notice.innerHTML = `<h1>${view === "owner" ? "Admin access required" : "Your server dashboard"}</h1><p>${state.authenticated ? "This account does not have Sonata administrator access." : "Sign in with Discord to manage your server."}</p>${state.authenticated ? "" : '<a class="primary" href="/auth/start?bot=1">Sign in with Discord</a>'}`; frame.parentElement.append(notice); } return; }
    frame.hidden = false;
    if (!frame.getAttribute("src") || command) frame.src = view === "owner" ? "/admin?embed=1" : "/dashboard?embed=1" + (command ? "&setup=" + encodeURIComponent(command) : "");
}
window.addEventListener("message", event => {
    if (event.origin !== location.origin || !["sonata-frame-size", "sonata-open-dashboard"].includes(event.data?.type)) return;
    const frame = all("iframe[data-frame]").find(frame => frame.contentWindow === event.source);
    if (frame && event.data?.type === "sonata-open-dashboard" && /^\d{17,20}$/.test(event.data.guild ?? "")) { $("#dashboard-frame").src = "/dashboard?embed=1&guild=" + event.data.guild + (event.data.owner ? "&owner=1" : ""); location.hash = "dashboard"; return; }
    if (frame && Number.isFinite(event.data.height)) frame.style.height = Math.max(700, Math.min(20000, event.data.height)) + "px";
});
async function start() {
    const catalog = (async () => {
        const response = await fetch("/catalog.json"); if (!response.ok) throw Error("Command reference unavailable");
        state.catalog = await response.json();
        state.forms = [...new Set(state.catalog.filter(command => command.websiteSetup).map(command => command.name.split(" ")[0]))].map(name => ({ name, options: state.catalog.filter(command => command.websiteSetup && command.name.split(" ")[0] === name).map(command => ({ name: command.name.split(" ")[1] ?? "run" })) }));
        if (activeView === "commands") renderCommands();
    })().catch(() => {
        $("#command-list").innerHTML = '<p class="empty">The command reference could not load. Refresh to try again.</p>';
        if (activeView === "commands") notify("Command reference could not load.");
    });
    try {
        const session = await api("/api/bot/session"), link = $(".owner-link");
        state.authenticated = true;
        state.staff = session.owner;
        link.hidden = !session.owner;
        link.textContent = session.sonataOwner ? "Owner" : "Admin";
        state.csrf = session.csrf;
    } catch { $(".owner-link").hidden = true; }
    if (!location.hash && location.pathname === "/guides") location.hash = "guides";
    else if (!location.hash && location.pathname === "/status") location.hash = "status";
    else if (!location.hash && location.pathname === "/commands") location.hash = "commands";
    route();
    await catalog;
}
start();
