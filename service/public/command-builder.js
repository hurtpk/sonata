/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const idPattern = /^(?:<@!?|<@&|<#)?(\d{17,20})>?$/;
const durationPattern = /^(?:\d+(?:\.\d+)?[smhdw])+$/i;

export function buildCommand(command, values, prefix, mode) {
    const slash = mode === "slash", options = command.options.filter(option => option.type !== 11);
    if (!slash && (!prefix || prefix.length > 5 || /\s/.test(prefix))) throw Error("Enter your server’s prefix (1–5 characters, no spaces).");
    const args = [];
    for (let index = 0; index < options.length; index++) {
        const option = options[index];
        let value = String(values[option.name] ?? "").trim();
        if (!value) {
            if (option.required) throw Error("Fill in " + option.name + ".");
            if (!slash && command.name !== "settings videoembeds") {
                const next = options.slice(index + 1).map(item => String(values[item.name] ?? "").trim()).find(Boolean);
                const skips = next && ([6, 7, 8].includes(option.type) && (!idPattern.test(next) || option.type === 8 && next.startsWith("<#")) || option.name === "duration" && !durationPattern.test(next));
                if (next && !skips) throw Error("Fill in " + option.name + " or switch to slash format to skip it.");
            }
            continue;
        }
        if ([6, 7, 8].includes(option.type)) {
            const id = idPattern.exec(value)?.[1];
            if (!id) throw Error("Enter a Discord ID or mention for " + option.name + ".");
            value = (option.type === 6 ? "<@" : option.type === 7 ? "<#" : "<@&") + id + ">";
        }
        if (option.type === 4 && (!Number.isSafeInteger(Number(value)) || Number(value) < (option.min_value ?? 0) || Number(value) > (option.max_value ?? Number.MAX_SAFE_INTEGER))) throw Error("Enter a valid whole number for " + option.name + ".");
        if (option.type === 3 && (value.length < (option.min_length ?? 1) || value.length > (option.max_length ?? 500) || option.choices && !option.choices.some(choice => choice.value === value))) throw Error("Enter a valid value for " + option.name + ".");
        if (!slash && command.name === "settings videoembeds" && option.name === "all") {
            if (value === "on") {
                if (values.channels?.trim()) throw Error("Choose selected channels or all channels.");
                args.push("all");
            } else if (!values.channels?.trim()) throw Error("Enter the selected channels or turn on all channels.");
            continue;
        }
        if (!slash && command.name === "settings videoembeds" && option.name === "roles") args.push("roles:");
        if (!slash && /[\s"']/.test(value)) {
            if (/[\r\n]/.test(value) || (value.includes('"') && value.includes("'"))) throw Error("Use slash format for this value because it contains line breaks or both kinds of quote.");
            const quote = value.includes('"') ? "'" : '"';
            value = quote + value + quote;
        }
        args.push(slash ? option.name + ":" + value : value);
    }
    const text = (slash ? "/" + (command.slashName ?? command.name) : prefix + command.name) + (args.length ? " " + args.join(" ") : "");
    if (!slash && text.length > 2000) throw Error("This prefix command exceeds Discord’s 2,000-character message limit. Try slash format or shorten it.");
    return text;
}

const node = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };

export function openCommandBuilder(catalog, initial, mode, prefix) {
    const dialog = document.querySelector("#command-builder");
    dialog.innerHTML = '<div class="builder-heading"><h2>Command builder</h2><button type="button" class="outline small" data-close>Close</button></div><form><label>Command<select name="builder-command"></select></label><div class="builder-fields"><label>Format<select name="builder-format"><option value="prefix">Prefix</option><option value="slash">Slash reference</option></select></label><label data-prefix>Server prefix<input name="builder-prefix" maxlength="5"></label></div><div class="builder-fields" data-arguments></div><p data-note></p><label>Preview<textarea data-preview readonly rows="3"></textarea></label><p role="status" data-result></p><button type="submit" class="primary">Copy command</button></form>';
    dialog.setAttribute("aria-label", "Command builder");
    const form = dialog.querySelector("form"), commandSelect = form.elements["builder-command"], format = form.elements["builder-format"], prefixInput = form.elements["builder-prefix"];
    const fields = form.querySelector("[data-arguments]"), note = form.querySelector("[data-note]"), result = form.querySelector("[data-result]"), preview = form.querySelector("[data-preview]"), copy = form.querySelector("[type=submit]");
    const commands = [...catalog].sort((a, b) => a.name.localeCompare(b.name));
    for (const command of commands) commandSelect.add(new Option(command.name, command.name));
    commandSelect.value = initial || commands[0].name; format.value = mode; prefixInput.value = prefix;
    const selected = () => commands.find(command => command.name === commandSelect.value);
    function update() {
        const slash = format.value === "slash";
        form.querySelector("[data-prefix]").hidden = slash;
        const attachments = selected().options.filter(option => option.type === 11);
        note.textContent = [slash ? "Choose the slash command and enter these values in Discord’s fields." : "", ...attachments.map(option => `Upload ${option.name} in Discord${option.required ? " (required)" : " if needed"}.`)].filter(Boolean).join(" ");
        result.textContent = "";
        copy.textContent = slash ? "Copy slash reference" : "Copy command";
        try {
            const values = Object.fromEntries([...new FormData(form)].filter(([key]) => key.startsWith("arg:")).map(([key, value]) => [key.slice(4), value]));
            preview.value = buildCommand(selected(), values, prefixInput.value, format.value);
            copy.disabled = false;
        } catch (error) { preview.value = ""; result.textContent = error.message; copy.disabled = true; }
    }
    function renderFields() {
        const command = selected();
        fields.replaceChildren();
        for (const option of command.options.filter(option => option.type !== 11)) {
            const label = node("label", option.name + (option.required ? " (required)" : "")), choices = option.choices ?? (option.type === 5 ? [{ name: "On", value: "on" }, { name: "Off", value: "off" }] : null);
            const control = node(choices ? "select" : "input");
            control.name = "arg:" + option.name;
            if (choices) {
                control.add(new Option(option.required ? "Choose…" : "Leave empty", ""));
                for (const choice of choices) control.add(new Option(choice.name, choice.value));
            } else if (option.type === 4) {
                control.type = "number"; control.min = option.min_value ?? 0;
                if (option.max_value !== undefined) control.max = option.max_value;
            } else {
                control.maxLength = option.max_length ?? 500;
                if ([6, 7, 8].includes(option.type)) control.placeholder = "Discord ID or mention";
            }
            label.append(control, node("small", command.parameters.find(parameter => parameter.name === option.name)?.description));
            fields.append(label);
        }
        update();
    }
    form.addEventListener("input", event => { if (event.target !== commandSelect) update(); });
    commandSelect.addEventListener("change", renderFields);
    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!preview.value) return;
        try { await navigator.clipboard.writeText(preview.value); result.textContent = "Copied."; }
        catch { preview.focus(); preview.select(); result.textContent = "Select and copy the preview."; }
    });
    renderFields(); dialog.showModal();
}
