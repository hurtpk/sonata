/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "../_shared/tool.css";
import "./styles.css";

import type { RenderModalProps } from "@vencord/discord-types";
import definePlugin, { OptionType } from "@utils/types";

import { defineFeatureSettings } from "../../featureSettings";
import type { AngleMode, Rounding } from "./engine";
import { loadHistory } from "./history";
import { openSection, registerSection } from "../_shared/Hub";
import { CalcModal, CalcPrefs } from "./Panel";

export const settings = defineFeatureSettings("calculator", {
    angleMode: {
        type: OptionType.SELECT,
        description: "Angle unit for sin, cos and tan",
        options: [
            { label: "Degrees", value: "deg", default: true },
            { label: "Radians", value: "rad" },
        ],
    },
    rounding: {
        type: OptionType.SELECT,
        description: "How many decimals to show",
        options: [
            { label: "Automatic", value: "auto", default: true },
            { label: "Whole numbers", value: "0" },
            { label: "2 decimals", value: "2" },
            { label: "4 decimals", value: "4" },
            { label: "6 decimals", value: "6" },
            { label: "3 significant figures", value: "sig3" },
            { label: "5 significant figures", value: "sig5" },
        ],
    },
    showFractions: { type: OptionType.BOOLEAN, description: "Also show answers as fractions (7/12)", default: false },
    showBases: { type: OptionType.BOOLEAN, description: "Also show whole-number answers in hex, binary and octal", default: false },
});

const KEYS: Record<keyof CalcPrefs, string> = { angle: "angleMode", rounding: "rounding", fraction: "showFractions", bases: "showBases" };

const render = (props: RenderModalProps) => {
    const s = settings.store as any;
    return <CalcModal modalProps={props} prefs={{ angle: (s.angleMode as AngleMode) ?? "deg", rounding: (s.rounding as Rounding) ?? "auto", fraction: !!s.showFractions, bases: !!s.showBases }}
        setPrefs={p => { for (const [k, v] of Object.entries(p)) s[KEYS[k as keyof CalcPrefs]] = v; }} />;
};

registerSection("calculatorTools", { id: "calculator", feature: "calculator", name: "Calculator", sub: "Expressions and formulas", render });

export default definePlugin({
    name: "Calculator",
    description: "A calculator window with scientific functions, saved values (rent = 1200), percentages that work like you'd expect (200 + 10%), fractions and hex — plus Money (fees, tips & splitting, tax, discounts, deals, savings & loans, pay), Dates & time (days between, ages, adding up time) and Tools (statistics, graphs, aspect ratio, numbers in words, programmer).",
    authors: [{ name: "aiqen", id: 779172192461783110n }],
    settings,

    // Its own window — add it to the dock from Plugin Utilities → Dock.
    openSettingsModal: () => openSection("calculatorTools", "calculator"),

    start() {
        loadHistory();
    },
});
