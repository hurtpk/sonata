/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { caseTarget } from "./moderation.mjs";
import { channelPermissions, embed, fail, PERMS, replyPayload, requirePermission } from "./discord.mjs";
import { readDiscordFile } from "./media.mjs";

export function validateEvidence(file) {
    if (!file || !Number.isInteger(file.size) || file.size < 1 || file.size > 8*1024*1024 || !/^(?:image|video)\//.test(file.content_type || "")) fail("Attach an image or video no larger than 8 MB.");
    let url;try{url=new URL(file.url);}catch{fail("Use an image or video uploaded to Discord.");}
    if(url.protocol!=="https:"||url.username||url.password||url.port||!["cdn.discordapp.com","media.discordapp.net"].includes(url.hostname)||!url.pathname.startsWith("/attachments/"))fail("Use an image or video uploaded to Discord.");
}
export async function saveCaseEvidence(context,store,n,file,transport=fetch) {
    validateEvidence(file);
    const destination=store.settings(context.guild.id).logChannel;
    if(!destination)fail("Set a moderation log channel before attaching evidence.");
    const channel=await context.api(`/channels/${destination}`);
    if(channel.guild_id!==context.guild.id||![0,5].includes(channel.type))fail("Choose a text channel in this server for moderation logs.");
    requirePermission(channelPermissions(context.actor,context.roles,context.guild,channel),PERMS.VIEW|PERMS.HISTORY);
    requirePermission(channelPermissions(context.bot,context.roles,context.guild,channel),PERMS.VIEW|PERMS.SEND|PERMS.ATTACH|PERMS.EMBEDS);
    const data=await readDiscordFile(file.url,8*1024*1024,transport),filename=String(file.filename||"evidence").replace(/[^\w. -]/g,"_").slice(0,100);
    const posted=await context.api(`/channels/${destination}/messages`,{method:"POST",...replyPayload({...embed(`Evidence · case #${n}`,`Submitted by <@${context.command.actor}> · \`${context.command.actor}\``),files:[{name:filename,type:file.content_type,bytes:data.bytes}]})});
    const link=`https://discord.com/channels/${context.guild.id}/${destination}/${posted.id}`;
    store.run("INSERT INTO case_files VALUES (?,?,?,?,?,?,?,?)",crypto.randomUUID(),context.guild.id,n,context.command.actor,destination,posted.id,filename,file.content_type);
    store.addNote(context.guild.id,n,context.command.actor,"evidence",link);
    return embed("Evidence saved",`[Open saved evidence](${link}). Keep that log message to retain the file.`);
}
export async function caseDetails(context,store,row) {
    const response=embed(`Case #${row.n} · ${row.kind}`,`**Target:** ${caseTarget(row.kind,row.target)}\n**Moderator:** <@${row.actor}> · \`${row.actor}\`\n**When:** <t:${Math.floor(row.at/1000)}:f>\n**Status:** ${row.status.replaceAll("_"," ")}\n\n**Reason**\n${row.reason}${row.duration?`\n**Duration:** ${Math.round(row.duration/60000)} minutes`:""}${row.detail?`\n\n**Details**\n${row.detail}`:""}`);
    response.embeds[0].color=0xbd898e;
    const notes=store.all("SELECT * FROM notes WHERE guild=? AND n=? ORDER BY at DESC LIMIT 15",row.guild,row.n);
    response.embeds[0].fields=notes.slice(0,8).map(note=>({name:note.kind,value:`${String(note.value).slice(0,450)}\nBy <@${note.actor}> · <t:${Math.floor(note.at/1000)}:f>`,inline:false}));
    const references=store.all("SELECT channel,message FROM case_files WHERE guild=? AND n=? ORDER BY rowid LIMIT 10",row.guild,row.n);
    for(const note of notes.filter(n=>n.kind==="evidence")) {const match=new RegExp(`^https://discord.com/channels/${row.guild}/(\\d{17,20})/(\\d{17,20})$`).exec(note.value);if(match&&!references.some(r=>r.message===match[2]))references.push({channel:match[1],message:match[2]});}
    let total=0;const files=[];
    for(const ref of references.slice(0,5)) {
        try {
            const channel=await context.api(`/channels/${ref.channel}`,{optional:true});if(!channel||channel.guild_id!==row.guild)continue;
            for(const member of [context.actor,context.bot])requirePermission(channelPermissions(member,context.roles,context.guild,channel),PERMS.VIEW|PERMS.HISTORY);
            const message=await context.api(`/channels/${ref.channel}/messages/${ref.message}`,{optional:true});
            for(const file of message?.attachments||[]) {
                if(files.length>=3||total+file.size>8*1024*1024)continue;validateEvidence(file);
                const data=await readDiscordFile(file.url);total+=data.bytes.length;
                if(total>8*1024*1024)break;
                files.push({name:`${files.length+1}-${String(file.filename||"evidence").replace(/[^\w. -]/g,"_").slice(0,80)}`,type:file.content_type,bytes:data.bytes});
            }
        }catch{response.embeds[0].footer={text:"Some evidence could not be previewed. Check the saved evidence links and channel permissions."};}
    }
    if(files.length){response.files=files;const image=files.find(f=>f.type.startsWith("image/")&&!f.type.includes("svg"));if(image)response.embeds[0].image={url:`attachment://${image.name}`};}
    return response;
}
