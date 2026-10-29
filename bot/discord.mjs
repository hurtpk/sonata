/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const PERMS = { ADMIN: 8n, KICK: 2n, BAN: 4n, CHANNELS: 16n, GUILD: 32n, AUDIT: 128n, VIEW: 1024n, SEND: 2048n, MESSAGES: 8192n, EMBEDS: 16384n, ATTACH: 32768n, HISTORY: 65536n, CONNECT: 1048576n, VOICE_MUTE: 4194304n, VOICE_DEAFEN: 8388608n, MOVE: 16777216n, NICKNAMES: 134217728n, ROLES: 268435456n, TIMEOUT: 1099511627776n, PINS: 2251799813685248n };
PERMS.POLLS = 562949953421312n;
PERMS.EXPRESSIONS = 1073741824n;
PERMS.CREATE_EXPRESSIONS = 8796093022208n;
PERMS.SPEAK = 2097152n;
PERMS.THREAD_SEND = 274877906944n;
export const INVITE_PERMISSIONS = PERMS.ADMIN.toString();
export const isId = value => typeof value === "string" && /^\d{17,20}$/.test(value);
export const fail = (message, outcome = "invalid") => { throw Object.assign(new Error(message), { outcome }); };
export const clean = value => String(value ?? "").slice(0, 1800);
export const embed = (title, description) => ({ embeds: [{ title: title.slice(0, 250), description: clean(description), color: 0xa78bfa }], allowed_mentions: { parse: [] } });
export const inviteUrl = id => { if (!isId(id)) fail("Configure the bot application first."); return `https://discord.com/oauth2/authorize?${new URLSearchParams({ client_id: id, scope: "bot applications.commands", permissions: INVITE_PERMISSIONS, integration_type: "0" })}`; };
export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export function replyPayload(body) {
    const { files, ...payload } = body;
    if (!files) return { body: payload };
    const form = new FormData();
    payload.attachments = files.map((file, id) => ({ id, filename: file.name }));
    form.set("payload_json", JSON.stringify(payload));
    files.forEach((file, id) => form.set(`files[${id}]`, new Blob([file.bytes], { type: file.type }), file.name));
    return { form };
}

export function discordApi(token, transport = fetch) {
    let tail = Promise.resolve();
    return (route, options = {}) => {
        if (!/^\/(?:guilds|channels|users|applications|interactions|webhooks|stickers)\//.test(route) || route.includes("..") || route.length > 500) fail("Invalid Discord API route.");
        const job = async () => {
            for (let attempt = 0; attempt < 3; attempt++) {
                let response;
                try { response = await transport(`https://discord.com/api/v10${route}`, { method: options.method ?? "GET", redirect: "manual", signal: AbortSignal.timeout(12_000), headers: { Authorization: `Bot ${token}`, ...(!options.form ? { "Content-Type": "application/json" } : {}), ...(options.reason ? { "X-Audit-Log-Reason": encodeURIComponent(options.reason.slice(0, 500)) } : {}) }, body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)) }); }
                catch { fail("Discord could not be reached. Check the case status before repeating an action."); }
                let length = 0, text = "";
                const decoder = new TextDecoder();
                if (response.body) for await (const chunk of response.body) { length += chunk.length; if (length > 2_000_000) fail("Discord's response was too large."); text += decoder.decode(chunk, { stream: true }); }
                text += decoder.decode();
                let data = null;
                try { if (text) data = JSON.parse(text); } catch { fail("Discord returned an unreadable response."); }
                if (response.status === 429 && typeof data?.retry_after === "number" && data.retry_after <= 10 && attempt < 2) { await wait(Math.max(100, data.retry_after * 1000)); continue; }
                if (response.status === 404 && options.optional) return null;
                if (!response.ok) throw Object.assign(new Error(response.status === 403 ? "Discord refused this action. Check the bot's permissions and role position." : response.status === 429 ? "Discord is rate limiting this action. Try again shortly." : `Discord rejected the action (${response.status}${Number.isInteger(data?.code) ? `, code ${data.code}` : ""}).`), { status: response.status });
                return data;
            }
        };
        const result = tail.then(job);
        tail = result.catch(() => null);
        return result;
    };
}

export function guildPermissions(member, roles, owner) {
    if (member.user.id === owner) return (1n << 53n) - 1n;
    return roles.filter(role => role.id === role.guild_id || role.everyone || member.roles.includes(role.id)).reduce((bits, role) => bits | BigInt(role.permissions), 0n);
}

export function memberPermissions(member, roles, guild) {
    return guildPermissions(member, roles.map(role => ({ ...role, everyone: role.id === guild.id })), guild.owner_id);
}

export function channelPermissions(member, roles, guild, channel) {
    let bits = memberPermissions(member, roles, guild);
    if (bits & PERMS.ADMIN) return (1n << 53n) - 1n;
    const apply = values => {
        let deny = 0n, allow = 0n;
        for (const value of values) { deny |= BigInt(value.deny); allow |= BigInt(value.allow); }
        bits = (bits & ~deny) | allow;
    };
    const overwrites = channel.permission_overwrites ?? [];
    apply(overwrites.filter(value => value.id === guild.id));
    apply(overwrites.filter(value => value.type === 0 && member.roles.includes(value.id)));
    apply(overwrites.filter(value => value.type === 1 && value.id === member.user.id));
    return bits;
}

export function highestRole(member, roles, guildId) {
    return roles.filter(role => role.id !== guildId && member.roles.includes(role.id)).sort((a, b) => b.position - a.position || (BigInt(a.id) < BigInt(b.id) ? 1 : -1))[0] ?? { id: guildId, position: 0 };
}

export function canManage(actor, target, bot, roles, guild) {
    if (target.user.id === guild.owner_id || target.user.id === actor.user.id || target.user.id === bot.user.id) fail("You cannot moderate the server owner, yourself, or Sonata Bot.", "denied");
    const above = (member, other) => { const a = highestRole(member, roles, guild.id), b = highestRole(other, roles, guild.id); return a.position > b.position || (a.position === b.position && BigInt(a.id) < BigInt(b.id)); };
    if (actor.user.id !== guild.owner_id && !above(actor, target)) fail("Your highest role must be above this member's highest role.", "denied");
    if (!above(bot, target)) fail("Move Sonata Bot's role above this member's highest role.", "denied");
}

export function requirePermission(bits, permission) {
    if (!(bits & PERMS.ADMIN) && (bits & permission) !== permission) fail("You or the bot are missing the Discord permissions required for this command.", "denied");
}
