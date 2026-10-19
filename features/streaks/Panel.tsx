/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Modal, NavigationRouter, openModal, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { ToolHero } from "../_shared/ToolHero";
import { atRiskNow, settings, todayNote, useStreaks } from "./index";
import { knownChannels, Rule, scanHistory, streakOf } from "./store";

const cl = classNameFactory("vc-tool-");
const st = classNameFactory("vc-streak-");

const recipientOf = (channelId: string) => {
    const ch: any = ChannelStore.getChannel(channelId);
    return ch?.type === 1 && ch.recipients?.[0] ? UserStore.getUser(ch.recipients[0]) as any : null;
};

function StreaksModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const accent = windowAccent("streaks");
    useStreaks();
    const s = settings.use(["rule", "minStreak"]);
    const rule = s.rule as Rule;
    const [scanning, setScanning] = useState<Record<string, string>>({});
    const [scanAll, setScanAll] = useState<string | null>(null);

    const rows = knownChannels()
        .map(id => ({ id, user: recipientOf(id), streak: streakOf(id, rule) }))
        .filter(r => r.user && (r.streak.count > 0 || r.streak.best > 1))
        .sort((a, b) => b.streak.count - a.streak.count || b.streak.best - a.streak.best);
    const top = rows[0]?.streak.count ? rows[0] : null;
    const liveCount = rows.filter(r => r.streak.count >= s.minStreak).length;
    const atRisk = rows.filter(r => r.streak.count >= s.minStreak && !r.streak.doneToday && atRiskNow()).length;
    const best = rows.reduce((n, r) => Math.max(n, r.streak.best), 0);

    const scanOne = async (id: string) => {
        setScanning(x => ({ ...x, [id]: "Scanning…" }));
        await scanHistory(id, rule, n => setScanning(x => ({ ...x, [id]: `Scanning… ${n * 100} messages` })));
        setScanning(x => { const { [id]: _, ...rest } = x; return rest; });
    };

    const scanRecent = async () => {
        const dms = (ChannelStore as any).getSortedPrivateChannels?.()?.filter((c: any) => c.type === 1).slice(0, 25) ?? [];
        for (let i = 0; i < dms.length; i++) {
            setScanAll(`Scanning ${i + 1} of ${dms.length}…`);
            await scanHistory(dms[i].id, rule, undefined, 15);
        }
        setScanAll(null);
    };

    return (
        <Modal {...modalProps} size="lg" title="Streaks" subtitle={rule === "both" ? "Days in a row you've both messaged" : "Days in a row either of you messaged"}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <ToolHero icon="🔥" kicker={atRisk ? `${atRisk} about to break` : top ? "Your longest streak" : "Streaks"}
                    title={top ? <>{top.user.globalName || top.user.username} · {top.streak.count} day{top.streak.count === 1 ? "" : "s"}</> : "No streaks yet"}
                    sub={top ? todayNote(top.streak, rule) : "They build up as you and your friends message each other every day."}
                    numbers={[{ value: liveCount, label: "going" }, { value: best, label: "best ever" }]}>
                    <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={!!scanAll} onClick={scanRecent}>{scanAll ?? "Scan recent DMs"}</button>
                </ToolHero>
                {rows.length ? (
                    <div className={st("list")}>
                        {rows.map(({ id, user, streak }) => {
                            const live = streak.count >= s.minStreak;
                            const risk = live && !streak.doneToday && atRiskNow();
                            return (
                                <div key={id} className={classes(st("row"), risk && st("row-risk"))}>
                                    <img className={st("avatar")} src={user.getAvatarURL?.(undefined, 80, false)} alt="" />
                                    <button type="button" className={st("who")} onClick={() => { NavigationRouter.transitionTo(`/channels/@me/${id}`); modalProps.onClose(); }}>
                                        <span className={st("name")}>{user.globalName || user.username}</span>
                                        <span className={st("note")}>{streak.count ? todayNote(streak, rule) : "No streak right now"} · best {streak.best}</span>
                                    </button>
                                    <span className={classes(st("big"), !streak.count && st("big-off"))}><span className={st("flame")} aria-hidden>🔥</span><b>{streak.count}</b><small>{risk ? "⌛ today" : "days"}</small></span>
                                    <button type="button" className={cl("btn")} disabled={!!scanning[id] || !!scanAll} onClick={() => scanOne(id)} title="Read back through this DM's history">
                                        {scanning[id] ?? "Scan"}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className={cl("empty")}><span className={cl("empty-icon")}>🔥</span>No streaks yet. They build up as you and your friends message each other — or scan your recent DMs to find the ones you already have.</div>
                )}
                <div className={cl("hint")}>Sonata counts days from the messages it sees, so streaks from before you turned this on need a scan. Scanning reads your own DM history only until it finds where each streak broke. Everything stays on this computer.</div>
            </div>
        </Modal>
    );
}

export function openStreaks() {
    openModal(props => <StreaksModal modalProps={props} />);
}
