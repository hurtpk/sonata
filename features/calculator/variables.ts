/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The Calculator's saved variables ("rent = 1200"), kept on this computer.

import * as DataStore from "@api/DataStore";
import { useEffect, useState } from "@webpack/common";

const KEY = "Sonata_calc_vars";
let vars: Record<string, number> = {};
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

async function load() {
    vars = (await DataStore.get<Record<string, number>>(KEY).catch(() => undefined)) ?? {};
    loaded = true;
    emit();
}

const save = () => DataStore.set(KEY, vars).catch(() => { });

export const getVars = () => vars;
export function setVar(name: string, value: number) { vars = { ...vars, [name]: value }; save(); emit(); }
export function removeVar(name: string) { const { [name]: _, ...rest } = vars; vars = rest; save(); emit(); }

export function useVars() {
    const [, force] = useState(0);
    useEffect(() => {
        if (!loaded) void load();
        const l = () => force(n => n + 1);
        listeners.add(l);
        return () => { listeners.delete(l); };
    }, []);
    return vars;
}
