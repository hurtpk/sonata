/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Two items side by side: their 3D models, textures and details, and how
// alike they are — handy for spotting a copied UGC item.

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useEffect, useState } from "@webpack/common";

import { collectItem, Main, parseAssetInput, Part, Preview, TYPES } from "./Assets";
import { ago, date, fetchAssetInfo, RbxAssetInfo } from "./data";
import { compareFingerprints, compareShapes, fingerprint, sameBytes } from "./similar";

const rb = classNameFactory("vc-rbx-");
type Loaded = { info?: RbxAssetInfo; main?: Main; parts?: Part[]; error?: string; status?: string; };

const mainMesh = (parts?: Part[]) => parts?.find(p => p.mesh && p.what === "mesh" && !p.label.startsWith("Cage"));
const mainTex = (parts?: Part[]) => parts?.find(p => (p.what === "texture" || p.what === "template" || p.what === "image") && p.bytes && !p.label.includes("map"));

function useItem(id: string | null) {
    const [s, setS] = useState<Loaded>({});
    useEffect(() => {
        if (!id) { setS({}); return; }
        let alive = true;
        setS({ status: "Looking it up…" });
        (async () => {
            const [i, got] = await Promise.all([fetchAssetInfo(id), collectItem(id, st => alive && setS(o => ({ ...o, status: st })))]);
            if (!alive) return;
            setS(i.ok ? { info: i.info, ...got } : { error: i.error, ...got });
        })();
        return () => { alive = false; };
    }, [id]);
    return s;
}

function Column({ label, value, onChange, s }: { label: string; value: string; onChange(v: string): void; s: Loaded; }) {
    const [text, setText] = useState(value);
    const mesh = mainMesh(s.parts), tex = mainTex(s.parts);
    return (
        <div className={rb("ic-col")}>
            <div className={rb("bar")}>
                <span className={rb("ic-label")}>{label}</span>
                <input className="vc-tool-input" value={text} placeholder="Item link or ID" onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") onChange(text); }} />
                <button type="button" className="vc-tool-btn" onClick={() => onChange(text)}>Load</button>
            </div>
            {s.status && <div className={rb("loading")}><span className={rb("spin")} /> {s.status}</div>}
            {s.error && <span className="vc-tool-error">{s.error}</span>}
            {s.info && (
                <div className={rb("head")}>
                    {s.info.image ? <img className={rb("icon")} src={s.info.image} alt="" /> : <span className={classes(rb("icon"), rb("img-none"))}>📦</span>}
                    <div className={rb("who")}>
                        <b>{s.info.name}</b>
                        <span>{TYPES[s.info.typeId] ?? "Item"} · by {s.info.creator}</span>
                        <span>Uploaded {date(s.info.created)} ({ago(s.info.created)})</span>
                    </div>
                </div>
            )}
            {!s.status && s.parts && (mesh ? <Preview parts={s.parts} /> : tex?.url ? <img className={rb("ic-tex-big")} src={tex.url} alt="" /> : s.info && <span className={rb("muted")}>No 3D model or picture to show{s.main?.error ? ` — ${s.main.error}` : ""}.</span>)}
            {!s.status && (mesh || tex) && (
                <div className={rb("ic-facts")}>
                    {mesh?.mesh && <span>🧊 {(mesh.mesh.faces.length / 3).toLocaleString()} triangles · {(mesh.mesh.positions.length / 3).toLocaleString()} corners · mesh v{mesh.mesh.version}</span>}
                    {tex?.url && <span className={rb("ic-tex")}><img src={tex.url} alt="" /> {tex.label}{tex.preview ? " (preview)" : ""}</span>}
                </div>
            )}
        </div>
    );
}

function Meter({ label, score, hint }: { label: string; score: number | null; hint?: string; }) {
    const level = score == null ? "none" : score >= 90 ? "high" : score >= 60 ? "mid" : "low";
    return (
        <div className={classes(rb("ic-meter"), rb(`ic-${level}`))} title={hint}>
            <span>{label}</span>
            <b>{score == null ? "–" : `${score}%`}</b>
            <i><em style={{ width: `${score ?? 0}%` }} /></i>
        </div>
    );
}

export function ItemCompare({ initial }: { initial?: string; }) {
    const [a, setA] = useState<string | null>(() => initial ? parseAssetInput(initial)?.id ?? null : null);
    const [b, setB] = useState<string | null>(null);
    const A = useItem(a), B = useItem(b);
    const [tex, setTex] = useState<{ score: number; pattern: number; colour: number; } | null>(null);

    const ma = mainMesh(A.parts)?.mesh, mb = mainMesh(B.parts)?.mesh;
    const ta = mainTex(A.parts), tb = mainTex(B.parts);
    const shape = ma && mb ? compareShapes(ma, mb) : null;
    const sameMesh = sameBytes(mainMesh(A.parts)?.bytes, mainMesh(B.parts)?.bytes);
    const sameTex = sameBytes(ta?.original ?? ta?.bytes, tb?.original ?? tb?.bytes);

    useEffect(() => {
        setTex(null);
        if (!ta?.bytes || !tb?.bytes) return;
        let alive = true;
        Promise.all([fingerprint(ta.bytes), fingerprint(tb.bytes)]).then(([x, y]) => alive && x && y && setTex(compareFingerprints(x, y)));
        return () => { alive = false; };
    }, [ta?.bytes, tb?.bytes]);

    const both = !!(A.info && B.info && !A.status && !B.status);
    const shapeScore = sameMesh ? 100 : shape?.score ?? null;
    const texScore = sameTex ? 100 : tex?.score ?? null;
    const scores = [shapeScore, texScore].filter((x): x is number => x != null);
    const overall = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null;
    const older = both ? (Date.parse(A.info!.created) <= Date.parse(B.info!.created) ? "A" : "B") : null;
    const verdict = overall == null ? null : (sameMesh && (sameTex || !ta)) ? "The same files — one is a re-upload of the other." : overall >= 90 ? "Almost certainly a copy." : overall >= 70 ? "Very alike — likely based on the other." : overall >= 45 ? "Somewhat alike." : "Different items.";

    return (
        <div className={rb("ic")}>
            {both && (
                <div className={classes(rb("ic-verdict"), overall != null && overall >= 70 && rb("ic-verdict-hot"))}>
                    <div className={rb("ic-verdict-text")}>
                        <b>{verdict ?? "Not enough to compare"}</b>
                        {older && A.info!.created !== B.info!.created && <span>{older === "A" ? A.info!.name : B.info!.name} ({older}) was uploaded first — {ago(older === "A" ? A.info!.created : B.info!.created)}, by {older === "A" ? A.info!.creator : B.info!.creator}.</span>}
                    </div>
                    <div className={rb("ic-meters")}>
                        <Meter label="Shape" score={shapeScore} hint={sameMesh ? "The very same mesh file" : shape ? `How much of the two shapes lines up after sizing both the same · proportions ${shape.proportions}% alike` : "Needs a 3D mesh on both"} />
                        <Meter label="Texture" score={texScore} hint={sameTex ? "The very same picture" : tex ? `Pattern ${tex.pattern}% · colour ${tex.colour}%` : "Needs a texture on both"} />
                        <Meter label="Overall" score={overall} />
                    </div>
                </div>
            )}
            {both && shape && (
                <div className={rb("ic-stats")}>
                    <span>Triangles: <b>{shape.trisA.toLocaleString()}</b> vs <b>{shape.trisB.toLocaleString()}</b></span>
                    <span>Corners: <b>{shape.vertsA.toLocaleString()}</b> vs <b>{shape.vertsB.toLocaleString()}</b></span>
                    <span>Proportions: <b>{shape.proportions}%</b> alike</span>
                    {sameMesh && <span className={rb("ic-flag")}>Identical mesh file</span>}
                    {sameTex && <span className={rb("ic-flag")}>Identical texture</span>}
                </div>
            )}
            <div className={rb("ic-cols")}>
                <Column label="A" value={a ?? initial ?? ""} onChange={v => setA(parseAssetInput(v)?.id ?? null)} s={A} />
                <Column label="B" value="" onChange={v => setB(parseAssetInput(v)?.id ?? null)} s={B} />
            </div>
            <span className="vc-tool-hint">Shapes are compared after sizing both the same, so a scaled-up copy still matches; textures by a small fingerprint, so a re-saved or lightly edited copy still matches. A high score is a strong sign — not proof.</span>
        </div>
    );
}
