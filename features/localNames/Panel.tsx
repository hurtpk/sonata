/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, GuildStore, openModal, useState } from "@webpack/common";

import { Window } from "../_shared/Window";
import { FormGroup, FormRow } from "../_shared/WindowParts";
import { Kind, setLocalName, useNames } from "./store";

/** The real name, even while the local one is showing. */
export type RealName = (kind: Kind, id: string) => string;

const what = (kind: Kind, id: string) => {
    if (kind === "guild") return "server";
    const c: any = ChannelStore.getChannel(id);
    return c?.type === 3 ? "group chat" : c?.isThread?.() ? "thread" : "channel";
};

function RenameWindow({ modalProps, kind, id, real }: { modalProps: RenderModalProps; kind: Kind; id: string; real: RealName; }) {
    const names = useNames();
    const original = real(kind, id);
    const [text, setText] = useState(names[kind][id] ?? "");
    const save = () => { setLocalName(kind, id, text); modalProps.onClose(); };
    return (
        <Window {...modalProps} size="sm" title="Local Names" subtitle="Only you see the new name"
            actions={[
                ...(names[kind][id] ? [{ text: "Use the real name", variant: "secondary", onClick: () => { setLocalName(kind, id, null); modalProps.onClose(); } }] : []),
                { text: "Save", variant: "primary", onClick: save },
            ]}
            status={["only you see the new name"]}>
            <FormGroup>
                <FormRow label={`Rename this ${what(kind, id)}`} help={original ? `Its real name: ${original}` : undefined} stack>
                    <input className="vc-tool-input" autoFocus value={text} maxLength={100} placeholder={original || "A name just for you"} aria-label="New name"
                        onChange={e => setText(e.currentTarget.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
                </FormRow>
            </FormGroup>
        </Window>
    );
}

export const openRename = (kind: Kind, id: string, real: RealName) => openModal(props => <RenameWindow modalProps={props} kind={kind} id={id} real={real} />);

function AllNamesWindow({ modalProps, real }: { modalProps: RenderModalProps; real: RealName; }) {
    const names = useNames();
    const rows = (kind: Kind) => Object.entries(names[kind]);
    const count = rows("guild").length + rows("channel").length;
    const where = (kind: Kind, id: string) => {
        if (kind === "guild") return "Server";
        const c: any = ChannelStore.getChannel(id);
        if (c?.type === 3) return "Group chat";
        const g = c?.guild_id ? GuildStore.getGuild(c.guild_id) : null;
        return g ? `Channel in ${g.name}` : "Channel";
    };
    const list = (kind: Kind) => rows(kind).map(([id, name]) => (
        <FormRow key={id} label={name} help={`${where(kind, id)} · real name: ${real(kind, id) || "unknown (not loaded)"}`}>
            <button type="button" className="vc-tool-btn" onClick={() => openRename(kind, id, real)}>Rename</button>
            <button type="button" className="vc-tool-btn" onClick={() => setLocalName(kind, id, null)}>Use the real name</button>
        </FormRow>
    ));
    return (
        <Window {...modalProps} size="md" title="Local Names" subtitle="Servers, channels and group chats you renamed just for you"
            status={[`${count} renamed`, "only you see them"]}>
            <div className="vc-tool-wrap">
                {count === 0 ? (
                    <div className="vc-tool-empty">
                        <span className="vc-tool-empty-icon">🏷️</span>
                        Nothing renamed yet. Right-click a server, channel or group chat and pick "Rename just for me".
                    </div>
                ) : <>
                    {rows("guild").length > 0 && <FormGroup title="Servers">{list("guild")}</FormGroup>}
                    {rows("channel").length > 0 && <FormGroup title="Channels and group chats">{list("channel")}</FormGroup>}
                </>}
            </div>
        </Window>
    );
}

export const openAllNames = (real: RealName) => openModal(props => <AllNamesWindow modalProps={props} real={real} />);
