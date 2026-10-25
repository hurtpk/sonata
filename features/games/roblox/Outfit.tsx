/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What someone's wearing: every item with its price, bundles counted once,
// and roughly what the whole outfit is worth.

import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { showToast, useEffect, useRef, useState } from "@webpack/common";
import { zipSync } from "fflate";

import { callNative } from "../../_shared/native";
import { ROBUX } from "../../currencyConverter/robux";
import { collectItem, download, safe, zipEntries } from "./Assets";
import { fetchOutfit, RbxOutfit } from "./data";

const rb = classNameFactory("vc-rbx-");

const GROUPS: [string, (t: string) => boolean][] = [
    ["Accessories", t => /Accessory$|^Hat$/.test(t)],
    ["Clothing", t => /Shirt|Pants|TShirt|Jacket|Sweater|Shorts|Dress|Skirt|Shoes/i.test(t)],
    ["Face & body", t => /Head|Torso|Arm|Leg|Face|Mood/.test(t)],
    ["Animations", t => /Animation$/.test(t)],
];
const groupOf = (t: string) => GROUPS.find(([, f]) => f(t))?.[0] ?? "Other";
const nice = (t: string) => t.replace(/Accessory$/, "").replace(/Animation$/, " animation").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^T Shirt$/, "T-shirt").trim() || t;
const rbx = (n: number) => `R$ ${Math.round(n).toLocaleString()}`;
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n < 10 ? 2 : 0 });

/** One tile: an item, or a whole bundle standing in for its parts. */
interface Tile { key: string; name: string; type: string; image: string; url: string; price: number | null; resale: number | null; limited: boolean; parts: number; loose?: boolean; }

function tiles(o: RbxOutfit): Tile[] {
    const out: Tile[] = [];
    const bundles = new Map<string, Tile>();
    for (const i of o.items) {
        if (i.bundle) {
            const b = bundles.get(i.bundle.id);
            if (b) { b.parts++; continue; }
            const t: Tile = { key: `b${i.bundle.id}`, name: i.bundle.name, type: /Animation$/.test(i.type) && i.type !== "MoodAnimation" ? "AnimationPack" : "Body", image: i.image, url: `https://www.roblox.com/bundles/${i.bundle.id}`, price: i.bundle.price, resale: null, limited: false, parts: 1 };
            bundles.set(i.bundle.id, t); out.push(t);
            continue;
        }
        // Body parts that aren't sold on their own (the classic body, and so on) become one tile.
        if (i.price == null && !i.limited && /^(Head|Torso|LeftArm|RightArm|LeftLeg|RightLeg)$/.test(i.type)) {
            const b = bundles.get("body");
            if (b) { b.parts++; if (i.type === "Torso") b.image = i.image; continue; }
            const t: Tile = { key: "body", name: "Body", type: "Body", image: i.image, url: `https://www.roblox.com/catalog/${i.id}`, price: null, resale: null, limited: false, parts: 1, loose: true };
            bundles.set("body", t); out.push(t);
            continue;
        }
        out.push({ key: i.id, name: i.name, type: i.type, image: i.image, url: `https://www.roblox.com/catalog/${i.id}`, price: i.price, resale: i.resale, limited: i.limited, parts: 0 });
    }
    return out;
}

function priceOf(t: Tile) {
    if (t.limited) return t.resale != null ? { text: rbx(t.resale), sub: "cheapest resale", value: t.resale } : { text: "Limited", sub: "nobody's reselling", value: null };
    if (t.price === 0) return { text: "Free", value: 0 };
    if (t.price != null) return { text: rbx(t.price), value: t.price };
    if (t.loose) return { text: "Not sold alone", value: null };
    return { text: "Off sale", value: null };
}

function TileView({ t }: { t: Tile; }) {
    const p = priceOf(t);
    return (
        <a className={rb("wear")} href={t.url} target="_blank" rel="noreferrer" title={`${t.name} — open on Roblox`}>
            {t.image ? <img src={t.image} alt="" loading="lazy" /> : <span className={rb("img-none")}>🧱</span>}
            <b>{t.name}</b>
            <span>{t.parts ? (t.type === "AnimationPack" ? `Animation pack · ${t.parts} animations` : `${t.loose ? "Body parts" : "Bundle"} · ${t.parts} part${t.parts === 1 ? "" : "s"}`) : nice(t.type)}</span>
            <i className={classes(rb("price"), t.limited && rb("price-lim"), p.value == null && rb("price-off"))}>{p.text}{p.sub && <small> · {p.sub}</small>}</i>
        </a>
    );
}

/** Saves everything they're wearing — every item's meshes, textures and files — in one zip. */
function AvatarDownload({ outfit, who, body, list }: { outfit: RbxOutfit; who: string; body?: string; list: Tile[]; }) {
    const [status, setStatus] = useState<string | null>(null);
    const stop = useRef(false);
    const run = async () => {
        stop.current = false;
        // Accessories and clothing first, animations last.
        const order = (t: string) => { const g = GROUPS.findIndex(([, f]) => f(t)); return g < 0 ? GROUPS.length : g; };
        const items = [...outfit.items].sort((a, b) => order(a.type) - order(b.type)).slice(0, 40);
        const files: Record<string, Uint8Array> = {};
        const missing: string[] = [];
        const enc = new TextEncoder();
        try {
            for (let i = 0; i < items.length; i++) {
                if (stop.current) { setStatus(null); showToast("Stopped", "message"); return; }
                const it = items[i];
                setStatus(`Item ${i + 1} of ${items.length}: ${it.name}`);
                const got = await collectItem(it.id, () => { });
                const folder = `${String(i + 1).padStart(2, "0")} ${safe(it.name)}`;
                const entries = zipEntries(safe(it.name), got.main, got.parts, folder);
                if (!Object.keys(entries).length) missing.push(`${it.name} (${it.id}) — ${got.main.error ?? "nothing to save"}`);
                Object.assign(files, entries);
            }
            if (body) {
                const png = await callNative<Uint8Array | null>("rbxCdnImage", body);
                if (png instanceof Uint8Array) files["avatar.png"] = png;
            }
            files["outfit.txt"] = enc.encode([`${who}'s avatar — saved by Sonata Game Hub`, "", ...list.map(t => `${t.name} — ${priceOf(t).text} — ${t.url}`),
                ...(outfit.emotes.length ? ["", "Emotes:", ...outfit.emotes.map(e => `${e.name} — https://www.roblox.com/catalog/${e.id}`)] : []),
                ...(missing.length ? ["", "Couldn't be saved (Roblox only hands these out to signed-in accounts):", ...missing] : [])].join("\n"));
            setStatus("Making the zip…");
            download(`${safe(who)} avatar.zip`, zipSync(files, { level: 6 }), "application/zip");
            showToast(missing.length ? `Saved — ${missing.length} item${missing.length === 1 ? "" : "s"} couldn't be included (see outfit.txt)` : "Saved the whole avatar", missing.length ? "message" : "success");
        } catch (e) {
            showToast(e instanceof Error ? e.message : "Couldn't save the avatar", "failure");
        } finally { setStatus(null); }
    };
    return status ? (
        <span className={rb("dl-status")}><span className={rb("spin")} /> {status} <button type="button" className={rb("link")} onClick={() => { stop.current = true; }}>Stop</button></span>
    ) : (
        <button type="button" className="vc-tool-btn vc-tool-primary" title="Every item's 3D model, textures and files, plus a picture of the avatar, in one zip" onClick={run}>⬇ Download whole avatar</button>
    );
}

export function Outfit({ userId, body, who = "Their" }: { userId: string; body?: string; who?: string; }) {
    const [state, setState] = useState<{ outfit?: RbxOutfit; error?: string; }>({});
    const [tick, setTick] = useState(0);
    useEffect(() => {
        let alive = true;
        setState({});
        fetchOutfit(userId, tick > 0).then(r => alive && setState(r.ok ? { outfit: r.outfit } : { error: r.error }));
        return () => { alive = false; };
    }, [userId, tick]);

    const bodyView = body ? <div className={rb("body-wrap")}><img className={rb("body")} src={body} alt="Avatar" loading="lazy" /></div> : null;
    if (state.error) return <div className={rb("look")}>{bodyView}<span className={rb("muted")}>👕 Couldn't get their outfit: {state.error}</span></div>;
    if (!state.outfit) return <div className={rb("look")}>{bodyView}<div className={rb("loading")}><span className={rb("spin")} /> Pricing their outfit…</div></div>;

    const list = tiles(state.outfit);
    const priced = list.map(t => priceOf(t).value).filter((v): v is number => v != null);
    const total = priced.reduce((a, b) => a + b, 0);
    const off = list.filter(t => priceOf(t).value == null && !t.loose).length;
    const limited = list.filter(t => t.limited).length;
    const copy = () => copyWithToast(list.map(t => `${t.name} — ${priceOf(t).text} — ${t.url}`).join("\n"), "Outfit copied");
    const groups = [...new Set(list.map(t => groupOf(t.type === "AnimationPack" ? "Animation" : t.type === "Body" ? "Head" : t.type)))];

    return (
        <div className={rb("look")}>
            <div className={rb("look-side")}>
                {bodyView}
                <div className={rb("worth")}>
                    <span>Outfit worth</span>
                    <b>{rbx(total)}</b>
                    <small>≈ {usd(total * ROBUX.buy)} to buy today</small>
                    <small>{list.length} thing{list.length === 1 ? "" : "s"}{limited ? ` · ${limited} limited` : ""}{off ? ` · ${off} off sale` : ""}{state.outfit.avatarType ? ` · ${state.outfit.avatarType}` : ""}</small>
                </div>
                {list.length > 0 && <AvatarDownload outfit={state.outfit} who={who} body={body} list={list} />}
                <div className={rb("look-links")}>
                    <button type="button" className={rb("link")} onClick={copy}>Copy item list</button>
                    <button type="button" className={rb("link")} onClick={() => setTick(t => t + 1)} title="Check again">↻ Refresh</button>
                </div>
            </div>
            <div className={rb("outfit")}>
                {!list.length && <span className={rb("muted")}>👕 Wearing nothing from the catalog — just the default look.</span>}
                {groups.map(g => {
                    const these = list.filter(t => groupOf(t.type === "AnimationPack" ? "Animation" : t.type === "Body" ? "Head" : t.type) === g)
                        .sort((a, b) => (priceOf(b).value ?? -1) - (priceOf(a).value ?? -1));
                    return (
                        <div key={g} className={rb("wear-group")}>
                            <span className={rb("wear-title")}>{g} <small>{these.length}</small></span>
                            <div className={rb("wears")}>{these.map(t => <TileView key={t.key} t={t} />)}</div>
                        </div>
                    );
                })}
                {state.outfit.emotes.length > 0 && (
                    <div className={rb("wear-group")}>
                        <span className={rb("wear-title")}>Emotes <small>{state.outfit.emotes.length}</small></span>
                        <div className={rb("chips")}>
                            {state.outfit.emotes.map(e => (
                                <a key={e.id} className={classes(rb("chip"), rb("chip-link"))} href={`https://www.roblox.com/catalog/${e.id}`} target="_blank" rel="noreferrer" title="Open this emote on Roblox">{e.name} ↗</a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
