/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { openModal, React, SelectedChannelStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { EFFECTS, playEffect } from "../_shared/effects";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { messageRect } from "./anchor";
import { defaultConfig, getConfig, saveConfig } from "./settings";
import { Config, effectsFor } from "./triggers";

const cl = classNameFactory("vc-fx-");
const ORDER = EFFECTS.map(e => e.id);

/** Previews play from the newest message in the chat you have open. */
const preview = (id: string, text = "Hello from Sonata!") =>
    playEffect(id, { text, anchor: () => messageRect(SelectedChannelStore.getChannelId() ?? "") });

function EffectsModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const [config, setConfig] = useState<Config>(getConfig);
    const [test, setTest] = useState("");
    const accent = windowAccent("chatEffects");

    const update = (next: Config) => { setConfig(next); saveConfig(next); };
    const patch = (id: string, p: Partial<Config[string]>) => update({ ...config, [id]: { ...config[id], ...p } });
    const hits = test.trim() ? effectsFor(test, config, ORDER) : [];
    const onCount = ORDER.filter(id => config[id]?.on).length;

    return (
        <Window {...modalProps} size="lg" title="Chat Effects" subtitle={`${onCount} of ${EFFECTS.length} effects on · only you see them`}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="🎉" kicker="Chat Effects" title={`${onCount} of ${EFFECTS.length} effects on`}
                    sub="Confetti, balloons and more when a message says the magic words — only you see them." />
                <div className={cl("test")}>
                    <input className={cl("input")} value={test} placeholder="Try a message, e.g. “happy birthday!” — see what it would trigger"
                        onChange={e => setTest(e.currentTarget.value)}
                        onKeyDown={e => { if (e.key === "Enter") hits.forEach(id => preview(id, test)); }} />
                    <div className={cl("test-result")}>
                        {!test.trim() ? "Separate trigger words with commas. Whole words only — “yay” won't fire on “papaya”."
                            : hits.length ? <>Triggers {hits.map(id => EFFECTS.find(e => e.id === id)!.name).join(", ")} — press Enter to play</>
                                : "Doesn't trigger anything."}
                    </div>
                </div>
                <div className={cl("list")}>
                    {EFFECTS.map((e, i) => {
                        const heading = i === 0 ? "iMessage effects" : !e.apple && EFFECTS[i - 1].apple ? "More effects" : null;
                        const c = config[e.id] ?? { on: false, words: "" };
                        return (
                            <React.Fragment key={e.id}>
                            {heading && <div className={cl("section")}>{heading}</div>}
                            <div className={classes(cl("row"), !c.on && cl("row-off"), hits.includes(e.id) && cl("row-hit"))}>
                                <label className={cl("toggle")} title={c.on ? "On" : "Off"}>
                                    <input type="checkbox" checked={c.on} onChange={ev => patch(e.id, { on: ev.currentTarget.checked })} />
                                    <span className={cl("icon")}>{e.icon}</span>
                                    <span className={cl("name")}>{e.name}</span>
                                </label>
                                <input className={classes(cl("input"), cl("words"))} value={c.words} disabled={!c.on} spellCheck={false}
                                    placeholder={e.apple && !e.words.length ? "Add your own words" : "No trigger words"} aria-label={`${e.name} trigger words`}
                                    onChange={ev => patch(e.id, { words: ev.currentTarget.value })} />
                                <button type="button" className={cl("btn")} onClick={() => preview(e.id)}>Preview</button>
                            </div>
                            </React.Fragment>
                        );
                    })}
                </div>
                <div className={cl("footer")}>
                    <button type="button" className={cl("btn")} onClick={() => update(defaultConfig())}>Reset to defaults</button>
                    <button type="button" className={cl("btn")} onClick={() => update(Object.fromEntries(ORDER.map(id => [id, { ...config[id], on: false }])))}>All off</button>
                    <button type="button" className={cl("btn")} onClick={() => update(Object.fromEntries(ORDER.map(id => [id, { ...config[id], on: true }])))}>All on</button>
                </div>
            </div>
        </Window>
    );
}

export function openEffects() {
    openModal(props => <EffectsModal modalProps={props} />);
}
