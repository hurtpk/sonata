/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// What Sonata Insights can see of Sonata's core: every feature with its status,
// how many patches it adds, how long it took to start and any start-up error,
// plus the settings and their definitions. Sonata's index fills this in, the
// same way it provides the dock's feature list.

import type { FeatureStatus } from "../controller/ControlCenter";

export interface DoctorFeature {
    key: string;
    name: string;
    status: FeatureStatus;
    on: boolean;
    patches: number;
    /** Milliseconds it took to start this session (if it started). */
    startMs?: number;
    /** Why it failed to start, if it did. */
    error?: string;
    /** The built-in plugin it's waiting on, when paused. */
    pausedBy?: string;
    /** The feature it needs that's off. */
    needs?: string;
}

export interface DoctorProvider {
    features(): DoctorFeature[];
    /** Sonata's settings store, and each option's definition. */
    store: Record<string, any>;
    defs: Record<string, any>;
    setOn(key: string, on: boolean): void;
    reload(): void;
    /** The feature has a window you open (so Sonata can tell whether you use it). */
    hasWindow?(key: string): boolean;
}

let provider: DoctorProvider | null = null;
export const setDoctorProvider = (p: DoctorProvider) => { provider = p; };
export const doctor = () => provider;

// Start-up timings and errors, recorded as features start.
export const startTimes = new Map<string, number>();
export const startErrors = new Map<string, string>();
