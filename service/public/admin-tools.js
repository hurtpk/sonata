/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const adminElement = (tag,text,className) => { const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node; };
const staffPermissions = {
    users: "View plugin accounts and access history",
    access: "Allow or block plugin accounts",
    servers: "View installed servers and their dashboards",
    serverAccess: "Blacklist servers, remove the bot and reset server bot profiles",
    health: "View service health and command failures",
};
const staffDate = at => at ? new Date(at).toLocaleString() : "No visit recorded";
const staffArea = area => area === "admin" ? "Admin dashboard" : "Dashboard";
const staffActions = { allowed: "Plugin access allowed", blocked: "Plugin access blocked", unblocked: "Plugin access restored", admin_granted: "Administrator access granted", admin_revoked: "Administrator access revoked", sessions_revoked: "Dashboard sessions revoked" };

async function renderAdministrators(panel, request, message = "") {
    const heading = adminElement("h1", "Administrators"), notice = adminElement("p", message, "small");
    notice.setAttribute("role", "status");
    panel.replaceChildren(heading, adminElement("p", "Manage permissions and review the last 90 days of recorded dashboard activity."), notice);
    try {
        const { grants, scopes } = await request("staff");
        if (!panel.contains(heading)) return;
        const editor = adminElement("details", null, "panel padded staff-editor"), editorTitle = adminElement("summary", "Add or edit an administrator");
        const form = adminElement("form"), label = adminElement("label", "Discord user ID"), id = adminElement("input");
        id.required = true; id.pattern = "[0-9]{17,20}"; id.inputMode = "numeric"; label.append(id);
        const permissions = adminElement("fieldset"), boxes = new Map();
        permissions.append(adminElement("legend", "Permissions"));
        for (const scope of scopes) {
            const row = adminElement("label", null, "staff-permission"), checkbox = adminElement("input");
            checkbox.type = "checkbox";
            row.append(checkbox, adminElement("span", staffPermissions[scope])); permissions.append(row); boxes.set(scope, checkbox);
        }
        const save = adminElement("button", "Save administrator", "primary");
        save.type = "submit"; form.append(label, permissions, save); editor.append(editorTitle, form);
        const list = adminElement("div", null, "staff-list");
        panel.append(editor, list);
        form.addEventListener("submit", async event => {
            event.preventDefault();
            const permissions = [...boxes].filter(([, checkbox]) => checkbox.checked).map(([scope]) => scope);
            if (!permissions.length) { notice.textContent = "Select at least one permission. Use Revoke access to remove an administrator."; return; }
            save.disabled = true;
            try { await request("staff", { id: id.value.trim(), permissions }); await renderAdministrators(panel, request, "Administrator saved."); }
            catch (error) { notice.textContent = error.message; }
            finally { save.disabled = false; }
        });
        if (!grants.length) list.append(adminElement("p", "No delegated administrators yet.", "small"));
        for (const grant of grants) {
            const allowed = JSON.parse(grant.permissions), name = grant.name || grant.username || grant.id;
            const card = adminElement("article", null, "panel padded staff-card"), top = adminElement("div", null, "staff-card-top");
            const profile = adminElement("a", null, "staff-profile"), avatar = adminElement("img"), identity = adminElement("span");
            profile.href = `https://discord.com/users/${grant.id}`; profile.target = "_blank"; profile.rel = "noopener noreferrer";
            profile.setAttribute("aria-label", "Open Discord profile for " + name);
            const fallback = `https://cdn.discordapp.com/embed/avatars/${grant.discriminator && grant.discriminator !== "0" ? Number(grant.discriminator) % 5 : (BigInt(grant.id) >> 22n) % 6n}.png`;
            avatar.alt = ""; avatar.loading = "lazy";
            avatar.src = /^(?:a_)?[a-f0-9]{32}$/i.test(grant.avatar ?? "") ? `https://cdn.discordapp.com/avatars/${grant.id}/${grant.avatar}.webp?size=128` : fallback;
            avatar.addEventListener("error", () => { avatar.src = fallback; }, { once: true });
            identity.append(adminElement("strong", name), adminElement("small", [grant.username && "@" + grant.username, grant.id].filter(Boolean).join(" · ")));
            profile.append(avatar, identity);
            const controls = adminElement("div", null, "staff-controls"), edit = adminElement("button", "Edit permissions", "quiet"), revoke = adminElement("button", "Revoke access", "quiet");
            controls.append(edit, revoke); top.append(profile, controls); card.append(top);
            const metrics = adminElement("dl", null, "staff-metrics");
            for (const [label, value] of [["Last Dashboard visit", staffDate(grant.lastDashboard)], ["Last Admin visit", staffDate(grant.lastAdmin)], ["Recorded actions", grant.totalActions.toLocaleString()]]) {
                const item = adminElement("div");
                item.append(adminElement("dt", label), adminElement("dd", value)); metrics.append(item);
            }
            const capability = adminElement("section", null, "staff-capabilities"), capabilities = adminElement("ul");
            capability.append(adminElement("h2", "Permissions"), capabilities);
            for (const scope of allowed) capabilities.append(adminElement("li", staffPermissions[scope]));
            const activity = adminElement("details", null, "staff-activity"), timeline = adminElement("div", null, "staff-timeline");
            activity.append(adminElement("summary", "Recent visits and actions"), timeline);
            card.append(metrics, capability, activity); list.append(card);
            let activityLoaded = false;
            activity.addEventListener("toggle", async () => {
                if (!activity.open || activityLoaded) return;
                activityLoaded = true; timeline.textContent = "Loading activity…";
                try {
                    const { visits, actions } = await request("staff?activity=" + encodeURIComponent(grant.id));
                    timeline.replaceChildren();
                    for (const [title, entries] of [["Visits", visits], ["Actions", actions]]) {
                        const column = adminElement("section"), rows = adminElement("ul");
                        column.append(adminElement("h3", title), rows);
                        for (const entry of entries) {
                            const row = adminElement("li"), area = staffArea(entry.area);
                            row.append(adminElement("strong", entry.action ? staffActions[entry.action] ?? entry.action : area), adminElement("small", [staffDate(entry.at), entry.action && area, entry.target].filter(Boolean).join(" · ")));
                            rows.append(row);
                        }
                        if (!entries.length) column.append(adminElement("p", "Nothing recorded yet.", "small"));
                        timeline.append(column);
                    }
                } catch (error) { timeline.textContent = error.message; activityLoaded = false; }
            });
            edit.addEventListener("click", () => {
                editor.open = true; id.value = grant.id;
                for (const [scope, checkbox] of boxes) checkbox.checked = allowed.includes(scope);
                id.focus();
            });
            revoke.addEventListener("click", async () => {
                if (!confirm("Revoke Sonata administrator access for " + name + "?")) return;
                revoke.disabled = true;
                try { await request("staff", { id: grant.id, permissions: [] }); await renderAdministrators(panel, request, "Administrator access revoked."); }
                catch (error) { notice.textContent = error.message; revoke.disabled = false; }
            });
        }
    } catch (error) { if (panel.contains(heading)) notice.textContent = error.message; }
}

document.addEventListener("sonata-admin", event=>{
    const session=event.detail, scopes=session.permissions, nav=document.querySelector(".bot-owner-nav"), body=document.querySelector(".admin-body");
    nav.addEventListener("click", event=>{const selected=event.target.closest("button");if(!selected)return;for(const button of nav.querySelectorAll("button"))button.setAttribute("aria-selected",String(button===selected));});
    const request=async(path,input)=>{const r=await fetch(`/api/admin/${path}`,{method:input?"POST":"GET",credentials:"same-origin",headers:input?{"Content-Type":"application/json","X-CSRF-Token":session.csrf}:{},body:input?JSON.stringify(input):undefined});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
    function show(panel,button){for(const section of body.children)section.hidden=section!==panel;for(const item of nav.querySelectorAll("button"))item.setAttribute("aria-selected",String(item===button));}
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
    if(scopes.includes("health"))tab("Command failures",async panel=>{
        panel.replaceChildren(adminElement("h1","Command failures"),adminElement("p","Detailed records start with this update and are kept until removed. Earlier failures have totals only.","small"));
        const form=adminElement("form",null,"toolbar"),label=adminElement("label","Find a failure"),search=adminElement("input"),submit=adminElement("button","Search","quiet"),refresh=adminElement("button","Refresh","quiet"),list=adminElement("div"),status=adminElement("p",null,"small"),pages=adminElement("div",null,"table-foot"),previous=adminElement("button","← Previous","quiet"),next=adminElement("button","Next →","quiet");
        search.type="search";search.placeholder="Error code, command or server ID";label.append(search);submit.type="submit";refresh.type="button";form.append(label,submit,refresh);pages.append(previous,next);panel.append(form,status,list,pages);
        let cursors=[""],page=0,query="",loading=false;
        async function load(){
            if(loading)return;loading=true;previous.disabled=true;next.disabled=true;submit.disabled=true;refresh.disabled=true;
            try{
                const data=await request(`bot/failures?${new URLSearchParams({q:query,before:cursors[page]})}`);list.replaceChildren();status.textContent=`${data.total.toLocaleString()} recorded failures · Page ${page+1}`;
                for(const row of data.failures){
                    const item=adminElement("details",null,"panel padded"),summary=adminElement("summary",`${row.code} · ${row.name} · ${new Date(row.at).toLocaleString()}`),details=adminElement("div");
                    details.append(adminElement("p",row.detail),adminElement("p",`Server ${row.guild||"DM"} · Channel ${row.channel} · User ${row.actor}`,"small"),adminElement("p",`Result: ${row.outcome} · Request ${row.request}`,"small"));
                    if(row.command){const original=adminElement("pre",row.command,"failure-command"),copy=adminElement("button","Copy command","quiet");copy.type="button";copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(row.command);copy.textContent="Copied";}catch{copy.textContent="Select the command text to copy it";}});details.append(original,copy);}else details.append(adminElement("p","The exact command was not recorded for this older failure.","small"));
                    if(row.source){const link=adminElement("a","Original video ↗");link.href=row.source;link.target="_blank";link.rel="noopener noreferrer";details.append(link);}
                    if(/^\d{17,20}$/.test(row.guild)&&/^\d{17,20}$/.test(row.channel)&&/^\d{17,20}$/.test(row.request)){const link=adminElement("a","Open command in Discord ↗");link.href=`https://discord.com/channels/${row.guild}/${row.channel}/${row.request}`;link.target="_blank";link.rel="noopener noreferrer";details.append(adminElement("p"),link);}
                    item.append(summary,details);list.append(item);
                }
                if(!data.failures.length)list.append(adminElement("p","No matching failures."));cursors[page+1]=data.next;previous.disabled=page===0;next.disabled=!data.next;
            }catch(error){list.replaceChildren(adminElement("p",error.message,"error"));}
            finally{loading=false;submit.disabled=false;refresh.disabled=false;}
        }
        form.addEventListener("submit",event=>{event.preventDefault();if(loading)return;query=search.value.trim();page=0;cursors=[""];void load();});refresh.addEventListener("click",()=>{if(loading)return;page=0;cursors=[""];void load();});previous.addEventListener("click",()=>{if(!loading&&page>0){page--;void load();}});next.addEventListener("click",()=>{if(!loading&&cursors[page+1]){page++;void load();}});await load();
    });
    if(session.owner)tab("Administrators",panel=>renderAdministrators(panel,request));
    if(!scopes.includes("users")){document.getElementById("activation-area").hidden=true;if(healthButton)healthButton.click();else document.getElementById("owner-bot-tab").click();}
});
