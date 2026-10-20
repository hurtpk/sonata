/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// A feature's options as a window form: each one's name and a line about it
// on the left, its control on the right. On/off, choices, numbers, sliders and
// text get Sonata's own controls; anything else (buttons, custom pickers) is
// drawn by Equicord as usual, under its name.

import { OptionComponentMap } from "@components/settings/tabs/plugins/components";
import { DefinedSettings, OptionType, PluginSettingDef } from "@utils/types";
import { useState } from "@webpack/common";

import { Choice, FormRow, Toggle } from "./WindowParts";

/** "notifyOffline" → "Notify offline". */
const wordsOf = (key: string) => {
    const w = key.replace(/^[^_]+_/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase().trim();
    return w.charAt(0).toUpperCase() + w.slice(1);
};

/** A setting's description as a short name and the rest as the line under it. */
export function labelOf(key: string, def: PluginSettingDef): [string, string | undefined] {
    const { displayName, description } = def as { displayName?: string; description?: string; };
    if (displayName) return [displayName, description || undefined];
    const d = (description ?? "").trim();
    const m = /^(.{3,60}?)(?:\.\s+| — | - |: )(.+)$/.exec(d);
    if (m) return [m[1], m[2].charAt(0).toUpperCase() + m[2].slice(1)];
    if (d && d.length <= 60) return [d.replace(/\.$/, ""), undefined];
    return [wordsOf(key), d || undefined];
}

const isDisabled = (def: PluginSettingDef, settings: DefinedSettings) =>
    typeof def.disabled === "function" ? !!def.disabled.call(settings) : !!def.disabled;

/** A text or number box. Numbers are saved once they're a number, so the box can be cleared while typing. */
function TextOption({ def, value, label, disabled, onChange }: { def: PluginSettingDef; value: any; label: string; disabled: boolean; onChange(v: any): void; }) {
    const isNum = def.type === OptionType.NUMBER;
    const [draft, setDraft] = useState(String(value ?? ""));
    return (
        <input className="vc-tool-input" type={isNum ? "number" : "text"} disabled={disabled} aria-label={label}
            placeholder={(def as { placeholder?: string; }).placeholder} value={draft}
            onChange={e => {
                const raw = e.currentTarget.value;
                setDraft(raw);
                if (!isNum) return onChange(raw);
                const n = Number(raw);
                if (raw !== "" && Number.isFinite(n)) onChange(n);
            }}
            onBlur={() => setDraft(String(value ?? ""))} />
    );
}

export interface OptionRowProps {
    id: string;
    def: PluginSettingDef;
    store: Record<string, any>;
    settings: DefinedSettings;
    onChange(value: any): void;
    onClose?(): void;
}

export function OptionRow({ id, def, store, settings, onChange, onClose }: OptionRowProps) {
    const [label, help] = labelOf(id, def);
    const value = store[id];
    const disabled = isDisabled(def, settings);
    const set = (v: any) => { if (!disabled) onChange(v); };

    switch (def.type) {
        case OptionType.BOOLEAN:
            return <FormRow label={label} help={help}><Toggle value={!!value} label={label} disabled={disabled} onChange={set} /></FormRow>;

        case OptionType.SELECT: {
            const opts = def.options;
            const current = value ?? opts.find(o => o.default)?.value;
            const short = opts.length <= 4 && opts.every(o => o.label.length <= 16);
            return (
                <FormRow label={label} help={help}>
                    {short
                        ? <Choice value={current} options={opts.map(o => [o.value, o.label] as const)} onChange={set} />
                        : (
                            <select className="vc-tool-select" disabled={disabled} value={String(current)} aria-label={label}
                                onChange={e => { const o = opts.find(x => String(x.value) === e.currentTarget.value); if (o) set(o.value); }}>
                                {opts.map(o => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
                            </select>
                        )}
                </FormRow>
            );
        }

        case OptionType.SLIDER: {
            const { markers } = def;
            const v = typeof value === "number" ? value : def.default;
            if (def.stickToMarkers !== false && markers.length <= 6)
                return <FormRow label={label} help={help}><Choice value={v} options={markers.map(m => [m, String(m)] as const)} onChange={set} /></FormRow>;
            const min = markers[0], max = markers[markers.length - 1];
            const step = def.stickToMarkers === false ? (max - min) / 100 : undefined;
            return (
                <FormRow label={label} help={help}>
                    <input type="range" className="vc-tool-range vc-sw-slider" min={min} max={max} step={step ?? "any"} value={v} disabled={disabled} aria-label={label}
                        onChange={e => {
                            let n = Number(e.currentTarget.value);
                            if (def.stickToMarkers !== false) n = markers.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a);
                            set(n);
                        }} />
                    <span className="vc-sw-slider-value">{Math.round(v * 100) / 100}</span>
                </FormRow>
            );
        }

        case OptionType.STRING:
        case OptionType.NUMBER:
            // Ones that check what's typed, and big text boxes, keep Equicord's own box (it shows the error).
            if (!def.isValid && !(def.type === OptionType.STRING && def.multiline)) {
                return <FormRow label={label} help={help}><TextOption def={def} value={value} label={label} disabled={disabled} onChange={set} /></FormRow>;
            }
    }

    const Component = OptionComponentMap[def.type];
    if (!Component) return null;
    // Equicord draws its own name and description for these.
    return (
        <div className="vc-sw-frow vc-sw-frow-stack vc-sw-native">
            <Component id={id} setting={def as any} pluginSettings={store as any} definedSettings={settings} closePluginSettings={onClose ?? (() => { })} onChange={onChange} />
        </div>
    );
}
