/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./rules.css";

import { Button } from "@components/Button";
import type { RenderModalProps } from "@vencord/discord-types";
import { Alerts, ChannelStore, Constants, GuildRoleStore, GuildStore, lodash, PermissionsBits, PermissionStore, React, RestAPI, SearchableSelect, SelectedGuildStore, TextArea, TextInput, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";

import { SonataGlyph } from "../../utilities/icons";
import { Window } from "../_shared/Window";
import { Toggle } from "../_shared/WindowParts";
import { registerModerationPart } from "../serverTools/Moderation";
import { type AutoModRule, draftRule, type RuleDraft, rulePayload, TRIGGERS } from "./rules";

function Exemptions({ label, options, value, onChange }: { label: string; options: { value: string; label: string; }[]; value: string[]; onChange(value: string[]): void; }) {
    return <div className="vc-amrules-field"><span>{label}</span>
        <div className="vc-tool-row">{value.map(id => <Button key={id} variant="secondary" size="small" onClick={() => onChange(value.filter(item => item !== id))} title="Remove exemption">{options.find(option => option.value === id)?.label ?? id}<SonataGlyph name="xCircle" /></Button>)}</div>
        <SearchableSelect options={options.filter(option => !value.includes(option.value))} value={undefined} placeholder={`Add ${label.toLowerCase()}`} maxVisibleItems={5} closeOnSelect onChange={id => onChange([...value, id])} />
    </div>;
}

function Rules({ guildId }: { guildId: string; }) {
    const [rules, setRules] = useState<AutoModRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [search, setSearch] = useState("");
    const [selected, setSelected] = useState<AutoModRule | null>();
    const [draft, setDraft] = useState<RuleDraft>(draftRule);
    const alive = useRef(true);
    const permissions = useStateFromStores([GuildStore, PermissionStore], () => {
        const guild = GuildStore.getGuild(guildId);
        return { manage: !!guild && PermissionStore.can(PermissionsBits.MANAGE_GUILD, guild), timeout: !!guild && PermissionStore.can(PermissionsBits.MODERATE_MEMBERS, guild) };
    }, [guildId], lodash.isEqual);
    const roles = useStateFromStores([GuildRoleStore], () => GuildRoleStore.getSortedRoles(guildId).filter(role => role.id !== guildId).map(role => ({ value: role.id, label: role.name })), [guildId], lodash.isEqual);
    const channels = useStateFromStores([ChannelStore, PermissionStore], () => Object.values(ChannelStore.getMutableGuildChannelsForGuild(guildId)).filter(channel => PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)).sort((a, b) => a.position - b.position).map(channel => ({ value: channel.id, label: `${channel.type === 4 ? "Category: " : "#"}${channel.name}`, type: channel.type })), [guildId], lodash.isEqual);
    const set = <K extends keyof RuleDraft>(key: K, value: RuleDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
    const canManage = () => {
        const guild = GuildStore.getGuild(guildId);
        if (!guild || !PermissionStore.can(PermissionsBits.MANAGE_GUILD, guild)) throw new Error("Manage Server is required to change AutoMod rules.");
    };
    const message = (error: unknown) => error instanceof Error ? error.message : "Discord could not complete that request. Check your permissions and try again.";
    async function load() {
        setError(""); setLoading(true);
        try {
            canManage();
            const response = await RestAPI.get({ url: Constants.Endpoints.GUILD_AUTOMOD_RULES(guildId) });
            if (alive.current) setRules(response.body);
        } catch (error) { if (alive.current) setError(message(error)); }
        finally { if (alive.current) setLoading(false); }
    }
    useEffect(() => {
        alive.current = true;
        void load();
        return () => { alive.current = false; };
    }, [guildId, permissions.manage]);
    async function change(operation: () => Promise<unknown>, result: string) {
        if (!alive.current || busy) return;
        setBusy(true); setError(""); setNotice("");
        try {
            canManage();
            await operation();
            if (alive.current) { setSelected(undefined); setNotice(result); await load(); }
        } catch (error) { if (alive.current) setError(message(error)); }
        finally { if (alive.current) setBusy(false); }
    }
    function save() {
        void change(async () => {
            const body = rulePayload(draft, selected ?? undefined, permissions.timeout);
            if (!selected) {
                const trigger = TRIGGERS.find(type => type.value === draft.trigger);
                if (trigger && rules.filter(rule => rule.trigger_type === draft.trigger).length >= trigger.limit) throw new Error(`Discord allows ${trigger.limit} ${trigger.label.toLowerCase()} rule${trigger.limit === 1 ? "" : "s"} per server. Edit an existing rule instead.`);
                await RestAPI.post({ url: Constants.Endpoints.GUILD_AUTOMOD_RULES(guildId), body });
            } else await RestAPI.patch({ url: Constants.Endpoints.GUILD_AUTOMOD_RULE(guildId, selected.id), body });
        }, selected ? "Rule updated." : "Rule created.");
    }
    function remove(rule: AutoModRule) {
        Alerts.show({ title: `Delete ${rule.name}?`, body: "This removes the rule from Discord. Messages already blocked will not be restored.", confirmText: "Delete rule", cancelText: "Cancel", confirmVariant: "critical-primary",
            onConfirm: () => { void change(() => RestAPI.del({ url: Constants.Endpoints.GUILD_AUTOMOD_RULE(guildId, rule.id) }), "Rule deleted."); } });
    }
    const known = TRIGGERS.some(type => type.value === draft.trigger);
    return <div className="vc-amrules">
        <div className="vc-amrules-heading"><div><h2>Discord AutoMod rules</h2><p className="vc-tool-hint">These rules run on Discord, even when your client is closed.</p></div>
            <Button size="small" variant="secondary" disabled={loading || busy} onClick={() => { setSelected(undefined); void load(); }}><SonataGlyph name="refresh" /> Refresh</Button>
            <Button size="small" disabled={loading || busy || !permissions.manage} onClick={() => { setDraft(draftRule()); setSelected(null); setError(""); }}>New rule</Button>
        </div>
        {error && <p className="vc-tool-error" role="alert">{error}</p>}{notice && <p className="vc-tool-ok" role="status">{notice}</p>}
        {!permissions.manage ? <p className="vc-tool-empty">Choose a server where you have Manage Server.</p> : selected !== undefined ? <div className="vc-amrules-editor">
            <div className="vc-amrules-heading"><h3>{selected ? "Edit rule" : "New rule"}</h3><Toggle value={draft.enabled} onChange={value => set("enabled", value)} label="Enable rule" disabled={busy} /><span className="vc-tool-hint">{draft.enabled ? "Enabled" : "Paused"}</span></div>
            {!known && <p className="vc-tool-hint">This rule type is newer than this editor. You can pause or delete it from the rule list.</p>}
            <fieldset disabled={busy || !known} className="vc-amrules-form">
                <label className="vc-amrules-field">Rule name<TextInput value={draft.name} maxLength={100} onChange={value => set("name", value)} placeholder="Name this rule" /></label>
                <div className="vc-amrules-field"><span>What to check</span><SearchableSelect options={[...TRIGGERS]} value={draft.trigger} isDisabled={!!selected} onChange={value => { setDraft(previous => ({ ...previous, trigger: value, timeout: false })); }} closeOnSelect />{selected && <small>Discord does not allow changing an existing rule's trigger.</small>}</div>
                {[1, 6].includes(draft.trigger) && <>
                    <label className="vc-amrules-field">Keywords<TextArea value={draft.keywords} onChange={value => set("keywords", value)} placeholder="One word or phrase per line" /><small>Up to 1,000 entries, 60 characters each. Use * around a term to match it inside words.</small></label>
                    <label className="vc-amrules-field">Regex patterns<TextArea value={draft.regex} onChange={value => set("regex", value)} placeholder="Paste patterns from the AutoMod Regex tab" /><small>Up to 10 Rust regex patterns, 260 characters each. Discord validates the pattern syntax when you save.</small></label>
                </>}
                {draft.trigger === 4 && <div className="vc-amrules-field"><span>Discord word lists</span>{[[1, "Profanity"], [2, "Sexual content"], [3, "Slurs"]].map(([id, name]) => <div key={id} className="vc-amrules-toggle"><span>{name}</span><Toggle value={draft.presets.includes(Number(id))} label={String(name)} onChange={on => set("presets", on ? [...draft.presets, Number(id)] : draft.presets.filter(value => value !== id))} /></div>)}</div>}
                {draft.trigger === 3 && <p className="vc-tool-hint">Discord checks messages for spam using its built-in detection.</p>}
                {draft.trigger === 5 && <><label className="vc-amrules-field">Unique mentions per message<TextInput value={draft.mentions} inputMode="numeric" onChange={value => set("mentions", value)} /><small>Choose 1 to 50 unique user or role mentions.</small></label><div className="vc-amrules-toggle"><span>Detect mention raids</span><Toggle value={draft.raid} onChange={value => set("raid", value)} label="Detect mention raids" /></div></>}
                {[1, 4, 6].includes(draft.trigger) && <label className="vc-amrules-field">Allowed phrases<TextArea value={draft.allow} onChange={value => set("allow", value)} placeholder="Exceptions, one per line" /><small>Up to {draft.trigger === 4 ? "1,000" : "100"} phrases, 60 characters each.</small></label>}
                <div className="vc-amrules-actions"><h4>When this rule triggers</h4>
                    <div className="vc-amrules-toggle"><span>{draft.trigger === 6 ? "Block member interactions" : "Block the message"}</span><Toggle value={draft.block} onChange={value => set("block", value)} label="Block matching content" /></div>
                    {draft.block && draft.trigger !== 6 && <label className="vc-amrules-field">Explanation shown to the member<TextInput value={draft.explanation} maxLength={150} onChange={value => set("explanation", value)} placeholder="Optional explanation" /></label>}
                    <div className="vc-amrules-toggle"><span>Send an alert to a channel</span><Toggle value={draft.alert} onChange={value => set("alert", value)} label="Send AutoMod alerts" /></div>
                    {draft.alert && <SearchableSelect options={channels.filter(channel => [0, 5].includes(channel.type))} value={draft.alertChannel} placeholder="Choose an alert channel" onChange={value => set("alertChannel", value)} closeOnSelect />}
                    {[1, 5].includes(draft.trigger) && <><div className="vc-amrules-toggle"><span>Time out the member{!permissions.timeout && <small>Requires Timeout Members.</small>}</span><Toggle value={draft.timeout} onChange={value => set("timeout", value)} label="Time out matching members" disabled={!permissions.timeout} /></div>{draft.timeout && <label className="vc-amrules-field">Timeout duration in seconds<TextInput value={draft.seconds} inputMode="numeric" disabled={!permissions.timeout} onChange={value => set("seconds", value)} /><small>1 to 2,419,200 seconds (28 days).</small></label>}</>}
                </div>
                <Exemptions label="Exempt roles" options={roles} value={draft.roles} onChange={value => set("roles", value)} />
                <Exemptions label="Exempt channels" options={channels} value={draft.channels} onChange={value => set("channels", value)} />
            </fieldset>
            <div className="vc-tool-row"><Button variant="secondary" disabled={busy} onClick={() => { setSelected(undefined); setError(""); }}>Cancel</Button><Button disabled={busy || !known} onClick={save}>{busy ? "Saving…" : "Save rule"}</Button></div>
        </div> : <>
            <TextInput value={search} onChange={setSearch} placeholder="Find a rule by name or ID" aria-label="Find an AutoMod rule" />
            {loading ? <p role="status">Loading AutoMod rules…</p> : <div className="vc-amrules-list">
                {rules.filter(rule => `${rule.name} ${rule.id}`.toLowerCase().includes(search.trim().toLowerCase())).map(rule => <article key={rule.id} className="vc-amrules-rule">
                    <div className="vc-amrules-rule-title"><SonataGlyph name="shield" /><div><b>{rule.name}</b><small>{TRIGGERS.find(type => type.value === rule.trigger_type)?.label ?? `Trigger ${rule.trigger_type}`} · {rule.enabled ? "Enabled" : "Paused"}</small></div><Toggle value={rule.enabled} disabled={busy} label={`${rule.enabled ? "Pause" : "Enable"} ${rule.name}`} onChange={enabled => { void change(() => RestAPI.patch({ url: Constants.Endpoints.GUILD_AUTOMOD_RULE(guildId, rule.id), body: { enabled } }), enabled ? "Rule enabled." : "Rule paused."); }} /></div>
                    <p className="vc-tool-hint">{rule.actions.map(action => ({ 1: "Block message", 2: "Send alert", 3: "Timeout", 4: "Block interactions" }[action.type] ?? `Action ${action.type}`)).join(" · ")}</p>
                    <small className="vc-tool-hint">{rule.trigger_metadata.keyword_filter?.length ?? 0} keywords · {rule.trigger_metadata.regex_patterns?.length ?? 0} patterns · {rule.exempt_roles.length} exempt roles · {rule.exempt_channels.length} exempt channels</small>
                    <div className="vc-tool-row"><Button size="small" variant="secondary" disabled={busy} onClick={() => { setSelected(rule); setDraft(draftRule(rule)); setError(""); }}>Edit</Button><Button size="small" variant="dangerSecondary" disabled={busy} onClick={() => remove(rule)}>Delete</Button></div>
                </article>)}
                {!rules.length && !error && <p className="vc-tool-empty">No AutoMod rules yet. Create a rule to get started.</p>}
                {!!rules.length && !rules.some(rule => `${rule.name} ${rule.id}`.toLowerCase().includes(search.trim().toLowerCase())) && <p className="vc-tool-empty">No matching rules.</p>}
            </div>}
        </>}
    </div>;
}

export function AutoModRulesWindow({ modalProps }: { modalProps: RenderModalProps; }) {
    const guilds = useStateFromStores([GuildStore, PermissionStore], () => Object.values(GuildStore.getGuilds()).filter(guild => PermissionStore.can(PermissionsBits.MANAGE_GUILD, guild)).sort((a, b) => a.name.localeCompare(b.name)), [], lodash.isEqual);
    const [id, setId] = useState(SelectedGuildStore.getGuildId() ?? "");
    const guild = guilds.find(guild => guild.id === id) ?? guilds[0];
    return <Window {...modalProps} title="AutoMod Rules" subtitle="Manage Discord's server-side moderation rules">
        <div className="vc-tool-wrap"><SearchableSelect options={guilds.map(guild => ({ value: guild.id, label: guild.name }))} value={guild?.id} onChange={setId} placeholder="Choose a server" closeOnSelect />
            {guild ? <Rules key={guild.id} guildId={guild.id} /> : <p className="vc-tool-empty">Manage Server is required to view and edit AutoMod rules.</p>}
        </div>
    </Window>;
}

registerModerationPart("autoModRules", props => <AutoModRulesWindow modalProps={props} />);
