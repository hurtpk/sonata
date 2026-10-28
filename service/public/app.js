/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const $ = id => document.getElementById(id);
let csrf = "", page = 0, requestNumber = 0, searchTimer, toastTimer;
const date = value => value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Not activated";
const ago = value => {
    if (!value) return "No check-in yet";
    const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
    return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
};
function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
function errorAt(id, error) { $(id).textContent = error?.message ?? ""; $(id).hidden = !error; }
function toast(text) { clearTimeout(toastTimer); $("toast").textContent = text; $("toast").hidden = false; toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3500); }
async function api(path, input) {
    const response = await fetch(path, { method: input ? "POST" : "GET", headers: input ? { "Content-Type": "application/json", "X-CSRF-Token": csrf } : {}, body: input ? JSON.stringify(input) : undefined, credentials: "same-origin" });
    const result = await response.json();
    if (!response.ok) { if (response.status === 401) showSignIn(); throw new Error(result.error ?? "The service could not complete this request."); }
    return result;
}
function showSignIn() { $("dashboard").hidden = true; $("signin").hidden = false; $("logout").hidden = true; }
function showBlock(userId = "") { $("block-id").value = userId; $("block-reason").value = ""; errorAt("block-error"); $("block-dialog").showModal(); $("block-id").focus(); }
async function changeAccess(userId, blocked, reason = "") {
    await api("/api/admin/block", { userId, blocked, reason });
    toast(blocked ? "Account access blocked." : "Account access restored.");
    await loadUsers();
    if ($("activity").open) await loadAudit();
}
async function loadUsers() {
    const current = ++requestNumber;
    errorAt("error");
    try {
        const result = await api(`/api/admin/users?${new URLSearchParams({ q: $("search").value, status: $("filter").value, page })}`);
        if (current !== requestNumber) return;
        const total = result.stats.total ?? 0, blocked = result.stats.blocked ?? 0;
        $("total").textContent = total; $("blocked").textContent = blocked; $("recent").textContent = result.stats.recent ?? 0; $("allowed").textContent = total - blocked;
        $("result-count").textContent = result.users.length ? `· ${result.users.length}` : "";
        $("users").replaceChildren(); $("empty").hidden = !!result.users.length;
        const filtered = $("search").value.trim() || $("filter").value !== "all";
        $("empty").querySelector("h3").textContent = filtered ? "No matching accounts." : "No accounts here yet.";
        $("empty").querySelector("p").textContent = filtered ? "Try another name, ID or access filter." : "Accounts appear after users finish Discord activation in Sonata.";
        for (const user of result.users) {
            const row = element("tr"), member = element("td"), identity = element("div", null, "identity"), labels = element("div", null, "labels");
            const name = user.name || user.username || "Unregistered account";
            identity.append(element("span", name.slice(0, 1).toUpperCase(), "avatar"));
            labels.append(element("b", name), element("span", user.username ? `@${user.username}` : "Blocked before activation"));
            const id = element("button", user.id, "id-copy"); id.title = "Copy Discord user ID"; id.addEventListener("click", () => { void navigator.clipboard.writeText(user.id).then(() => toast("User ID copied.")).catch(() => toast("Select the ID to copy it manually.")); });
            labels.append(id); identity.append(labels); member.append(identity); row.append(member);
            const status = element("td"); status.append(element("span", user.blocked ? "Blocked" : "Allowed", `badge ${user.blocked ? "is-blocked" : "is-allowed"}`)); row.append(status);
            row.append(element("td", user.version ?? "—", "mono"), element("td", date(user.first_seen)), element("td", ago(user.last_seen)));
            row.lastChild.title = user.last_seen ? new Date(user.last_seen).toLocaleString() : "No check-in yet";
            const actions = element("td"), button = element("button", user.blocked ? "Restore access" : "Block", user.blocked ? "restore quiet" : "block quiet");
            if (user.blocked && user.reason) { const note = element("span", "Note", "private-note"); note.title = user.reason; actions.append(note); }
            button.addEventListener("click", () => { if (!user.blocked) { showBlock(user.id); return; } button.disabled = true; void changeAccess(user.id, false).catch(error => { errorAt("error", error); button.disabled = false; }); });
            actions.append(button); row.append(actions); $("users").append(row);
        }
        $("previous").disabled = page === 0; $("next").disabled = !result.next; $("page").textContent = `Page ${page + 1}`; $("updated").textContent = `Updated ${new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    } catch (error) { if (current === requestNumber) errorAt("error", error); }
}
async function loadAudit() {
    try { const result = await api("/api/admin/audit"); $("audit").replaceChildren(); if (!result.events.length) $("audit").append(element("p", "No access changes yet.", "small")); for (const entry of result.events) { const line = element("div", null, "audit-row"); line.append(element("b", entry.action === "blocked" ? "Access blocked" : "Access restored"), element("span", entry.target, "mono"), element("span", date(entry.at), "small")); if (entry.reason) line.append(element("span", entry.reason)); line.append(element("small", `By ${entry.actor}`)); $("audit").append(line); } }
    catch (error) { $("audit").textContent = error.message; }
}
async function start() {
    const info = await api("/api/info"); $("demo").hidden = !info.demo;
    if (location.pathname === "/activate") {
        showSignIn(); $("signin-eyebrow").textContent = "SONATA ACTIVATION"; $("signin-title").textContent = "Make this account yours."; $("signin-description").textContent = "Activate Sonata with the same Discord account you have open in the client."; $("disclosure").hidden = false; $("signin-note").textContent = "By continuing, you agree to register the details above for access management.";
        const activation = new URLSearchParams(location.search).get("id");
        if (!/^[a-f0-9]{64}$/.test(activation ?? "")) { $("login").hidden = true; $("signin-note").textContent = "Start activation from inside Sonata to get a valid link."; }
        else $("login").href = `/auth/start?activation=${encodeURIComponent(activation)}`;
        return;
    }
    if (new URLSearchParams(location.search).has("activated")) { showSignIn(); $("signin-title").textContent = "You're all set here."; $("signin-description").textContent = "Return to Sonata and press Finish activation to check your access."; $("login").hidden = true; $("signin-note").textContent = "The owner may allow or restrict this account."; return; }
    try { const session = await api("/api/admin/session"); csrf = session.csrf; $("owner").textContent = `@${session.username}`; $("logout").hidden = false; $("dashboard").hidden = false; await loadUsers(); }
    catch { showSignIn(); if (info.demo) { $("login").href = "/demo"; $("login").textContent = "Open local demo →"; } }
}
$("search").addEventListener("input", () => { clearTimeout(searchTimer); page = 0; searchTimer = setTimeout(() => void loadUsers(), 250); });
$("filter").addEventListener("change", () => { page = 0; void loadUsers(); });
$("refresh").addEventListener("click", () => void loadUsers());
$("previous").addEventListener("click", () => { if (page > 0) page--; void loadUsers(); });
$("next").addEventListener("click", () => { page++; void loadUsers(); });
$("block-new").addEventListener("click", () => showBlock());
$("cancel").addEventListener("click", () => $("block-dialog").close());
$("activity").addEventListener("toggle", () => { if ($("activity").open) void loadAudit(); });
$("logout").addEventListener("click", () => { void api("/api/admin/logout", {}).then(showSignIn).catch(error => toast(error.message)); });
$("block-form").addEventListener("submit", event => { event.preventDefault(); $("confirm-block").disabled = true; void changeAccess($("block-id").value.trim(), true, $("block-reason").value.trim()).then(() => $("block-dialog").close()).catch(error => errorAt("block-error", error)).finally(() => { $("confirm-block").disabled = false; }); });
void start().catch(error => { showSignIn(); $("signin-description").textContent = error.message; });
