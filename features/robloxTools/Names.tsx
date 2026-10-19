/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Username checker: is a Roblox name free? Asks Roblox's own sign-up check
// (nothing to log in to). Taken names show who has them, and close
// alternatives are checked for you. A list of names can be checked at once.

import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { useEffect, useState } from "@webpack/common";

import { callNative } from "../_shared/native";
import { cardActions } from "./data";

const rb = classNameFactory("vc-rbx-");

type Result = { name: string; state: "free" | "taken" | "bad" | "error"; message: string; };

const cache = new Map<string, Promise<Result>>();

/** One name, asked once (and remembered for this session). */
function check(name: string): Promise<Result> {
    const key = name.toLowerCase();
    let p = cache.get(key);
    if (!p) {
        p = (callNative("rbxNameCheck", name) as Promise<any>).then(r => {
            if (!r?.ok) { cache.delete(key); return { name, state: "error", message: r?.error ?? "Couldn't check" } as Result; }
            const state = r.code === 0 ? "free" : r.code === 1 ? "taken" : "bad";
            return { name, state, message: state === "free" ? "It's free!" : r.message || "Not allowed" } as Result;
        }, () => { cache.delete(key); return { name, state: "error", message: "Couldn't check" } as Result; });
        cache.set(key, p);
    }
    return p;
}

/** Roblox's rules, checked here first so obviously-wrong names don't need asking. */
function quickProblem(n: string) {
    if (n.length < 3 || n.length > 20) return "Usernames are 3 to 20 characters long";
    if (/\s/.test(n)) return "Usernames can't have spaces";
    if (!/^[A-Za-z0-9_]+$/.test(n)) return "Only letters, numbers and one _ are allowed";
    if (/^_|_$/.test(n)) return "A username can't start or end with _";
    if ((n.match(/_/g) ?? []).length > 1) return "Usernames can have at most one _";
    return null;
}

/** Close alternatives to a name, that follow Roblox's rules. */
function ideas(name: string): string[] {
    const base = name.replace(/[^A-Za-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 16) || "Player";
    const plain = base.replace(/_/g, "");
    const year = String(new Date().getFullYear()).slice(2);
    const list = [
        `${plain}_x`, `x${plain}`, `${plain}x`, `${plain}${year}`, `${plain}_${year}`, `Its${plain}`, `Real${plain}`, `${plain}YT`,
        `${plain}RBX`, `${plain}${plain.at(-1) ?? "o"}`, `The${plain}`, `${plain}${Math.floor(Math.random() * 900 + 100)}`, `${plain}_Official`, `Not${plain}`,
    ];
    return [...new Set(list.map(n => n.slice(0, 20)))].filter(n => !quickProblem(n) && n.toLowerCase() !== name.toLowerCase()).slice(0, 10);
}

/** Checks a list one by one, gently, showing each answer as it comes. */
function useChecks(names: string[]) {
    const [results, setResults] = useState<Record<string, Result>>({});
    const key = names.join("\n");
    useEffect(() => {
        let alive = true;
        setResults({});
        void (async () => {
            for (const n of names) {
                if (!alive) return;
                const problem = quickProblem(n);
                const r = problem ? { name: n, state: "bad" as const, message: problem } : await check(n);
                if (!alive) return;
                setResults(prev => ({ ...prev, [n]: r }));
                if (!problem) await new Promise(res => setTimeout(res, 250));
            }
        })();
        return () => { alive = false; };
    }, [key]);
    return results;
}

const ICON = { free: "✅", taken: "❌", bad: "⚠️", error: "❔" };

function IdeaChips({ name }: { name: string; }) {
    const list = ideas(name);
    const res = useChecks(list);
    const free = list.filter(n => res[n]?.state === "free");
    const pending = list.filter(n => !res[n]).length;
    return (
        <div className={rb("names-ideas")}>
            <span className="vc-tool-label">Free ones like it{pending ? " — checking…" : ""}</span>
            <div className="vc-tool-chips">
                {list.map(n => {
                    const r = res[n];
                    return (
                        <button key={n} type="button" className={classes("vc-tool-chip", rb("name-chip"), r && rb(`name-${r.state}`))} disabled={!r || r.state !== "free"} title={r?.message ?? "Checking…"} onClick={() => copyWithToast(n, `Copied ${n}`)}>
                            {r ? ICON[r.state] : "…"} {n}
                        </button>
                    );
                })}
            </div>
            {!pending && !free.length && <span className="vc-tool-hint">None of these are free — try your own ideas above.</span>}
            {free.length > 0 && <span className="vc-tool-hint">Click a free one to copy it.</span>}
        </div>
    );
}

function One() {
    const [text, setText] = useState("");
    const [res, setRes] = useState<Result | null>(null);
    const [busy, setBusy] = useState(false);
    const name = text.trim().replace(/^@/, "");
    useEffect(() => {
        setRes(null);
        if (!name) return;
        const problem = quickProblem(name);
        if (problem) { setRes({ name, state: "bad", message: problem }); return; }
        let alive = true;
        setBusy(true);
        const t = setTimeout(() => void check(name).then(r => { if (alive) { setRes(r); setBusy(false); } }), 450);
        return () => { alive = false; clearTimeout(t); setBusy(false); };
    }, [name]);

    return (
        <div className={rb("names-one")}>
            <input className={classes("vc-tool-input", rb("names-input"))} autoFocus value={text} maxLength={30} spellCheck={false} placeholder="Type a username to see if it's free" onChange={e => setText(e.currentTarget.value)} />
            {busy && <span className="vc-tool-hint">Asking Roblox…</span>}
            {res && (
                <div className={classes(rb("name-result"), rb(`name-${res.state}`))}>
                    <span className={rb("name-result-icon")}>{ICON[res.state]}</span>
                    <div>
                        <b>{res.state === "free" ? `${res.name} is free!` : res.state === "taken" ? `${res.name} is taken` : res.state === "bad" ? "Not allowed" : "Couldn't check"}</b>
                        <span>{res.state === "free" ? "Anyone can claim it, so it could be gone soon. Changing your username costs 1,000 Robux." : res.message}</span>
                    </div>
                    <span className="vc-tool-spacer" />
                    {res.state === "free" && <button type="button" className="vc-tool-btn vc-tool-primary" onClick={() => copyWithToast(res.name, `Copied ${res.name}`)}>Copy</button>}
                    {res.state === "taken" && <button type="button" className="vc-tool-btn" onClick={() => cardActions.lookup(res.name)}>See who has it</button>}
                </div>
            )}
            {res && (res.state === "taken" || res.state === "bad") && <IdeaChips key={res.name} name={res.name} />}
        </div>
    );
}

function Many() {
    const [text, setText] = useState("");
    const [ran, setRan] = useState<string[]>([]);
    const res = useChecks(ran);
    const free = ran.filter(n => res[n]?.state === "free");
    return (
        <div className={rb("names-many")}>
            <textarea className={classes("vc-tool-input", rb("names-area"))} value={text} rows={6} spellCheck={false} placeholder={"One name per line (up to 25)\nSkyRunner\nNeonFox\nPixelKing"} onChange={e => setText(e.currentTarget.value)} />
            <div className="vc-tool-footer">
                <span className="vc-tool-hint">{ran.length ? `${free.length} of ${ran.length} free${ran.some(n => !res[n]) ? " so far…" : ""}` : "Checks them one at a time."}</span>
                <span className="vc-tool-spacer" />
                {free.length > 0 && <button type="button" className="vc-tool-btn" onClick={() => copyWithToast(free.join("\n"), `Copied ${free.length} free name${free.length === 1 ? "" : "s"}`)}>Copy free ones</button>}
                <button type="button" className="vc-tool-btn vc-tool-primary" disabled={!text.trim()} onClick={() => setRan([...new Set(text.split(/[\n,]+/).map(s => s.trim().replace(/^@/, "")).filter(Boolean))].slice(0, 25))}>Check them</button>
            </div>
            {ran.length > 0 && (
                <div className={rb("names-table")}>
                    {ran.map(n => {
                        const r = res[n];
                        return (
                            <div key={n} className={classes(rb("names-row"), r && rb(`name-${r.state}`))}>
                                <span>{r ? ICON[r.state] : "…"}</span>
                                <b>{n}</b>
                                <span className="vc-tool-hint">{r ? r.message : "Checking…"}</span>
                                {r?.state === "free" && <button type="button" className="vc-tool-icon" title="Copy" onClick={() => copyWithToast(n, `Copied ${n}`)}>📋</button>}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function Names() {
    const [mode, setMode] = useState<"one" | "many">("one");
    return (
        <div className={rb("names")}>
            <div className={rb("outfit-head")}>
                <div>
                    <b>🏷️ Username checker</b>
                    <span>See if a Roblox username is free — straight from Roblox's own sign-up check.</span>
                </div>
            </div>
            <div className="vc-tool-seg">
                <button type="button" className={classes("vc-tool-seg-btn", mode === "one" && "vc-tool-seg-on")} onClick={() => setMode("one")}>One name</button>
                <button type="button" className={classes("vc-tool-seg-btn", mode === "many" && "vc-tool-seg-on")} onClick={() => setMode("many")}>A list</button>
            </div>
            {mode === "one" ? <One /> : <Many />}
        </div>
    );
}
