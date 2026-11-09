/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embedColor } from "./discord.mjs";

import { featureEnabled } from "./featureGroups.mjs";
import { embed, isId } from "./discord.mjs";

const channelTypes = {0:"Text",2:"Voice",4:"Category",5:"Announcement",10:"Announcement thread",11:"Public thread",12:"Private thread",13:"Stage",15:"Forum",16:"Media"};
const person = id => isId(id) ? `<@${id}> · \`${id}\`` : "Discord did not identify the actor.";
const stamp = id => Number((BigInt(id)>>22n)+1420070400000n);
const recentMessageLifetime = 30 * 60_000;
function cachedFiles(files) {
    return files.slice(0, 3).map(file => {
        const url = typeof file.url === "string" && file.url.length <= 800 && /^https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments\/[^\s<>]+$/.test(file.url) ? file.url : undefined;
        return { name: String(file.filename || "Attachment").slice(0, 100), ...(url ? { url, image: /^image\//.test(file.content_type || "") || /\.(?:png|jpe?g|gif|webp)(?:\?|$)/i.test(url) } : {}) };
    });
}
function expireMessages(messages, now) {
    for (const [id, row] of messages) {
        if (now - row.at <= recentMessageLifetime) break;
        messages.delete(id);
    }
}

export function rememberLogEvent(type,data,settings,cache,now=Date.now()) {
    expireMessages(cache.messages, now);
    const logged = Boolean(settings.eventlogs?.messages && data.channel_id !== settings.eventlogs.messages);
    const bot = Boolean(data.author?.bot || data.webhook_id);
    if (type === "MESSAGE_CREATE" && (logged || settings.snipeLimit && !bot)) {
        cache.messages.delete(data.id);
        const reference = data.message_reference, reply = reference && (reference.type ?? 0) === 0 && isId(reference.message_id) && (!reference.guild_id || reference.guild_id === data.guild_id) && (!reference.channel_id || reference.channel_id === data.channel_id) ? { id: reference.message_id, author: data.referenced_message?.author?.id || cache.messages.get(reference.message_id)?.author, name: data.referenced_message?.author?.global_name || data.referenced_message?.author?.username || cache.messages.get(reference.message_id)?.name, content: String(data.referenced_message?.content || cache.messages.get(reference.message_id)?.content || "").slice(0, 200) } : undefined;
        cache.messages.set(data.id,{guild:data.guild_id,channel:data.channel_id,author:data.author?.id,name:String(data.member?.nick || data.author?.global_name || data.author?.username || data.author?.id || "Unknown user").slice(0,256),avatar:/^(?:a_)?[a-f0-9]+$/.test(data.author?.avatar || "")?data.author.avatar:null,discriminator:data.author?.discriminator,bot,logged,snipe:!!settings.snipeLimit,content:bot?"":String(data.content||"").slice(0,settings.snipeLimit?4000:1400),files:cachedFiles(bot?[]:data.attachments||[]),reply,at:now});
        while(cache.messages.size>1000)cache.messages.delete(cache.messages.keys().next().value);
    }
    if(type==="MESSAGE_UPDATE"){
        const old=cache.messages.get(data.id);
        if(old&&!old.bot){
            if(typeof data.content==="string")old.content=data.content.slice(0,old.snipe?4000:1400);
            if(Array.isArray(data.attachments))old.files=cachedFiles(data.attachments);
        }
    }
    if(type==="GUILD_CREATE"&&settings.eventlogs?.channels)for(const channel of data.channels||[])cache.channels.set(channel.id,{guild:data.id,name:channel.name,type:channel.type,at:now});
    if(["CHANNEL_CREATE","CHANNEL_UPDATE","CHANNEL_DELETE"].includes(type)&&settings.eventlogs?.channels)cache.channels.set(data.id,{guild:data.guild_id,name:data.name,type:data.type,at:now});
    while(cache.channels.size>10000)cache.channels.delete(cache.channels.keys().next().value);
}
export function rememberSnipe(type, data, settings, cache, now = Date.now()) {
    const ids = type === "MESSAGE_DELETE" ? [data.id] : [...data.ids].sort((a, b) => a.length - b.length || a.localeCompare(b));
    const history = cache.snipes.get(data.channel_id)?.filter(row => now - row.deleted <= recentMessageLifetime) ?? [];
    for (const id of ids) {
        const row = cache.messages.get(id);
        if (!row || row.guild !== data.guild_id || row.channel !== data.channel_id) continue;
        if (!row.logged) cache.messages.delete(id);
        if (settings.snipeLimit && row.snipe && !row.bot && (row.content || row.files.length) && now - row.at <= recentMessageLifetime)
            history.unshift({ ...row, deleted: now });
        row.snipe = false;
    }
    cache.snipes.delete(data.channel_id);
    if (history.length && settings.snipeLimit) {
        cache.snipes.set(data.channel_id, history.slice(0, settings.snipeLimit));
        if (cache.snipes.size > 250) cache.snipes.delete(cache.snipes.keys().next().value);
    }
}

export function expireLogMessages(cache, now = Date.now()) {
    expireMessages(cache.messages, now);
    for (const [channel, history] of cache.snipes) {
        const live = history.filter(row => now - row.deleted <= recentMessageLifetime);
        if (!live.length) cache.snipes.delete(channel);
        else if (live.length < history.length) cache.snipes.set(channel, live);
    }
}

export function configureSnipe(cache, guild, limit) {
    if (!cache) return;
    for (const [channel, history] of cache.snipes) {
        if (history[0].guild !== guild) continue;
        if (limit) cache.snipes.set(channel, history.slice(0, limit));
        else cache.snipes.delete(channel);
    }
    if (!limit) for (const [id, row] of cache.messages) {
        if (row.guild !== guild) continue;
        if (row.logged) { row.snipe = false; row.content = row.content.slice(0, 1400); }
        else cache.messages.delete(id);
    }
}

export function snipeReply(cache, guild, channel, limit, position, now = Date.now()) {
    if (!limit) return embed("Snipe is off", "A server manager can enable it in Dashboard → Settings → General settings.");
    const history = (cache?.snipes.get(channel) ?? []).filter(row => row.guild === guild && now - row.deleted <= recentMessageLifetime).slice(0, limit);
    const row = history[position - 1];
    if (!row) return embed("No deleted message at that position", history.length ? `Choose a number from 1 to ${history.length}.` : "There are no recent deletions cached in this channel.");
    const body = embed("", ""), card = body.embeds[0];
    delete card.title;
    const name = (row.name || row.author || "Unknown user").replace(/[\\[\]()*_`~>|]/g, "\\$&");
    card.description = `**${name}**${isId(row.author) ? ` (<@${row.author}>)` : ""}\n\n${row.content || "No text."}`;
    card.description = card.description.slice(0, 4096);
    body.allowed_mentions.replied_user = false;
    const avatarIndex = row.discriminator && row.discriminator !== "0" ? Number(row.discriminator) % 5 : isId(row.author) ? Number((BigInt(row.author) >> 22n) % 6n) : 0;
    card.thumbnail = { url: row.avatar ? `https://cdn.discordapp.com/avatars/${row.author}/${row.avatar}.${row.avatar.startsWith("a_") ? "gif" : "png"}?size=128` : `https://cdn.discordapp.com/embed/avatars/${avatarIndex}.png` };
    const seconds = Math.max(0, Math.floor((now - row.deleted) / 1000)), minutes = Math.floor(seconds / 60);
    const age = seconds < 60 ? `${seconds} second${seconds === 1 ? "" : "s"}` : `${minutes} minute${minutes === 1 ? "" : "s"}`;
    card.footer = { text: `Deleted ${age} ago · ${position}/${history.length} ${history.length === 1 ? "message" : "messages"}` };
    card.fields = [];
    if (row.reply) card.fields.push({ name: `Replying to ${row.reply.name || "a message"}`, value: `${isId(row.reply.author) ? person(row.reply.author) : "Original author unavailable."} · [Jump to message](https://discord.com/channels/${guild}/${channel}/${row.reply.id})${row.reply.content ? "\n" + row.reply.content : ""}` });
    if (row.files.length) {
        for (const [index, file] of row.files.entries()) body.embeds[0].fields.push({ name: `Attachment ${index + 1}`, value: file.url ? `[${file.name.replace(/[\\[\]()*_`]/g, "\\$&")}](${file.url})` : file.name });
        const image = row.files.find(file => file.image && file.url);
        if (image) body.embeds[0].image = { url: image.url };
        body.embeds[0].footer.text += " · Media links may expire";
    }
    return body;
}

export async function eventLog(type,data,store,api,cache,botId) {
    if (!featureEnabled(store.settings(data.guild_id), "logging")) return;
    const guild=data.guild_id,settings=store.settings(guild),logs=settings.eventlogs||{};
    let destination,title,description;
    if(["MESSAGE_DELETE","MESSAGE_DELETE_BULK"].includes(type)&&logs.messages){
        if(data.channel_id===logs.messages)return;
        const ids=type==="MESSAGE_DELETE"?[data.id]:data.ids||[],found=ids.map(id=>cache.messages.get(id)).filter(row=>row?.logged&&row.guild===guild&&row.channel===data.channel_id&&!row.bot&&Date.now()-row.at<=recentMessageLifetime);
        if(type==="MESSAGE_DELETE"&&ids.every(id=>cache.messages.get(id)?.bot))return;
        for(const id of ids)cache.messages.delete(id);
        if(!store.claim(`deleted:${guild}:${ids[0]}`))return;
        destination=logs.messages;title=type==="MESSAGE_DELETE"?"Message deleted":"Messages deleted";
        description=`**Channel:** <#${data.channel_id}>\n**Deleted by:** Discord does not identify the actor in a message deletion event. Check the separate audit entry if one is provided.\n**Messages:** ${ids.length}\n**Message IDs:** ${ids.slice(0,5).map(id=>`\`${id}\``).join(", ")}\n`+found.slice(0,3).map(row=>`\n**Author:** ${person(row.author)}\n**Message ID:** \`${ids.length===1?ids[0]:"See deletion batch"}\`\n${row.content.slice(0,1400)||"No text."}${row.files.length?`\nAttachments: ${row.files.map(f=>f.name).join(", ")}`:""}`).join("\n");
        if(!found.length)description+="\nAuthor and contents unavailable. This message was not in Sonata's recent-message cache.";
    }
    if(["GUILD_MEMBER_ADD","GUILD_MEMBER_REMOVE"].includes(type)&&logs.joins){
        if(!store.claim(`membership-log:${guild}:${data.user.id}:${type}:${data.joined_at||data.eventId||Date.now()}`))return;
        destination=logs.joins;title=type==="GUILD_MEMBER_ADD"?"Member joined":"Member left";
        description=`**Member:** ${person(data.user.id)}\n**Username:** ${data.user.username||"Unavailable"}\n**Action by:** ${type==="GUILD_MEMBER_ADD"?person(data.user.id):"Discord does not identify whether this was a voluntary leave, kick or ban in the departure event. Check the matching moderation or audit log."}`;
    }
    if(type==="GUILD_AUDIT_LOG_ENTRY_CREATE"&&isId(data.id)&&Date.now()-stamp(data.id)<300_000){
        const action=data.action_type,category=[10,11,12].includes(action)?"channels":[72,73].includes(action)?"messages":[26,27].includes(action)?"voice":null;
        if(!category||!logs[category]||!store.claim(`event-audit:${data.id}`))return;
        destination=logs[category];const changes=data.changes||[],channel=cache.channels.get(data.target_id),value=key=>{const change=changes.find(c=>c.key===key);return change?.new_value??change?.old_value;};
        title=({10:"Channel created",11:"Channel updated",12:"Channel deleted",72:"Message deletion · audit",73:"Bulk message deletion · audit",26:"Member moved · audit",27:"Member disconnected · audit"})[action];
        description=`**Action by:** ${person(data.user_id)}\n**Audit ID:** \`${data.id}\`\n`;
        if(category==="channels")description+=`**Channel:** ${channel?.name||value("name")||"Name unavailable"} · \`${data.target_id}\`\n**Type:** ${channelTypes[channel?.type??value("type")]||`Unknown (${channel?.type??value("type")??"not provided"})`}\n`;
        else description+=`**Target:** ${data.target_id?person(data.target_id):"Discord did not identify an individual target."}\n${data.options?.channel_id?`**Channel:** <#${data.options.channel_id}>\n`:""}${data.options?.count?`**Reported count:** ${data.options.count}\n`:""}`;
        if(data.reason)description+=`**Reason:** ${data.reason.slice(0,400)}\n`;
        const marker=new RegExp(`\\[Sonata case ${guild}-(\\d+)\\]`).exec(data.reason||""),sonataCase=isId(botId)&&data.user_id===botId&&marker?store.case(guild,Number(marker[1])):null;
        if(sonataCase)description+=`**Responsible Sonata moderator:** ${person(sonataCase.actor)} · Case #${sonataCase.n}\n`;
        description+=changes.slice(0,4).map(c=>`**${c.key}:** ${JSON.stringify(c.old_value??"None").slice(0,100)} → ${JSON.stringify(c.new_value??"None").slice(0,100)}`).join("\n");
    }
    if(!destination)return;
    const body=embed(title,description);body.embeds[0].color=embedColor();body.embeds[0].timestamp=new Date().toISOString();
    try{await api(`/channels/${destination}/messages`,{method:"POST",body});}
    catch{const current=store.settings(guild);current.securityError="An event log could not be delivered. Check Sonata's access to the destination channel.";store.saveSettings(guild,current);}
}
