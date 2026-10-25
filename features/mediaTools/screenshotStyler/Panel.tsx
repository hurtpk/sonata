/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, DraftType, SelectedChannelStore, showToast, UploadHandler, useEffect, useMemo, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { openSection, replaceOriginal } from "../../_shared/Hub";
import { Window } from "../../_shared/Window";
import {
    ALL_FILTERS, Aspect, Background, Brush, canvasToFile, DEFAULT_ADJUSTMENTS, DEFAULT_OPTIONS, FILTER_GROUPS, filterThumbs, GRADIENTS, ImageEdits, loadImage, LOOKS, MarkTool,
    NO_EDITS, renderStyled, renderStyledLayout, Styled, StyleOptions, TEXT_FONTS, TextStyle, Tool, toOriginalPoint, WindowBar
} from "./render";

const cl = classNameFactory("vc-shot-");

/** Put a file in the chat box of the channel you're in, like pasting it would. */
async function attach(file: File) {
    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    if (!channel) { showToast("Open a channel first", "failure"); return false; }
    replaceOriginal(); await UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage);
    return true;
}

async function clipboardImage(): Promise<Blob | null> {
    try {
        for (const item of await navigator.clipboard.read()) {
            const type = item.types.find(t => t.startsWith("image/"));
            if (type) return await item.getType(type);
        }
    } catch { }
    return null;
}

const sameBg = (a: Background, b: Background) => a.kind === b.kind && (a.kind !== "gradient" || a.id === (b as any).id);

function Slider({ label, value, min, max, onChange, suffix = "" }: { label: string; value: number; min: number; max: number; onChange(v: number): void; suffix?: string; }) {
    return (
        <label className={cl("slider")}>
            <span className={cl("slider-top")}>
                <span>{label}</span>
                {/* Double-click the number to put it back to zero. */}
                <span className={cl("value")} onDoubleClick={e => { e.preventDefault(); onChange(min < 0 ? 0 : min); }}>{value > 0 && min < 0 ? "+" : ""}{value}{suffix}</span>
            </span>
            <input type="range" min={min} max={max} value={value} onChange={e => onChange(Number(e.currentTarget.value))} />
        </label>
    );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange(v: T): void; }) {
    return (
        <div className={cl("seg")}>
            {options.map(([id, label]) => (
                <button key={id} type="button" className={classes(cl("seg-btn"), value === id && cl("seg-on"))} onClick={() => onChange(id)}>{label}</button>
            ))}
        </div>
    );
}

const TOOLS: { id: Tool; label: string; hint: string; }[] = [
    { id: "crop", label: "Crop", hint: "Drag over the part to keep" },
    { id: "draw", label: "✏️ Draw", hint: "Draw on the picture with the brush" },
    { id: "blur", label: "Blur", hint: "Drag over what to blur" },
    { id: "pixelate", label: "Pixelate", hint: "Drag over what to pixelate" },
    { id: "redact", label: "Black out", hint: "Drag over what to cover (uses the colour)" },
    { id: "box", label: "Box", hint: "Drag to draw a box around something" },
    { id: "circle", label: "Circle", hint: "Drag to circle something" },
    { id: "spotlight", label: "Spotlight", hint: "Drag over what to keep bright; the rest dims" },
    { id: "arrow", label: "Arrow", hint: "Drag from the tail to the tip" },
    { id: "text", label: "Text", hint: "Click where the text should start" },
    { id: "sticker", label: "😀 Sticker", hint: "Click where the sticker should go" },
];

type Tab = "frame" | "adjust" | "edit";
interface Drag { x1: number; y1: number; x2: number; y2: number; }

export function StylerModal({ modalProps, initial, startOptions, saveOptions }: {
    modalProps: RenderModalProps; initial: Blob | null; startOptions: StyleOptions; saveOptions(o: StyleOptions): void;
}) {
    const accent = windowAccent("screenshotStyler");
    const [source, setSource] = useState<{ blob: Blob; img: HTMLImageElement; } | null>(null);
    const [opts, setOpts] = useState<StyleOptions>(startOptions);
    const [edits, setEdits] = useState<ImageEdits>(NO_EDITS);
    const [history, setHistory] = useState<ImageEdits[]>([]);
    const [tab, setTab] = useState<Tab>("frame");
    const [tool, setTool] = useState<Tool | null>(null);
    const [markColor, setMarkColor] = useState("#f23f43");
    const [markText, setMarkText] = useState("Look here");
    const [textFont, setTextFont] = useState("default");
    const [textSize, setTextSize] = useState(4);
    const [textStyle, setTextStyle] = useState<TextStyle>("outline");
    const [sticker, setSticker] = useState("😂");
    const [stickerSize, setStickerSize] = useState(4);
    const [drag, setDrag] = useState<Drag | null>(null);
    const [brush, setBrush] = useState<Brush>("pen");
    const [brushSize, setBrushSize] = useState(4);
    /** The stroke being drawn, in screen pixels relative to the stage (for the live preview). */
    const [stroke, setStroke] = useState<[number, number][] | null>(null);
    const strokeScreen = useRef<[number, number][]>([]);
    const [solid, setSolid] = useState(startOptions.background.kind === "solid" ? startOptions.background.color : "#1e1f22");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [dims, setDims] = useState<string | null>(null);
    const stage = useRef<HTMLDivElement>(null);
    const preview = useRef<HTMLDivElement>(null);
    const layout = useRef<Styled | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const use = (blob: Blob) => loadImage(blob).then(img => {
        setSource({ blob, img });
        setEdits(NO_EDITS);
        setHistory([]);
        setError(null);
    }).catch(e => setError(e.message));

    useEffect(() => { if (initial) use(initial); }, []);

    // Every edit can be undone (the last 50).
    const edit = (next: ImageEdits | ((e: ImageEdits) => ImageEdits)) => {
        setHistory(h => [...h.slice(-49), edits]);
        setEdits(typeof next === "function" ? next(edits) : next);
    };
    const undo = () => {
        if (!history.length) return;
        setEdits(history[history.length - 1]);
        setHistory(history.slice(0, -1));
    };

    // Ctrl+V while the window is open swaps in whatever image you paste; Ctrl+Z undoes the last edit.
    useEffect(() => {
        const onPaste = (e: ClipboardEvent) => {
            const file = Array.from(e.clipboardData?.files ?? []).find(f => f.type.startsWith("image/"));
            if (!file) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            use(file);
        };
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && (e.target as HTMLElement)?.tagName !== "INPUT") {
                e.preventDefault();
                undo();
            } else if (e.key === "Escape" && tool) {
                // Stop drawing, rather than closing the window.
                e.preventDefault();
                e.stopImmediatePropagation();
                setTool(null);
            }
        };
        document.addEventListener("paste", onPaste, true);
        document.addEventListener("keydown", onKey, true);
        return () => {
            document.removeEventListener("paste", onPaste, true);
            document.removeEventListener("keydown", onKey, true);
        };
    }, [tool, history]);

    // Redraw the preview as options change.
    useEffect(() => {
        const box = preview.current;
        if (!box || !source) return;
        try {
            const styled = renderStyledLayout(source.img, opts, edits);
            styled.canvas.className = cl("canvas");
            layout.current = styled;
            setDims(`${styled.canvas.width} × ${styled.canvas.height}`);
            box.replaceChildren(styled.canvas);
        } catch (e: any) {
            setError(String(e?.message ?? e));
        }
    }, [source, opts, edits]);

    const set = (p: Partial<StyleOptions>) => setOpts(o => ({ ...o, ...p }));

    // Previews of every filter on this screenshot.
    const thumbs = useMemo(() => {
        if (!source) return {} as Record<string, string>;
        try { return filterThumbs(source.img); } catch { return {} as Record<string, string>; }
    }, [source]);

    // ─── Drawing on the preview ───

    /** A point on the screen → the same spot on the original picture. */
    const toImage = (cx: number, cy: number): [number, number] | null => {
        const L = layout.current;
        if (!L || !source) return null;
        const r = L.canvas.getBoundingClientRect();
        const px = (cx - r.left) * L.canvas.width / r.width, py = (cy - r.top) * L.canvas.height / r.height;
        const u = Math.min(L.work.w, Math.max(0, (px - L.image.x) / L.image.w * L.work.w));
        const v = Math.min(L.work.h, Math.max(0, (py - L.image.y) / L.image.h * L.work.h));
        return toOriginalPoint(u, v, edits, source.img.width, source.img.height);
    };

    const local = (e: React.PointerEvent) => {
        const r = stage.current!.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top] as const;
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if (!tool || !source || e.button !== 0) return;
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const [x, y] = local(e);
        (e.currentTarget as any)._start = [e.clientX, e.clientY];
        if (tool === "draw") {
            strokeScreen.current = [[e.clientX, e.clientY]];
            setStroke([[x, y]]);
            return;
        }
        setDrag({ x1: x, y1: y, x2: x, y2: y });
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (stroke) {
            const last = strokeScreen.current[strokeScreen.current.length - 1];
            if (last && Math.hypot(e.clientX - last[0], e.clientY - last[1]) < 2) return;
            strokeScreen.current.push([e.clientX, e.clientY]);
            const [x, y] = local(e);
            setStroke(p => p && [...p, [x, y]]);
            return;
        }
        if (!drag) return;
        const [x, y] = local(e);
        setDrag(d => d && { ...d, x2: x, y2: y });
    };
    const onPointerUp = (e: React.PointerEvent) => {
        const start = (e.currentTarget as any)._start as [number, number] | undefined;
        if (stroke) {
            setStroke(null);
            const points = strokeScreen.current.map(([cx, cy]) => toImage(cx, cy)).filter(Boolean) as [number, number][];
            strokeScreen.current = [];
            if (!points.length) return;
            const [x1, y1] = points[0];
            edit(cur => ({ ...cur, marks: [...cur.marks, { tool: "draw", x1, y1, x2: x1, y2: y1, color: markColor, points, size: brushSize, brush }] }));
            return;
        }
        setDrag(null);
        if (!drag || !tool || !start || !source) return;
        const a = toImage(start[0], start[1]), b = toImage(e.clientX, e.clientY);
        if (!a || !b) return;
        const moved = Math.hypot(e.clientX - start[0], e.clientY - start[1]);

        if (tool === "text") {
            if (!markText.trim()) { setError("Type the text to add first."); return; }
            edit(cur => ({ ...cur, marks: [...cur.marks, { tool: "text", x1: a[0], y1: a[1], x2: a[0], y2: a[1], color: markColor, text: markText.trim(), font: textFont, size: textSize, textStyle }] }));
            return;
        }
        if (tool === "sticker") {
            if (!sticker.trim()) return;
            edit(cur => ({ ...cur, marks: [...cur.marks, { tool: "sticker", x1: a[0], y1: a[1], x2: a[0], y2: a[1], color: "#000", text: sticker.trim(), size: stickerSize }] }));
            return;
        }
        if (moved < 5) return;
        if (tool === "crop") {
            const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]);
            if (w < 8 || h < 8) return;
            edit(cur => ({ ...cur, crop: { x, y, w, h } }));
            setTool(null);
            return;
        }
        edit(cur => ({ ...cur, marks: [...cur.marks, { tool: tool as MarkTool, x1: a[0], y1: a[1], x2: b[0], y2: b[1], color: markColor }] }));
    };

    // ─── Output ───

    const output = async () => {
        if (!source) throw new Error("No screenshot yet");
        saveOptions(opts);
        return canvasToFile(renderStyled(source.img, opts, edits), "screenshot.png");
    };

    const run = async (fn: () => Promise<unknown>) => {
        setBusy(true);
        try { await fn(); } catch (e: any) { setError(String(e?.message ?? e)); } finally { setBusy(false); }
    };

    const send = () => run(async () => { if (await attach(await output())) modalProps.onClose(); });
    const sendOriginal = () => run(async () => {
        if (!source) return;
        const file = source.blob instanceof File ? source.blob : new File([source.blob], "screenshot.png", { type: source.blob.type || "image/png" });
        if (await attach(file)) modalProps.onClose();
    });
    const copy = () => run(async () => {
        const file = await output();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": file })]);
        showToast("Styled screenshot copied", "success");
    });
    const save = () => run(async () => {
        const file = await output();
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");
        a.href = url;
        a.download = `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

    const backgrounds: { bg: Background; label: string; swatch: string; }[] = [
        ...GRADIENTS.map(g => ({ bg: { kind: "gradient", id: g.id } as Background, label: g.name, swatch: `linear-gradient(135deg, ${g.colors.join(", ")})` })),
        { bg: { kind: "blur" }, label: "Blurred screenshot", swatch: "radial-gradient(circle at 30% 30%, #9aa5ff, #3b3f8f 70%)" },
        { bg: { kind: "solid", color: solid }, label: "Solid colour", swatch: solid },
        { bg: { kind: "none" }, label: "None (see-through)", swatch: "repeating-conic-gradient(#888 0 25%, #555 0 50%) 0 0 / 10px 10px" },
    ];

    const activeTool = TOOLS.find(t => t.id === tool);

    const frameTab = (
        <>
            <div className={cl("group")}>
                <div className={cl("label")}>Background</div>
                <div className={cl("swatches")}>
                    {backgrounds.map(b => (
                        <button key={b.label} type="button" title={b.label} aria-label={b.label}
                            className={classes(cl("swatch"), sameBg(opts.background, b.bg) && cl("swatch-on"))}
                            style={{ background: b.swatch }} onClick={() => set({ background: b.bg })} />
                    ))}
                </div>
                {opts.background.kind === "solid" && (
                    <input type="color" className={cl("color")} value={solid}
                        onChange={e => { setSolid(e.currentTarget.value); set({ background: { kind: "solid", color: e.currentTarget.value } }); }} />
                )}
            </div>

            <Slider label="Padding" value={opts.padding} min={0} max={25} suffix="%" onChange={v => set({ padding: v })} />
            <Slider label="Corners" value={opts.radius} min={0} max={40} onChange={v => set({ radius: v })} />
            <Slider label="Shadow" value={opts.shadow} min={0} max={100} onChange={v => set({ shadow: v })} />
            <div className={cl("group")}>
                <Slider label="Border" value={opts.border} min={0} max={20} onChange={v => set({ border: v })} />
                {opts.border > 0 && <input type="color" className={cl("color")} value={opts.borderColor} onChange={e => set({ borderColor: e.currentTarget.value })} />}
            </div>

            <div className={cl("group")}>
                <div className={cl("label")}>Shape</div>
                <Seg<Aspect> value={opts.aspect} onChange={v => set({ aspect: v, keepSize: false })}
                    options={[["auto", "Fit"], ["1:1", "1:1"], ["4:3", "4:3"], ["16:9", "16:9"], ["9:16", "9:16"]]} />
                <label className={cl("check")}>
                    <input type="checkbox" checked={opts.keepSize} onChange={e => set({ keepSize: e.currentTarget.checked })} />
                    <span>Same size as the original{source ? ` (${source.img.width} × ${source.img.height})` : ""}</span>
                </label>
            </div>

            <div className={cl("group")}>
                <div className={cl("label")}>Window bar</div>
                <Seg<WindowBar> value={opts.windowBar} onChange={v => set({ windowBar: v })} options={[["none", "None"], ["mac", "Mac"], ["windows", "Windows"]]} />
                {opts.windowBar !== "none" && (
                    <div className={cl("bar-row")}>
                        <input className={cl("input")} value={opts.title} placeholder="Title (optional)" onChange={e => set({ title: e.currentTarget.value })} />
                        <button type="button" className={cl("btn")} onClick={() => set({ barTheme: opts.barTheme === "dark" ? "light" : "dark" })}>
                            {opts.barTheme === "dark" ? "Dark" : "Light"}
                        </button>
                    </div>
                )}
            </div>

            <div className={cl("group")}>
                <div className={cl("label")}>Caption</div>
                <div className={cl("bar-row")}>
                    <input className={cl("input")} value={opts.caption} placeholder="Text under the screenshot" onChange={e => set({ caption: e.currentTarget.value })} />
                    {opts.caption.trim() && <input type="color" className={cl("color-sm")} value={opts.captionColor} onChange={e => set({ captionColor: e.currentTarget.value })} />}
                </div>
            </div>

            <button type="button" className={cl("link")} onClick={() => setOpts(o => ({ ...DEFAULT_OPTIONS, ...pickAdjustments(o) }))}>Reset frame</button>
        </>
    );

    const adjustTab = (
        <>
            {FILTER_GROUPS.map(g => (
                <div key={g.name} className={cl("group")}>
                    <div className={cl("label")}>Filters · {g.name}</div>
                    <div className={cl("filters")}>
                        {g.name === "Cities" && (
                            <button type="button" className={classes(cl("filter"), opts.photoFilter === "none" && cl("filter-on"))} onClick={() => set({ photoFilter: "none" })}>
                                {thumbs.none ? <img src={thumbs.none} alt="" /> : <span className={cl("filter-blank")} />}
                                <span>Normal</span>
                            </button>
                        )}
                        {g.filters.map(f => (
                            <button key={f.id} type="button" className={classes(cl("filter"), opts.photoFilter === f.id && cl("filter-on"))} onClick={() => set({ photoFilter: f.id, filterStrength: opts.photoFilter === f.id ? opts.filterStrength : 100 })}>
                                {thumbs[f.id] ? <img src={thumbs[f.id]} alt="" /> : <span className={cl("filter-blank")} />}
                                <span>{f.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ))}
            {opts.photoFilter !== "none" && <Slider label="Filter strength" value={opts.filterStrength} min={0} max={100} suffix="%" onChange={v => set({ filterStrength: v })} />}
            {ALL_FILTERS.find(f => f.id === opts.photoFilter)?.label && (
                <label className={cl("check")}>
                    <input type="checkbox" checked={opts.filterLabel} onChange={e => set({ filterLabel: e.currentTarget.checked })} />
                    <span>Show "{ALL_FILTERS.find(f => f.id === opts.photoFilter)!.label}" across the picture</span>
                </label>
            )}
            <div className={cl("group")}>
                <div className={cl("label")}>Look</div>
                <div className={cl("chips")}>
                    {LOOKS.map(l => (
                        <button key={l.id} type="button" className={classes(cl("chip"), opts.look === l.id && cl("chip-on"))} onClick={() => set({ look: l.id })}>{l.name}</button>
                    ))}
                </div>
            </div>
            <Slider label="Brightness" value={opts.brightness} min={-100} max={100} onChange={v => set({ brightness: v })} />
            <Slider label="Contrast" value={opts.contrast} min={-100} max={100} onChange={v => set({ contrast: v })} />
            <Slider label="Saturation" value={opts.saturation} min={-100} max={100} onChange={v => set({ saturation: v })} />
            <Slider label="Hue" value={opts.hue} min={-180} max={180} suffix="°" onChange={v => set({ hue: v })} />
            <Slider label="Warmth" value={opts.warmth} min={-100} max={100} onChange={v => set({ warmth: v })} />
            <div className={cl("group")}>
                <Slider label="Tint" value={opts.tintAmount} min={0} max={100} suffix="%" onChange={v => set({ tintAmount: v })} />
                {opts.tintAmount > 0 && <input type="color" className={cl("color")} value={opts.tint} onChange={e => set({ tint: e.currentTarget.value })} />}
            </div>
            <Slider label="Vignette" value={opts.vignette} min={0} max={100} onChange={v => set({ vignette: v })} />
            <Slider label="Grain" value={opts.grain} min={0} max={100} onChange={v => set({ grain: v })} />
            <Slider label="Soften" value={opts.soften} min={0} max={20} onChange={v => set({ soften: v })} />
            <button type="button" className={cl("link")} onClick={() => set(DEFAULT_ADJUSTMENTS)}>Reset adjustments</button>
        </>
    );

    const editTab = (
        <>
            <div className={cl("group")}>
                <div className={cl("label")}>Tool</div>
                <div className={cl("chips")}>
                    {TOOLS.map(t => (
                        <button key={t.id} type="button" title={t.hint} className={classes(cl("chip"), tool === t.id && cl("chip-on"))} onClick={() => setTool(tool === t.id ? null : t.id)}>{t.label}</button>
                    ))}
                </div>
                <div className={cl("hint")}>{activeTool ? `${activeTool.hint}. Esc to stop.` : "Pick a tool, then drag on the picture."}</div>
            </div>
            {tool === "draw" && (
                <div className={cl("group")}>
                    <div className={cl("label")}>Brush</div>
                    <Seg<Brush> value={brush} onChange={setBrush} options={[["pen", "Pen"], ["marker", "Highlighter"], ["neon", "Neon"], ["blur", "Blur"]]} />
                    {brush === "blur" && <div className={cl("hint")}>Paint over names, faces or numbers to blur just those bits.</div>}
                    <Slider label="Size" value={brushSize} min={1} max={20} onChange={setBrushSize} />
                </div>
            )}
            {(tool === "draw" || tool === "circle" || tool === "redact" || tool === "box" || tool === "arrow" || tool === "text") && (
                <div className={cl("group")}>
                    <div className={cl("label")}>Colour</div>
                    <div className={cl("bar-row")}>
                        {["#f23f43", "#f0b232", "#fde047", "#23a55a", "#22d3ee", "#5865f2", "#d946ef", "#ffffff", "#000000"].map(c => (
                            <button key={c} type="button" aria-label={c} className={classes(cl("dot"), markColor === c && cl("dot-on"))} style={{ background: c }} onClick={() => setMarkColor(c)} />
                        ))}
                        <input type="color" className={cl("color-sm")} value={markColor} onChange={e => setMarkColor(e.currentTarget.value)} />
                    </div>
                </div>
            )}
            {tool === "text" && (
                <div className={cl("group")}>
                    <input className={cl("input")} value={markText} placeholder="Text to add" onChange={e => setMarkText(e.currentTarget.value)} />
                    <div className={cl("label")}>Font</div>
                    <div className={cl("chips")}>
                        {TEXT_FONTS.map(font => (
                            <button key={font.id} type="button" className={classes(cl("chip"), textFont === font.id && cl("chip-on"))} style={{ fontFamily: font.css, fontWeight: font.weight }} onClick={() => setTextFont(font.id)}>{font.name}</button>
                        ))}
                    </div>
                    <Slider label="Size" value={textSize} min={1} max={12} onChange={setTextSize} />
                    <div className={cl("label")}>Look</div>
                    <Seg<TextStyle> value={textStyle} onChange={setTextStyle} options={[["outline", "Outline"], ["shadow", "Shadow"], ["pill", "Label"], ["plain", "Plain"]]} />
                </div>
            )}
            {tool === "sticker" && (
                <div className={cl("group")}>
                    <div className={cl("stickers")}>
                        {["😂", "💀", "😭", "🔥", "💯", "👀", "😎", "❤️", "✨", "👍", "👎", "🎉", "⭐", "🤔", "😳", "🙏", "⬆️", "➡️", "⬇️", "⬅️", "❌", "✅", "⚠️", "📌"].map(e => (
                            <button key={e} type="button" className={classes(cl("sticker"), sticker === e && cl("sticker-on"))} onClick={() => setSticker(e)}>{e}</button>
                        ))}
                    </div>
                    <input className={cl("input")} value={sticker} maxLength={8} placeholder="Or type / paste any emoji" onChange={e => setSticker(e.currentTarget.value)} />
                    <Slider label="Size" value={stickerSize} min={1} max={12} onChange={setStickerSize} />
                </div>
            )}

            <div className={cl("group")}>
                <div className={cl("label")}>Turn</div>
                <div className={cl("chips")}>
                    <button type="button" className={cl("chip")} onClick={() => edit(c => ({ ...c, rotate: ((c.rotate + 270) % 360) as ImageEdits["rotate"] }))}>⟲ Left</button>
                    <button type="button" className={cl("chip")} onClick={() => edit(c => ({ ...c, rotate: ((c.rotate + 90) % 360) as ImageEdits["rotate"] }))}>⟳ Right</button>
                    <button type="button" className={cl("chip")} onClick={() => edit(c => ({ ...c, flipH: !c.flipH }))}>⇋ Flip</button>
                    <button type="button" className={cl("chip")} onClick={() => edit(c => ({ ...c, flipV: !c.flipV }))}>⇵ Flip</button>
                </div>
            </div>

            <div className={cl("chips")}>
                <button type="button" className={cl("chip")} disabled={!history.length} onClick={undo}>Undo</button>
                <button type="button" className={cl("chip")} disabled={!edits.crop} onClick={() => edit(c => ({ ...c, crop: null }))}>Uncrop</button>
                <button type="button" className={cl("chip")} disabled={!edits.marks.length} onClick={() => edit(c => ({ ...c, marks: [] }))}>Clear marks</button>
                <button type="button" className={cl("chip")} disabled={edits === NO_EDITS} onClick={() => edit(NO_EDITS)}>Start over</button>
            </div>
        </>
    );

    return (
        <Window {...modalProps} size="xl" title="Screenshot Styler" subtitle={source && dims ? `${dims} when sent` : "Paste (Ctrl+V), drop or pick a screenshot"}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={cl("layout")}>
                    <div ref={stage} className={cl("stage")}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => { e.preventDefault(); const f = Array.from(e.dataTransfer.files).find(x => x.type.startsWith("image/")); if (f) use(f); }}>
                        {source
                            ? <div ref={preview} className={classes(cl("preview"), tool && cl("drawing"))}
                                onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)} />
                            : (
                                <div className={cl("empty")}>
                                    <span className={cl("empty-icon")} aria-hidden>🖼️</span>
                                    <div className={cl("empty-title")}>No screenshot yet</div>
                                    <div>Press Ctrl+V to paste one, drop an image here, or</div>
                                    <div className={cl("empty-actions")}>
                                        <button type="button" className={cl("btn")} onClick={() => fileInput.current?.click()}>Choose a file</button>
                                        <button type="button" className={cl("btn")} onClick={async () => { const b = await clipboardImage(); if (b) use(b); else setError("There's no image on your clipboard."); }}>Use clipboard</button>
                                    </div>
                                </div>
                            )}
                        {stroke && (
                            <svg className={cl("overlay")} aria-hidden>
                                <polyline className={cl("stroke")} points={stroke.map(p => p.join(",")).join(" ")}
                                    style={{ stroke: markColor, strokeWidth: Math.max(2, brushSize * (brush === "marker" ? 1.6 : 0.7)), opacity: brush === "marker" ? 0.45 : 1, filter: brush === "neon" ? `drop-shadow(0 0 6px ${markColor})` : undefined }} />
                            </svg>
                        )}
                        {drag && tool && (
                            <svg className={cl("overlay")} aria-hidden>
                                {tool === "arrow"
                                    ? <line x1={drag.x1} y1={drag.y1} x2={drag.x2} y2={drag.y2} />
                                    : tool === "circle"
                                        ? <ellipse cx={(drag.x1 + drag.x2) / 2} cy={(drag.y1 + drag.y2) / 2} rx={Math.abs(drag.x2 - drag.x1) / 2} ry={Math.abs(drag.y2 - drag.y1) / 2} />
                                    : tool !== "text" && <rect x={Math.min(drag.x1, drag.x2)} y={Math.min(drag.y1, drag.y2)} width={Math.abs(drag.x2 - drag.x1)} height={Math.abs(drag.y2 - drag.y1)} rx={4} />}
                            </svg>
                        )}
                        <input ref={fileInput} type="file" accept="image/*" hidden onChange={e => { const f = e.currentTarget.files?.[0]; if (f) use(f); e.currentTarget.value = ""; }} />
                    </div>

                    <div className={cl("side")}>
                        <Seg<Tab> value={tab} onChange={t => { setTab(t); if (t !== "edit") setTool(null); }} options={[["frame", "Frame"], ["adjust", "Adjust"], ["edit", "Edit"]]} />
                        <div className={cl("controls")}>
                            {tab === "frame" ? frameTab : tab === "adjust" ? adjustTab : editTab}
                        </div>
                    </div>
                </div>

                {error && <div className={cl("error")}>{error}</div>}

                <div className={cl("footer")}>
                    {source && <button type="button" className={cl("btn")} onClick={() => fileInput.current?.click()}>Another image…</button>}
                    <span style={{ flex: 1 }} />
                    {source && <button type="button" className={cl("btn")} disabled={busy} onClick={sendOriginal}>Attach original</button>}
                    <button type="button" className={cl("btn")} disabled={!source || busy} onClick={save}>Save</button>
                    <button type="button" className={cl("btn")} disabled={!source || busy} onClick={copy}>Copy</button>
                    <button type="button" className={classes(cl("btn"), cl("btn-primary"))} disabled={!source || busy} onClick={send}>Attach to message</button>
                </div>
            </div>
        </Window>
    );
}

/** The colour adjustments out of a set of options (so resetting the frame keeps them). */
function pickAdjustments(o: StyleOptions) {
    const out: Partial<StyleOptions> = {};
    for (const k of Object.keys(DEFAULT_ADJUSTMENTS) as (keyof typeof DEFAULT_ADJUSTMENTS)[]) (out as any)[k] = o[k];
    return out;
}

export function openStyler(initial: Blob | null, startOptions: StyleOptions, saveOptions: (o: StyleOptions) => void) {
    openSection("mediaTools", "screenshotStyler", initial ? props => <StylerModal modalProps={props} initial={initial} startOptions={startOptions} saveOptions={saveOptions} /> : undefined);
}
