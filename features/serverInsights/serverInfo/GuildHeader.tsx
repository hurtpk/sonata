/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button } from "@components/Button";
import { getGuildAcronym, openImageModal } from "@utils/discord";
import type { Guild } from "@vencord/discord-types";
import { Dialog, GuildMemberStore, GuildStore, IconUtils, lodash, Popout, React, TextInput, useRef, useState, useStateFromStores } from "@webpack/common";

import { SonataGlyph } from "../../../utilities/icons";

function ServerList({ current, pick }: { current: string; pick(id: string): void; }) {
    const [query, setQuery] = useState("");
    const guilds = useStateFromStores([GuildStore], () => Object.values(GuildStore.getGuilds()).filter(guild => `${guild.name} ${guild.id}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)), [query], lodash.isEqual);
    return <Dialog className="vc-gp-server-picker" aria-label="Choose a server">
        <TextInput autoFocus value={query} onChange={setQuery} placeholder="Find a server or ID" aria-label="Find a server or ID" />
        <div className="vc-gp-server-list">
            {guilds.map(guild => <Button key={guild.id} variant="none" className="vc-gp-server-option" aria-pressed={guild.id === current} onClick={() => pick(guild.id)}>
                {guild.icon ? <img src={IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 32 }) ?? undefined} alt="" /> : <span className="vc-gp-server-initials">{getGuildAcronym(guild)}</span>}
                <span>{guild.name}<small>{guild.id}</small></span>
                {guild.id === current && <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6" /></svg>}
            </Button>)}
            {!guilds.length && <p className="vc-tool-hint">No matching servers.</p>}
        </div>
    </Dialog>;
}

export function GuildHeader({ guild, onChange }: { guild: Guild; onChange(id: string): void; }) {
    const button = useRef<HTMLButtonElement>(null);
    const count = useStateFromStores([GuildMemberStore], () => GuildMemberStore.getMemberIds(guild.id).length, [guild.id]);
    const icon = IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, canAnimate: false, size: 128 });
    const banner = guild.banner ? IconUtils.getGuildBannerURL(guild, false)?.replace(/\?size=\d+$/, "?size=1024") : null;
    return <div className="vc-gp-hero" style={banner ? { backgroundImage: `linear-gradient(90deg, #0b0b0ed9, #0b0b0e70), url("${banner}")` } : undefined}>
        <Button variant="none" className="vc-gp-icon-button" disabled={!icon} aria-label="Open server icon" onClick={() => { if (icon) openImageModal({ url: icon, width: 512, height: 512 }); }}>
            {icon ? <img className="vc-gp-icon" src={icon} alt="" /> : <span className="vc-gp-icon-text">{getGuildAcronym(guild)}</span>}
        </Button>
        <div className="vc-gp-hero-text"><b>{guild.name}</b>{guild.description && <span>{guild.description}</span>}<span>{count.toLocaleString()} members loaded</span></div>
        {banner && <Button variant="none" size="iconOnly" className="vc-gp-server-switch" aria-label="Open server banner" title="Open server banner" onClick={() => openImageModal({ url: banner, width: 1024 })}><SonataGlyph name="image" /></Button>}
        <Popout position="bottom" align="right" targetElementRef={button} renderPopout={({ closePopout }) => <ServerList current={guild.id} pick={id => { onChange(id); closePopout(); }} />}>
            {props => <Button {...props} ref={button} variant="none" size="iconOnly" className="vc-gp-server-switch" aria-label="Change server" title="Change server">
                <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </Button>}
        </Popout>
    </div>;
}
