/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The starter project: a ready-to-run bot in JavaScript (discord.js) or Python
// (discord.py), with only the parts you pick. The token is never put in the
// code — there's a .env file with a blank for you to paste it into yourself.

import { strToU8, zipSync } from "fflate";

export type Lang = "js" | "py";
export interface StarterOptions {
    name: string;
    lang: Lang;
    /** /ping and /hello. */
    slash: boolean;
    /** An /info command that sends an embed. */
    embeds: boolean;
    /** Answers "hello" in chat (needs the Message Content intent). */
    replies: boolean;
    /** Welcomes new members (needs the Server Members intent). */
    welcome: boolean;
    /** /kick, /ban, /timeout and /clear — only for people allowed to. */
    moderation: boolean;
    /** /rolebutton posts a button that gives or takes away a role. */
    roleButtons: boolean;
    /** Deleted and edited messages go to a log channel (needs Message Content). */
    logs: boolean;
    /** A "Playing …" status, or empty for none. */
    status: string;
    /** /play and /stop for songs in the bot's music folder. */
    music: boolean;
}

export const DEFAULT_PARTS = { slash: true, embeds: true, replies: false, welcome: false, moderation: false, roleButtons: false, logs: false, status: "", music: false };

/** The privileged intents the picked parts need, for the Developer Portal. */
export function intentsNeeded(o: Pick<StarterOptions, "replies" | "logs" | "welcome">) {
    const out: string[] = [];
    if (o.replies || o.logs) out.push("Message Content");
    if (o.welcome) out.push("Server Members");
    return out;
}

/** The permissions the picked parts need (Discord's permission bits) — for the Invite builder. */
export function permsFor(o: Omit<StarterOptions, "name" | "lang">) {
    const bits = new Set([10, 31, 11, 38, 16]); // see channels, slash commands, send, send in threads, history
    if (o.embeds || o.logs) bits.add(14);
    if (o.moderation) [1, 2, 40, 13].forEach(b => bits.add(b));
    if (o.roleButtons) bits.add(28);
    if (o.music) [20, 21, 25].forEach(b => bits.add(b));
    return [...bits];
}

export const slugOf = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "my-bot";

const hasCommands = (o: StarterOptions) => o.slash || o.embeds || o.moderation || o.roleButtons || o.music;

/* ── JavaScript (discord.js) ── */

function jsFiles(o: StarterOptions): Record<string, string> {
    const intents = ["Guilds",
        ...(o.replies || o.logs ? ["GuildMessages", "MessageContent"] : []),
        ...(o.welcome ? ["GuildMembers"] : []),
        ...(o.music ? ["GuildVoiceStates"] : []),
    ].map(i => `GatewayIntentBits.${i}`);
    const djs = ["Client", "Events", "GatewayIntentBits",
        ...(hasCommands(o) ? ["SlashCommandBuilder", "MessageFlags"] : []),
        ...(o.embeds || o.logs ? ["EmbedBuilder"] : []),
        ...(o.moderation || o.roleButtons ? ["PermissionFlagsBits"] : []),
        ...(o.roleButtons ? ["ActionRowBuilder", "ButtonBuilder", "ButtonStyle"] : []),
        ...(o.status ? ["ActivityType"] : []),
    ];
    const L: string[] = [];
    const add = (...l: string[]) => L.push(...l);

    add(`// ${o.name} — made with Sonata's Bot Manager.`,
        "// 1. Put your bot's token in the .env file (TOKEN=...). Never share it or upload it.",
        "// 2. Double-click \"Start bot.bat\" (or run: npm install, then npm start).",
        "",
        "require(\"dotenv\").config();",
        `const { ${djs.join(", ")} } = require("discord.js");`);
    if (o.music) add(
        "const { joinVoiceChannel, createAudioPlayer, createAudioResource, getVoiceConnection } = require(\"@discordjs/voice\");",
        "const fs = require(\"fs\");",
        "const path = require(\"path\");");
    add("", `const client = new Client({ intents: [${intents.join(", ")}] });`);

    if (o.music) add(
        "",
        "// Music: songs go in the \"music\" folder next to this file.",
        "const MUSIC_DIR = path.join(__dirname, \"music\");",
        "const songs = () => fs.existsSync(MUSIC_DIR) ? fs.readdirSync(MUSIC_DIR).filter(f => /\\.(mp3|wav|ogg|flac|m4a|opus)$/i.test(f)) : [];",
        "const player = createAudioPlayer();");
    if (o.logs) add(
        "",
        "// Logs go to the channel in LOG_CHANNEL_ID (in the .env file).",
        "async function log(guild, embed) {",
        "    const channel = process.env.LOG_CHANNEL_ID && guild.channels.cache.get(process.env.LOG_CHANNEL_ID);",
        "    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => { });",
        "}",
        "const cut = text => (text || \"*(empty)*\").slice(0, 1000);");

    if (hasCommands(o)) {
        add("", "// The slash commands. They're registered every time the bot starts.", "const commands = [");
        if (o.slash) add(
            "    new SlashCommandBuilder().setName(\"ping\").setDescription(\"Check that the bot is awake\"),",
            "    new SlashCommandBuilder().setName(\"hello\").setDescription(\"Say hi to the bot\"),");
        if (o.embeds) add("    new SlashCommandBuilder().setName(\"info\").setDescription(\"Show a little info card\"),");
        if (o.moderation) add(
            "    new SlashCommandBuilder().setName(\"kick\").setDescription(\"Remove someone from the server\")",
            "        .addUserOption(x => x.setName(\"member\").setDescription(\"Who to kick\").setRequired(true))",
            "        .addStringOption(x => x.setName(\"reason\").setDescription(\"Why\"))",
            "        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),",
            "    new SlashCommandBuilder().setName(\"ban\").setDescription(\"Ban someone from the server\")",
            "        .addUserOption(x => x.setName(\"member\").setDescription(\"Who to ban\").setRequired(true))",
            "        .addStringOption(x => x.setName(\"reason\").setDescription(\"Why\"))",
            "        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),",
            "    new SlashCommandBuilder().setName(\"timeout\").setDescription(\"Stop someone talking for a while\")",
            "        .addUserOption(x => x.setName(\"member\").setDescription(\"Who\").setRequired(true))",
            "        .addIntegerOption(x => x.setName(\"minutes\").setDescription(\"How long\").setRequired(true).setMinValue(1).setMaxValue(40320))",
            "        .addStringOption(x => x.setName(\"reason\").setDescription(\"Why\"))",
            "        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),",
            "    new SlashCommandBuilder().setName(\"clear\").setDescription(\"Delete the last messages in this channel\")",
            "        .addIntegerOption(x => x.setName(\"amount\").setDescription(\"How many (1-100)\").setRequired(true).setMinValue(1).setMaxValue(100))",
            "        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),");
        if (o.roleButtons) add(
            "    new SlashCommandBuilder().setName(\"rolebutton\").setDescription(\"Post a button that gives (or takes away) a role\")",
            "        .addRoleOption(x => x.setName(\"role\").setDescription(\"The role\").setRequired(true))",
            "        .addStringOption(x => x.setName(\"label\").setDescription(\"The button's text\"))",
            "        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),");
        if (o.music) add(
            "    new SlashCommandBuilder().setName(\"play\").setDescription(\"Play a song from the bot's music folder\")",
            "        .addStringOption(x => x.setName(\"song\").setDescription(\"Start typing its name\").setRequired(true).setAutocomplete(true)),",
            "    new SlashCommandBuilder().setName(\"stop\").setDescription(\"Stop the music and leave the voice channel\"),");
        add("];");
    }

    add("", "client.once(Events.ClientReady, async ready => {", "    console.log(`Logged in as ${ready.user.tag}`);");
    if (o.status) add(`    ready.user.setActivity(${JSON.stringify(o.status)}, { type: ActivityType.Playing });`);
    if (hasCommands(o)) add(
        "    await ready.application.commands.set(commands.map(c => c.toJSON()));",
        "    console.log(\"Slash commands are ready (they can take a minute to show up — press Ctrl+R in Discord).\");");
    add("});");

    if (hasCommands(o)) {
        const quiet = "flags: MessageFlags.Ephemeral";
        add("", "client.on(Events.InteractionCreate, async interaction => {");
        if (o.roleButtons) add(
            "    // Someone pressed a role button.",
            "    if (interaction.isButton() && interaction.customId.startsWith(\"role:\")) {",
            "        const roleId = interaction.customId.slice(5);",
            "        try {",
            "            if (interaction.member.roles.cache.has(roleId)) {",
            "                await interaction.member.roles.remove(roleId);",
            `                await interaction.reply({ content: "Role removed.", ${quiet} });`,
            "            } else {",
            "                await interaction.member.roles.add(roleId);",
            `                await interaction.reply({ content: "Role added! 🎉", ${quiet} });`,
            "            }",
            "        } catch {",
            `            await interaction.reply({ content: "I can't give that role — my role needs Manage Roles and has to be above it.", ${quiet} });`,
            "        }",
            "        return;",
            "    }");
        if (o.music) add(
            "    // Suggests songs while someone types /play.",
            "    if (interaction.isAutocomplete() && interaction.commandName === \"play\") {",
            "        const typed = interaction.options.getFocused().toLowerCase();",
            "        await interaction.respond(songs().filter(f => f.toLowerCase().includes(typed)).slice(0, 25).map(f => ({ name: f.slice(0, 100), value: f.slice(0, 100) })));",
            "        return;",
            "    }");
        add("    if (!interaction.isChatInputCommand()) return;", "    const name = interaction.commandName;");
        if (o.slash) add(
            "    if (name === \"ping\") await interaction.reply(`Pong! ${client.ws.ping} ms`);",
            "    if (name === \"hello\") await interaction.reply(`Hi ${interaction.user}! 👋`);");
        if (o.embeds) add(
            "    if (name === \"info\") {",
            "        const card = new EmbedBuilder()",
            `            .setTitle(${JSON.stringify(o.name)})`,
            "            .setDescription(\"I'm a bot made with Sonata's Bot Manager.\")",
            "            .addFields({ name: \"Servers\", value: String(client.guilds.cache.size), inline: true }, { name: \"Ping\", value: `${client.ws.ping} ms`, inline: true })",
            "            .setColor(0x5865f2);",
            "        await interaction.reply({ embeds: [card] });",
            "    }");
        if (o.moderation) add(
            "    if (name === \"kick\" || name === \"ban\" || name === \"timeout\") {",
            "        const member = interaction.options.getMember(\"member\");",
            "        const reason = interaction.options.getString(\"reason\") ?? undefined;",
            "        try {",
            "            if (name === \"kick\") await member.kick(reason);",
            "            if (name === \"ban\") await member.ban({ reason });",
            "            if (name === \"timeout\") await member.timeout(interaction.options.getInteger(\"minutes\") * 60_000, reason);",
            "            await interaction.reply(`${name === \"kick\" ? \"👢 Kicked\" : name === \"ban\" ? \"🔨 Banned\" : \"⏸ Timed out\"} ${member}.`);",
            "        } catch {",
            `            await interaction.reply({ content: "I can't do that to them — my role has to be above theirs, with the right permission.", ${quiet} });`,
            "        }",
            "    }",
            "    if (name === \"clear\") {",
            "        const deleted = await interaction.channel.bulkDelete(interaction.options.getInteger(\"amount\"), true).catch(() => null);",
            `        await interaction.reply({ content: deleted ? \`🧹 Deleted \${deleted.size} messages.\` : "I couldn't delete them — I need Manage Messages here.", ${quiet} });`,
            "    }");
        if (o.roleButtons) add(
            "    if (name === \"rolebutton\") {",
            "        const role = interaction.options.getRole(\"role\");",
            "        const button = new ButtonBuilder().setCustomId(`role:${role.id}`).setLabel(interaction.options.getString(\"label\") ?? `Get ${role.name}`).setStyle(ButtonStyle.Primary);",
            "        await interaction.channel.send({ content: `Press the button to get or remove **${role.name}**.`, components: [new ActionRowBuilder().addComponents(button)] });",
            `        await interaction.reply({ content: "Posted!", ${quiet} });`,
            "    }");
        if (o.music) add(
            "    if (name === \"play\") {",
            "        const channel = interaction.member.voice?.channel;",
            `        if (!channel) return interaction.reply({ content: "Join a voice channel first.", ${quiet} });`,
            "        const wanted = interaction.options.getString(\"song\").toLowerCase();",
            "        const file = songs().find(f => f.toLowerCase() === wanted) ?? songs().find(f => f.toLowerCase().includes(wanted));",
            `        if (!file) return interaction.reply({ content: "There's no song like that in the music folder.", ${quiet} });`,
            "        const connection = joinVoiceChannel({ channelId: channel.id, guildId: channel.guild.id, adapterCreator: channel.guild.voiceAdapterCreator });",
            "        connection.subscribe(player);",
            "        player.play(createAudioResource(path.join(MUSIC_DIR, file)));",
            "        await interaction.reply(`▶ Playing **${file}**`);",
            "    }",
            "    if (name === \"stop\") {",
            "        player.stop();",
            "        getVoiceConnection(interaction.guildId)?.destroy();",
            "        await interaction.reply(\"⏹ Stopped.\");",
            "    }");
        add("});");
    }

    if (o.replies) add(
        "",
        "// Answers \"hello\" in chat. Needs the Message Content intent (Developer Portal → Bot).",
        "client.on(Events.MessageCreate, message => {",
        "    if (message.author.bot) return;",
        "    if (message.content.toLowerCase() === \"hello\") message.reply(\"Hello! 👋\");",
        "});");
    if (o.welcome) add(
        "",
        "// Welcomes new members. Needs the Server Members intent (Developer Portal → Bot).",
        "client.on(Events.GuildMemberAdd, member => {",
        "    const channel = member.guild.systemChannel;",
        "    if (channel) channel.send(`Welcome to ${member.guild.name}, ${member}! 🎉`);",
        "});");
    if (o.logs) add(
        "",
        "// Deleted and edited messages, to the log channel. Needs the Message Content intent.",
        "client.on(Events.MessageDelete, async message => {",
        "    if (!message.guild || message.author?.bot) return;",
        "    await log(message.guild, new EmbedBuilder().setTitle(\"🗑 Message deleted\").setColor(0xf23f43).setTimestamp()",
        "        .setDescription(message.content ? cut(message.content) : \"*(sent before the bot started, so its text wasn't seen)*\")",
        "        .addFields({ name: \"By\", value: message.author ? `${message.author}` : \"Someone\", inline: true }, { name: \"In\", value: `${message.channel}`, inline: true }));",
        "});",
        "client.on(Events.MessageUpdate, async (before, after) => {",
        "    if (!after.guild || after.author?.bot || before.content === after.content) return;",
        "    await log(after.guild, new EmbedBuilder().setTitle(\"✏️ Message edited\").setColor(0xf0b232).setTimestamp().setURL(after.url)",
        "        .addFields({ name: \"Before\", value: cut(before.content) }, { name: \"After\", value: cut(after.content) }, { name: \"By\", value: `${after.author}`, inline: true }, { name: \"In\", value: `${after.channel}`, inline: true }));",
        "});");

    add("",
        "if (!process.env.TOKEN || process.env.TOKEN.startsWith(\"paste\")) {",
        "    console.error(\"Put your bot's token in the .env file first (TOKEN=...).\");",
        "    process.exit(1);",
        "}",
        "client.login(process.env.TOKEN);",
        "");

    const deps: Record<string, string> = { "discord.js": "^14.27.0", "dotenv": "^16.4.5" };
    if (o.music) Object.assign(deps, { "@discordjs/voice": "^0.19.2", "ffmpeg-static": "^5.3.0", "opusscript": "^0.1.1" });
    const pkg = JSON.stringify({ name: slugOf(o.name), version: "1.0.0", private: true, main: "index.js", scripts: { start: "node index.js" }, dependencies: deps }, null, 2) + "\n";
    const bat = ["@echo off", `title ${o.name.replace(/[&|<>^%"]/g, "")}`, "cd /d \"%~dp0\"", "if not exist node_modules (", "    echo Installing the bot's parts (first time only)...", "    call npm install", ")", "node index.js", "pause", ""].join("\r\n");
    return { "index.js": L.join("\n"), "package.json": pkg, "Start bot.bat": bat };
}

/* ── Python (discord.py) ── */

function pyFiles(o: StarterOptions): Record<string, string> {
    const L: string[] = [];
    const add = (...l: string[]) => L.push(...l);
    const gap = () => add("", "");
    add(`# ${o.name} — made with Sonata's Bot Manager.`,
        "# 1. Put your bot's token in the .env file (TOKEN=...). Never share it or upload it.",
        "# 2. Double-click \"Start bot.bat\" (or run: pip install -r requirements.txt, then python bot.py).",
        "");
    if (o.moderation) add("import datetime");
    add("import os");
    if (o.moderation || o.roleButtons) add("from typing import Optional");
    add("", "import discord");
    if (hasCommands(o)) add("from discord import app_commands");
    add("from dotenv import load_dotenv");
    if (o.music) add("import imageio_ffmpeg");
    add("", "load_dotenv()", "", "intents = discord.Intents.default()");
    if (o.replies || o.logs) add("intents.message_content = True  # Needs the Message Content intent (Developer Portal -> Bot)");
    if (o.welcome) add("intents.members = True  # Needs the Server Members intent (Developer Portal -> Bot)");
    if (o.music) add("", "# Music: songs go in the \"music\" folder next to this file.", "MUSIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), \"music\")", "", "",
        "def songs():", "    if not os.path.isdir(MUSIC_DIR):", "        return []", "    return sorted(f for f in os.listdir(MUSIC_DIR) if f.lower().endswith((\".mp3\", \".wav\", \".ogg\", \".flac\", \".m4a\", \".opus\")))");
    gap();
    add("class Bot(discord.Client):", "    def __init__(self):",
        `        super().__init__(intents=intents${o.status ? `, activity=discord.Game(name=${JSON.stringify(o.status)})` : ""})`);
    if (hasCommands(o)) add("        self.tree = app_commands.CommandTree(self)", "", "    async def setup_hook(self):", "        # Registers the slash commands every time the bot starts.", "        await self.tree.sync()");
    gap();
    add("bot = Bot()");
    gap();
    add("@bot.event", "async def on_ready():", "    print(f\"Logged in as {bot.user}\")");
    if (o.slash) {
        gap(); add("@bot.tree.command(description=\"Check that the bot is awake\")", "async def ping(interaction: discord.Interaction):", "    await interaction.response.send_message(f\"Pong! {round(bot.latency * 1000)} ms\")");
        gap(); add("@bot.tree.command(description=\"Say hi to the bot\")", "async def hello(interaction: discord.Interaction):", "    await interaction.response.send_message(f\"Hi {interaction.user.mention}! 👋\")");
    }
    if (o.embeds) {
        gap();
        add("@bot.tree.command(description=\"Show a little info card\")", "async def info(interaction: discord.Interaction):",
            `    card = discord.Embed(title=${JSON.stringify(o.name)}, description="I'm a bot made with Sonata's Bot Manager.", color=0x5865F2)`,
            "    card.add_field(name=\"Servers\", value=str(len(bot.guilds)))",
            "    card.add_field(name=\"Ping\", value=f\"{round(bot.latency * 1000)} ms\")",
            "    await interaction.response.send_message(embed=card)");
    }
    if (o.moderation) {
        const mod = (cmd: string, perm: string, desc: string, verb: string, action: string, extra = "", extraDescribe = "") => {
            gap();
            add(`@bot.tree.command(description="${desc}")`, `@app_commands.default_permissions(${perm}=True)`, `@app_commands.describe(member="Who"${extraDescribe}, reason="Why")`,
                `async def ${cmd}(interaction: discord.Interaction, member: discord.Member${extra}, reason: Optional[str] = None):`,
                "    try:", `        await ${action}`, "    except discord.Forbidden:",
                "        await interaction.response.send_message(\"I can't do that to them — my role has to be above theirs, with the right permission.\", ephemeral=True)",
                "        return", `    await interaction.response.send_message(f"${verb} {member.mention}.")`);
        };
        mod("kick", "kick_members", "Remove someone from the server", "👢 Kicked", "member.kick(reason=reason)");
        mod("ban", "ban_members", "Ban someone from the server", "🔨 Banned", "member.ban(reason=reason)");
        mod("timeout", "moderate_members", "Stop someone talking for a while", "⏸ Timed out", "member.timeout(datetime.timedelta(minutes=minutes), reason=reason)", ", minutes: app_commands.Range[int, 1, 40320]", ", minutes=\"How long\"");
        gap();
        add("@bot.tree.command(description=\"Delete the last messages in this channel\")", "@app_commands.default_permissions(manage_messages=True)", "@app_commands.describe(amount=\"How many (1-100)\")",
            "async def clear(interaction: discord.Interaction, amount: app_commands.Range[int, 1, 100]):",
            "    await interaction.response.defer(ephemeral=True)",
            "    try:", "        deleted = await interaction.channel.purge(limit=amount)", "    except discord.Forbidden:",
            "        await interaction.followup.send(\"I couldn't delete them — I need Manage Messages here.\", ephemeral=True)", "        return",
            "    await interaction.followup.send(f\"🧹 Deleted {len(deleted)} messages.\", ephemeral=True)");
    }
    if (o.roleButtons) {
        gap();
        add("@bot.tree.command(description=\"Post a button that gives (or takes away) a role\")", "@app_commands.default_permissions(manage_roles=True)", "@app_commands.describe(role=\"The role\", label=\"The button's text\")",
            "async def rolebutton(interaction: discord.Interaction, role: discord.Role, label: Optional[str] = None):",
            "    view = discord.ui.View(timeout=None)",
            "    view.add_item(discord.ui.Button(label=label or f\"Get {role.name}\", custom_id=f\"role:{role.id}\", style=discord.ButtonStyle.primary))",
            "    await interaction.channel.send(f\"Press the button to get or remove **{role.name}**.\", view=view)",
            "    await interaction.response.send_message(\"Posted!\", ephemeral=True)");
        gap();
        add("@bot.event", "async def on_interaction(interaction: discord.Interaction):", "    # Someone pressed a role button.",
            "    custom_id = (interaction.data or {}).get(\"custom_id\", \"\")",
            "    if interaction.type != discord.InteractionType.component or not custom_id.startswith(\"role:\"):", "        return",
            "    role = interaction.guild.get_role(int(custom_id[5:]))",
            "    try:",
            "        if role in interaction.user.roles:", "            await interaction.user.remove_roles(role)", "            await interaction.response.send_message(\"Role removed.\", ephemeral=True)",
            "        else:", "            await interaction.user.add_roles(role)", "            await interaction.response.send_message(\"Role added! 🎉\", ephemeral=True)",
            "    except (discord.Forbidden, AttributeError):",
            "        await interaction.response.send_message(\"I can't give that role — my role needs Manage Roles and has to be above it.\", ephemeral=True)");
    }
    if (o.music) {
        gap();
        add("async def song_names(interaction: discord.Interaction, current: str):",
            "    return [app_commands.Choice(name=f[:100], value=f[:100]) for f in songs() if current.lower() in f.lower()][:25]");
        gap();
        add("@bot.tree.command(description=\"Play a song from the bot's music folder\")", "@app_commands.describe(song=\"Start typing its name\")", "@app_commands.autocomplete(song=song_names)",
            "async def play(interaction: discord.Interaction, song: str):",
            "    if not interaction.user.voice or not interaction.user.voice.channel:",
            "        await interaction.response.send_message(\"Join a voice channel first.\", ephemeral=True)", "        return",
            "    wanted = song.lower()",
            "    file = next((f for f in songs() if f.lower() == wanted), None) or next((f for f in songs() if wanted in f.lower()), None)",
            "    if not file:", "        await interaction.response.send_message(\"There's no song like that in the music folder.\", ephemeral=True)", "        return",
            "    await interaction.response.defer()",
            "    channel = interaction.user.voice.channel",
            "    voice = interaction.guild.voice_client or await channel.connect()",
            "    if voice.channel != channel:", "        await voice.move_to(channel)",
            "    if voice.is_playing():", "        voice.stop()",
            "    voice.play(discord.FFmpegPCMAudio(os.path.join(MUSIC_DIR, file), executable=imageio_ffmpeg.get_ffmpeg_exe()))",
            "    await interaction.followup.send(f\"▶ Playing **{file}**\")");
        gap();
        add("@bot.tree.command(description=\"Stop the music and leave the voice channel\")", "async def stop(interaction: discord.Interaction):",
            "    if interaction.guild.voice_client:", "        await interaction.guild.voice_client.disconnect()",
            "    await interaction.response.send_message(\"⏹ Stopped.\")");
    }
    if (o.replies) {
        gap();
        add("@bot.event", "async def on_message(message: discord.Message):", "    if message.author.bot:", "        return",
            "    if message.content.lower() == \"hello\":", "        await message.reply(\"Hello! 👋\")");
    }
    if (o.welcome) {
        gap();
        add("@bot.event", "async def on_member_join(member: discord.Member):", "    if member.guild.system_channel:",
            "        await member.guild.system_channel.send(f\"Welcome to {member.guild.name}, {member.mention}! 🎉\")");
    }
    if (o.logs) {
        gap();
        add("async def log(guild: discord.Guild, embed: discord.Embed):",
            "    channel = guild.get_channel(int(os.getenv(\"LOG_CHANNEL_ID\") or 0))",
            "    if channel:", "        await channel.send(embed=embed)");
        gap();
        add("@bot.event", "async def on_message_delete(message: discord.Message):", "    if not message.guild or message.author.bot:", "        return",
            "    embed = discord.Embed(title=\"🗑 Message deleted\", description=(message.content or \"*(empty)*\")[:1000], color=0xF23F43)",
            "    embed.add_field(name=\"By\", value=message.author.mention)", "    embed.add_field(name=\"In\", value=message.channel.mention)",
            "    await log(message.guild, embed)");
        gap();
        add("@bot.event", "async def on_message_edit(before: discord.Message, after: discord.Message):",
            "    if not after.guild or after.author.bot or before.content == after.content:", "        return",
            "    embed = discord.Embed(title=\"✏️ Message edited\", url=after.jump_url, color=0xF0B232)",
            "    embed.add_field(name=\"Before\", value=(before.content or \"*(empty)*\")[:1000], inline=False)",
            "    embed.add_field(name=\"After\", value=(after.content or \"*(empty)*\")[:1000], inline=False)",
            "    embed.add_field(name=\"By\", value=after.author.mention)", "    embed.add_field(name=\"In\", value=after.channel.mention)",
            "    await log(after.guild, embed)");
    }
    gap();
    add("token = os.getenv(\"TOKEN\", \"\")", "if not token or token.startswith(\"paste\"):", "    raise SystemExit(\"Put your bot's token in the .env file first (TOKEN=...).\")", "bot.run(token)", "");

    const req = [o.music ? "discord.py[voice]>=2.7" : "discord.py>=2.7", "python-dotenv>=1.0", ...(o.music ? ["imageio-ffmpeg>=0.5"] : [])].join("\n") + "\n";
    const bat = ["@echo off", `title ${o.name.replace(/[&|<>^%"]/g, "")}`, "cd /d \"%~dp0\"", "python -m pip install --quiet -r requirements.txt", "python bot.py", "pause", ""].join("\r\n");
    return { "bot.py": L.join("\n"), "requirements.txt": req, "Start bot.bat": bat };
}

export function starterFiles(input: StarterOptions): Record<string, string> {
    // One plain line: the name and status go into code comments and strings.
    const o = { ...input, name: input.name.replace(/\s+/g, " ").trim().slice(0, 60) || "My bot", status: (input.status ?? "").replace(/\s+/g, " ").trim().slice(0, 100) };
    const intents = intentsNeeded(o);
    const files = o.lang === "js" ? jsFiles(o) : pyFiles(o);
    let n = 1;
    const step = (s: string) => `${n++}. ${s}`;
    const readme = [
        o.name, "=".repeat(Math.max(4, o.name.length)), "",
        `A Discord bot made with Sonata's Bot Manager (${o.lang === "js" ? "JavaScript, discord.js" : "Python, discord.py"}).`, "",
        step(`Install ${o.lang === "js" ? "Node.js (nodejs.org, the LTS version)" : "Python (python.org — tick \"Add Python to PATH\" while installing)"}.`),
        step("In the Discord Developer Portal, open your bot → Bot → Reset Token, and copy it."),
        step("Open the .env file in Notepad and paste it after TOKEN= (no spaces, no quotes). Save."),
        ...(intents.length ? [step(`In the Developer Portal → Bot → Privileged Gateway Intents, turn on: ${intents.join(" and ")}. Save.`)] : []),
        ...(o.logs ? [step("For logs: in Discord, right-click the log channel → Copy Channel ID (turn on Developer Mode in Settings → Advanced first), and paste it after LOG_CHANNEL_ID= in .env.")] : []),
        ...(o.music ? [step(`For music: put songs (MP3, WAV, OGG, FLAC, M4A) in the "music" folder. Only play music you're allowed to share.${o.lang === "js" ? " (If /play ever says FFmpeg is missing, open a terminal in this folder and run: npm install-scripts approve ffmpeg-static, then: npm rebuild ffmpeg-static.)" : ""}`)] : []),
        step("Double-click \"Start bot.bat\". Keep the window open — the bot is online while it runs."), "",
        "Keep the .env file private: anyone with the token can control your bot.",
        "If it ever leaks, press Reset Token in the Developer Portal straight away.", "",
    ].join("\r\n");
    const env = `TOKEN=paste-your-bot-token-here\n${o.logs ? "LOG_CHANNEL_ID=\n" : ""}`;
    return {
        ...files, ".env": env, ".gitignore": ".env\nnode_modules/\n__pycache__/\n", "README.txt": readme,
        ...(o.music ? { "music/Put your songs here.txt": "Put MP3, WAV, OGG, FLAC or M4A files in this folder, then use /play in Discord.\r\n" } : {}),
    };
}

/** The project as a .zip, in a folder named after the bot. */
export function starterZip(o: StarterOptions) {
    const folder = slugOf(o.name);
    const files = starterFiles(o);
    return zipSync(Object.fromEntries(Object.entries(files).map(([n, c]) => [`${folder}/${n}`, strToU8(c)])), { level: 6 });
}
