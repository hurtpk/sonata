/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Keybinds: one group per Sonata feature and per plugin, folded up so the
// list stays short. Search finds a setting anywhere (and opens its group),
// "Bound only" shows just what has a key, and each section shows a dozen
// groups at a time.

import { Settings } from "@api/Settings";
import { classes } from "@utils/misc";
import { TextInput, useMemo, useState } from "@webpack/common";

import { cl, getBooleanSettings, getKeybindSettings, parseStringMap, SettingEntry } from "./shared";

interface Row {
    id: string;
    label: string;
    /** "on/off" for switches, "key" for a plugin's own keybind setting. */
    kind: "toggle" | "key";
    value: string;
    defaultVal: string;
    onChange: (v: string) => void;
}

interface Group { id: string; name: string; source: "sonata" | "plugin"; rows: Row[]; }

const PAGE = 12;

/** "voiceTimeline" → "Voice Timeline". */
const titleCase = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

function makePluginOwnedRow(e: SettingEntry, label = e.label): Row {
    return {
        id: `${e.plugin.name}::${e.key}`,
        label,
        kind: "key",
        value: (Settings.plugins[e.plugin.name]?.[e.key] as string) ?? e.default,
        defaultVal: e.default,
        onChange: v => { Settings.plugins[e.plugin.name][e.key] = v; },
    };
}

function makeCentralRow(e: SettingEntry, map: Record<string, string>, label = e.label): Row {
    const mapKey = `${e.plugin.name}.${e.key}`;
    return {
        id: `${e.plugin.name}::toggle::${e.key}`,
        label,
        kind: "toggle",
        value: map[mapKey] ?? "",
        defaultVal: "",
        onChange: v => {
            const current = parseStringMap(Settings.plugins.Sonata?.keybindMap);
            if (v) current[mapKey] = v;
            else delete current[mapKey];
            Settings.plugins.Sonata.keybindMap = JSON.stringify(current);
        },
    };
}

/**
 * Sonata keeps every feature's settings on itself (as "on_<feature>" and
 * "<feature>_<option>"), so its settings are split back out by feature here.
 */
function splitSonata(entries: SettingEntry[], toRow: (e: SettingEntry, label?: string) => Row): Group[] {
    const features = new Set(entries.filter(e => e.key.startsWith("on_")).map(e => e.key.slice(3)));
    const byFeature = new Map<string, Row[]>();
    const own: Row[] = [];
    for (const e of entries) {
        if (e.key.startsWith("on_")) {
            const f = e.key.slice(3);
            byFeature.set(f, [toRow(e, `Turn ${titleCase(f)} on / off`), ...(byFeature.get(f) ?? [])]);
            continue;
        }
        const f = [...features].find(k => e.key.startsWith(`${k}_`));
        if (f) byFeature.set(f, [...(byFeature.get(f) ?? []), toRow(e)]);
        else own.push(toRow(e));
    }
    const groups = [...byFeature].map(([f, rows]) => ({ id: `sonata:${f}`, name: titleCase(f), source: "sonata" as const, rows }));
    if (own.length) groups.unshift({ id: "sonata:self", name: "Sonata", source: "sonata", rows: own });
    return groups;
}

function KeybindRow({ row, onBound }: { row: Row; onBound(id: string, bound: boolean): void; }) {
    const [value, setValue] = useState(row.value);
    const commit = (v: string) => {
        setValue(v);
        row.onChange(v);
        onBound(row.id, !!v);
    };
    return (
        <div className={classes(cl("keybind-row"), value && cl("keybind-row-bound"))}>
            <div className={cl("keybind-label")} title={row.label}>
                <span className={cl("keybind-kind")}>{row.kind === "toggle" ? "on/off" : "key"}</span>
                {row.label}
            </div>
            <div className={cl("keybind-controls")}>
                <div className={cl("keybind-input")}>
                    <TextInput value={value} onChange={commit} placeholder="Not bound" />
                </div>
                <button type="button" className={cl("keybind-reset")} onClick={() => commit(row.defaultVal)} disabled={value === row.defaultVal}>Reset</button>
            </div>
        </div>
    );
}

function Section({ title, groups, open, toggle, query, boundOnly, bound, onBound }: {
    title: string; groups: Group[]; open: Set<string>; toggle(id: string): void; query: string; boundOnly: boolean; bound: Set<string>; onBound(id: string, b: boolean): void;
}) {
    const [limit, setLimit] = useState(PAGE);
    const q = query.trim().toLowerCase();
    const shown = groups
        .map(g => ({
            ...g,
            rows: g.rows.filter(r => (!q || r.label.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)) && (!boundOnly || bound.has(r.id))),
        }))
        .filter(g => g.rows.length);
    if (!shown.length) return null;
    // While searching or filtering, everything that matches is shown (and open).
    const filtering = !!q || boundOnly;
    const visible = filtering ? shown : shown.slice(0, limit);

    return (
        <div className={cl("keybind-section")}>
            <div className={cl("keybind-section-title")}>{title} <span>{shown.length}</span></div>
            {visible.map(g => {
                const isOpen = filtering || open.has(g.id);
                const count = g.rows.filter(r => bound.has(r.id)).length;
                return (
                    <div key={g.id} className={classes(cl("keybind-group"), isOpen && cl("keybind-group-open"))}>
                        <button type="button" className={cl("keybind-group-header")} aria-expanded={isOpen} onClick={() => toggle(g.id)} disabled={filtering}>
                            <span className={cl("keybind-chevron")} aria-hidden>›</span>
                            <span className={cl("keybind-group-name")}>{g.name}</span>
                            <span className={cl("keybind-group-count")}>{g.rows.length} {g.rows.length === 1 ? "setting" : "settings"}</span>
                            {count > 0 && <span className={cl("keybind-group-bound")}>{count} bound</span>}
                        </button>
                        {isOpen && <div className={cl("keybind-rows")}>{g.rows.map(r => <KeybindRow key={r.id} row={r} onBound={onBound} />)}</div>}
                    </div>
                );
            })}
            {!filtering && shown.length > limit && (
                <button type="button" className={cl("keybind-more")} onClick={() => setLimit(l => l + PAGE * 2)}>
                    Show {Math.min(PAGE * 2, shown.length - limit)} more ({shown.length - limit} left)
                </button>
            )}
            {!filtering && limit > PAGE && <button type="button" className={cl("keybind-less")} onClick={() => setLimit(PAGE)}>Show fewer</button>}
        </div>
    );
}

export function KeybindsTab() {
    const { sonata, plugins } = useMemo(() => {
        const keybindGroups = getKeybindSettings();
        const booleanGroups = getBooleanSettings();
        const map = parseStringMap(Settings.plugins.Sonata?.keybindMap);
        const toggleRow = (e: SettingEntry, label?: string) => makeCentralRow(e, map, label);

        const sonata = [
            ...splitSonata(booleanGroups.get("Sonata") ?? [], toggleRow),
            ...(keybindGroups.get("Sonata") ?? []).length ? [{ id: "sonata:keys", name: "Sonata keybinds", source: "sonata" as const, rows: (keybindGroups.get("Sonata") ?? []).map(e => makePluginOwnedRow(e)) }] : [],
        ].sort((a, b) => a.id === "sonata:self" ? -1 : b.id === "sonata:self" ? 1 : a.name.localeCompare(b.name));

        const names = new Set([...keybindGroups.keys(), ...booleanGroups.keys()]);
        names.delete("Sonata");
        const plugins: Group[] = [...names].sort((a, b) => a.localeCompare(b)).map(name => ({
            id: `plugin:${name}`,
            name,
            source: "plugin" as const,
            rows: [
                ...(keybindGroups.get(name) ?? []).map(e => makePluginOwnedRow(e)),
                ...(booleanGroups.get(name) ?? []).map(e => makeCentralRow(e, map)),
            ],
        })).filter(g => g.rows.length);
        return { sonata, plugins };
    }, []);

    const initialBound = useMemo(() => new Set([...sonata, ...plugins].flatMap(g => g.rows.filter(r => !!r.value).map(r => r.id))), []);
    const [bound, setBound] = useState(initialBound);
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState("");
    const [boundOnly, setBoundOnly] = useState(false);

    const onBound = (id: string, b: boolean) => setBound(s => { const n = new Set(s); if (b) n.add(id); else n.delete(id); return n; });
    const toggle = (id: string) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const all = [...sonata, ...plugins];

    if (!all.length) return <div className={cl("empty")}>No toggleable settings or keybinds found.</div>;

    return (
        <div className={cl("keybinds-list")}>
            <div className={cl("keybind-toolbar")}>
                <div className={cl("keybind-search")}>
                    <TextInput value={query} onChange={setQuery} placeholder={`Search ${all.reduce((n, g) => n + g.rows.length, 0)} settings…`} />
                </div>
                <button type="button" className={classes(cl("keybind-chip"), boundOnly && cl("keybind-chip-on"))} onClick={() => setBoundOnly(b => !b)}>
                    Bound only{bound.size ? ` (${bound.size})` : ""}
                </button>
                <button type="button" className={cl("keybind-chip")} onClick={() => setOpen(open.size ? new Set() : new Set(all.map(g => g.id)))}>
                    {open.size ? "Collapse all" : "Expand all"}
                </button>
            </div>
            <div className={cl("keybind-hint")}>Keys work anywhere in Discord. Type a combination like Alt+K or Ctrl+Shift+P; leave it empty to unbind.</div>
            {boundOnly && !bound.size && <div className={cl("empty")}>Nothing is bound yet.</div>}
            <Section title="Sonata features" groups={sonata} open={open} toggle={toggle} query={query} boundOnly={boundOnly} bound={bound} onBound={onBound} />
            <Section title="Your plugins" groups={plugins} open={open} toggle={toggle} query={query} boundOnly={boundOnly} bound={bound} onBound={onBound} />
        </div>
    );
}
