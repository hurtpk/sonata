/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../../_shared/tool.css";

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { RenderModalProps } from "@vencord/discord-types";
import { extractAndLoadChunksLazy } from "@webpack";
import { openModalLazy, useMemo, useRef, useState } from "@webpack/common";

import { windowAccent } from "../../../controller/accent";
import { Window } from "../../_shared/Window";
import { pickCharacters } from "../../textStyles/charactersPicker";
import { DEFAULT_COLOR, SWATCHES } from "../constants";
import { categoryLen, createCategory, getCategory } from "../data";
import { CategoryStyle, colorsOf, EffectId, EFFECTS, FillMode, GRADIENT_CHOICES, hexOf, normalizeStyle, numOf, StyledName } from "../style";

export const requireSettingsModal = extractAndLoadChunksLazy(['type:"USER_SETTINGS_MODAL_OPEN"']);

const cl = classNameFactory("vc-tool-");
const pd = classNameFactory("vc-pindms-ed-");

interface Props {
    categoryId: string | null;
    initialChannelId: string | null;
    modalProps: RenderModalProps;
}

function useCategory(categoryId: string | null, initalChannelId: string | null) {
    return useMemo(() => {
        if (categoryId) return getCategory(categoryId);
        if (initalChannelId) {
            return {
                id: crypto.randomUUID(),
                name: `Pin Category ${categoryLen() + 1}`,
                color: DEFAULT_COLOR,
                collapsed: false,
                channels: [initalChannelId],
            };
        }
    }, [categoryId, initalChannelId]);
}

/** A colour swatch that opens the system colour picker. */
function ColorWell({ value, onChange, label }: { value: string; onChange(hex: string): void; label: string; }) {
    return (
        <label className={pd("well")} style={{ background: value }} title={label}>
            <input type="color" value={value} onChange={e => onChange(e.currentTarget.value)} aria-label={label} />
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden><path fill="currentColor" d="M14.06 6.19l3.75 3.75L7.75 20H4v-3.75L14.06 6.19zm1.06-1.06 1.84-1.84a1 1 0 0 1 1.41 0l2.34 2.34a1 1 0 0 1 0 1.41l-1.84 1.84-3.75-3.75z" /></svg>
        </label>
    );
}

export function NewCategoryModal({ categoryId, modalProps, initialChannelId }: Props) {
    const category = useCategory(categoryId, initialChannelId);
    const accent = windowAccent("pinDms");
    const [name, setName] = useState(category?.name ?? "");
    const [color, setColor] = useState(category?.color ?? DEFAULT_COLOR);
    const [style, setStyle] = useState<CategoryStyle>(() => normalizeStyle((category as any)?.style));
    const nameRef = useRef<HTMLInputElement>(null);
    if (!category) return null;

    const patch = (p: Partial<CategoryStyle>) => setStyle(s => ({ ...s, ...p }));
    const toggleEffect = (id: EffectId) => patch({ effects: style.effects.includes(id) ? style.effects.filter(e => e !== id) : [...style.effects, id] });

    // Characters go in where the cursor was.
    const insertChar = (ch: string) => {
        const el = nameRef.current;
        setName(n => {
            const at = el?.selectionStart ?? n.length, end = el?.selectionEnd ?? n.length;
            const next = n.slice(0, at) + ch + n.slice(end);
            requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + ch.length, at + ch.length); });
            return next;
        });
    };

    const onSave = () => {
        if (!name.trim()) return;
        category.name = name;
        // Solid keeps the plain colour too, so older versions of Pin DMs still show something sensible.
        category.color = style.mode === "solid" ? color : numOf(colorsOf(style, color)[0]);
        (category as any).style = { ...style, effects: [...style.effects] };
        if (!categoryId) createCategory(category);
        modalProps.onClose();
    };

    const solidHex = hexOf(color);

    return (
        <Window {...modalProps} size="md" title={`${categoryId ? "Edit" : "New"} Category`} subtitle="Pinned DMs, grouped your way">
            <form
                className={cl("wrap")}
                style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}
                onSubmit={e => { e.preventDefault(); onSave(); }}
            >
                {/* How it'll look in your DM list. */}
                <div className={pd("preview")} aria-label="Preview">
                    <div className={pd("preview-head")}>
                        <StyledName name={name || " "} color={color} style={style} />
                        <svg className={pd("preview-chevron")} viewBox="0 0 24 24" width="14" height="14" aria-hidden><path fill="currentColor" d="M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z" /></svg>
                    </div>
                    <div className={pd("preview-row")}><span /><i /></div>
                    <div className={pd("preview-row")}><span /><i style={{ width: "38%" }} /></div>
                </div>

                <div className={cl("card")}>
                    <span className={cl("label")}>Name</span>
                    <div className={cl("row")}>
                        <input ref={nameRef} className={classes(cl("input"), cl("grow"))} value={name} maxLength={100} placeholder="Besties, Work, ✦ Gaming ✦…" onChange={e => setName(e.currentTarget.value)} />
                        <button type="button" className={cl("btn")} onClick={() => pickCharacters(insertChar, "the category name")} title="Add symbols from the Characters picker">✦ Characters</button>
                    </div>
                </div>

                <div className={cl("card")}>
                    <div className={cl("row")}>
                        <span className={cl("label")}>Colour</span>
                        <span className={cl("spacer")} />
                        <div className={cl("seg")}>
                            {(["solid", "gradient"] as FillMode[]).map(m => (
                                <button key={m} type="button" className={classes(cl("seg-btn"), style.mode === m && cl("seg-on"))} onClick={() => patch({ mode: m })}>{m === "solid" ? "Solid" : "Gradient"}</button>
                            ))}
                        </div>
                    </div>

                    {style.mode === "solid" ? (
                        <div className={pd("swatches")}>
                            <ColorWell value={solidHex} onChange={h => setColor(numOf(h))} label="Pick any colour" />
                            {SWATCHES.map(c => (
                                <button key={c} type="button" className={classes(pd("swatch"), c === color && pd("swatch-on"))} style={{ background: hexOf(c) }} onClick={() => setColor(c)} aria-label={hexOf(c)} />
                            ))}
                        </div>
                    ) : (
                        <>
                            <div className={pd("gradients")}>
                                {GRADIENT_CHOICES.map(g => (
                                    <button key={g.id} type="button" className={classes(pd("grad"), style.gradient === g.id && pd("grad-on"))} onClick={() => patch({ gradient: g.id })}>
                                        <span className={pd("grad-swatch")} style={{ background: `linear-gradient(135deg, ${g.colors.join(", ")})` }} />
                                        {g.name}
                                    </button>
                                ))}
                                <button type="button" className={classes(pd("grad"), style.gradient === "custom" && pd("grad-on"))} onClick={() => patch({ gradient: "custom" })}>
                                    <span className={pd("grad-swatch")} style={{ background: `linear-gradient(135deg, ${style.a}, ${style.b})` }} />
                                    Custom
                                </button>
                            </div>
                            {style.gradient === "custom" && (
                                <div className={cl("row")}>
                                    <ColorWell value={style.a} onChange={a => patch({ a })} label="First colour" />
                                    <button type="button" className={cl("btn")} onClick={() => patch({ a: style.b, b: style.a })} title="Swap colours">⇄</button>
                                    <ColorWell value={style.b} onChange={b => patch({ b })} label="Second colour" />
                                    <span className={cl("hint")}>Click a colour to change it.</span>
                                </div>
                            )}
                            <div className={cl("row")}>
                                <span className={cl("hint")}>Direction</span>
                                <input type="range" className={pd("range")} min={0} max={360} step={15} value={style.angle} disabled={style.effects.includes("flow")} onChange={e => patch({ angle: Number(e.currentTarget.value) })} />
                                <span className={cl("hint")}>{style.effects.includes("flow") ? "Flow moves it for you" : `${style.angle}°`}</span>
                            </div>
                        </>
                    )}
                </div>

                <div className={cl("card")}>
                    <span className={cl("label")}>Effects</span>
                    <div className={pd("effects")}>
                        {EFFECTS.map(e => {
                            const unavailable = e.gradientOnly && style.mode === "solid";
                            const on = style.effects.includes(e.id) && !unavailable;
                            return (
                                <button key={e.id} type="button" disabled={unavailable} className={classes(pd("fx"), on && pd("fx-on"))} onClick={() => toggleEffect(e.id)} title={unavailable ? "Needs a gradient" : e.blurb}>
                                    <span className={pd("fx-emoji")}>{e.emoji}</span>
                                    <span className={pd("fx-name")}>{e.name}</span>
                                    <span className={pd("fx-blurb")}>{unavailable ? "Needs a gradient" : e.blurb}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className={cl("footer")}>
                    {categoryId && <button type="button" className={cl("btn")} onClick={() => patch({ effects: [] })} disabled={!style.effects.length}>Clear effects</button>}
                    <span className={cl("spacer")} />
                    <button type="button" className={cl("btn")} onClick={modalProps.onClose}>Cancel</button>
                    <button type="submit" className={classes(cl("btn"), cl("primary"))} disabled={!name.trim()}>{categoryId ? "Save" : "Create"}</button>
                </div>
            </form>
        </Window>
    );
}

export const openCategoryModal = (categoryId: string | null, channelId: string | null) =>
    openModalLazy(async () => {
        await requireSettingsModal();
        return modalProps => <NewCategoryModal categoryId={categoryId} modalProps={modalProps} initialChannelId={channelId} />;
    });
