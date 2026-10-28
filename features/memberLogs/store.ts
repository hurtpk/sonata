/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { UserStore } from "@webpack/common";

export interface Evidence { id: string; name: string; type: string; size: number; kind: "image" | "video"; }
export interface MemberLog { id: string; userId: string; username?: string; guildId: string; title: string; notes: string; status: string; links: string[]; evidence: Evidence[]; created: number; updated: number; }
const logger = new Logger("SonataMemberLogs");
export const accountKey = () => `Sonata_memberLogs_${UserStore.getCurrentUser().id}`;
export const evidenceKey = (account: string, id: string) => `${account}:evidence:${id}`;
export const loadMemberLogs = () => DataStore.get<MemberLog[]>(accountKey()).then(value => value ?? []);
let queue: Promise<unknown> = Promise.resolve();

export function saveMemberLog(log: MemberLog, files: File[]) {
    const account = accountKey();
    const task = queue.then(async () => {
        const current = await DataStore.get<MemberLog[]>(account) ?? [];
        const additions: Evidence[] = files.map(file => ({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, kind: file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(file.name) ? "image" : "video" }));
        const saved = { ...log, username: log.username ?? UserStore.getUser(log.userId)?.username, evidence: [...log.evidence, ...additions], updated: Date.now() };
        const entries: [IDBValidKey, unknown][] = additions.map((file, index) => [evidenceKey(account, file.id), files[index]]);
        entries.push([account, [saved, ...current.filter(entry => entry.id !== log.id)]]);
        await DataStore.setMany(entries);
        return saved;
    });
    queue = task.catch(error => logger.error("Couldn't save a personal member log.", error));
    return task;
}

export const readEvidence = (id: string) => DataStore.get<Blob>(evidenceKey(accountKey(), id));
