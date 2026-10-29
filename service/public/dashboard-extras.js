/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const extraElement = (tag, text, className) => { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; };
document.addEventListener("sonata-server", event => {
    const { current, session, selected } = event.detail, root = document.getElementById("tab-configure");
    document.getElementById("dashboard-extra")?.remove(); document.getElementById("dashboard-extra-nav")?.remove();
    if (!current.manageable) return;
    const holder = extraElement("section", null, "panel padded dashboard-extra"); holder.id = "dashboard-extra";
    const tabs = extraElement("div", null, "record-actions"), content = extraElement("div");
    const layout=root.querySelector(".settings-layout"), editor=root.querySelector(".settings-editor"), sidebar=root.querySelector(".tool-sidebar"), tools=root.querySelector("#tool-list");
    tabs.id="dashboard-extra-nav"; tabs.className="tool-list"; sidebar.insertBefore(tabs,tools); holder.append(content); layout.append(holder); holder.hidden=true;
    tools.addEventListener("click",()=>{holder.hidden=true;editor.hidden=false;});
    const open=()=>{holder.hidden=false;editor.hidden=true;};
    const send = async (path, input) => { const response = await fetch(`/api/bot/${path}`, { method: "POST", credentials: "same-origin", headers: {"Content-Type":"application/json","X-CSRF-Token":session.csrf}, body:JSON.stringify({guild:selected,...input}) }); const value = await response.json(); if (!response.ok) throw Error(value.error); return value; };
    const message = extraElement("p", null, "small"); message.setAttribute("role", "status");
    function field(form, name, type = "input") { const label = extraElement("label", name), control = extraElement(type); label.append(control); form.append(label); return control; }
    function designer() {
        open(); message.textContent=""; content.replaceChildren(); const form = extraElement("form"), preview = extraElement("article", null, "message-preview"), titleView = extraElement("strong"), bodyView = extraElement("p"), buttonsView = extraElement("div", null, "record-actions"); preview.append(titleView, bodyView, buttonsView);
        content.append(extraElement("h2","Message designer"),extraElement("p","Preview welcome messages and panels before saving or posting."), form, preview, message);
        const kind = field(form,"Message type","select"); for (const [value,text] of [["custom","Custom message"],["welcome","Welcome"],["goodbye","Goodbye"],["ticket","Ticket panel"],["verification","Verification panel"]]) { const option = extraElement("option",text); option.value=value; kind.append(option); }
        const title = field(form,"Title"); title.maxLength=250; title.value="Welcome";
        const text = field(form,"Message","textarea"); text.maxLength=1800; text.rows=5; text.required=true; text.value="Welcome {user} to {server}.";
        const color = field(form,"Accent color"); color.type="color"; color.value="#bd898e";
        const channel = field(form,"Destination channel","select"); for (const item of current.channels.filter(c=>[0,5].includes(c.type))) { const option=extraElement("option",`# ${item.name}`); option.value=item.id; channel.append(option); }
        const actions=extraElement("div",null,"record-actions"), sample=extraElement("button","Preview with my account","quiet"), post=extraElement("button","Post message","primary"), save=extraElement("button","Save automatic message","quiet"); for (const button of [sample,post,save]) button.type="button"; actions.append(sample,post,save); form.append(extraElement("p","Variables: {user}, {username}, {server}, {id}.","small"), actions);
        const input=()=>({kind:kind.value,title:title.value,text:text.value,color:color.value,channel:channel.value});
        const update=()=> { titleView.textContent=title.value;bodyView.textContent=text.value;preview.style.borderLeftColor=color.value;buttonsView.replaceChildren();if(["ticket","verification"].includes(kind.value)){const button=extraElement("button",kind.value==="ticket"?"Open ticket":"Verify","quiet");button.type="button";button.disabled=true;buttonsView.append(button);}save.hidden=!["welcome","goodbye"].includes(kind.value);message.textContent=""; };
        form.addEventListener("input",update); update();
        async function act(button,extra) { if(!form.reportValidity())return;button.disabled=true;message.textContent="";try{const value=await send("designer",{...input(),...extra});if(value.message){titleView.textContent=value.message.embeds[0].title;bodyView.textContent=value.message.embeds[0].description;}message.textContent=extra.preview?"Preview only. Nothing posted.":extra.save?"Automatic message saved.":"Message posted.";}catch(error){message.textContent=error.message;}finally{button.disabled=false;} }
        sample.addEventListener("click",()=>void act(sample,{preview:true}));post.addEventListener("click",()=>void act(post,{}));save.addEventListener("click",()=>void act(save,{save:true}));
    }
    const designButton=extraElement("button","Message designer","quiet");designButton.type="button";designButton.addEventListener("click",designer);tabs.append(designButton);
    if(current.serverOwner){const accessButton=extraElement("button","Dashboard access","quiet");accessButton.type="button";tabs.append(accessButton);accessButton.addEventListener("click",()=>{
        open(); message.textContent=""; content.replaceChildren();const form=extraElement("form");content.append(extraElement("h2","Dashboard access"),extraElement("p","Only you, the Discord server owner, can change this. Whitelisted members still need the Discord permissions required by each action."),form,message);
        const admins=field(form,"Allow members with Administrator or Manage Server");admins.type="checkbox";admins.checked=current.dashboardAccess?.administrators??true;
        const users=field(form,"Whitelisted Discord user IDs","textarea");users.rows=4;users.value=(current.dashboardAccess?.users||[]).join("\n");users.placeholder="One ID per line, or separated by commas";
        const save=extraElement("button","Save dashboard access","primary");save.type="submit";form.append(save);form.addEventListener("submit",async event=>{event.preventDefault();save.disabled=true;try{const ids=users.value.split(/[\s,]+/).filter(Boolean);await send("access",{administrators:admins.checked,users:ids});current.dashboardAccess={administrators:admins.checked,users:ids};message.textContent="Dashboard access saved.";}catch(error){message.textContent=error.message;}finally{save.disabled=false;}});
    });}
});
