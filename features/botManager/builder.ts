/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The command builder: a slash command described in boxes → the code for it in
// JavaScript (discord.js) or Python (discord.py), in the same shape as the
// starter project, so it can be pasted straight in.

export type OptType = "string" | "integer" | "number" | "boolean" | "user" | "channel" | "role" | "mentionable";
export interface OptChoice { name: string; value: string; }
export interface CmdOpt { type: OptType; name: string; description: string; required: boolean; choices: OptChoice[]; }
export interface CmdSpec { name: string; description: string; options: CmdOpt[]; reply: string; private: boolean; adminOnly: boolean; }

export const OPT_TYPES: [OptType, string][] = [["string", "Text"], ["integer", "Whole number"], ["number", "Number"], ["boolean", "True / false"], ["user", "User"], ["channel", "Channel"], ["role", "Role"], ["mentionable", "User or role"]];
export const canChoose = (t: OptType) => t === "string" || t === "integer" || t === "number";

const NAME = /^[a-z0-9_-]{1,32}$/;
const OPT_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/** What's wrong with the command, in plain English (empty when it's ready). */
export function problems(s: CmdSpec): string[] {
    const out: string[] = [];
    if (!NAME.test(s.name)) out.push("The command's name needs 1–32 lowercase letters, numbers, - or _ (no spaces).");
    if (!s.description.trim() || s.description.length > 100) out.push("Give the command a description (up to 100 characters).");
    if (s.options.length > 25) out.push("A command can have up to 25 options.");
    const seen = new Set<string>();
    s.options.forEach((o, i) => {
        const what = `Option ${i + 1}`;
        if (!OPT_NAME.test(o.name)) out.push(`${what}: its name needs to start with a letter and use only lowercase letters, numbers and _.`);
        else if (seen.has(o.name)) out.push(`${what}: two options can't have the same name ("${o.name}").`);
        seen.add(o.name);
        if (!o.description.trim() || o.description.length > 100) out.push(`${what}: give it a description (up to 100 characters).`);
        if (o.choices.length > 25) out.push(`${what}: up to 25 choices.`);
        if (canChoose(o.type)) o.choices.forEach((c, j) => {
            if (!c.name.trim()) out.push(`${what}, choice ${j + 1}: give it a name.`);
            if (o.type !== "string" && (c.value.trim() === "" || isNaN(Number(c.value)) || (o.type === "integer" && !Number.isInteger(Number(c.value))))) out.push(`${what}, choice ${j + 1}: its value has to be a ${o.type === "integer" ? "whole " : ""}number.`);
        });
    });
    return out;
}

/** Required options have to come before optional ones — kept in your order otherwise. */
const ordered = (s: CmdSpec) => [...s.options.filter(o => o.required), ...s.options.filter(o => !o.required)];

const JS_ADD: Record<OptType, string> = { string: "addStringOption", integer: "addIntegerOption", number: "addNumberOption", boolean: "addBooleanOption", user: "addUserOption", channel: "addChannelOption", role: "addRoleOption", mentionable: "addMentionableOption" };
const JS_GET: Record<OptType, string> = { string: "getString", integer: "getInteger", number: "getNumber", boolean: "getBoolean", user: "getUser", channel: "getChannel", role: "getRole", mentionable: "getMentionable" };
const PY_TYPE: Record<OptType, string> = { string: "str", integer: "int", number: "float", boolean: "bool", user: "discord.Member", channel: "discord.abc.GuildChannel", role: "discord.Role", mentionable: "Union[discord.Member, discord.Role]" };
const PY_KEYWORDS = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));

const jsStr = (s: string) => JSON.stringify(s);
const choiceValue = (o: CmdOpt, v: string) => o.type === "string" ? jsStr(v) : String(Number(v));
const jsVar = (n: string) => n.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** The reply text with {option} fill-ins, as a JavaScript template string. */
function jsReply(s: CmdSpec) {
    const names = new Set(s.options.map(o => o.name));
    const body = s.reply.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")
        .replace(/\{([a-z][a-z0-9_]*)\}/g, (m, n) => names.has(n) ? `\${${jsVar(n)} ?? "—"}` : m);
    return `\`${body || "Done!"}\``;
}

/** The reply text as a Python f-string. */
function pyReply(s: CmdSpec) {
    const byName = new Map(s.options.map(o => [o.name, o]));
    let out = "";
    const text = s.reply || "Done!";
    for (let i = 0; i < text.length;) {
        const m = /^\{([a-z][a-z0-9_]*)\}/.exec(text.slice(i));
        if (m && byName.has(m[1])) {
            const o = byName.get(m[1])!;
            // Users, roles and channels show as mentions (like in JavaScript); choices show their name.
            const mention = o.type === "user" || o.type === "role" || o.type === "channel" || o.type === "mentionable";
            const value = o.choices.length && canChoose(o.type) ? `${m[1]}.name` : mention ? `${m[1]}.mention` : m[1];
            const expr = o.required ? value : `${value} if ${m[1]} is not None else '—'`;
            out += `{${expr}}`;
            i += m[0].length;
            continue;
        }
        const ch = text[i++];
        out += ch === "{" ? "{{" : ch === "}" ? "}}" : ch === "\\" ? "\\\\" : ch === "\"" ? "\\\"" : ch === "\n" ? "\\n" : ch;
    }
    return `f"${out}"`;
}

export function jsCode(s: CmdSpec) {
    const opts = ordered(s);
    const def = [
        `    new SlashCommandBuilder()`,
        `        .setName(${jsStr(s.name)})`,
        `        .setDescription(${jsStr(s.description.trim())})`,
        ...opts.map(o => {
            let chain = `x => x.setName(${jsStr(o.name)}).setDescription(${jsStr(o.description.trim())})`;
            if (o.required) chain += ".setRequired(true)";
            if (canChoose(o.type) && o.choices.length) chain += `.addChoices(${o.choices.map(c => `{ name: ${jsStr(c.name)}, value: ${choiceValue(o, c.value)} }`).join(", ")})`;
            return `        .${JS_ADD[o.type]}(${chain})`;
        }),
        ...(s.adminOnly ? [`        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)`] : []),
    ].join("\n") + ",";
    const handler = [
        `    if (interaction.commandName === ${jsStr(s.name)}) {`,
        ...opts.map(o => `        const ${jsVar(o.name)} = interaction.options.${JS_GET[o.type]}(${jsStr(o.name)});`),
        `        await interaction.reply(${s.private ? `{ content: ${jsReply(s)}, flags: MessageFlags.Ephemeral }` : jsReply(s)});`,
        `    }`,
    ].join("\n");
    return { def, handler };
}

export function pyCode(s: CmdSpec) {
    const opts = ordered(s);
    let fn = s.name.replace(/-/g, "_");
    if (/^\d/.test(fn)) fn = `cmd_${fn}`;
    if (PY_KEYWORDS.has(fn)) fn += "_cmd";
    const lines = [`@bot.tree.command(name=${jsStr(s.name)}, description=${jsStr(s.description.trim())})`];
    if (s.adminOnly) lines.push(`@app_commands.default_permissions(manage_guild=True)`);
    if (opts.length) lines.push(`@app_commands.describe(${opts.map(o => `${o.name}=${jsStr(o.description.trim())}`).join(", ")})`);
    const withChoices = opts.filter(o => canChoose(o.type) && o.choices.length);
    if (withChoices.length) lines.push(`@app_commands.choices(${withChoices.map(o => `${o.name}=[${o.choices.map(c => `app_commands.Choice(name=${jsStr(c.name)}, value=${choiceValue(o, c.value)})`).join(", ")}]`).join(", ")})`);
    const params = opts.map(o => {
        const t = canChoose(o.type) && o.choices.length ? `app_commands.Choice[${PY_TYPE[o.type]}]` : PY_TYPE[o.type];
        return o.required ? `${o.name}: ${t}` : `${o.name}: Optional[${t}] = None`;
    });
    lines.push(
        `async def ${fn}(interaction: discord.Interaction${params.map(p => `, ${p}`).join("")}):`,
        `    await interaction.response.send_message(${pyReply(s)}${s.private ? ", ephemeral=True" : ""})`,
    );
    const imports: string[] = [];
    if (opts.some(o => !o.required)) imports.push("Optional");
    if (opts.some(o => o.type === "mentionable")) imports.push("Union");
    return { code: lines.join("\n"), imports: imports.length ? `from typing import ${imports.join(", ")}` : "" };
}

export const BLANK_SPEC: CmdSpec = {
    name: "order", description: "Order a pizza", private: false, adminOnly: false,
    options: [
        { type: "string", name: "size", description: "How big", required: true, choices: [{ name: "Small", value: "small" }, { name: "Medium", value: "medium" }, { name: "Large", value: "large" }] },
        { type: "string", name: "topping", description: "Anything on top?", required: false, choices: [] },
    ],
    reply: "🍕 One {size} pizza coming up! Topping: {topping}",
};
