/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Dates <-> Discord IDs, kept free of Discord so it can be tested on its own.
// Every Discord ID ("snowflake") starts with the time it was made, counted in
// milliseconds since the start of 2015.

const DISCORD_EPOCH = 1420070400000n;

export const snowflakeAt = (ms: number) => ((BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n).toString();
export const timeOf = (id: string) => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export interface DayWindow {
    year: number;
    yearsAgo: number;
    /** Local midnight that day, and the next. */
    start: Date;
    end: Date;
    /** IDs just before the day starts and when it ends. */
    afterId: string;
    beforeId: string;
}

/**
 * Today's date in each past year, back to when the channel was made. Feb 29
 * falls back to Feb 28 in years without one.
 */
export function pastDays(today: Date, channelCreated: number, maxYears = 20): DayWindow[] {
    const days: DayWindow[] = [];
    for (let ago = 1; ago <= maxYears; ago++) {
        const year = today.getFullYear() - ago;
        const month = today.getMonth();
        const day = month === 1 && today.getDate() === 29 && !isLeap(year) ? 28 : today.getDate();
        const start = new Date(year, month, day);
        const end = new Date(year, month, day + 1);
        if (end.getTime() <= channelCreated) break;
        if (start.getTime() < Number(DISCORD_EPOCH)) break;
        days.push({ year, yearsAgo: ago, start, end, afterId: snowflakeAt(start.getTime() - 1), beforeId: snowflakeAt(end.getTime()) });
    }
    return days;
}

/** Is this message ID from inside the day? */
export const inDay = (id: string, d: DayWindow) => BigInt(id) > BigInt(d.afterId) && BigInt(id) < BigInt(d.beforeId);
