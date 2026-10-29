/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function d1Store(database) {
    const statement = (sql, params) => params.length ? database.prepare(sql).bind(...params) : database.prepare(sql);
    return {
        async run(sql, ...params) { const result = await statement(sql, params).run(); return { changes: result.meta.changes }; },
        async get(sql, ...params) { return await statement(sql, params).first() ?? undefined; },
        async all(sql, ...params) { return (await statement(sql, params).all()).results; },
        async batch(statements) { return (await database.batch(statements.map(([sql, ...params]) => statement(sql, params)))).map(result => ({ changes: result.meta.changes })); },
        async cleanup() {
            const now = Date.now();
            const queries = ["devices", "pairings", "flows", "sessions", "bot_flows", "bot_sessions"].map(table => [`DELETE FROM ${table} WHERE expires < ?`, now]);
            queries.push(["DELETE FROM users WHERE blocked=0 AND COALESCE(last_seen,registered_at) < ?", now - 90 * 86400_000], ["DELETE FROM audit WHERE at < ?", now - 90 * 86400_000]);
            await database.batch(queries.map(([sql, ...params]) => statement(sql, params)));
        },
    };
}
