/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const profileElement = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };

async function profileEditor(root, guild, csrf, owner = false, canReset = false) {
    const path = owner ? "/api/admin/bot/profile" : "/api/bot/profile";
    root.replaceChildren(profileElement("h2", owner ? "Server bot profile" : "Bot profile"));
    const message = profileElement("p", "Loading profile…", "small"); message.setAttribute("role", "status"); root.append(message);
    const request = async input => {
        const response = await fetch(input ? path : `${path}?guild=${guild}`, { method: input ? "POST" : "GET", credentials: "same-origin", headers: input ? { "Content-Type": "application/json", "X-CSRF-Token": csrf } : {}, body: input ? JSON.stringify({ guild, ...input }) : undefined });
        const result = await response.json(); if (!response.ok) throw Error(result.error || "The profile could not be loaded."); return result.profile;
    };
    let profile;
    try { profile = await request(); } catch (error) { message.textContent = error.message; return; }
    message.textContent = "";
    const card = profileElement("article", null, "profile-preview"), banner = profileElement("img", null, "profile-banner"), content = profileElement("div", null, "profile-card-body"), avatar = profileElement("img", null, "profile-avatar"), name = profileElement("h3"), bio = profileElement("p", null, "profile-bio");
    banner.alt = "Bot banner"; avatar.alt = "Bot avatar"; content.append(avatar, name, bio); card.append(banner, content);
    const draw = (value = profile) => { avatar.src = value.avatar; banner.hidden = !value.banner; if (value.banner) banner.src = value.banner; name.textContent = value.name; bio.textContent = value.bio; };
    draw(); root.append(profileElement("p", "This profile applies only to this server.", "small"), card);
    if (owner) {
        root.append(profileElement("p", `Server ${guild}${profile.updatedBy ? ` · Last changed by ${profile.updatedBy}` : ""}`, "small"));
        if (canReset) {
            const reset = profileElement("button", "Reset server profile", "primary"), cancel = profileElement("button", "Cancel", "quiet"), actions = profileElement("div", null, "record-actions"); let confirming = false;
            reset.type = cancel.type = "button"; cancel.hidden = true; actions.append(reset, cancel); root.append(actions);
            cancel.addEventListener("click", () => { confirming = false; cancel.hidden = true; reset.textContent = "Reset server profile"; message.textContent = ""; });
            reset.addEventListener("click", async () => {
                if (!confirming) { confirming = true; cancel.hidden = false; reset.textContent = "Confirm reset"; message.textContent = "This resets this server's nickname, avatar, banner and bio to Sonata's defaults."; return; }
                reset.disabled = true; cancel.hidden = true; message.textContent = "Resetting…";
                try { profile = await request({ action: "reset" }); draw(); message.textContent = "Server profile reset. The required help and dashboard links are kept."; }
                catch (error) { message.textContent = error.message; }
                finally { reset.disabled = false; confirming = false; reset.textContent = "Reset server profile"; }
            });
        }
        root.append(message); return;
    }
    if (!profile.editable) { root.append(profileElement("p", "Manage Server is required to change this profile.", "small")); return; }
    const form = profileElement("form", null, "profile-form");
    const field = (label, type = "input") => { const holder = profileElement("label", label), control = profileElement(type); holder.append(control); form.append(holder); return control; };
    const nickname = field("Nickname"); nickname.maxLength = 32; nickname.value = profile.nickname; nickname.placeholder = "Sonata";
    const customBio = field("Bio", "textarea"); customBio.rows = 3; customBio.maxLength = 100; customBio.value = profile.customBio;
    form.append(profileElement("p", "The dashboard link, /help and this server's prefix help command are always included.", "small"));
    const changes = {}, defaults = {}; let pending = 0;
    for (const key of ["avatar", "banner"]) {
        const upload = field(key === "avatar" ? "Avatar image" : "Banner image"); upload.type = "file"; upload.accept = "image/png,image/jpeg,image/gif";
        const clear = field(`Use Sonata's default ${key}`); clear.type = "checkbox"; defaults[key] = clear;
        clear.addEventListener("change", () => { upload.disabled = clear.checked; if (clear.checked) { delete changes[key]; upload.value = ""; } drawPreview(); });
        upload.addEventListener("change", async () => {
            const file = upload.files[0]; if (!file) { delete changes[key]; drawPreview(); return; }
            if (file.size > 1024 * 1024 || !["image/png", "image/jpeg", "image/gif"].includes(file.type)) { upload.value = ""; delete changes[key]; message.textContent = "Choose a PNG, JPEG or GIF image no larger than 1 MB."; return; }
            try {
                pending++; save.disabled = true;
                const value = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(Error("The image could not be read.")); reader.readAsDataURL(file); });
                if (upload.files[0] !== file || clear.checked) return;
                changes[key] = value;
                message.textContent = ""; drawPreview();
            } catch (error) { message.textContent = error.message; }
            finally { pending--; save.disabled = pending > 0; }
        });
    }
    const footer = `Commands: \`/help\` • \`${profile.prefix}help\`\nDashboard: https://sonatabot.info`;
    function drawPreview() {
        const text = customBio.value.trim();
        draw({ ...profile, name: nickname.value.trim() || profile.defaultName, bio: `${text}${text ? "\n\n" : ""}${footer}`, avatar: defaults.avatar.checked ? profile.defaultAvatar : changes.avatar || profile.avatar, banner: defaults.banner.checked ? profile.defaultBanner : changes.banner || profile.banner });
    }
    nickname.addEventListener("input", drawPreview); customBio.addEventListener("input", drawPreview);
    const save = profileElement("button", "Save server profile", "primary"); save.type = "submit"; form.append(save); root.append(form, message);
    form.addEventListener("submit", async event => {
        event.preventDefault(); if (pending || !form.reportValidity()) return;
        save.disabled = true; message.textContent = "Saving…";
        const input = { nickname: nickname.value, bio: customBio.value, ...changes };
        for (const key of ["avatar", "banner"]) if (defaults[key].checked) input[key] = null;
        try { profile = await request(input); draw(); message.textContent = "Server profile saved."; for (const key of Object.keys(changes)) delete changes[key]; for (const clear of Object.values(defaults)) clear.checked = false; for (const upload of form.querySelectorAll('input[type="file"]')) { upload.value = ""; upload.disabled = false; } }
        catch (error) { message.textContent = error.message; }
        finally { save.disabled = false; }
    });
}

document.addEventListener("sonata-server", event => {
    document.getElementById("profile-editor")?.remove();
    const { current, selected, session } = event.detail; if (!current.manageable) return;
    const root = document.getElementById("tab-configure"), sidebar = root.querySelector(".tool-sidebar"), layout = root.querySelector(".settings-layout"), editor = root.querySelector(".settings-editor"), extras = document.getElementById("dashboard-extra"), nav = document.getElementById("dashboard-extra-nav");
    const holder = profileElement("section", null, "panel padded settings-editor"); holder.id = "profile-editor"; holder.hidden = true; layout.append(holder);
    const button = profileElement("button", "Bot profile", "quiet profile-nav"); button.type = "button"; nav.append(button);
    button.addEventListener("click", () => { holder.hidden = false; editor.hidden = true; extras.hidden = true; void profileEditor(holder, selected, session.csrf); });
});

document.addEventListener("click", event => { if (event.target.closest(".tool-sidebar") && !event.target.closest(".profile-nav")) { const holder = document.getElementById("profile-editor"); if (holder) holder.hidden = true; } });

document.addEventListener("sonata-owner-profile", event => {
    document.getElementById("owner-profile-dialog")?.remove();
    const { guild, csrf, canReset } = event.detail, dialog = profileElement("dialog", null, "profile-dialog"), close = profileElement("button", "Close", "quiet"), content = profileElement("div"); dialog.id = "owner-profile-dialog"; close.type = "button"; close.addEventListener("click", () => dialog.close()); dialog.append(close, content); document.body.append(dialog); dialog.showModal(); void profileEditor(content, guild, csrf, true, canReset);
});
