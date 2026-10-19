/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import type { RenderModalProps } from "@vencord/discord-types";
import { GuildStore, Modal, openModal, SelectedGuildStore, showToast, useEffect, useRef, UserStore, useState } from "@webpack/common";

import { windowAccent } from "../../controller/accent";
import { applyProfile, Backup, backUp, fileData, lastBackup, Part, PARTS, ProfileDraft, readProfile, Target } from "./profile";

const cl = classNameFactory("vc-tool-");
const sp = classNameFactory("vc-steal-");

const EMPTY: ProfileDraft = { avatar: null, banner: null, displayName: "", pronouns: "", bio: "", accentColor: "", themeColors: null };

function Card({ draft, parts }: { draft: ProfileDraft; parts: Set<Part>; }) {
    const theme = parts.has("themeColors") && draft.themeColors;
    return (
        <div className={sp("card")} style={theme ? { background: `linear-gradient(${theme[0]}, ${theme[1]})` } : undefined}>
            <div className={sp("banner")} style={{
                backgroundColor: (parts.has("accentColor") && draft.accentColor) || (theme ? theme[0] : "#5865f2"),
                backgroundImage: parts.has("banner") && draft.banner ? `url(${draft.banner})` : undefined,
            }} />
            <div className={sp("avatar")} style={{ backgroundImage: parts.has("avatar") && draft.avatar ? `url(${draft.avatar})` : undefined }} />
            <div className={sp("body")}>
                <div className={sp("name")}>{parts.has("displayName") ? draft.displayName || "No display name" : "Your name (unchanged)"}</div>
                {parts.has("pronouns") && draft.pronouns && <div className={sp("pronouns")}>{draft.pronouns}</div>}
                <div className={sp("bio")}>{parts.has("bio") ? draft.bio || "No about me" : "About me unchanged"}</div>
            </div>
        </div>
    );
}

function ImageField({ label, value, onChange, accept = "image/*" }: { label: string; value: string | null; onChange(v: string | null): void; accept?: string; }) {
    const input = useRef<HTMLInputElement>(null);
    return (
        <div className={cl("row")}>
            <div className={classes(sp("thumb"), label === "Banner" && sp("thumb-wide"))} style={{ backgroundImage: value ? `url(${value})` : undefined }} />
            <span className={cl("grow")}>{value ? (value.startsWith("data:image/gif") ? "Animated" : "Picture") : "None"}</span>
            <button type="button" className={cl("btn")} onClick={() => input.current?.click()}>Replace…</button>
            {value && <button type="button" className={cl("btn")} onClick={() => onChange(null)}>Remove</button>}
            <input ref={input} type="file" accept={accept} hidden onChange={async e => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (f) onChange(await fileData(f));
            }} />
        </div>
    );
}

function StealModal({ modalProps, userId: startUser, guildId: startGuild }: { modalProps: RenderModalProps; userId?: string; guildId?: string | null; }) {
    const accent = windowAccent("stealProfile");
    const me = UserStore.getCurrentUser();
    const nitro = !!(me as any)?.premiumType;
    const [userId, setUserId] = useState(startUser ?? "");
    const [source, setSource] = useState<string | null>(null);
    const [draft, setDraft] = useState<ProfileDraft>(EMPTY);
    // Nitro-only parts start switched off for people without it.
    const [parts, setParts] = useState<Set<Part>>(new Set(PARTS.filter(p => nitro || !p.nitro).map(p => p.id)));
    const [target, setTarget] = useState<Target>({ kind: "main" });
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState<string | null>(null);
    const [backup, setBackup] = useState<Backup | null>(null);

    const guilds = Object.values(GuildStore.getGuilds()).sort((a: any, b: any) => a.name.localeCompare(b.name));
    const sourceGuild = startGuild ?? SelectedGuildStore.getGuildId();

    const load = async (id: string) => {
        if (!/^\d{17,20}$/.test(id)) { setError("That doesn't look like a user ID."); return; }
        setLoading(true); setError(null); setDone(null);
        try {
            const { draft, name } = await readProfile(id, sourceGuild);
            setDraft(draft);
            setSource(name);
        } catch (e: any) {
            setError(String(e?.message ?? e));
        } finally { setLoading(false); }
    };

    useEffect(() => { if (startUser) load(startUser); lastBackup().then(b => setBackup(b ?? null)); }, []);

    const set = (p: Partial<ProfileDraft>) => setDraft(d => ({ ...d, ...p }));
    const togglePart = (id: Part) => setParts(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const usable = PARTS.filter(p => target.kind === "main" || !p.mainOnly);
    const chosen = new Set([...parts].filter(p => usable.some(u => u.id === p)));

    const apply = async () => {
        if (!chosen.size) return;
        setBusy(true); setError(null); setDone(null);
        try {
            setBackup(await backUp(target, chosen).catch(() => null));
            const failed = await applyProfile(draft, chosen, target);
            if (failed.length) setError(failed.join("\n"));
            else { setDone(`Applied to your ${target.kind === "main" ? "main profile" : "server profile"}. Your old one was backed up.`); showToast("Profile updated", "success"); }
        } finally { setBusy(false); }
    };

    const restore = async () => {
        if (!backup) return;
        setBusy(true); setError(null); setDone(null);
        try {
            const failed = await applyProfile(backup.draft, new Set(backup.parts), backup.target);
            if (failed.length) setError(failed.join("\n"));
            else { setDone("Your old profile is back."); showToast("Profile restored", "success"); }
        } finally { setBusy(false); }
    };

    const field = (id: Part, el: React.ReactNode) => {
        const def = PARTS.find(p => p.id === id)!;
        const off = !usable.some(u => u.id === id);
        return (
            <div className={classes(sp("field"), (off || !parts.has(id)) && sp("field-off"))} key={id}>
                <label className={cl("check")}>
                    <input type="checkbox" checked={!off && parts.has(id)} disabled={off} onChange={() => togglePart(id)} />
                    <span className={cl("label")}>{def.name}</span>
                    {def.nitro && !nitro && <span className={sp("tag")}>Needs Nitro</span>}
                    {off && <span className={sp("tag")}>Main profile only</span>}
                </label>
                {el}
            </div>
        );
    };

    const theme = draft.themeColors ?? ["#5865f2", "#1e1f22"];

    return (
        <Modal {...modalProps} size="lg" title="Steal Profile" subtitle={source ? `From ${source} — change anything before applying` : "Right-click someone and pick Steal profile, or paste their user ID"}>
            <div className={classes("vc-tool-wrap", cl("wrap"))} style={accent ? ({ "--vc-tool-accent": accent } as React.CSSProperties) : undefined}>
                <div className={cl("row")}>
                    <input className={classes(cl("input"), cl("grow"))} value={userId} placeholder="User ID" onChange={e => setUserId(e.currentTarget.value.trim())}
                        onKeyDown={e => { if (e.key === "Enter") load(userId); }} />
                    <button type="button" className={cl("btn")} disabled={loading || !userId} onClick={() => load(userId)}>{loading ? "Loading…" : source ? "Reload" : "Load"}</button>
                </div>

                <div className={sp("layout")}>
                    <Card draft={draft} parts={chosen} />
                    <div className={sp("fields")}>
                        {field("avatar", <ImageField label="Picture" value={draft.avatar} onChange={avatar => set({ avatar })} />)}
                        {field("banner", <ImageField label="Banner" value={draft.banner} onChange={banner => set({ banner })} />)}
                        {field("displayName", <input className={cl("input")} value={draft.displayName} maxLength={32} placeholder={target.kind === "server" ? "Server nickname" : "Display name"} onChange={e => set({ displayName: e.currentTarget.value })} />)}
                        {field("pronouns", <input className={cl("input")} value={draft.pronouns} maxLength={40} placeholder="Pronouns" onChange={e => set({ pronouns: e.currentTarget.value })} />)}
                        {field("bio", <textarea className={cl("area")} value={draft.bio} maxLength={190} placeholder="About me" onChange={e => set({ bio: e.currentTarget.value })} />)}
                        {field("accentColor", (
                            <div className={cl("row")}>
                                <input type="color" className={cl("color")} value={draft.accentColor || "#5865f2"} onChange={e => set({ accentColor: e.currentTarget.value })} />
                                <span className={cl("hint")}>{draft.accentColor || "None"} — shows when there's no banner</span>
                            </div>
                        ))}
                        {field("themeColors", (
                            <div className={cl("row")}>
                                <input type="color" className={cl("color")} value={theme[0]} onChange={e => set({ themeColors: [e.currentTarget.value, theme[1]] })} />
                                <input type="color" className={cl("color")} value={theme[1]} onChange={e => set({ themeColors: [theme[0], e.currentTarget.value] })} />
                                <span className={cl("hint")}>{draft.themeColors ? "Primary and accent" : "None set"}</span>
                                {draft.themeColors && <button type="button" className={cl("btn")} onClick={() => set({ themeColors: null })}>Remove</button>}
                            </div>
                        ))}
                    </div>
                </div>

                <div className={cl("card")}>
                    <div className={cl("label")}>Apply to</div>
                    <div className={cl("row")}>
                        <div className={cl("seg")}>
                            <button type="button" className={classes(cl("seg-btn"), target.kind === "main" && cl("seg-on"))} onClick={() => setTarget({ kind: "main" })}>Main profile</button>
                            <button type="button" className={classes(cl("seg-btn"), target.kind === "server" && cl("seg-on"))}
                                onClick={() => setTarget({ kind: "server", guildId: (target.kind === "server" && target.guildId) || SelectedGuildStore.getGuildId() || (guilds[0] as any)?.id })}>Server profile</button>
                        </div>
                        {target.kind === "server" && (
                            <select className={classes(cl("input"), cl("grow"), sp("select"))} value={target.guildId} onChange={e => setTarget({ kind: "server", guildId: e.currentTarget.value })}>
                                {guilds.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                        )}
                    </div>
                    <div className={cl("hint")}>
                        {target.kind === "server"
                            ? "A server profile can have its own nickname and pronouns; its own picture, banner, about me and theme need Nitro."
                            : "Animated pictures, banners and theme colours need Nitro. Discord may limit how often you change your picture."}
                    </div>
                </div>

                {error && <div className={cl("error")} style={{ whiteSpace: "pre-wrap" }}>{error}</div>}
                {done && <div className={cl("ok")}>{done}</div>}

                <div className={cl("footer")}>
                    {backup && (
                        <button type="button" className={cl("btn")} disabled={busy} onClick={restore}
                            title={`Saved ${new Date(backup.at).toLocaleString()} (${backup.target.kind === "main" ? "main profile" : "server profile"})`}>
                            Restore my old profile
                        </button>
                    )}
                    <span className={cl("spacer")} />
                    <button type="button" className={cl("btn")} onClick={modalProps.onClose}>Close</button>
                    <button type="button" className={classes(cl("btn"), cl("primary"))} disabled={busy || !source || !chosen.size} onClick={apply}>
                        {busy ? "Applying…" : `Apply ${chosen.size} ${chosen.size === 1 ? "part" : "parts"}`}
                    </button>
                </div>
            </div>
        </Modal>
    );
}

export function openStealProfile(userId?: string, guildId?: string | null) {
    openModal(props => <StealModal modalProps={props} userId={userId} guildId={guildId} />);
}
