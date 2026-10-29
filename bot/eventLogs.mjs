/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { embed, isId } from "./discord.mjs";

const channelTypes = {0:"Text",2:"Voice",4:"Category",5:"Announcement",10:"Announcement thread",11:"Public thread",12:"Private thread",13:"Stage",15:"Forum",16:"Media"};
const person = id => isId(id) ? `<@${id}> · \`${id}\`` : "Discord did not identify the actor.";
const stamp = id => Number((BigInt(id)>>22n)+1420070400000n);
export function rememberLogEvent(type,data,settings,cache,now=Date.now()) {
    for(const [id,value] of cache.messages)if(now-value.at>1800_000)cache.messages.delete(id);
    if(type==="MESSAGE_CREATE"&&settings.eventlogs?.messages&&data.channel_id!==settings.eventlogs.messages){
        cache.messages.set(data.id,{guild:data.guild_id,channel:data.channel_id,author:data.author?.id,bot:!!data.author?.bot||!!data.webhook_id,content:data.author?.bot||data.webhook_id?"":String(data.content||"").slice(0,1400),files:(data.author?.bot||data.webhook_id?[]:data.attachments||[]).slice(0,3).map(f=>({name:String(f.filename||"Attachment").slice(0,100)})),at:now});
        while(cache.messages.size>1000)cache.messages.delete(cache.messages.keys().next().value);
    }
    if(type==="MESSAGE_UPDATE"){const old=cache.messages.get(data.id);if(old&&!old.bot&&typeof data.content==="string")old.content=data.content.slice(0,1400);}
    if(type==="GUILD_CREATE"&&settings.eventlogs?.channels)for(const channel of data.channels||[])cache.channels.set(channel.id,{guild:data.id,name:channel.name,type:channel.type,at:now});
    if(["CHANNEL_CREATE","CHANNEL_UPDATE","CHANNEL_DELETE"].includes(type)&&settings.eventlogs?.channels)cache.channels.set(data.id,{guild:data.guild_id,name:data.name,type:data.type,at:now});
    while(cache.channels.size>10000)cache.channels.delete(cache.channels.keys().next().value);
}
export async function eventLog(type,data,store,api,cache,botId) {
    const guild=data.guild_id,settings=store.settings(guild),logs=settings.eventlogs||{};
    let destination,title,description;
    if(["MESSAGE_DELETE","MESSAGE_DELETE_BULK"].includes(type)&&logs.messages){
        if(data.channel_id===logs.messages)return;
        const ids=type==="MESSAGE_DELETE"?[data.id]:data.ids||[],found=ids.map(id=>cache.messages.get(id)).filter(row=>row&&row.guild===guild&&row.channel===data.channel_id&&!row.bot&&Date.now()-row.at<=1800_000);
        if(type==="MESSAGE_DELETE"&&ids.every(id=>cache.messages.get(id)?.bot))return;
        for(const id of ids)cache.messages.delete(id);
        if(!store.claim(`deleted:${guild}:${ids[0]}`))return;
        destination=logs.messages;title=type==="MESSAGE_DELETE"?"Message deleted":"Messages deleted";
        description=`**Channel:** <#${data.channel_id}>\n**Deleted by:** Discord does not identify the actor in a message deletion event. Check the separate audit entry if one is provided.\n**Messages:** ${ids.length}\n**Message IDs:** ${ids.slice(0,5).map(id=>`\`${id}\``).join(", ")}\n`+found.slice(0,3).map(row=>`\n**Author:** ${person(row.author)}\n**Message ID:** \`${ids.length===1?ids[0]:"See deletion batch"}\`\n${row.content||"No text."}${row.files.length?`\nAttachments: ${row.files.map(f=>f.name).join(", ")}`:""}`).join("\n");
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
    const body=embed(title,description);body.embeds[0].color=0xbd898e;body.embeds[0].timestamp=new Date().toISOString();
    try{await api(`/channels/${destination}/messages`,{method:"POST",body});}
    catch{const current=store.settings(guild);current.securityError="An event log could not be delivered. Check Sonata's access to the destination channel.";store.saveSettings(guild,current);}
}
