/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { featureEnabled } from "./featureGroups.mjs";
import { modlogInteraction } from "./modlogs.mjs";
import { appealEligible, decideAppeal, submitAppeal } from "./appeals.mjs";
import { parseSlash } from "./commands.mjs";
import { commissionFields, readCommissionFields } from "./commissionIntake.mjs";
import { fail } from "./discord.mjs";
import { giveawayEntry } from "./giveaways.mjs";
import { actorId, consumeForm, openForm } from "./interactionUI.mjs";
import { commandContext, executeCommand } from "./moderation.mjs";
import { requireBotUser } from "./ownerConsole.mjs";
import { ticketCommand } from "./tickets.mjs";
import { verificationCommand } from "./memberTools.mjs";
import { roleMenuSelection } from "./roleMenus.mjs";
import { reminderControl } from "./reminders.mjs";
import { approvalCommand } from "./approvals.mjs";
import { imageControlInvocation, imageEdit, imageForm } from "./imageEditor.mjs";

const voices = { name: ["Room name", "New room name", "name"], limit: ["Member limit", "Member limit from 0 to 99", "limit"], bitrate: ["Room bitrate", "Bitrate in kbps", "kbps"], transfer: ["Transfer ownership", "Discord user ID or mention", "member"], permit: ["Permit member", "Discord user ID or mention", "member"], reject: ["Reject member", "Discord user ID or mention", "member"] };
const parsed = (data, guild, name, sub, options = {}) => ({ ...parseSlash({ name, options: sub ? [{ name: sub, options: Object.entries(options).map(([name, value]) => ({ name, value })) }] : Object.entries(options).map(([name, value]) => ({ name, value })) }), id: data.id, guild, channel: data.channel_id, actor: actorId(data) });

export function featureForm(data, store) {
    requireBotUser(store, actorId(data));
    if (data.type !== 3) return;
    const image = imageForm(data, store); if (image) return image;
    const id = data.data.custom_id, appeal = /^snappeal:open:(\d{17,20}):(\d{1,10})$/.exec(id);
    if (appeal) { appealEligible(store, appeal[1], Number(appeal[2]), actorId(data)); return openForm(data, store, appeal[1], "appeal", { n: Number(appeal[2]) }, "Appeal your ban", "Why should staff reconsider this ban?"); }
    const ticket = /^snticket:(open|category):(\d{17,20})$/.exec(id);
    if (ticket) {
        const config = store.settings(ticket[2]).tickets, category = ticket[1] === "category" ? data.data.values?.[0] : "general";
        if (data.guild_id !== ticket[2] || !config?.enabled || config.panel?.message !== data.message.id || config.panel?.channel !== data.channel_id || (category !== "general" && !Object.hasOwn(config.categories ?? {}, category))) fail("This ticket panel is no longer active.");
        if (config.intake === "commission") return openForm(data, store, ticket[2], "ticket", { category, intake: "commission" }, "Request a Commission", commissionFields);
        return openForm(data, store, ticket[2], "ticket", { category }, "Open a support ticket", "What do you need help with?");
    }
    const voice = /^snvoice:(\d{17,20}):(\d{17,20}):([a-z]+)$/.exec(id);
    if (voice && voices[voice[3]]) {
        if (data.guild_id !== voice[1] || !store.get("SELECT channel FROM voice_rooms WHERE guild=? AND channel=?", voice[1], voice[2])) fail("This room control is no longer available.");
        const [title, label] = voices[voice[3]];
        return openForm(data, store, voice[1], "voice", { room: voice[2], action: voice[3] }, title, label, 100);
    }
}

export async function featureAction(data, store, api, botId, music) {
    requireBotUser(store, actorId(data));
    const checked = async command => {
        if (data.guild_id !== command.guild) fail("Use this control in its original server.");
        const context = await commandContext(command, botId, api, store.settings(command.guild));
        if (!store.claim(data.id)) fail("This interaction was already handled.");
        return context;
    };
    const voiceCommand = async (guild, room, action, value) => {
        if (data.guild_id !== guild) fail("Use this room control in its original server.");
        const state = await api(`/guilds/${guild}/voice-states/${actorId(data)}`, { optional: true });
        if (state?.channel_id !== room) fail("Join the voice room shown on this panel first.");
        const field = voices[action]?.[2], o = field ? { [field]: value } : {};
        return executeCommand(parsed(data, guild, "voicemaster", action, o), store, api, botId, music);
    };
    const image = /^sncaption:([\da-f-]{36}):(style|format|done|undo|publish|text|croptext|sizetext|marktext|keytext)(?::(\d{1,9}))?$/.exec(data.data.custom_id);
    if (image) {
        const [, id, action, revision] = image;
        const invocation = imageControlInvocation(data, store, id);
        return imageEdit(await checked(parsed(data, data.guild_id, ...invocation)), data, store, music, id, action, revision);
    }
    if (data.type === 5) {
        const form = consumeForm(data, store, readCommissionFields);
        if (form.kind === "appeal") { if (!featureEnabled(store.settings(form.guild), "community")) fail("Community & support is disabled in this server."); return submitAppeal(form, store, api); }
        if (form.kind === "voice") return voiceCommand(form.guild, form.details.room, form.details.action, form.value);
        if (form.kind === "ticket") return ticketCommand(await checked(parsed(data, form.guild, "ticket", form.details.category && form.details.category !== "general" ? "openin" : "open", { topic: form.value, ...(form.details.category && form.details.category !== "general" ? { category: form.details.category } : {}) })), store);
        fail("This form is no longer supported.");
    }
    const id = data.data.custom_id;
    const reminder = /^snremind:([\da-f]{16}):(cancel|s10|s60)$/.exec(id);
    if (reminder) return reminderControl(store, actorId(data), reminder[1], reminder[2], data.message.id);
    const menu = /^snroles:([\da-f]{8}):(pick|clear)$/.exec(id);
    if (menu) {
        const command = parsed(data, data.guild_id, "rolemenu", "list");
        command.sub = "select"; command.definition = { ...command.definition, permission: 0n };
        if (menu[2] === "pick" && data.data.component_type !== 3) fail("Choose roles from the menu.");
        return roleMenuSelection(await checked(command), store, menu[1], data.message.id, menu[2] === "pick" ? data.data.values : []);
    }
    const approval = /^snapprove:([\da-f]{16}):(approve|reject)$/.exec(id);
    if (approval) return approvalCommand(await checked(parsed(data, data.guild_id, "case", approval[2], { id: approval[1] })), store, botId, data.message.id);
    if(id.startsWith("snlogs:"))return modlogInteraction(data,store,api,botId);
    const verification = /^snverify:(\d{17,20})$/.exec(id);
    if (verification) {
        const config = store.settings(verification[1]).verification;
        if (config?.panel?.message !== data.message.id || config?.panel?.channel !== data.channel_id) fail("This verification panel is no longer available.");
        return verificationCommand(await checked(parsed(data, verification[1], "verification", "view")), store, true);
    }
    const voice = /^snvoice:(\d{17,20}):(\d{17,20}):(lock|unlock|hide|unhide|claim|reset|room)$/.exec(id);
    if (voice) return voiceCommand(voice[1], voice[2], voice[3]);
    const player = /^snmusic:(\d{17,20}):(\d{17,20}):(pause|resume|skip|stop|queue|nowplaying|voteskip|filter)(?::([1-7]|home))?$/.exec(id);
    if (player) {
        if (data.guild_id !== player[1]) fail("Use this music control in its original server.");
        const state = await api(`/guilds/${player[1]}/voice-states/${actorId(data)}`, { optional: true });
        if (state?.channel_id !== player[2]) fail("Join the voice channel shown on this player first.");
        if (player[3] === "filter" && (data.data.component_type !== 3 || data.data.values?.length !== 1)) fail("Choose an available audio preset.");
        return executeCommand(parsed(data, player[1], player[3], player[3] === "queue" ? "view" : "", player[3] === "filter" ? { preset: data.data.values[0] } : player[3] === "queue" ? { page: Number(player[4]) || 1 } : {}), store, api, botId, music);
    }
    const ticket = /^snticket:(claim|close|reopen|transcript):([\da-f-]{36})$/.exec(id);
    if (ticket) return ticketCommand(await checked(parsed(data, data.guild_id, "ticket", ticket[1])), store, ticket[2]);
    const give = /^sngive:(enter|leave):([\da-f-]{36})$/.exec(id);
    if (give) return giveawayEntry(await checked(parsed(data, data.guild_id, "giveaway", "list")), store, give[2], give[1], data.message);
    const appeal = /^snappeal:(approve|deny|view):(\d{17,20}):(\d{1,10})$/.exec(id);
    if (appeal) return decideAppeal(await checked(parsed(data, appeal[2], "appeals", "case", { case: Number(appeal[3]) })), store, Number(appeal[3]), appeal[1], data.message);
    fail("This control is no longer available.");
}
