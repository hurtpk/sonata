/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

(() => {
    let state;
    const el = (tag, text, css) => { const n = document.createElement(tag); if (text != null) n.textContent = text; if (css) n.className = css; return n; };
    const button = (text, action, css = "quiet") => { const n = el("button", text, css); n.type = "button"; n.addEventListener("click", action); return n; };
    const field = (root, title, value = "", tag = "input") => { const label = el("label", title), n = el(tag); n.value = value; label.append(n); root.append(label); return n; };
    function choose(root, title, initial, options, change = () => {}) {
        let value = initial;
        const wrap = el("div", null, "manager-field"), popup = el("details", null, "manager-select"), summary = el("summary"), search = el("input"), list = el("div", null, "manager-options");
        search.type = "search"; search.placeholder = "Search…"; search.setAttribute("aria-label", `Search ${title.toLowerCase()}`);
        const label = () => { summary.textContent = options.find(o => String(o.value) === String(value))?.label || "Choose…"; };
        const draw = () => { list.replaceChildren(...options.filter(o => `${o.label} ${o.value}`.toLowerCase().includes(search.value.toLowerCase())).map(o => { const n = button(o.label, () => { value = o.value; popup.open = false; label(); change(value); }); n.setAttribute("aria-pressed", String(String(o.value) === String(value))); n.disabled = !!o.disabled; return n; })); };
        search.addEventListener("input", draw); popup.addEventListener("toggle", () => { if (popup.open) { search.value = ""; draw(); search.focus(); } });
        popup.append(summary, search, list); wrap.append(el("span", title), popup); root.append(wrap); label(); draw(); return { get value() { return value; }, element: popup };
    }
    function toggle(root, title, initial) { let value = initial; const row = el("div", null, "manager-toggle"), n = button(value ? "On" : "Off", () => { value = !value; n.textContent = value ? "On" : "Off"; n.setAttribute("aria-checked", String(value)); }); n.setAttribute("role", "switch"); n.setAttribute("aria-label", title); n.setAttribute("aria-checked", String(value)); row.append(el("span", title), n); root.append(row); return { get value() { return value; } }; }
    function permissions(root, groups, initial = "0", denied) {
        let allow = BigInt(initial), deny = BigInt(denied || "0");
        const wrap = el("div", null, "manager-permissions"), search = el("input"); search.type = "search"; search.placeholder = "Find a permission"; search.setAttribute("aria-label", "Find a permission"); wrap.append(search);
        for (const group of groups) {
            const section = el("details"); section.open = group.group === "Server"; section.append(el("summary", group.group));
            for (const option of group.values) {
                const bit = BigInt(option.bit), row = el("div", null, "manager-permission"), controls = el("div", null, "manager-permission-choices"); row.dataset.name = option.name.toLowerCase();
                const draw = () => { for (const n of controls.children) n.setAttribute("aria-pressed", String(n.dataset.value === (allow & bit ? "allow" : deny & bit ? "deny" : "inherit"))); };
                for (const [value, title] of denied === undefined ? [["inherit", "Off"], ["allow", "On"]] : [["deny", "Deny"], ["inherit", "Inherit"], ["allow", "Allow"]]) { const n = button(title, () => { allow &= ~bit; deny &= ~bit; if (value === "allow") allow |= bit; if (value === "deny") deny |= bit; draw(); }); n.dataset.value = value; controls.append(n); }
                row.append(el("span", option.name), controls); section.append(row); draw();
            }
            wrap.append(section);
        }
        search.addEventListener("input", () => { for (const row of wrap.querySelectorAll(".manager-permission")) row.hidden = !row.dataset.name.includes(search.value.toLowerCase()); for (const group of wrap.querySelectorAll("details")) group.hidden = ![...group.querySelectorAll(".manager-permission")].some(n => !n.hidden); }); root.append(wrap); return { get allow() { return allow.toString(); }, get deny() { return deny.toString(); } };
    }
    async function api(snapshot, input, query = "") {
        const response = await fetch(`/api/bot/server-manager?guild=${snapshot.id}${query}`, { method: input ? "POST" : "GET", credentials: "same-origin", headers: input ? { "Content-Type": "application/json", "X-CSRF-Token": snapshot.session.csrf } : {}, body: input ? JSON.stringify({ guild: snapshot.id, ...input }) : undefined });
        const data = await response.json(); if (!response.ok) throw Error(data.error || "This request could not be completed."); return data;
    }
    async function load(snapshot) { snapshot.data = await api(snapshot); if (state === snapshot) render(snapshot.mode); }
    async function mutate(snapshot, action, id, options) {
        if (snapshot.busy) return; snapshot.busy = true;
        const root = document.getElementById(`tab-${snapshot.mode}`), status = root.querySelector(".manager-status"); const controls = [...root.querySelectorAll("button,input,textarea")].map(n => [n, n.disabled]); controls.forEach(([n]) => { n.disabled = true; });
        try { const data = await api(snapshot, { action, id, options }); snapshot.notice = (data.result?.embeds || []).map(e => [e.title, e.description, e.footer?.text].filter(Boolean).join("\n")).join("\n\n") || "Changes saved."; snapshot.current.needsRefresh = true; await load(snapshot); }
        catch (error) { if (state === snapshot) { status.textContent = error.message; status.classList.add("error"); controls.forEach(([n, disabled]) => { n.disabled = disabled; }); } }
        finally { snapshot.busy = false; }
    }
    function confirmDelete(root, item, run) {
        root.querySelector(".manager-delete")?.remove(); const panel = el("section", null, "manager-delete"); panel.append(el("strong", `Delete ${item.name}?`), el("p", "This cannot be undone. Type the name to confirm.", "small"));
        const input = field(panel, "Name"), remove = button("Delete permanently", run, "danger"); remove.disabled = true; input.addEventListener("input", () => { remove.disabled = input.value !== item.name; }); panel.append(remove, button("Cancel", () => panel.remove())); root.append(panel); input.focus();
    }
    function members(root, role, snapshot) {
        const search = el("input"), list = el("div"), note = el("p", "Search by username or Discord user ID.", "small"); search.type = "search"; search.placeholder = "Find a member"; search.setAttribute("aria-label", "Find a member to assign this role");
        const find = button("Search members", async () => {
            if (!search.value.trim()) return; find.disabled = true;
            try { const data = await api(snapshot, null, "&query=" + encodeURIComponent(search.value.trim())); if (state !== snapshot) return; list.replaceChildren();
                for (const member of data.members) { const row = el("div", null, "manager-member"), assigned = member.roles.includes(role.id), action = button(assigned ? "Remove role" : "Add role", () => void mutate(snapshot, assigned ? "role-remove" : "role-assign", role.id, { member: member.id })); action.disabled = !role.editable || !member.editable; row.append(el("span", `${member.name} (@${member.username})`), el("small", member.id), action); list.append(row); }
                note.textContent = data.members.length ? `${data.members.length} matches. Role changes respect Discord's hierarchy.` : "No matching members.";
            } catch (error) { note.textContent = error.message; } finally { find.disabled = false; }
        });
        search.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); find.click(); } }); root.append(el("h3", "Members"), search, find, note, list);
    }
    const hex = value => "#" + Number(value).toString(16).padStart(6, "0");
    function colorPicker(root, title, initial, change) {
        let value = hex(initial), h = 0, s = 0, v = 0;
        const wrap = el("details", null, "role-color-picker"), summary = el("summary"), dot = el("i"), code = el("code", value), panel = el("div", null, "role-picker-panel"), plane = el("div", null, "role-color-plane"), marker = el("i"), input = field(panel, "Hex color", value), sliders = [];
        summary.append(dot, el("span", title), code); plane.setAttribute("aria-hidden", "true"); plane.append(marker); panel.prepend(plane); input.pattern = "#[a-fA-F0-9]{6}"; input.maxLength = 7; input.required = true; input.autocomplete = "off"; input.spellcheck = false;
        const toHex = () => { const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, rgb = [[c,x,0],[x,c,0],[0,c,x],[0,x,c],[x,0,c],[c,0,x]][Math.floor(h / 60) % 6]; return "#" + rgb.map(n => Math.round((n + m) * 255).toString(16).padStart(2, "0")).join(""); };
        const paint = () => { code.textContent = value; dot.style.backgroundColor = value; plane.style.setProperty("--role-hue", h); marker.style.left = `${s * 100}%`; marker.style.top = `${(1 - v) * 100}%`; [h, s * 100, v * 100].forEach((n, i) => { sliders[i].value = Math.round(n); sliders[i].nextElementSibling.textContent = Math.round(n) + (i ? "%" : "°"); }); };
        const fromHex = next => { value = next.toLowerCase(); const rgb = [1,3,5].map(i => parseInt(value.slice(i, i + 2), 16) / 255), max = Math.max(...rgb), min = Math.min(...rgb), d = max - min; if (d) h = ((rgb.indexOf(max) === 0 ? (rgb[1] - rgb[2]) / d : rgb.indexOf(max) === 1 ? (rgb[2] - rgb[0]) / d + 2 : (rgb[0] - rgb[1]) / d + 4) * 60 + 360) % 360; s = max ? d / max : 0; v = max; };
        const update = () => { value = toHex(); input.value = value; paint(); change(); };
        for (const [i, label] of ["Hue", "Saturation", "Brightness"].entries()) { const row = el("label", null, "role-color-slider"), range = el("input"), output = el("output"); range.type = "range"; range.min = 0; range.max = i ? 100 : 360; range.step = 1; range.setAttribute("aria-label", title + " " + label.toLowerCase()); range.addEventListener("input", () => { if (!i) h = Number(range.value); else if (i === 1) s = Number(range.value) / 100; else v = Number(range.value) / 100; update(); }); sliders.push(range); row.append(el("span", label), range, output); panel.append(row); }
        const point = event => { const r = plane.getBoundingClientRect(); s = Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)); v = Math.max(0, Math.min(1, 1 - (event.clientY - r.top) / r.height)); update(); };
        plane.addEventListener("pointerdown", event => { if (wrap.closest("fieldset:disabled")) return; event.preventDefault(); plane.setPointerCapture(event.pointerId); point(event); }); plane.addEventListener("pointermove", event => { if (plane.hasPointerCapture(event.pointerId) && event.buttons) point(event); });
        input.addEventListener("input", () => { if (/^#[a-fA-F0-9]{6}$/.test(input.value)) { fromHex(input.value); paint(); change(); } });
        const swatches = el("div", null, "role-color-swatches"); swatches.setAttribute("role", "group"); swatches.setAttribute("aria-label", title + " presets");
        for (const next of ["#ffad91", "#ed4245", "#f1c40f", "#57f287", "#1abc9c", "#3498db", "#5865f2", "#9b59b6", "#eb459e", "#ffffff", "#99aab5", "#000000"]) { const n = button("", () => { fromHex(next); input.value = value; paint(); change(); }, "role-color-swatch"); n.style.backgroundColor = next; n.title = next === "#000000" ? "Default role color" : next; n.setAttribute("aria-label", title + " " + n.title); swatches.append(n); }
        panel.append(swatches); wrap.append(summary, panel); root.append(wrap); fromHex(value); paint(); return { get value() { return parseInt(value.slice(1), 16); }, element: wrap };
    }
    function roleAppearance(root, role, snapshot, name) {
        const enabled = snapshot.data.roleAppearance || {}, original = role?.colors || { primary_color: role?.color || 0, secondary_color: null, tertiary_color: null }, block = el("section", null, "role-appearance"), preview = el("div", null, "role-preview"), icon = el("span", null, "role-preview-icon"), previewName = el("span", null, "role-preview-name");
        let iconValue, revision = 0, loading = false;
        const originalIcon = /^[a-f0-9]{32}$/i.test(role?.icon || "") ? `https://cdn.discordapp.com/role-icons/${role.id}/${role.icon}.png?size=64` : "";
        const drawIcon = () => { icon.replaceChildren(); const source = iconValue === undefined ? originalIcon : iconValue; if (source) { const image = el("img"); image.src = source; image.alt = "Role icon"; icon.append(image); } else if (iconValue === undefined && role?.unicode_emoji) icon.textContent = role.unicode_emoji; else { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"), path = document.createElementNS(svg.namespaceURI, "path"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); path.setAttribute("d", "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"); path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.5"); svg.append(path); icon.append(svg); } };
        preview.append(icon, previewName); block.append(el("h4", "Appearance"), preview); root.append(block);
        const colors = () => mode.value === "holographic" ? { primary_color: 11127295, secondary_color: 16759788, tertiary_color: 16761760 } : { primary_color: primary.value, secondary_color: mode.value === "gradient" ? secondary.value : null, tertiary_color: null };
        const draw = () => { const c = colors(); preview.dataset.style = mode.value; previewName.textContent = name.value.trim() || "New role"; previewName.style.color = mode.value === "solid" ? hex(c.primary_color || 0xc6c6cf) : "transparent"; previewName.style.backgroundImage = mode.value === "solid" ? "none" : `linear-gradient(110deg,${[c.primary_color, c.secondary_color, c.tertiary_color].filter(n => n !== null).map(hex).join(",")})`; colorFields.hidden = mode.value === "holographic"; colorFields.disabled = mode.value === "holographic"; secondary.element.hidden = mode.value !== "gradient"; secondary.element.querySelectorAll("input,button").forEach(n => { n.disabled = mode.value !== "gradient"; }); preset.hidden = mode.value !== "holographic"; };
        const mode = choose(block, "Color style", original.tertiary_color != null ? "holographic" : original.secondary_color != null ? "gradient" : "solid", [{ value: "solid", label: "Solid" }, { value: "gradient", label: "Gradient", disabled: !enabled.enhancedColors }, { value: "holographic", label: "Holographic", disabled: !enabled.enhancedColors }], draw), colorFields = el("fieldset", null, "role-color-fields"), primary = colorPicker(colorFields, "Primary color", original.primary_color, draw), secondary = colorPicker(colorFields, "Secondary color", original.secondary_color ?? 0x5865f2, draw), preset = el("p", "Holographic uses Discord's fixed blue, pink and peach colors.", "small"); block.append(colorFields, preset);
        if (!enabled.enhancedColors) block.append(el("p", "Gradient and holographic colors need Discord's Enhanced Role Styles perk on this server.", "small"));
        const uploads = el("div", null, "role-icon-tools"), file = el("input"), note = el("p", enabled.icons ? "PNG, JPEG or WebP, up to 256 KiB. A square image works best." : "Role icons are not unlocked for this server.", "small"); note.setAttribute("role", "status"); file.type = "file"; file.accept = "image/png,image/jpeg,image/webp"; file.hidden = true; file.setAttribute("aria-label", "Upload role icon");
        const upload = button("Upload role icon", () => file.click()), remove = button("Remove icon", () => { revision++; iconValue = null; loading = false; drawIcon(); file.value = ""; note.textContent = "Icon will be removed when you save."; }); upload.disabled = !enabled.icons;
        file.addEventListener("change", async () => { const selected = file.files[0]; if (!selected) return; const current = ++revision; loading = false; if (!["image/png", "image/jpeg", "image/webp"].includes(selected.type) || selected.size > 256 * 1024) { note.textContent = "Choose a PNG, JPEG or WebP up to 256 KiB."; file.value = ""; return; } loading = true; note.textContent = "Loading icon…";
            try { const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error("This file could not be read.")); reader.readAsDataURL(selected); }); if (revision !== current) return; iconValue = data; drawIcon(); note.textContent = "Icon ready. Save the role to apply it."; } catch (error) { if (revision === current) note.textContent = error.message; } finally { if (revision === current) loading = false; }
        });
        uploads.append(upload, remove, file); block.append(el("span", "Role icon"), uploads, note); name.addEventListener("input", draw); drawIcon(); draw(); return { get colors() { return colors(); }, get icon() { return iconValue; }, get ready() { return !loading; } };
    }
    function copyRole(root, role) {
        const row = el("div", null, "role-copy-tools"); row.append(el("code", role.id));
        for (const [label, text] of [["Copy role ID", role.id], ["Copy role mention", `<@&${role.id}>`]]) row.append(button(label, async event => { const n = event.currentTarget; try { await navigator.clipboard.writeText(text); n.textContent = "Copied"; setTimeout(() => { n.textContent = label; }, 1600); } catch { n.textContent = "Copy unavailable. Select the role ID above."; } })); root.append(row);
    }
    function roleEditor(root, role, snapshot) {
        const creating = !role, everyone = role?.id === snapshot.id; root.append(el("h3", creating ? "Create role" : role.name)); if (role) copyRole(root, role); if (role?.lockedReason) root.append(el("p", role.lockedReason, "manager-lock"));
        const form = el("form"), fields = el("fieldset"); fields.disabled = !creating && !role.editable;
        const name = field(fields, "Role name", role?.name || ""); name.maxLength = 100; name.required = true; name.disabled = everyone;
        const appearance = everyone ? null : roleAppearance(fields, role, snapshot, name), hoist = toggle(fields, "Display members separately", !!role?.hoist), mentionable = toggle(fields, "Allow this role to be mentioned", !!role?.mentionable), mask = permissions(fields, snapshot.data.permissions, role?.permissions || "0"), save = el("button", creating ? "Create role" : "Save role", "primary"); save.type = "submit"; fields.append(save); form.append(fields); root.append(form);
        form.addEventListener("submit", event => { event.preventDefault(); if (appearance && !appearance.ready) { root.querySelector('[role="status"]').textContent = "Wait for the icon to finish loading."; return; } void mutate(snapshot, creating ? "role-create" : "role-update", role?.id, { name: name.value, ...(appearance ? { colors: appearance.colors, ...(appearance.icon !== undefined ? { icon: appearance.icon } : {}) } : {}), hoist: hoist.value, mentionable: mentionable.value, permissions: mask.allow }); });
        if (role && !everyone) { members(root, role, snapshot); const remove = button("Delete role", () => confirmDelete(root, role, () => void mutate(snapshot, "role-delete", role.id, { confirm: role.id })), "danger"); remove.disabled = !role.editable; root.append(remove); }
    }
    function overwrites(root, channel, snapshot) {
        const details = el("details", null, "manager-overwrites"), targetArea = el("div"), editor = el("div"); details.append(el("summary", "Channel permissions")); root.append(details); let kind = 0;
        const show = id => { editor.replaceChildren(); const old = channel.permission_overwrites?.find(o => o.id === id && o.type === kind), mask = permissions(editor, snapshot.data.permissions, old?.allow || "0", old?.deny || "0"); editor.append(button("Save channel permissions", () => void mutate(snapshot, "channel-permissions", channel.id, { type: kind, target: id, allow: mask.allow, deny: mask.deny }), "primary"), button("Remove overwrite", () => void mutate(snapshot, "channel-inherit", channel.id, { type: kind, target: id }))); };
        const draw = () => { targetArea.replaceChildren(); editor.replaceChildren(); if (kind === 0) { const target = choose(targetArea, "Role", snapshot.id, snapshot.data.roles.map(role => ({ value: role.id, label: role.name })), show); show(target.value); } else { const input = field(targetArea, "Member Discord ID"); targetArea.append(button("Load permissions", () => { if (/^\d{17,20}$/.test(input.value)) show(input.value); })); } };
        choose(details, "Apply permissions to", 0, [{ value: 0, label: "Role" }, { value: 1, label: "Member" }], value => { kind = Number(value); draw(); }); details.append(targetArea, editor); draw();
    }
    function channelEditor(root, channel, snapshot) {
        const creating = !channel; root.append(el("h3", creating ? "Create channel or category" : channel.name)); if (channel && !channel.editable) root.append(el("p", "You and Sonata need Manage Channels in this channel.", "manager-lock"));
        const form = el("form"), fields = el("fieldset"); fields.disabled = !creating && !channel.editable; const name = field(fields, "Name", channel?.name || ""); name.maxLength = 100; name.required = true;
        const type = choose(fields, "Type", channel?.type ?? 0, snapshot.data.channelTypes, () => update()); if (channel) type.element.inert = true;
        const parentWrap = el("div"), parent = choose(parentWrap, "Category", channel?.parent_id || "", [{ value: "", label: "No category" }, ...snapshot.data.channels.filter(c => c.type === 4).map(c => ({ value: c.id, label: c.name }))]); fields.append(parentWrap);
        const textFields = el("div", null, "manager-fields"), topic = field(textFields, "Topic", channel?.topic || "", "textarea"), nsfw = toggle(textFields, "Age-restricted channel", !!channel?.nsfw), slowmode = field(textFields, "Slowmode in seconds (0 to 21600)", channel?.rate_limit_per_user ?? 0), voiceFields = el("div", null, "manager-fields"), limit = field(voiceFields, "Voice user limit (0 for unlimited)", channel?.user_limit ?? 0); topic.maxLength = 4096; slowmode.inputMode = "numeric"; limit.inputMode = "numeric"; fields.append(textFields, voiceFields);
        function update() { textFields.hidden = ![0, 5, 15, 16].includes(Number(type.value)); voiceFields.hidden = ![2, 13].includes(Number(type.value)); parentWrap.hidden = Number(type.value) === 4; } update();
        const save = el("button", creating ? "Create channel" : "Save channel", "primary"); save.type = "submit"; fields.append(save); form.append(fields); root.append(form);
        form.addEventListener("submit", event => { event.preventDefault(); void mutate(snapshot, creating ? "channel-create" : "channel-update", channel?.id, { name: name.value, type: Number(type.value), parent: parent.value || null, topic: topic.value, nsfw: nsfw.value, slowmode: Number(slowmode.value), userLimit: Number(limit.value) }); });
        if (channel) { if (channel.permissionsEditable) overwrites(root, channel, snapshot); if (channel.type === 4) root.append(el("p", "Deleting this category keeps its channels.", "small")); const remove = button(channel.type === 4 ? "Delete category" : "Delete channel", () => confirmDelete(root, channel, () => void mutate(snapshot, "channel-delete", channel.id, { confirm: channel.id })), "danger"); remove.disabled = !channel.editable; root.append(remove); }
    }
    function render(mode) {
        const snapshot = state, root = document.getElementById(`tab-${mode}`); if (!snapshot || !root || !["roles", "channels"].includes(mode)) return; snapshot.mode = mode;
        const header = el("header", null, "manager-heading"), status = el("p", snapshot.notice || "", "manager-status"); status.setAttribute("role", "status"); header.append(el("h2", mode === "roles" ? "Roles" : "Channels & categories"), button("Refresh", () => void load(snapshot).catch(e => { status.textContent = e.message; }))); root.replaceChildren(header, status); if (!snapshot.data) { status.textContent = "Loading…"; return; }
        const layout = el("div", null, "manager-layout"), side = el("aside", null, "manager-side"), search = el("input"), list = el("div", null, "manager-list"), editor = el("article", null, "manager-editor"); search.type = "search"; search.placeholder = mode === "roles" ? "Search roles" : "Search channels or categories"; search.setAttribute("aria-label", search.placeholder);
        const renderEditor = item => { editor.replaceChildren(); (mode === "roles" ? roleEditor : channelEditor)(editor, item, snapshot); }, create = button(mode === "roles" ? "Create role" : "Create channel or category", () => { snapshot.picked = null; renderEditor(null); draw(); }); create.disabled = !(mode === "roles" ? snapshot.data.canCreateRoles : snapshot.data.canCreateChannels); side.append(search, create, list); layout.append(side, editor); root.append(layout);
        const values = mode === "roles" ? snapshot.data.roles : [...snapshot.data.channels].sort((a, b) => (a.parent_id || a.id).localeCompare(b.parent_id || b.id) || a.position - b.position);
        const pick = item => { snapshot.picked = item.id; renderEditor(item); draw(); };
        const draw = () => { list.replaceChildren(); for (const item of values.filter(item => `${item.name} ${item.id}`.toLowerCase().includes(search.value.toLowerCase()))) { const row = button("", () => pick(item), "manager-list-row"), mark = el("i", mode === "channels" ? item.type === 4 ? "›" : [2, 13].includes(item.type) ? "◦" : "#" : "", "manager-role-dot"), text = el("span", item.name); row.setAttribute("aria-pressed", String(snapshot.picked === item.id)); if (mode === "roles") mark.style.backgroundColor = "#" + Number((item.colors?.primary_color ?? item.color) || 0x888888).toString(16).padStart(6, "0"); text.append(el("small", mode === "roles" ? item.managed ? "Application role" : item.lockedReason || item.id : snapshot.data.channelTypes.find(t => t.value === item.type)?.label || "Channel")); row.append(mark, text); list.append(row); } if (!list.children.length) list.append(el("p", "No matches.", "small")); };
        search.addEventListener("input", draw); draw(); const initial = values.find(item => item.id === snapshot.picked) || values[0]; if (initial) pick(initial); else editor.append(el("p", "Create an item to get started.", "small"));
    }
    function open(mode) { if (!state?.current.manageable || !["roles", "channels"].includes(mode)) return; state.mode = mode; render(mode); if (!state.data) { const snapshot = state; void load(snapshot).catch(error => { if (state === snapshot) document.querySelector(`#tab-${mode} .manager-status`).textContent = error.message; }); } }
    document.addEventListener("sonata-server", event => { const { current, session, selected } = event.detail; state = { current, session, id: selected }; open(document.querySelector('[data-tab][aria-selected="true"]')?.dataset.tab); });
    document.addEventListener("sonata-dashboard-tab", event => open(event.detail));
})();
