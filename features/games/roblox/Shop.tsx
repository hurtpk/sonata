/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A game's shop: every game pass and developer product with its price and
// what the creator keeps per sale. Roblox keeps sales numbers private, so
// there's a "what if it sold…" instead of made-up earnings.

import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { classes } from "@utils/misc";
import { useEffect, useMemo, useState } from "@webpack/common";

import { ROBUX } from "../../currencyConverter/robux";
import { fetchShop, RbxPass, RbxShop } from "./data";

const rb = classNameFactory("vc-rbx-");
const rbx = (n: number) => `R$ ${Math.round(n).toLocaleString()}`;
const usd = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: n < 100 ? 2 : 0 });
const keep = (price: number) => Math.floor(price * (1 - ROBUX.fee));

type Kind = "passes" | "products";
type Sort = "high" | "low" | "new" | "name";

function Stats({ items }: { items: RbxPass[]; }) {
    const priced = items.filter(i => i.forSale && i.price != null).map(i => i.price!);
    if (!priced.length) return null;
    const avg = priced.reduce((a, b) => a + b, 0) / priced.length;
    return (
        <div className={rb("stats")}>
            <div className={rb("stat")}><span>For sale</span><b>{priced.length}</b><small>of {items.length}</small></div>
            <div className={rb("stat")}><span>Cheapest</span><b>{rbx(Math.min(...priced))}</b></div>
            <div className={rb("stat")}><span>Priciest</span><b>{rbx(Math.max(...priced))}</b></div>
            <div className={rb("stat")}><span>Average</span><b>{rbx(avg)}</b></div>
            <div className={rb("stat")}><span>Buy them all</span><b>{rbx(priced.reduce((a, b) => a + b, 0))}</b><small>≈ {usd(priced.reduce((a, b) => a + b, 0) * ROBUX.buy)}</small></div>
        </div>
    );
}

/** What a pass would earn if it sold this many — Roblox doesn't say how many it really has. */
function WhatIf({ item }: { item: RbxPass; }) {
    const [sales, setSales] = useState("1000");
    const n = Math.max(0, Number(sales.replace(/[^\d]/g, "")) || 0);
    const earned = keep(item.price ?? 0) * n;
    return (
        <div className={rb("whatif")}>
            <b>If “{item.name}” sold</b>
            <input className="vc-tool-input" inputMode="numeric" value={sales} onChange={e => setSales(e.currentTarget.value)} />
            <b>times:</b>
            <span className={rb("whatif-out")}>{rbx(earned)} after Roblox's {Math.round(ROBUX.fee * 100)}% cut <small>≈ {usd(earned * ROBUX.devex)} cashed out</small></span>
        </div>
    );
}

function Row({ item, on, onPick }: { item: RbxPass; on: boolean; onPick(): void; }) {
    return (
        <button type="button" className={classes(rb("shop-row"), on && rb("shop-row-on"))} onClick={onPick} title={item.description || item.name}>
            {item.icon ? <img src={item.icon} alt="" loading="lazy" /> : <span className={rb("img-none")}>🎟️</span>}
            <span className={rb("shop-name")}>
                <b>{item.name}</b>
                {item.description && <small>{item.description.split("\n")[0].slice(0, 110)}</small>}
            </span>
            {item.forSale && item.price != null ? (
                <span className={rb("shop-price")}>
                    <b>{item.price ? rbx(item.price) : "Free"}</b>
                    {!!item.price && <small>keeps {rbx(keep(item.price))}</small>}
                </span>
            ) : <span className={classes(rb("shop-price"), rb("price-off"))}><b>Off sale</b></span>}
        </button>
    );
}

export function GameShop({ placeId }: { placeId: string; }) {
    const [state, setState] = useState<{ shop?: RbxShop; error?: string; }>({});
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<Kind>("passes");
    const [sort, setSort] = useState<Sort>("high");
    const [q, setQ] = useState("");
    const [pick, setPick] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (!open) return;
        let alive = true;
        setState({});
        fetchShop(placeId, tick > 0).then(r => alive && setState(r.ok ? { shop: r.shop } : { error: r.error }));
        return () => { alive = false; };
    }, [placeId, open, tick]);

    const items = useMemo(() => {
        const all = state.shop?.[kind] ?? [];
        const t = q.trim().toLowerCase();
        const val = (i: RbxPass) => i.forSale && i.price != null ? i.price : -1;
        return all.filter(i => !t || i.name.toLowerCase().includes(t) || i.description.toLowerCase().includes(t)).sort((a, b) =>
            sort === "high" ? val(b) - val(a) : sort === "low" ? (val(a) < 0 ? 1 : val(b) < 0 ? -1 : val(a) - val(b)) : sort === "new" ? Date.parse(b.updated || "0") - Date.parse(a.updated || "0") : a.name.localeCompare(b.name));
    }, [state.shop, kind, sort, q]);

    if (!open) return <button type="button" className={classes("vc-tool-btn", rb("shop-open"))} onClick={() => setOpen(true)}>🎟️ Game passes & products</button>;
    if (state.error) return <span className={rb("muted")}>🎟️ Couldn't get the shop: {state.error}</span>;
    if (!state.shop) return <div className={rb("loading")}><span className={rb("spin")} /> Opening the shop…</div>;

    const { passes, products } = state.shop;
    const picked = items.find(i => i.id === pick && i.forSale && i.price);
    const copy = () => copyWithToast(items.map(i => `${i.name} — ${i.forSale && i.price != null ? rbx(i.price) : "off sale"}`).join("\n"), "Price list copied");

    return (
        <div className={rb("shop")}>
            <div className={rb("outfit-head")}>
                <div>
                    <b>🎟️ {passes.length} game pass{passes.length === 1 ? "" : "es"} · {products.length >= 300 ? "300+" : products.length} developer product{products.length === 1 ? "" : "s"}</b>
                    <span>Prices, and what the creator keeps after Roblox's {Math.round(ROBUX.fee * 100)}% cut. Roblox keeps sales numbers private.</span>
                </div>
                <span className={rb("spacer")} />
                <button type="button" className={rb("link")} onClick={copy}>Copy list</button>
                <button type="button" className={rb("link")} onClick={() => setTick(t => t + 1)} title="Check again">↻</button>
            </div>
            <div className={rb("filters")}>
                <div className="vc-tool-seg">
                    <button type="button" className={classes("vc-tool-seg-btn", kind === "passes" && "vc-tool-seg-on")} onClick={() => { setKind("passes"); setPick(null); }}>Game passes ({passes.length})</button>
                    <button type="button" className={classes("vc-tool-seg-btn", kind === "products" && "vc-tool-seg-on")} onClick={() => { setKind("products"); setPick(null); }}>Products ({products.length})</button>
                </div>
                <select className="vc-tool-select" value={sort} onChange={e => setSort(e.currentTarget.value as Sort)}>
                    <option value="high">Priciest first</option>
                    <option value="low">Cheapest first</option>
                    <option value="new">Recently changed</option>
                    <option value="name">A to Z</option>
                </select>
                <input className={classes("vc-tool-input", rb("shop-search"))} value={q} placeholder="Search…" onChange={e => setQ(e.currentTarget.value)} />
            </div>
            <Stats items={state.shop[kind]} />
            {picked ? <WhatIf key={picked.id} item={picked} /> : <span className="vc-tool-hint">Click one to see what it would earn if it sold a number of times.</span>}
            <div className={rb("shop-list")}>
                {items.map(i => <Row key={i.id} item={i} on={pick === i.id} onPick={() => setPick(p => p === i.id ? null : i.id)} />)}
                {!items.length && <span className={rb("muted")}>{q ? "Nothing matches." : kind === "passes" ? "This game doesn't sell any game passes." : "This game doesn't sell any developer products."}</span>}
            </div>
        </div>
    );
}
