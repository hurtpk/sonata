/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export function mountCommandSetup(root, forms, server, execute, initial = "alias set", catalog = []) {
    const entries = new Map(catalog.map(doc => [doc.name, { full: doc.name, documentation: doc, aliases: doc.aliases }]));
    for (const form of forms) for (const action of form.options) {
        const full = form.name + (action.name === "run" ? "" : " " + action.name);
        entries.set(full, { ...entries.get(full), ...action, root: form.name, full });
    }
    const actions = [...entries.values()].sort((a, b) => a.full.localeCompare(b.full));
    let selected = entries.get(initial) ?? actions.find(action => action.full.startsWith(initial + " ") && ["set", "setup", "config"].includes(action.name)) ?? actions.find(action => action.full.startsWith(initial + " ")) ?? actions[0], visible = actions, active = -1;
    root.classList.add("command-setup");
    root.innerHTML = '<div class="setup-picker"><label for="setup-search">Find a command</label><div class="setup-combobox"><input type="text" id="setup-search" role="combobox" aria-autocomplete="list" aria-controls="setup-actions" aria-expanded="false" placeholder="Search or choose a command" autocomplete="off" spellcheck="false"><button type="button" class="setup-open" aria-label="Show commands" aria-controls="setup-actions" aria-expanded="false"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="setup-menu" hidden><div id="setup-actions" role="listbox" aria-label="Sonata commands"></div><div class="setup-no-matches" role="status" hidden>No matching commands.</div></div></div></div><div id="setup-form"></div><p class="setup-result" role="status" hidden></p>';
    const picker = root.querySelector(".setup-combobox"), input = root.querySelector("#setup-search"), toggle = root.querySelector(".setup-open"), list = root.querySelector("#setup-actions"), menu = list.parentElement;
    const body = root.querySelector("#setup-form"), result = root.querySelector(".setup-result");
    function focusOption(index) {
        list.children[active]?.classList.remove("active");
        active = index;
        const option = list.children[active];
        if (!option) { input.removeAttribute("aria-activedescendant"); return; }
        option.classList.add("active");
        input.setAttribute("aria-activedescendant", option.id);
        if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
    function show(query = "") {
        const term = query.trim().toLowerCase().replace(/^[,/]/, "");
        visible = actions.filter(action => `${action.full} ${action.documentation.slashName ?? ""} ${(action.aliases ?? []).join(" ")} ${action.description ?? action.documentation.description}`.toLowerCase().includes(term));
        menu.hidden = false;
        input.setAttribute("aria-expanded", "true");
        toggle.setAttribute("aria-expanded", "true");
        list.innerHTML = visible.map((action, index) => `<button type="button" tabindex="-1" role="option" id="setup-option-${index}" data-index="${index}" aria-selected="${action === selected}"><span>${escape(action.full)}</span>${action.root ? "" : "<small>Discord only</small>"}</button>`).join("");
        menu.querySelector(".setup-no-matches").hidden = visible.length > 0;
        menu.scrollTop = 0;
        const exact = visible.findIndex(action => action.full === term || action.documentation.slashName === term);
        const startsWith = visible.findIndex(action => action.full.startsWith(term));
        focusOption(term ? (exact >= 0 ? exact : Math.max(startsWith, visible.length ? 0 : -1)) : visible.indexOf(selected));
    }
    function close() {
        menu.hidden = true;
        input.value = selected?.full ?? "";
        input.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    }
    function choose(index) {
        const action = visible[index];
        if (!action) return;
        if (action !== selected) { selected = action; render(); }
        close();
    }
    function render() {
        result.hidden = true; const action = selected;
        if (!action) { body.textContent = "No matching setup actions."; return; }
        const doc = action.documentation;
        const intro = escape((action.description || doc.description).split(/(?<=[.!?])\s/)[0]);
        const more = `<details class="setup-more"><summary>Details and permissions</summary><p>${escape(doc.description)}</p>${doc.detail ? `<p>${escape(doc.detail)}</p>` : ""}<p class="setup-permissions">Required: ${escape(doc.permissions)}</p></details>`;
        if (!action.root) {
            body.innerHTML = `<h2>${escape(action.full)}</h2><p>${intro}</p>${more}<p>Run <code>${escape((server.settings?.prefix ?? ",") + action.full)}</code>${doc.slashName ? ` or <code>/${escape(doc.slashName)}</code>` : ""} in Discord.</p>`;
            return;
        }
        body.innerHTML = `<h2>${escape(action.full)}</h2><p>${intro}</p>${more}<form><label>Run in channel<select name="_channel">${server.channels.filter(channel => [0, 5].includes(channel.type)).map(channel => `<option value="${channel.id}"># ${escape(channel.name)}</option>`).join("")}</select><small>Sonata checks permissions before running the command.</small></label>${action.options.some(option => option.type === 11) ? "<p>For image or video evidence, run this action in Discord with the files attached. This form runs the text action only.</p>" : ""}<div class="setup-fields">${action.options.filter(option => option.type !== 11).map(option => {
            const parameter = doc.parameters.find(parameter => parameter.name === option.name), attrs = `name="${option.name}" ${option.required ? "required" : ""}`, placeholder = option.required ? "Choose…" : "Keep default";
            let input;
            if (option.choices) input = `<select ${attrs}><option value="">${placeholder}</option>${option.choices.map(choice => `<option value="${escape(choice.value)}">${escape(choice.name)}</option>`).join("")}</select>`;
            else if ([7, 8].includes(option.type)) { const values = option.type === 7 ? server.channels.filter(channel => !option.channel_types || option.channel_types.includes(channel.type)) : server.roles.filter(role => role.id !== server.guild.id); input = `<select ${attrs}><option value="">${placeholder}</option>${values.map(value => `<option value="${value.id}">${option.type === 7 ? "# " : ""}${escape(value.name)}</option>`).join("")}</select>`; }
            else if (option.type === 5) input = `<select ${attrs}><option value="">${placeholder}</option><option value="true">On</option><option value="false">Off</option></select>`;
            else input = option.max_length > 200 ? `<textarea ${attrs} maxlength="${option.max_length}" rows="3"></textarea>` : `<input ${attrs} type="${option.type === 4 ? "number" : "text"}" ${option.min_value !== undefined ? `min="${option.min_value}"` : ""} ${option.max_value !== undefined ? `max="${option.max_value}"` : ""} ${option.max_length ? `maxlength="${option.max_length}"` : ""} ${option.type === 6 ? 'pattern="[0-9]{17,20}" inputmode="numeric" placeholder="Discord user ID"' : ""}>`;
            return `<div class="setup-option"><label>${escape(option.name)} <span>${option.required ? "Required" : "Optional"}</span>${input}<small>${escape(parameter.description.replace(/\s+\d[\d,–-]* characters accepted by the command parser; stricter runtime rules above still apply\./g, ""))}</small></label>${parameter.acceptedCommands ? `<details class="setup-targets"><summary>Supported commands and arguments</summary>${parameter.acceptedCommands.map(target => `<p><code>${escape(target.command)} ${escape(target.syntax)}</code><br>${escape(target.description)}</p>`).join("")}</details>` : ""}</div>`;
        }).join("")}</div><details class="setup-review"><summary>Show command</summary><code id="setup-command-preview"></code></details><button type="submit">${action.name === "run" ? "Run command" : "Save"}</button></form>`;
        const form = body.querySelector("form"), preview = body.querySelector("#setup-command-preview");
        const settings = server.settings || {}, ticket = settings.tickets;
        const saved = action.root === "settings" ? ({
            prefix: { prefix: settings.prefix || "," }, embedcolor: { color: "#" + (settings.embedColor ?? 0xffad91).toString(16).padStart(6, "0") },
            modlog: { channel: settings.logChannel }, dm: { enabled: !!settings.dm }, snipe: { limit: settings.snipeLimit ?? 15, require_manage_messages: settings.snipeRequireManageMessages !== false },
        })[action.name] : action.root === "ticket" && ticket ? ({ setup: { category: ticket.category, role: ticket.role, channel: ticket.log }, intake: { mode: ticket.intake || "support" }, idle: { hours: ticket.idle?.hours ?? 0, channel: ticket.idle?.channel } })[action.name] : undefined;
        for (const [name, value] of Object.entries(saved || {})) { const field = form.elements.namedItem(name); if (field && value != null) field.value = String(value); }
        const update = () => { const data = new FormData(form); preview.textContent = (server.settings?.prefix ?? ",") + action.full + action.options.filter(option => option.type !== 11).map(option => { const value = data.get(option.name); return value ? " " + (/\s/.test(value) ? JSON.stringify(value) : value) : option.required ? ` <${option.name}>` : ""; }).join(""); };
        form.addEventListener("input", update); update();
        form.addEventListener("submit", async event => {
            event.preventDefault(); const button = form.querySelector('button[type="submit"]'), data = new FormData(form), options = {};
            for (const option of action.options.filter(option => option.type !== 11)) { const value = data.get(option.name); if (value !== "") options[option.name] = option.type === 4 ? Number(value) : option.type === 5 ? value === "true" : value; }
            if (action.name === "run" && !confirm(`Run ${preview.textContent} in #${server.channels.find(channel => channel.id === data.get("_channel"))?.name}?`)) return;
            button.disabled = true; result.hidden = true;
            try { const response = await execute({ guild: server.guild.id, channel: data.get("_channel"), name: action.root, sub: action.name, options }); result.textContent = (response.result?.embeds ?? []).map(embed => `${embed.title}\n${embed.description}`).join("\n\n") || "Action completed."; result.classList.remove("setup-error"); }
            catch (error) { result.textContent = error.message; result.classList.add("setup-error"); }
            finally { button.disabled = false; result.hidden = false; }
        });
    }
    input.addEventListener("focus", () => { input.select(); show(); });
    input.addEventListener("click", () => { if (menu.hidden) show(); });
    input.addEventListener("input", () => show(input.value));
    input.addEventListener("keydown", event => {
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            if (menu.hidden) { show(); return; }
            if (visible.length) focusOption((active + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length);
        } else if (!menu.hidden && ["Enter", "Escape"].includes(event.key)) {
            event.preventDefault();
            if (event.key === "Enter") choose(active);
            else close();
        }
    });
    toggle.addEventListener("mousedown", event => event.preventDefault());
    toggle.addEventListener("click", () => {
        if (menu.hidden) { input.focus(); show(); }
        else close();
    });
    list.addEventListener("mousedown", event => event.preventDefault());
    list.addEventListener("click", event => {
        const option = event.target.closest("[data-index]");
        if (option) choose(Number(option.dataset.index));
    });
    picker.addEventListener("focusout", event => { if (!picker.contains(event.relatedTarget)) close(); });
    close(); render();
}

let setupView, catalogRequest, setupOpened = false;
document.addEventListener("sonata-server", async event => {
    setupView = event.detail.current;
    if (!setupView.manageable || setupOpened) return;
    const initial = new URLSearchParams(location.search).get("setup");
    if (!initial) return;
    setupOpened = true;
    await openTab("command-access");
    const search = document.getElementById("command-access-search"); search.value = initial; search.dispatchEvent(new Event("input"));
    document.getElementById("configure-command-" + encodeURIComponent(initial))?.click();
});
document.addEventListener("sonata-command-configure", async event => {
    const { server, root, name } = event.detail;
    if (setupView !== server || !server.manageable) return;
    root.classList.add("inline-command-setup");
    root.textContent = "Loading…";
    try {
        catalogRequest ??= fetch("/catalog.json").then(response => {
            if (!response.ok) throw Error("Commands could not be loaded.");
            return response.json();
        }).catch(() => { catalogRequest = undefined; return []; });
        const [forms, catalog] = await Promise.all([loadDashboardForms(), catalogRequest]);
        if (setupView !== server || !root.isConnected) return;
        root.textContent = "";
        mountCommandSetup(root, forms, server, runDashboardAction, name, catalog);
    } catch (error) { if (setupView === server) root.textContent = error.message; }
});
