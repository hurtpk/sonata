/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import * as DataStore from "@api/DataStore";
import { Button } from "@components/Button";
import { Devs } from "@utils/constants";
import { useFixedTimer } from "@utils/react";
import definePlugin, { PluginNative } from "@utils/types";
import type { RenderModalProps, User } from "@vencord/discord-types";
import { lodash, Menu, React, TextInput, useEffect, UserStore, useState } from "@webpack/common";

import { openSection, registerSection } from "../_shared/Hub";
import { Window } from "../_shared/Window";
import type { ZonePlace } from "./native";

interface SavedZone extends ZonePlace { userId: string; }
const storageKey = () => `Sonata_timezones_${UserStore.getCurrentUser().id}`;
const timeAt = (zone: string, now: number) => new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: "short", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(now);

export function TimezonesWindow({ modalProps, userId }: { modalProps: RenderModalProps; userId?: string; }) {
    const [target, setTarget] = useState(userId ?? "");
    const [query, setQuery] = useState("");
    const [places, setPlaces] = useState<ZonePlace[]>([]);
    const [saved, setSaved] = useState<SavedZone[]>([]);
    const [busy, setBusy] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState("");
    const now = useFixedTimer({ interval: 30_000, initialTime: 0 });
    useEffect(() => {
        let live = true;
        void DataStore.get<SavedZone[]>(storageKey()).then(value => { if (live) setSaved(value ?? []); }).catch(() => { if (live) setError("Couldn't load saved timezones."); }).finally(() => { if (live) setLoaded(true); });
        return () => { live = false; };
    }, []);
    useEffect(() => {
        let live = true;
        setPlaces([]);
        if (query.trim().length < 2) { setBusy(false); return; }
        setBusy(true);
        const search = lodash.debounce(async () => {
            try {
                if (IS_WEB) throw new Error("Location search is available in the desktop app.");
                const native = VencordNative.pluginHelpers.Sonata as PluginNative<typeof import("./native")>;
                const result = await native.timezoneSearch(query);
                if (!live) return;
                if (!result.ok) throw new Error(result.error);
                setPlaces(result.places);
                setError("");
            } catch (e) { if (live) setError(e instanceof Error ? e.message : "Couldn't search locations."); }
            finally { if (live) setBusy(false); }
        }, 500);
        search();
        return () => { live = false; search.cancel(); };
    }, [query]);
    const save = async (place: ZonePlace) => {
        if (!/^\d{17,20}$/.test(target)) { setError("Choose someone from their right-click menu or paste their Discord user ID."); return; }
        setSaving(true);
        try {
            let next: SavedZone[] = [];
            await DataStore.update<SavedZone[]>(storageKey(), current => next = [...(current ?? []).filter(entry => entry.userId !== target), { ...place, userId: target }]);
            setSaved(next);
            setError("");
            setQuery("");
        } catch { setError("Couldn't save this timezone."); }
        finally { setSaving(false); }
    };
    const remove = async (user: string) => {
        setSaving(true);
        try { let next: SavedZone[] = []; await DataStore.update<SavedZone[]>(storageKey(), current => next = (current ?? []).filter(entry => entry.userId !== user)); setSaved(next); }
        catch { setError("Couldn't remove this timezone."); }
        finally { setSaving(false); }
    };
    return <Window {...modalProps} title="Timezones" size="lg" subtitle="Local times for your people">
        <div className="vc-tool-wrap">
            <TextInput value={target} onChange={setTarget} placeholder="Discord user ID" aria-label="Discord user ID" />
            <p className="vc-tool-hint">Setting a timezone for {UserStore.getUser(target)?.username ?? (target || "a person")}. These are your private assignments, not locations detected from their account.</p>
            <TextInput value={query} onChange={setQuery} placeholder="Search a city, country, state, province or timezone" aria-label="Search timezone locations" autoFocus={!!userId} />
            <p className="vc-tool-hint">Countries and regions can span several timezones. Pick the specific place and zone that match. Try “London, Canada” or “Los Angeles, California”. Times follow daylight-saving rules automatically.</p>
            {error && <div className="vc-tool-error">{error}</div>}
            {busy && <div className="vc-tool-hint">Searching locations…</div>}
            {!busy && query.trim().length >= 2 && !places.length && !error && <div className="vc-tool-empty">No matching locations. Try a nearby city or the full timezone name.</div>}
            {places.map(place => <Button key={`${place.label}:${place.zone}`} className="vc-timezones-place" variant="secondary" disabled={saving || !loaded} onClick={() => void save(place)}><span>{place.label}<small>{place.zone} · {timeAt(place.zone, now)}</small></span></Button>)}
            <h3>Saved timezones</h3>
            {!saved.length && <div className="vc-tool-empty">Right-click someone, open Sonata, then choose Set Timezone.</div>}
            {saved.map(entry => <div key={entry.userId} className="vc-tool-section"><b>{UserStore.getUser(entry.userId)?.username ?? entry.userId}</b><span>{timeAt(entry.zone, now)}</span><span className="vc-tool-hint">{entry.label} · {entry.zone}</span><div className="vc-tool-row"><Button variant="secondary" size="small" onClick={() => setTarget(entry.userId)}>Change timezone</Button><Button variant="secondary" size="small" disabled={saving} onClick={() => void remove(entry.userId)}>Remove</Button></div></div>)}
        </div>
    </Window>;
}

export const openTimezones = (userId?: string) => openSection("people", "timezones", props => <TimezonesWindow modalProps={props} userId={userId} />);
registerSection("people", { id: "timezones", feature: "timezones", name: "Timezones", sub: "Your people's local times", render: props => <TimezonesWindow modalProps={props} /> });

export default definePlugin({
    name: "Timezones",
    description: "Assign people a timezone by searching cities, countries and regions, then see their current local time with daylight-saving changes handled automatically.",
    authors: [Devs.Ven],
    openSettingsModal: () => openTimezones(),
    contextMenus: { "user-context": (children, { user }: { user?: User; }) => { if (user) children.push(<Menu.MenuItem id="sonata-set-timezone" label="Set Timezone" action={() => openTimezones(user.id)} />); } },
});
