/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const adminElement = (tag,text,className) => { const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node; };
document.addEventListener("sonata-admin", event=>{
    const session=event.detail, scopes=session.permissions, nav=document.querySelector(".bot-owner-nav"), body=document.querySelector(".admin-body");
    const request=async(path,input)=>{const r=await fetch(`/api/admin/${path}`,{method:input?"POST":"GET",credentials:"same-origin",headers:input?{"Content-Type":"application/json","X-CSRF-Token":session.csrf}:{},body:input?JSON.stringify(input):undefined});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
    function show(panel,button){for(const section of body.children)section.hidden=section!==panel;for(const item of nav.children)item.setAttribute("aria-selected",String(item===button));}
    for(const id of ["activation-tab","owner-bot-tab"]){const button=document.getElementById(id);button.hidden=!scopes.includes(id==="activation-tab"?"users":"servers");button.addEventListener("click",()=>{for(const panel of body.querySelectorAll(".extra-admin-panel"))panel.hidden=true;});}
    function tab(label,render){const button=adminElement("button",label,"quiet"),panel=adminElement("section",null,"extra-admin-panel");button.type="button";panel.hidden=true;nav.append(button);body.append(panel);button.addEventListener("click",()=>{show(panel,button);void render(panel);});return button;}
    let healthButton;
    if(scopes.includes("health"))healthButton=tab("Service health",async panel=>{
        panel.replaceChildren(adminElement("h1","Service health"));const refresh=adminElement("button","Refresh","quiet");panel.append(refresh);refresh.addEventListener("click",()=>healthButton.click());
        try{const data=await request("health"),grid=adminElement("div",null,"bot-two");panel.append(adminElement("p",`Checked ${new Date(data.checkedAt).toLocaleString()}`,"small"),grid);
            for(const [title,values] of [["Website & database",[["Deployment",data.version],["Database",data.database.online?"Online":"Offline"],["Database response",`${data.database.responseMs} ms`],["Registered accounts",data.database.accounts]]],["Bot & music",[["Gateway",data.bot?.status.connected?"Connected":"Offline"],["Music / video service",data.bot?.status.musicOnline?"Connected":"Offline"],["Bot deployment",data.bot?.status.version||"Unavailable"],["Queued commands",data.bot?.status.queued??"Unavailable"],["Pending timed actions",data.bot?.pendingJobs??"Unavailable"]]]]){const card=adminElement("article",null,"panel padded"),list=adminElement("dl");card.append(adminElement("h2",title),list);for(const [key,value]of values)list.append(adminElement("dt",key),adminElement("dd",String(value)));grid.append(card);}
            const errors=adminElement("article",null,"panel padded");errors.append(adminElement("h2","Recent issues"));for(const text of [data.botError,data.bot?.error,...(data.bot?.failures||[]).map(x=>`${x.name}: ${x.n} failed or unresolved commands in the last day.`),...(data.bot?.stickyErrors||[]).map(x=>`Sticky in ${x.guild} / ${x.channel}: ${x.error}`)].filter(Boolean))errors.append(adminElement("p",text));if(errors.children.length===1)errors.append(adminElement("p","No recorded issues."));panel.append(errors);
        }catch(error){panel.append(adminElement("p",error.message,"error"));}
    });
    if(session.owner)tab("Administrators",async panel=>{
        panel.replaceChildren(adminElement("h1","Administrators"),adminElement("p","Grant specific tools to trusted Discord accounts. Only the owner can change these grants."));
        try{const data=await request("staff"),form=adminElement("form",null,"panel padded"),label=adminElement("label","Discord user ID"),id=adminElement("input");id.required=true;id.pattern="[0-9]{17,20}";label.append(id);form.append(label);const boxes=[];
            const names={users:"View plugin accounts",access:"Allow and block plugin accounts",servers:"View bot servers",serverAccess:"Blacklist servers and make the bot leave",health:"View service health"};for(const scope of data.scopes){const row=adminElement("label",names[scope]),box=adminElement("input");box.type="checkbox";row.append(box);form.append(row);boxes.push([scope,box]);}
            const save=adminElement("button","Save administrator","primary"),notice=adminElement("p",null,"small");save.type="submit";form.append(save,notice);panel.append(form);form.addEventListener("submit",async event=>{event.preventDefault();save.disabled=true;try{await request("staff",{id:id.value.trim(),permissions:boxes.filter(([,b])=>b.checked).map(([s])=>s)});notice.textContent="Administrator saved. Reopen this page to refresh the list.";}catch(error){notice.textContent=error.message;}finally{save.disabled=false;}});
            for(const grant of data.grants){const row=adminElement("article",null,"panel padded"),edit=adminElement("button","Edit","quiet"),revoke=adminElement("button","Revoke access","quiet");row.append(adminElement("strong",grant.id),adminElement("p",JSON.parse(grant.permissions).map(s=>names[s]).join(", ")),edit,revoke);panel.append(row);edit.addEventListener("click",()=>{id.value=grant.id;for(const [scope,box]of boxes)box.checked=JSON.parse(grant.permissions).includes(scope);id.focus();});revoke.addEventListener("click",async()=>{revoke.disabled=true;try{await request("staff",{id:grant.id,permissions:[]});row.remove();}catch(error){notice.textContent=error.message;revoke.disabled=false;}});}
        }catch(error){panel.append(adminElement("p",error.message,"error"));}
    });
    if(!scopes.includes("users")){document.getElementById("activation-area").hidden=true;if(healthButton)healthButton.click();else document.getElementById("owner-bot-tab").click();}
});
