/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Two roles side by side: what each can do, with the differences first.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { Role } from "@vencord/discord-types";
import { PermissionsBits, useEffect, useRef, useState } from "@webpack/common";

import { roleFill } from "./RoleInfo";

const cl = classNameFactory("vc-permviewer-");
const tl = classNameFactory("vc-tool-");

export type PermName = (bit: bigint) => string;

const has = (r: Role, bit: bigint) => (r.permissions & bit) === bit;
const isAdmin = (r: Role) => has(r, PermissionsBits.ADMINISTRATOR);

function Mark({ on, admin }: { on: boolean; admin: boolean; }) {
    if (on) return <span className={classes(cl("cmp-mark"), cl("cmp-yes"))} title="Allowed">✓</span>;
    if (admin) return <span className={classes(cl("cmp-mark"), cl("cmp-admin"))} title="Not ticked, but Administrator allows everything">✓</span>;
    return <span className={classes(cl("cmp-mark"), cl("cmp-no"))} title="Not allowed">✕</span>;
}

export function CompareView({ a, b, name, onClose }: { a: Role; b: Role; name: PermName; onClose(): void; }) {
    const [onlyDiff, setOnlyDiff] = useState(true);
    const bits = Object.values(PermissionsBits) as bigint[];
    const aAdmin = isAdmin(a), bAdmin = isAdmin(b);
    // What each can really do (Administrator counts as everything).
    const can = (r: Role, admin: boolean, bit: bigint) => admin || has(r, bit);
    const rows = bits.map(bit => ({ bit, label: name(bit), a: has(a, bit), b: has(b, bit), diff: can(a, aAdmin, bit) !== can(b, bAdmin, bit) }))
        .sort((x, y) => Number(y.diff) - Number(x.diff) || x.label.localeCompare(y.label));
    const onlyA = rows.filter(r => can(a, aAdmin, r.bit) && !can(b, bAdmin, r.bit)).length;
    const onlyB = rows.filter(r => can(b, bAdmin, r.bit) && !can(a, aAdmin, r.bit)).length;
    const shown = onlyDiff ? rows.filter(r => r.diff) : rows;

    const Chip = ({ r }: { r: Role; }) => <span className={cl("cmp-role")}><i style={{ background: roleFill(r) }} />{r.name}</span>;

    return (
        <div className={cl("cmp")}>
            <div className={tl("head")}>
                <span className={tl("label")}>Comparing</span>
                <span className={tl("spacer")} />
                <button type="button" className={tl("link")} onClick={onClose}>Done comparing</button>
            </div>
            <div className={cl("cmp-summary")}>
                <div><Chip r={a} /><span>{onlyA ? `can do ${onlyA} thing${onlyA === 1 ? "" : "s"} the other can't` : "can't do anything extra"}</span>{aAdmin && <small>Administrator — allowed everything</small>}</div>
                <div><Chip r={b} /><span>{onlyB ? `can do ${onlyB} thing${onlyB === 1 ? "" : "s"} the other can't` : "can't do anything extra"}</span>{bAdmin && <small>Administrator — allowed everything</small>}</div>
            </div>
            <div className="vc-tool-chips">
                <button type="button" className={classes("vc-tool-chip", onlyDiff && "vc-tool-chip-on")} onClick={() => setOnlyDiff(true)}>Only differences ({onlyA + onlyB})</button>
                <button type="button" className={classes("vc-tool-chip", !onlyDiff && "vc-tool-chip-on")} onClick={() => setOnlyDiff(false)}>Everything</button>
            </div>
            <div className={cl("cmp-table")}>
                <div className={classes(cl("cmp-row"), cl("cmp-headrow"))}>
                    <span>Permission</span>
                    <span title={a.name}><i style={{ background: roleFill(a) }} /></span>
                    <span title={b.name}><i style={{ background: roleFill(b) }} /></span>
                </div>
                {shown.map(r => (
                    <div key={String(r.bit)} className={classes(cl("cmp-row"), r.diff && cl("cmp-diff"))}>
                        <span>{r.label}</span>
                        <Mark on={r.a} admin={aAdmin} />
                        <Mark on={r.b} admin={bAdmin} />
                    </div>
                ))}
                {!shown.length && <div className={tl("empty")}>These two roles can do exactly the same things.</div>}
            </div>
        </div>
    );
}

/** A role dropdown that looks like the role list: colour dot, icon and name — with a search. */
export function RolePicker({ roles, value, onChange, iconOf, placeholder = "Pick another role…" }: { roles: Role[]; value: string | null; onChange(id: string | null): void; iconOf(r: Role): string | undefined; placeholder?: string; }) {
    const [open, setOpen] = useState(false);
    const [find, setFind] = useState("");
    const box = useRef<HTMLDivElement>(null);
    const picked = roles.find(r => r.id === value);
    useEffect(() => {
        if (!open) return;
        const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
        document.addEventListener("mousedown", away, true);
        document.addEventListener("keydown", esc, true);
        return () => { document.removeEventListener("mousedown", away, true); document.removeEventListener("keydown", esc, true); };
    }, [open]);
    const q = find.trim().toLowerCase();
    const list = q ? roles.filter(r => r.name.toLowerCase().includes(q)) : roles;
    const Row = ({ r }: { r: Role; }) => {
        const icon = iconOf(r);
        return (
            <>
                <i className={cl("rp-dot")} style={{ background: roleFill(r) }} />
                {icon && <img className={cl("rp-icon")} src={icon} alt="" />}
                <span className={cl("rp-name")}>{r.name}</span>
            </>
        );
    };
    const pick = (id: string | null) => { onChange(id); setOpen(false); setFind(""); };
    return (
        <div ref={box} className={cl("rp")}>
            <button type="button" className={classes(cl("rp-button"), open && cl("rp-button-open"))} onClick={() => setOpen(v => !v)}>
                {picked ? <Row r={picked} /> : <span className={cl("rp-placeholder")}>{placeholder}</span>}
                <svg className={cl("rp-caret")} width="16" height="16" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M7 10l5 5 5-5z" /></svg>
            </button>
            {open && (
                <div className={cl("rp-menu")}>
                    <input className={classes(tl("input"), cl("rp-search"))} autoFocus value={find} placeholder="Find a role" onChange={e => setFind(e.currentTarget.value)}
                        onKeyDown={e => { if (e.key === "Enter" && list[0]) pick(list[0].id); }} />
                    <div className={cl("rp-list")}>
                        {picked && <button type="button" className={classes(cl("rp-item"), cl("rp-clear"))} onClick={() => pick(null)}>Stop comparing</button>}
                        {list.map(r => (
                            <button key={r.id} type="button" className={classes(cl("rp-item"), r.id === value && cl("rp-item-on"))} onClick={() => pick(r.id)}>
                                <Row r={r} />
                            </button>
                        ))}
                        {!list.length && <div className={cl("rp-none")}>No role called “{find}”</div>}
                    </div>
                </div>
            )}
        </div>
    );
}
