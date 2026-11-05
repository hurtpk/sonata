/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export function mountCommandSetup(root, forms, server, execute, initial = "alias set") {
    let selected = initial, query = "";
    const actions = forms.flatMap(form => form.options.map(action => ({ ...action, root: form.name, full: form.name + (action.name === "run" ? "" : " " + action.name) })));
    root.classList.add("command-setup");
    root.innerHTML = '<div class="setup-picker"><label>Find a command<input type="search" id="setup-search" placeholder="Alias, warn, AutoMod, welcome…"></label><label>Action<select id="setup-action"></select></label></div><div id="setup-form"></div><p class="setup-result" role="status" hidden></p>';
    const select = root.querySelector("#setup-action"), body = root.querySelector("#setup-form"), result = root.querySelector(".setup-result");
    function pick() {
        const filtered = actions.filter(action => `${action.full} ${action.description}`.toLowerCase().includes(query));
        select.innerHTML = filtered.map(action => `<option value="${escape(action.full)}">${escape(action.full)}</option>`).join("");
        if (!filtered.some(action => action.full === selected)) selected = filtered[0]?.full;
        select.value = selected; render();
    }
    function render() {
        result.hidden = true; const action = actions.find(action => action.full === selected);
        if (!action) { body.textContent = "No matching setup actions."; return; }
        const doc = action.documentation;
        body.innerHTML = `<h2>${escape(action.full)}</h2><p>${escape(doc.description)}</p>${doc.detail ? `<p>${escape(doc.detail)}</p>` : ""}<p class="setup-permissions">Required: ${escape(doc.permissions)}</p><form><label>Run in channel<select name="_channel">${server.channels.filter(channel => [0, 5].includes(channel.type)).map(channel => `<option value="${channel.id}"># ${escape(channel.name)}</option>`).join("")}</select><small>Channel permissions and moderation hierarchy are checked when applying this action.</small></label>${action.options.some(option => option.type === 11) ? "<p>For image or video evidence, run this action in Discord with the files attached. This form runs the text action only.</p>" : ""}<div class="setup-fields">${action.options.filter(option => option.type !== 11).map(option => {
            const parameter = doc.parameters.find(parameter => parameter.name === option.name), attrs = `name="${option.name}" ${option.required ? "required" : ""}`, placeholder = option.required ? "Choose…" : "Use the command default";
            let input;
            if (option.choices) input = `<select ${attrs}><option value="">${placeholder}</option>${option.choices.map(choice => `<option value="${escape(choice.value)}">${escape(choice.name)}</option>`).join("")}</select>`;
            else if ([7, 8].includes(option.type)) { const values = option.type === 7 ? server.channels.filter(channel => !option.channel_types || option.channel_types.includes(channel.type)) : server.roles.filter(role => role.id !== server.guild.id); input = `<select ${attrs}><option value="">${placeholder}</option>${values.map(value => `<option value="${value.id}">${option.type === 7 ? "# " : ""}${escape(value.name)}</option>`).join("")}</select>`; }
            else if (option.type === 5) input = `<select ${attrs}><option value="">${placeholder}</option><option value="true">On / true</option><option value="false">Off / false</option></select>`;
            else input = option.max_length > 200 ? `<textarea ${attrs} maxlength="${option.max_length}" rows="3"></textarea>` : `<input ${attrs} type="${option.type === 4 ? "number" : "text"}" ${option.min_value !== undefined ? `min="${option.min_value}"` : ""} ${option.max_value !== undefined ? `max="${option.max_value}"` : ""} ${option.max_length ? `maxlength="${option.max_length}"` : ""} ${option.type === 6 ? 'pattern="[0-9]{17,20}" inputmode="numeric" placeholder="Discord user ID"' : ""}>`;
            return `<div class="setup-option"><label>${escape(option.name)} <span>${option.required ? "Required" : "Optional"}</span>${input}<small>${escape(parameter.description)}</small></label>${parameter.acceptedCommands ? `<details class="setup-targets"><summary>Supported commands and arguments</summary>${parameter.acceptedCommands.map(target => `<p><code>${escape(target.command)} ${escape(target.syntax)}</code><br>${escape(target.description)}</p>`).join("")}</details>` : ""}</div>`;
        }).join("")}</div><div class="setup-review"><h3>Command preview</h3><code id="setup-command-preview"></code><p>Uses your current Discord permissions. Dashboard access does not grant command permissions.</p></div><button type="submit">${action.name === "run" ? "Run action…" : "Apply configuration"}</button></form>`;
        const form = body.querySelector("form"), preview = body.querySelector("#setup-command-preview");
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
    select.addEventListener("change", () => { selected = select.value; render(); });
    root.querySelector("#setup-search").addEventListener("input", event => { query = event.target.value.toLowerCase(); pick(); }); pick();
}

let setupView, mountedView, setupOpened = false;
document.addEventListener("sonata-server", event => {
    const { current } = event.detail;
    let button = document.querySelector('[data-tab="commands"]'), panel = document.getElementById("tab-commands");
    if (!button) {
        const nav = document.querySelector('[data-tab="features"]').parentElement;
        button = document.createElement("button"); button.dataset.tab = "commands"; button.textContent = "Command setup"; button.setAttribute("aria-selected", "false"); nav.append(button);
        panel = document.createElement("section"); panel.id = "tab-commands"; panel.hidden = true; document.getElementById("tab-features").parentElement.append(panel);
        button.addEventListener("click", () => { void openTab("commands"); void renderSetup(panel); });
    }
    setupView = current;
    button.hidden = !current.manageable;
    if (!current.manageable) { panel.replaceChildren(); return; }
    if (!setupOpened && new URLSearchParams(location.search).get("setup")) { setupOpened = true; button.click(); }
    else if (button.getAttribute("aria-selected") === "true") void renderSetup(panel);
});

async function renderSetup(panel) {
    const server = setupView;
    if (!server?.manageable || mountedView === server) return;
    mountedView = server;
    panel.textContent = "Loading command setup…";
    try {
        const forms = await loadDashboardForms();
        if (setupView !== server) return;
        const initial = new URLSearchParams(location.search).get("setup") || "alias set";
        mountCommandSetup(panel, forms, server, runDashboardAction, initial);
    } catch (error) {
        if (setupView !== server) return;
        mountedView = undefined;
        panel.textContent = error.message;
    }
}
