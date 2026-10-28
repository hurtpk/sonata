/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "../_shared/tool.css";

import { classes } from "@utils/misc";
import { RenderModalProps } from "@vencord/discord-types";
import { SearchableSelect, useMemo } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { openSection } from "../_shared/Hub";
import { ToolHero } from "../_shared/ToolHero";
import { Window } from "../_shared/Window";
import { resetLanguageDefaults, settings } from "./settings";
import { getLanguages } from "./utils";

type LangKey = "receivedInput" | "receivedOutput" | "sentInput" | "sentOutput";

function LanguageSelect({ settingsKey, includeAuto }: { settingsKey: LangKey; includeAuto: boolean; }) {
    const currentValue = settings.use([settingsKey])[settingsKey];
    const options = useMemo(() => {
        const options = Object.entries(getLanguages()).map(([value, label]) => ({ value, label }));
        if (!includeAuto) options.shift();
        return options;
    }, [settings.store.service]);

    return (
        <div className="vc-tool-field vc-trans-lang">
            <span className="vc-tool-label">{includeAuto ? "From" : "To"}</span>
            <SearchableSelect
                options={options}
                value={options.find(o => o.value === currentValue)?.value}
                placeholder="Pick a language"
                maxVisibleItems={6}
                closeOnSelect={true}
                onChange={v => settings.store[settingsKey] = v}
            />
        </div>
    );
}

const SERVICES = [
    { id: "google", name: "Google Translate", note: "Free, no setup" },
    { id: "deepl", name: "DeepL Free", note: "Needs a free API key" },
    { id: "deepl-pro", name: "DeepL Pro", note: "Needs a Pro API key" },
    { id: "kagi", name: "Kagi Translate", note: "Needs your Kagi session" },
] as const;

export function TranslateModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const s = settings.use(["service", "autoTranslate", "showAutoTranslateTooltip", "deeplApiKey", "kagiSession", "receivedInput", "receivedOutput", "sentInput", "sentOutput"]);
    const langs = getLanguages() as Record<string, string>;
    const name = (code: string) => code === "auto" ? "Any language" : langs[code] ?? code;
    const accent = windowAccent("translate");
    const deepl = s.service === "deepl" || s.service === "deepl-pro";

    return (
        <Window {...rootProps} size="lg" title="Translate" subtitle="Translate messages you get, and what you send — with the 🌐 button in the chat bar">
            <div className="vc-tool-wrap vc-trans-window" style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="🌐" kicker={`Using ${SERVICES.find(x => x.id === s.service)?.name ?? "Google Translate"}`}
                    title={<>{name(s.receivedInput)} <span className="vc-trans-hero-arrow">→</span> {name(s.receivedOutput)}</>}
                    sub={<>What you send: {name(s.sentInput)} → {name(s.sentOutput)}</>}
                    numbers={[{ value: s.autoTranslate ? "On" : "Off", label: "auto-translate" }]} />
                <section className="vc-tool-section">
                    <h3 className="vc-tool-section-title">🔌 Translation service</h3>
                    <div className="vc-tool-tiles">
                        {SERVICES.map(x => (
                            <button key={x.id} type="button" className={classes("vc-tool-tile", s.service === x.id && "vc-tool-tile-on")}
                                onClick={() => { settings.store.service = x.id; resetLanguageDefaults(); }}>
                                <b>{x.name}</b><span>{x.note}</span>
                            </button>
                        ))}
                    </div>
                    {deepl && (
                        <label className="vc-tool-field">
                            <span className="vc-tool-label">DeepL API key</span>
                            <input className="vc-tool-input" type="password" value={s.deeplApiKey} placeholder="From deepl.com → Account → API keys" onChange={e => settings.store.deeplApiKey = e.currentTarget.value} />
                        </label>
                    )}
                    {s.service === "kagi" && (
                        <label className="vc-tool-field">
                            <span className="vc-tool-label">Kagi session token</span>
                            <input className="vc-tool-input" type="password" value={s.kagiSession} placeholder="From kagi.com → Settings → Account" onChange={e => settings.store.kagiSession = e.currentTarget.value} />
                        </label>
                    )}
                </section>

                <div className="vc-trans-sides">
                <section className="vc-tool-section">
                    <h3 className="vc-tool-section-title">📥 Messages you get</h3>
                    <div className="vc-trans-pair">
                        <LanguageSelect settingsKey="receivedInput" includeAuto />
                        <span className="vc-trans-arrow" aria-hidden>→</span>
                        <LanguageSelect settingsKey="receivedOutput" includeAuto={false} />
                    </div>
                </section>

                <section className="vc-tool-section">
                    <h3 className="vc-tool-section-title">📤 Messages you send</h3>
                    <div className="vc-trans-pair">
                        <LanguageSelect settingsKey="sentInput" includeAuto />
                        <span className="vc-trans-arrow" aria-hidden>→</span>
                        <LanguageSelect settingsKey="sentOutput" includeAuto={false} />
                    </div>
                    <label className="vc-tool-check"><input type="checkbox" checked={!!s.autoTranslate} onChange={e => settings.store.autoTranslate = e.currentTarget.checked} /> Translate everything I send automatically</label>
                    <label className="vc-tool-check"><input type="checkbox" checked={s.showAutoTranslateTooltip !== false} onChange={e => settings.store.showAutoTranslateTooltip = e.currentTarget.checked} /> Show a note on the button when a message was translated</label>
                    <span className="vc-tool-hint">Shift+click or right-click the 🌐 button to switch automatic translation on or off quickly.</span>
                </section>
                </div>

                <div className="vc-tool-footer">
                    <span className="vc-tool-spacer" />
                    <button type="button" className="vc-tool-btn vc-tool-primary" onClick={rootProps.onClose}>Done</button>
                </div>
            </div>
        </Window>
    );
}

export function openTranslateModal() { openSection("writingAssistant", "translate", props => renderTranslateModal(props)); }

export function renderTranslateModal(props: RenderModalProps) {
    return (<TranslateModal rootProps={props} />);
}
