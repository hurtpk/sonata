/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classes } from "@utils/misc";
import { Select, Tooltip, useCallback, useEffect, useMemo, useState } from "@webpack/common";

import { ColorPicker } from "../features/_shared/ColorPicker";
import { addDockMutationListener, getDockItems, PINNED_DOCK_ID, refreshDock, removeDockMutationListener } from "./dock";
import { dockColorOf, dockLayoutOf, dockSizeOf } from "./dockColor";
import { DEFAULT_DOCK_ICON_KEY, DOCK_ICON_GROUPS, DOCK_ICON_LIBRARY, DOCK_ICON_MAP } from "./icons";
import {
    cl,
    customDockId,
    customDockPluginName,
    dockLabel,
    getDockCandidates,
    isCustomDockId,
    parseStringArray,
    parseStringMap,
    registerCustomDockButton,
    unregisterCustomDockButton,
} from "./shared";

interface DockSettings {
    dockOrder: string;
    dockHidden: string;
    customDock: string;
    /** Icons you picked for built-in buttons: dock ID → icon key. */
    dockIcons: string;
    /** The buttons' colour: "" (Discord's), "accent", or a hex code. */
    dockColor?: string;
    /** "stack" (rows) or "line" (one line). */
    dockLayout?: string;
    /** "small", "normal" or "large". */
    dockSize?: string;
}

const DOCK_SWATCHES = ["#ffffff", "#b5bac1", "#5b8cff", "#a855f7", "#ff6fae", "#ff5c6c", "#ffb020", "#3ddc84", "#22d3ee"];

function LookChoice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(v: T): void; }) {
    return (
        <div className={cl("dock-look-seg")} role="radiogroup">
            {options.map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={value === id} className={classes(cl("dock-color-chip"), value === id && cl("dock-color-on"))} onClick={() => onChange(id)}>{label}</button>
            ))}
        </div>
    );
}

/** How the dock looks: one colour for every button, rows or one line, and the buttons' size. */
function DockLook({ settings }: { settings: DockSettings; }) {
    const v = dockColorOf(settings);
    const custom = v && v !== "accent" && !DOCK_SWATCHES.includes(v) ? v : null;
    const set = (c: string) => { settings.dockColor = c; };
    return (
        <div className={cl("dock-look")}>
            <div className={cl("dock-color")}>
                <div className={cl("dock-color-text")}>
                    <b>Icon colour</b>
                    <span>All the buttons at once. A Theme Studio theme can set one too; this wins when it's set.</span>
                </div>
                <div className={cl("dock-color-pick")}>
                    <button type="button" className={classes(cl("dock-color-chip"), !v && cl("dock-color-on"))} onClick={() => set("")}>Discord's</button>
                    <button type="button" className={classes(cl("dock-color-chip"), v === "accent" && cl("dock-color-on"))} onClick={() => set("accent")}>Accent</button>
                    {DOCK_SWATCHES.map(c => (
                        <button key={c} type="button" title={c} aria-label={`Colour ${c}`} className={classes(cl("dock-color-dot"), v === c && cl("dock-color-on"))}
                            style={{ "--dc": c } as React.CSSProperties} onClick={() => set(c)} />
                    ))}
                    <ColorPicker className={classes(cl("dock-color-dot"), cl("dock-color-any"), custom && cl("dock-color-on"))} label="Any colour"
                        value={custom ?? (v && v !== "accent" ? v : "#5b8cff")} onChange={set}>+</ColorPicker>
                </div>
            </div>
            <div className={cl("dock-color")}>
                <div className={cl("dock-color-text")}>
                    <b>Layout</b>
                    <span>Stack wraps the buttons onto more rows when they don't fit. One line squeezes them all into a single row.</span>
                </div>
                <LookChoice value={dockLayoutOf(settings)} options={[["stack", "Stack"], ["line", "One line"]]} onChange={l => { settings.dockLayout = l; }} />
            </div>
            <div className={cl("dock-color")}>
                <div className={cl("dock-color-text")}>
                    <b>Size</b>
                    <span>How big the buttons and their icons are.</span>
                </div>
                <LookChoice value={dockSizeOf(settings)} options={[["small", "Small"], ["normal", "Normal"], ["large", "Large"]]} onChange={s => { settings.dockSize = s; }} />
            </div>
        </div>
    );
}

/** One icon, bigger, with its name — what's picked right now. */
function IconPreview({ iconKey }: { iconKey: string; }) {
    const def = DOCK_ICON_MAP[iconKey];
    if (!def) return <span className={cl("dock-ip-none")}>Pick an icon</span>;
    const { Icon } = def;
    return (
        <span className={cl("dock-ip-pick")}>
            <span className={cl("dock-ip-pick-icon")}><Icon width={22} height={22} /></span>
            <span><b>{def.label}</b><small>{def.group}</small></span>
        </span>
    );
}

/** Pick an icon: search and categories on the left, the icons on the right, and what's picked along the bottom. */
export function IconPicker({ selected, onSelect }: { selected: string; onSelect(key: string): void; }) {
    const [query, setQuery] = useState("");
    const [group, setGroup] = useState<string>(() => DOCK_ICON_MAP[selected]?.group ?? DOCK_ICON_GROUPS[0]);
    const q = query.trim().toLowerCase();
    const matches = (i: typeof DOCK_ICON_LIBRARY[number]) => !q || i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q) || i.group.toLowerCase().includes(q);
    const counts = useMemo(() => Object.fromEntries(DOCK_ICON_GROUPS.map(g => [g, DOCK_ICON_LIBRARY.filter(i => i.group === g && matches(i)).length])), [q]);
    // While searching, every category's matches show together.
    const shown = DOCK_ICON_LIBRARY.filter(i => matches(i) && (q ? true : i.group === group));
    return (
        <div className={cl("dock-ip")}>
            <div className={cl("dock-ip-side")}>
                <input className={cl("dock-ip-search")} value={query} placeholder={`Search ${DOCK_ICON_LIBRARY.length} icons`} aria-label="Search icons"
                    onChange={e => setQuery(e.currentTarget.value)} />
                <div className={cl("dock-ip-groups")} role="tablist">
                    {DOCK_ICON_GROUPS.map(g => (
                        <button key={g} type="button" role="tab" aria-selected={!q && g === group} disabled={!counts[g]}
                            className={classes(cl("dock-ip-group"), !q && g === group && cl("dock-ip-group-on"))}
                            onClick={() => { setGroup(g); setQuery(""); }}>
                            <span>{g}</span><small>{counts[g]}</small>
                        </button>
                    ))}
                </div>
            </div>
            <div className={cl("dock-ip-main")}>
                <div className={cl("dock-ip-head")}>{q ? `${shown.length} match${shown.length === 1 ? "" : "es"} for “${query.trim()}”` : group}</div>
                {shown.length ? (
                    <div className={cl("dock-ip-grid")}>
                        {shown.map(({ key, label, Icon }) => (
                            <button key={key} type="button" aria-label={label} title={label} aria-pressed={key === selected}
                                className={classes(cl("dock-ip-icon"), key === selected && cl("dock-ip-icon-on"))} onClick={() => onSelect(key)}>
                                <Icon width={20} height={20} />
                            </button>
                        ))}
                    </div>
                ) : <div className={cl("dock-ip-empty")}>No icons match “{query.trim()}”. Try a simpler word, like music, lock or star.</div>}
                <div className={cl("dock-ip-foot")}><IconPreview iconKey={selected} /></div>
            </div>
        </div>
    );
}

interface Editing {
    id: string;
    /** For buttons you added: the plugin (or Sonata feature) it opens. */
    plugin: string | null;
    icon: string;
}

export function DockTab({ settings }: { settings: DockSettings; }) {
    const [refreshTick, forceUpdate] = useState(0);
    const [dragId, setDragId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
    const [selectedIcon, setSelectedIcon] = useState(DEFAULT_DOCK_ICON_KEY);
    const [editing, setEditing] = useState<Editing | null>(null);

    useEffect(() => {
        const cb = () => forceUpdate(x => x + 1);
        addDockMutationListener(cb);
        return () => removeDockMutationListener(cb);
    }, []);

    const items = useMemo(() => {
        const raw = getDockItems();
        const order = parseStringArray(settings.dockOrder);
        const orderIndex = new Map(order.map((id, i) => [id, i]));
        return raw
            .map(([id, entry]) => ({ id, entry }))
            .sort((a, b) => {
                if (a.id === PINNED_DOCK_ID) return -1;
                if (b.id === PINNED_DOCK_ID) return 1;
                const ai = orderIndex.get(a.id);
                const bi = orderIndex.get(b.id);
                if (ai != null && bi != null) return ai - bi;
                if (ai != null) return -1;
                if (bi != null) return 1;
                return (a.entry.priority ?? 0) - (b.entry.priority ?? 0);
            });
    }, [settings.dockOrder, refreshTick]);

    const hidden = useMemo(() => new Set(parseStringArray(settings.dockHidden)), [settings.dockHidden]);
    const iconOverrides = useMemo(() => parseStringMap(settings.dockIcons), [settings.dockIcons]);

    const toggleHidden = useCallback((id: string) => {
        if (id === PINNED_DOCK_ID) return;
        const next = new Set(hidden);
        if (next.has(id)) next.delete(id); else next.add(id);
        settings.dockHidden = JSON.stringify(Array.from(next));
        refreshDock();
        forceUpdate(x => x + 1);
    }, [hidden, settings]);

    // The small "x" is a one-way hide action - it should never flip a
    // currently-hidden item back to visible (that's what re-toggling the
    // switch below is for). Only mutate settings/refresh when there's
    // actually something to hide.
    const hideItem = useCallback((id: string) => {
        if (id === PINNED_DOCK_ID || hidden.has(id)) return;
        const next = new Set(hidden);
        next.add(id);
        settings.dockHidden = JSON.stringify(Array.from(next));
        refreshDock();
        forceUpdate(x => x + 1);
    }, [hidden, settings]);

    const commitOrder = useCallback((draggedId: string, beforeId: string | null) => {
        if (draggedId === PINNED_DOCK_ID) return;
        const currentOrder = items.map(i => i.id);
        const from = currentOrder.indexOf(draggedId);
        if (from === -1) return;
        currentOrder.splice(from, 1);
        if (beforeId == null) {
            currentOrder.push(draggedId);
        } else {
            const to = currentOrder.indexOf(beforeId);
            currentOrder.splice(to === -1 ? currentOrder.length : to, 0, draggedId);
        }
        settings.dockOrder = JSON.stringify(currentOrder);
        refreshDock();
        forceUpdate(x => x + 1);
    }, [items, settings]);

    const customDock = useMemo(() => parseStringMap(settings.customDock), [settings.customDock]);

    // Enabled plugins, plus Sonata's own running features.
    const candidates = useMemo(
        () => getDockCandidates(new Set(Object.keys(customDock))),
        [customDock, refreshTick],
    );

    const addCustomButton = useCallback(() => {
        if (!selectedPlugin) return;
        const next = { ...customDock, [selectedPlugin]: selectedIcon };
        settings.customDock = JSON.stringify(next);
        registerCustomDockButton(selectedPlugin, selectedIcon);
        refreshDock();
        setSelectedPlugin(null);
        setSelectedIcon(DEFAULT_DOCK_ICON_KEY);
        setShowAdd(false);
        forceUpdate(x => x + 1);
    }, [selectedPlugin, selectedIcon, customDock, settings]);

    const removeCustomButton = useCallback((pluginName: string) => {
        const next = { ...customDock };
        delete next[pluginName];
        settings.customDock = JSON.stringify(next);
        unregisterCustomDockButton(pluginName);
        refreshDock();
        forceUpdate(x => x + 1);
    }, [customDock, settings]);

    /** Right-click on a button: edit its icon (and, for ones you added, which plugin it opens). */
    const startEditing = (id: string) => {
        setShowAdd(false);
        if (isCustomDockId(id)) {
            const plugin = customDockPluginName(id);
            setEditing({ id, plugin, icon: customDock[plugin] ?? DEFAULT_DOCK_ICON_KEY });
        } else {
            setEditing({ id, plugin: null, icon: iconOverrides[id] ?? "" });
        }
    };

    const saveEdit = () => {
        if (!editing) return;
        if (editing.plugin != null) {
            // A button you added: swap the plugin and/or icon, keeping its place in the order.
            const oldPlugin = customDockPluginName(editing.id);
            const next = { ...customDock };
            delete next[oldPlugin];
            next[editing.plugin] = editing.icon || DEFAULT_DOCK_ICON_KEY;
            settings.customDock = JSON.stringify(next);
            unregisterCustomDockButton(oldPlugin);
            registerCustomDockButton(editing.plugin, editing.icon || DEFAULT_DOCK_ICON_KEY);
            if (oldPlugin !== editing.plugin) {
                const newId = customDockId(editing.plugin);
                settings.dockOrder = JSON.stringify(parseStringArray(settings.dockOrder).map(id => id === editing.id ? newId : id));
                settings.dockHidden = JSON.stringify(parseStringArray(settings.dockHidden).map(id => id === editing.id ? newId : id));
            }
        } else {
            // A built-in button: an icon of your choosing, or its own again.
            const next = { ...iconOverrides };
            if (editing.icon) next[editing.id] = editing.icon; else delete next[editing.id];
            settings.dockIcons = JSON.stringify(next);
        }
        refreshDock();
        setEditing(null);
        forceUpdate(x => x + 1);
    };

    const selected = candidates.find(c => c.value === selectedPlugin);
    const editingEntry = editing && items.find(i => i.id === editing.id);
    const editingName = editing && (editing.plugin != null ? dockLabel(customDockPluginName(editing.id)) : editingEntry?.entry.props.tooltipText ?? editing.id);
    // When editing a button you added, its current plugin is a choice too.
    const editCandidates = editing?.plugin != null
        ? [{ value: customDockPluginName(editing.id), label: dockLabel(customDockPluginName(editing.id)) }, ...candidates]
        : [];

    return (
        <div className={cl("dock-wrap")}>
            <DockLook settings={settings} />
            <div className={cl("dock-hint")}>Drag icons to reorder. <b>Right-click an icon to edit it</b> — change its icon, or for plugins you added, which plugin it opens. Hover for a quick × to hide it (or remove it, for plugins you added), or use the toggle underneath.</div>

            {items.length === 0 ? (
                <div className={cl("empty")}>No dock buttons yet — add a plugin below.</div>
            ) : (
                <div className={cl("dock-strip")}>
                    {items.map(({ id, entry }) => {
                        const isDragging = dragId === id;
                        const isDropTarget = dropTargetId === id && dragId && dragId !== id;
                        const isPinned = id === PINNED_DOCK_ID;
                        const isHidden = !isPinned && hidden.has(id);
                        const isCustom = isCustomDockId(id);
                        const isEditing = editing?.id === id;
                        const Icon = (!isCustom && iconOverrides[id] && DOCK_ICON_MAP[iconOverrides[id]]?.Icon) || entry.props.icon;
                        return (
                            <div key={id} className={cl("dock-cell")}>
                                <div className={cl("dock-icon-slot")}>
                                    {!isPinned && <button
                                        type="button"
                                        className={cl("dock-remove")}
                                        onClick={() => isCustom
                                            ? removeCustomButton(customDockPluginName(id))
                                            : hideItem(id)}
                                        aria-label={isCustom
                                            ? `Remove ${dockLabel(customDockPluginName(id))} from dock`
                                            : `Hide ${id} from dock`}
                                        title={isCustom ? "Remove" : "Hide"}
                                    >
                                        ×
                                    </button>}
                                    <Tooltip text={`${entry.props.tooltipText}${isPinned ? " · always in the dock" : ""} · right-click to edit`}>
                                        {tooltipProps => (
                                            <div
                                                {...tooltipProps}
                                                className={classes(
                                                    cl("dock-icon"),
                                                    isDragging && cl("dock-icon-dragging"),
                                                    isDropTarget && cl("dock-icon-drop"),
                                                    isHidden && cl("dock-icon-hidden"),
                                                    isPinned && cl("dock-icon-pinned"),
                                                    isEditing && cl("dock-icon-editing"),
                                                )}
                                                draggable={!isPinned}
                                                onContextMenu={e => { e.preventDefault(); startEditing(id); }}
                                                onDragStart={e => {
                                                    if (isPinned) { e.preventDefault(); return; }
                                                    setDragId(id);
                                                    e.dataTransfer.effectAllowed = "move";
                                                    e.dataTransfer.setData("text/plain", id);
                                                }}
                                                onDragOver={e => { if (isPinned) return; e.preventDefault(); setDropTargetId(id); }}
                                                onDragLeave={() => setDropTargetId(d => d === id ? null : d)}
                                                onDrop={e => {
                                                    e.preventDefault();
                                                    const dragged = e.dataTransfer.getData("text/plain");
                                                    if (dragged && dragged !== id) commitOrder(dragged, id);
                                                    setDragId(null);
                                                    setDropTargetId(null);
                                                }}
                                                onDragEnd={() => { setDragId(null); setDropTargetId(null); }}
                                            >
                                                <Icon width={28} height={28} />
                                            </div>
                                        )}
                                    </Tooltip>
                                </div>
                                <button
                                    type="button"
                                    className={classes(cl("dock-visibility"), !isHidden && cl("dock-visibility-on"), isPinned && cl("dock-visibility-locked"))}
                                    onClick={() => toggleHidden(id)}
                                    disabled={isPinned}
                                    title={isPinned ? "Sonata always stays in the dock" : undefined}
                                    aria-label={isPinned ? "Sonata always stays in the dock" : `${isHidden ? "Show" : "Hide"} ${id}`}
                                >
                                    <div className={cl("dock-visibility-knob")} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {editing && (
                <div className={classes(cl("dock-add-form"), cl("dock-edit-form"))}>
                    <div className={cl("dock-edit-title")}>
                        Editing <strong>{editingName}</strong>
                        {editing.plugin == null && <span className={cl("dock-add-note")}> · built-in button — you can change its icon</span>}
                    </div>
                    {editing.plugin != null && (
                        <div className={cl("dock-add-row")}>
                            <Select
                                options={editCandidates.map(c => ({ label: c.label, value: c.value }))}
                                placeholder="Choose a plugin or Sonata feature…"
                                serialize={String}
                                select={v => setEditing(ed => ed && { ...ed, plugin: v })}
                                isSelected={v => v === editing.plugin}
                                closeOnSelect
                                className={cl("dock-add-select")}
                            />
                        </div>
                    )}
                    <IconPicker selected={editing.icon} onSelect={key => setEditing(ed => ed && { ...ed, icon: key })} />
                    <div className={cl("dock-add-actions")}>
                        {editing.plugin == null && iconOverrides[editing.id] && (
                            <button type="button" className={cl("dock-add-cancel")} onClick={() => setEditing(ed => ed && { ...ed, icon: "" })}>
                                Use its own icon
                            </button>
                        )}
                        <button type="button" className={cl("dock-add-cancel")} onClick={() => setEditing(null)}>Cancel</button>
                        <button type="button" className={cl("dock-add-confirm")} onClick={saveEdit} disabled={editing.plugin != null && !editing.plugin}>Save</button>
                    </div>
                </div>
            )}

            <div className={cl("dock-add-section")}>
                {!showAdd ? (
                    <button type="button" className={cl("dock-add-toggle")} onClick={() => { setShowAdd(true); setEditing(null); }}>
                        + Add a plugin to the dock
                    </button>
                ) : (
                    <div className={cl("dock-add-form")}>
                        <div className={cl("dock-add-row")}>
                            <Select
                                options={candidates.map(c => ({ label: c.label, value: c.value }))}
                                placeholder={candidates.length ? "Choose a plugin or Sonata feature…" : "Nothing left to add"}
                                serialize={String}
                                select={v => setSelectedPlugin(v)}
                                isSelected={v => v === selectedPlugin}
                                closeOnSelect
                                className={cl("dock-add-select")}
                            />
                        </div>
                        {selectedPlugin && (
                            <div className={cl("dock-add-note")}>
                                {selected && (() => {
                                    const name = <strong>{dockLabel(selected.value)}</strong>;
                                    switch (selected.opens) {
                                        case "window": return <>Clicking it will open {name}'s own window.</>;
                                        case "options": return <>Clicking it will open {name}'s options.</>;
                                        case "page": return <>Clicking it will open the Sonata page ({name} has no window or options).</>;
                                        default: return <>Clicking it will open {name}'s plugin settings.</>;
                                    }
                                })()}
                            </div>
                        )}
                        <IconPicker selected={selectedIcon} onSelect={setSelectedIcon} />
                        <div className={cl("dock-add-actions")}>
                            <button
                                type="button"
                                className={cl("dock-add-cancel")}
                                onClick={() => { setShowAdd(false); setSelectedPlugin(null); setSelectedIcon(DEFAULT_DOCK_ICON_KEY); }}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className={cl("dock-add-confirm")}
                                disabled={!selectedPlugin}
                                onClick={addCustomButton}
                            >
                                Add to dock
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
