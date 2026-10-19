/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The glowing card at the top of a Sonata window: an icon, a title, a line
// about what's going on, a big number or two, and the main actions.

import type { ReactNode } from "react";

export interface HeroNumber { value: ReactNode; label: string; }

export function ToolHero({ icon, kicker, title, sub, numbers = [], children }: { icon: ReactNode; kicker?: string; title: ReactNode; sub?: ReactNode; numbers?: HeroNumber[]; children?: ReactNode; }) {
    return (
        <section className="vc-tool-hero">
            <span className="vc-tool-hero-icon" aria-hidden>{icon}</span>
            <div className="vc-tool-hero-text">
                {kicker && <span className="vc-tool-hero-kicker">{kicker}</span>}
                <b>{title}</b>
                {sub && <span>{sub}</span>}
            </div>
            {(numbers.length > 0 || children) && (
                <div className="vc-tool-hero-side">
                    {numbers.map((n, i) => <div key={i} className="vc-tool-hero-num"><b>{n.value}</b><span>{n.label}</span></div>)}
                    {children}
                </div>
            )}
        </section>
    );
}
