/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Person Tags: coloured tags only you can see — "School", "Trading", "Be
// careful" — next to people's names in chat, the member list and your DMs.
// Tag anyone from their right-click menu, and show only the DMs with a tag.

import "./styles.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { currentNotice, popNotice, showNotice } from "@api/Notices";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { Menu, showToast } from "@webpack/common";

import { defineFeatureSettings } from "../../featureSettings";
import { TagChip } from "./LookPicker";
import { openNewTag, openTagManager } from "./Manager";
import { allTags, connect, setTagged, Tag, tagById, tagsOf, useTags } from "./store";

const settings = defineFeatureSettings("personTags", {
    inChat: { type: OptionType.BOOLEAN, description: "Show tags next to names in chat", default: true },
    inLists: { type: OptionType.BOOLEAN, description: "Show tags in the member list and your DM list", default: true },
    manage: { type: OptionType.COMPONENT, description: "", component: () => <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => openTagManager()}>Manage tags</button> },
    tagsJson: { type: OptionType.STRING, description: "Internal: your tags and who has them.", default: "", hidden: true },
});

/* ── The little chips ── */

function Chips({ userId, max, where, visible = true }: { userId: string; max: number; where: "chat" | "list"; visible?: boolean; }) {
    useTags();
    const tags = tagsOf(userId);
    if (!tags.length) return null;
    const shown = visible ? tags.slice(0, max) : [];
    return (
        <span className={`vc-ptag-chips vc-ptag-in-${where}`} hidden={!visible}>
            {/* Marks for "show only DMs tagged …" to find. */}
            {tags.map(t => <i key={`m-${t.id}`} className={`vc-ptag-m-${t.id}`} hidden />)}
            {shown.map(t => <TagChip key={t.id} look={t} name={t.name} title={`Your tag: ${t.name}`} />)}
            {visible && tags.length > max && <span className="vc-ptag vc-ptag-more" title={tags.slice(max).map(t => t.name).join(", ")}>+{tags.length - max}</span>}
        </span>
    );
}
const SafeChips = ErrorBoundary.wrap(Chips, { noop: true });

/* ── Show only DMs with a tag ── */

let filterStyle: HTMLStyleElement | null = null;
let filterNotice = "";

function filterDms(tag: Tag | null) {
    filterStyle?.remove();
    filterStyle = null;
    if (filterNotice && currentNotice?.[1] === filterNotice) popNotice();
    filterNotice = "";
    if (!tag) return;
    filterStyle = document.createElement("style");
    filterStyle.id = "vc-ptag-filter";
    // Every DM with a person (not Friends, Nitro or Shop) that doesn't carry the tag's mark.
    filterStyle.textContent = `[class*="privateChannels"] li:has(a[href^="/channels/@me/"]):not(:has(.vc-ptag-m-${tag.id})) { display: none !important; }`;
    document.head.appendChild(filterStyle);
    filterNotice = `Showing only DMs tagged “${tag.name}”`;
    showNotice(filterNotice, "Show all DMs", () => filterDms(null));
}
const filteringBy = () => filterStyle?.textContent?.match(/vc-ptag-m-(\w+)/)?.[1] ?? null;

/* ── Right-click menu ── */

const userMenu: NavContextMenuPatchCallback = (children, { user }: any) => {
    if (!user?.id) return;
    const name = user.globalName ?? user.username;
    const mine = new Set(tagsOf(user.id).map(t => t.id));
    const tags = allTags();
    const filter = filteringBy();
    children.push(
        <Menu.MenuItem id="vc-ptag" label="Tags">
            {tags.map(t => (
                <Menu.MenuCheckboxItem key={t.id} id={`vc-ptag-${t.id}`} label={t.name} checked={mine.has(t.id)}
                    action={() => setTagged(user.id, t.id, !mine.has(t.id), name)} />
            ))}
            {tags.length > 0 && <Menu.MenuSeparator />}
            <Menu.MenuItem id="vc-ptag-new" label="New tag…" action={() => openNewTag(tag => { setTagged(user.id, tag.id, true, name); showToast(`Tagged ${name}: ${tag.name}`, "success"); })} />
            {tags.length > 0 && (
                <Menu.MenuItem id="vc-ptag-only" label="Show only DMs tagged">
                    {tags.map(t => <Menu.MenuRadioItem key={t.id} id={`vc-ptag-only-${t.id}`} group="vc-ptag-only" label={t.name} checked={filter === t.id} action={() => filterDms(t)} />)}
                    <Menu.MenuRadioItem id="vc-ptag-only-all" group="vc-ptag-only" label="Everyone" checked={!filter} action={() => filterDms(null)} />
                </Menu.MenuItem>
            )}
            <Menu.MenuItem id="vc-ptag-manage" label="Manage tags…" action={() => openTagManager()} />
        </Menu.MenuItem>
    );
};

export default definePlugin({
    name: "PersonTags",
    description: "Coloured tags only you can see — like “School”, “Trading” or “Be careful” — next to people's names in chat, the member list and your DMs. Tag anyone from their right-click menu, and show only the DMs with a certain tag.",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    contextMenus: { "user-context": userMenu },

    renderMessageDecoration: ({ message }: any) => settings.store.inChat !== false && message?.author?.id ? <SafeChips userId={message.author.id} max={2} where="chat" /> : null,
    // Always there in lists (if only as hidden marks), so "Show only DMs tagged" works with chips switched off.
    renderMemberListDecorator: ({ user }: any) => user?.id ? <SafeChips userId={user.id} max={1} where="list" visible={settings.store.inLists !== false} /> : null,

    start() {
        connect(() => settings.store.tagsJson ?? "", raw => { settings.store.tagsJson = raw; });
        // A tag deleted elsewhere can't stay as the DM filter.
        const f = filteringBy();
        if (f && !tagById(f)) filterDms(null);
    },

    stop() {
        filterDms(null);
    },
});
