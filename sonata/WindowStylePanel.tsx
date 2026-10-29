/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function WindowStylePanel({ store }: { store: { sonataWinFooter?: boolean; }; }) {
    return (
        <section className="sonata-panel sonata-appearance">
            <h3 className="sonata-panel-title">Window details</h3>
            <label className="sonata-check">
                <input type="checkbox" checked={store.sonataWinFooter !== false} onChange={e => { store.sonataWinFooter = e.currentTarget.checked; }} />
                Show the status line in feature windows
            </label>
            <p className="sonata-field-hint">Displays activity and status information along the bottom of a window.</p>
        </section>
    );
}
