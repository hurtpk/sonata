/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ReactNode } from "react";

// The player's icons: one set of rounded line icons, drawn on a 24 grid, in the text colour.
const Line = ({ size = 16, children }: { size?: number; children: ReactNode; }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);

export const PlayIcon = ({ size = 18 }: { size?: number; }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden><path d="M8 5.6v12.8a1.1 1.1 0 0 0 1.7.93l10-6.4a1.1 1.1 0 0 0 0-1.86l-10-6.4A1.1 1.1 0 0 0 8 5.6z" /></svg>
);
export const PauseIcon = ({ size = 18 }: { size?: number; }) => (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden><rect x="6" y="5" width="4.2" height="14" rx="1.4" /><rect x="13.8" y="5" width="4.2" height="14" rx="1.4" /></svg>
);

export const LoopIcon = () => <Line><path d="M17 2l3 3-3 3" /><path d="M4 11V9a4 4 0 0 1 4-4h12" /><path d="M7 22l-3-3 3-3" /><path d="M20 13v2a4 4 0 0 1-4 4H4" /></Line>;

export const VolumeIcon = ({ level }: { level: number; }) => (
    <Line>
        <path d="M11 5L6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
        <path d="M11 5L6 9H3v6h3l5 4V5z" />
        {level === 0
            ? <><path d="M16 9.5l5 5" /><path d="M21 9.5l-5 5" /></>
            : <><path d="M15.5 9a4 4 0 0 1 0 6" />{level >= 0.5 && <path d="M18.5 6a8 8 0 0 1 0 12" />}</>}
    </Line>
);

/** "Play all": a list with a play mark. */
export const QueueIcon = () => <Line><path d="M3 6h12" /><path d="M3 12h9" /><path d="M3 18h7" /><path d="M16 13.5v6.5l5-3.25z" fill="currentColor" /></Line>;

/** Pop out: a small window coming out of a bigger one. */
export const PopOutIcon = () => <Line><path d="M20 12v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h5" /><rect x="14" y="4" width="6" height="5" rx="1.2" fill="currentColor" /></Line>;

export const DownloadIcon = () => <Line><path d="M12 4v11" /><path d="M7.5 10.5L12 15l4.5-4.5" /><path d="M5 20h14" /></Line>;

export const NextIcon = () => (
    <svg viewBox="0 0 24 24" width={15} height={15} fill="currentColor" aria-hidden><path d="M5 6.2v11.6a1 1 0 0 0 1.55.83L15 13v4.8a1 1 0 0 0 2 0V6.2a1 1 0 0 0-2 0V11L6.55 5.37A1 1 0 0 0 5 6.2z" /></svg>
);
export const CloseIcon = () => <Line size={15}><path d="M6 6l12 12" /><path d="M18 6L6 18" /></Line>;
