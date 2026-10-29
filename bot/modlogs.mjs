/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { COMMANDS } from "./commands.mjs";
import { embed, fail, isId } from "./discord.mjs";
import { actorId, genuineControl } from "./interactionUI.mjs";
import { commandContext, caseTarget } from "./moderation.mjs";

const size = 5;
const brief = (value, limit = 300) => String(value || "No reason supplied.").replace(/\s+/g, " ").slice(0, limit);
function query(state, filtered = true) {
    const conditions = ["guild=?", "n<=?"], values = [state.guild, state.ceiling];
    for (const [column, value] of [["target", state.victim], ["actor", state.staff], ["at>=", state.since]]) if (value) { conditions.push(column === "at>=" ? "at>=?" : `${column}=?`); values.push(value); }
    if (filtered) for (const [column, value] of [["kind", state.action], [state.staff ? "target" : "actor", state.filter]]) if (value && value !== "all") { conditions.push(`${column}=?`); values.push(value); }
    return { where: conditions.join(" AND "), values };
}
export function modlogPage(store, state, id) {
    const { where, values } = query(state), base = query(state, false), count = store.get(`SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('completed','cleared','expired') THEN 1 ELSE 0 END) AS completed FROM cases WHERE ${where}`, ...values);
    const pages = Math.max(1, Math.ceil(count.total / size)); state.page = Math.min(Math.max(0, state.page), pages - 1);
    const entries = store.all(`SELECT * FROM cases WHERE ${where} ORDER BY n DESC LIMIT ? OFFSET ?`, ...values, size, state.page * size);
    const response = embed(state.staff ? "Staff activity" : "Moderation history", state.staff ? `**Moderator:** <@${state.staff}> · \`${state.staff}\`\n**${count.completed || 0} completed actions** · ${count.total - (count.completed || 0)} awaiting review${state.days ? ` · Past ${state.days} days` : " · All time"}\nOnly actions recorded by Sonata Bot.` : `**Member:** <@${state.victim}> · \`${state.victim}\`\n**${count.total} records** · ${count.completed || 0} completed\nOnly actions recorded by Sonata Bot.`);
    response.embeds[0].color = 0xbd898e;
    response.embeds[0].fields = entries.map(row => ({ name: `#${row.n} · ${row.kind.replace(/\b\w/g, x => x.toUpperCase())}`, value: `**Target:** ${caseTarget(row.kind,row.target)} · **Moderator:** <@${row.actor}>\n<t:${Math.floor(row.at / 1000)}:f> · ${row.status === "completed" ? "Completed" : row.status.replaceAll("_", " ")}\n**Reason:** ${brief(row.reason)}\nView: \`case ${row.n}\``, inline: false }));
    if (!entries.length) response.embeds[0].description += "\n\nNo matching records.";
    response.embeds[0].footer = { text: `Page ${state.page + 1} of ${pages} · ${count.total} matching records · Menu expires after 30 minutes` };
    const control = action => `snlogs:${id}:${action}`;
    const select = (key, title, choices, selected) => ({ type: 1, components: [{ type: 3, custom_id: control(key), placeholder: title, min_values: 1, max_values: 1, options: [{ label: "All", value: "all", default: !selected || selected === "all" }, ...choices.slice(0,24).map(([value,label]) => ({ label: brief(label, 100), value, default: value === selected }))] }] });
    const actions = store.all(`SELECT kind,COUNT(*) AS n FROM cases WHERE ${base.where} GROUP BY kind ORDER BY n DESC LIMIT 24`, ...base.values).map(row=>[row.kind,row.kind]);
    const column = state.staff ? "target" : "actor", users = store.all(`SELECT ${column} AS id,COUNT(*) AS n FROM cases WHERE ${base.where} GROUP BY ${column} ORDER BY n DESC LIMIT 24`, ...base.values).map(row=>[row.id, `${state.staff ? "Member" : "Moderator"} ${row.id} · ${row.n} records`]);
    response.components = [select("action", "Filter by action", actions, state.action), select("filter", state.staff ? "Filter by member" : "Filter by moderator", users, state.filter), { type: 1, components: [
        { type: 2, style: 2, emoji: { name: "◀️" }, custom_id: control("prev"), disabled: state.page === 0 },
        { type: 2, style: 1, emoji: { name: "🏠" }, custom_id: control("home") },
        { type: 2, style: 2, emoji: { name: "▶️" }, custom_id: control("next"), disabled: state.page >= pages - 1 },
        { type: 2, style: 2, emoji: { name: "🔄" }, custom_id: control("refresh") },
    ] }];
    return response;
}
export function openModlogs(context, store, staff = false) {
    const command = context.command, target = command.options.member;
    if (!isId(target)) fail(staff ? "Use modstats followed by a staff member's Discord ID." : "Use modlogs followed by the victim's Discord ID.");
    const days = staff ? command.options.days : undefined;
    const state = { guild: context.guild.id, channel: context.channel.id, victim: staff ? null : target, staff: staff ? target : null, days, since: days ? Date.now()-days*86400_000 : 0, ceiling: store.get("SELECT COALESCE(MAX(n),0) AS n FROM cases WHERE guild=?",context.guild.id).n, page: 0 };
    const id = crypto.randomUUID();
    if (store.get("SELECT COUNT(*) AS n FROM forms WHERE actor=? AND kind='modlogs' AND expires>?",command.actor,Date.now()).n >= 10) fail("You have ten open moderation menus. Let an older menu expire before opening another.");
    store.run("INSERT INTO forms VALUES (?,?,?,?,?,?)",id,command.actor,context.guild.id,"modlogs",JSON.stringify(state),Date.now()+1800_000);
    return modlogPage(store,state,id);
}
export async function modlogInteraction(data,store,api,botId) {
    if (!genuineControl(data,botId)) fail("Open a new moderation menu from Sonata.");
    const match = /^snlogs:([\da-f-]{36}):(prev|home|next|refresh|action|filter)$/.exec(data.data.custom_id);
    if (!match) fail("Open a new moderation menu.");
    const row = store.get("SELECT * FROM forms WHERE id=? AND kind='modlogs' AND expires>?",match[1],Date.now());
    if (!row || row.actor !== actorId(data) || row.guild !== data.guild_id) fail("This moderation menu expired or belongs to someone else.");
    const state = JSON.parse(row.data), action = match[2];
    if (state.channel !== data.channel_id) fail("Use this menu in its original channel.");
    const name = state.staff ? "modstats" : "case";
    await commandContext({name,sub:state.staff?"staff":"history",definition:COMMANDS.find(c=>c.name===name),actor:actorId(data),guild:row.guild,channel:data.channel_id},botId,api,store.settings(row.guild));
    if (["action","filter"].includes(action)) {
        const value = data.data.values?.[0], component = data.message.components.flatMap(r=>r.components).find(c=>c.custom_id===data.data.custom_id);
        if(data.data.component_type!==3 || data.data.values?.length!==1 || !component?.options.some(o=>o.value===value)) fail("Choose a filter from this menu.");
        state[action]=value;state.page=0;
    } else {
        if(data.data.component_type!==2) fail("Choose a page button.");
        if(action==="prev")state.page--;if(action==="next")state.page++;if(action==="home")state.page=0;
        if(action==="refresh")state.ceiling=store.get("SELECT COALESCE(MAX(n),0) AS n FROM cases WHERE guild=?",row.guild).n;
    }
    const result=modlogPage(store,state,row.id);store.run("UPDATE forms SET data=? WHERE id=?",JSON.stringify(state),row.id);return result;
}
