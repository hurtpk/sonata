# Private reply buttons — "Only you can see this"

Sonata's **Embed Sender** can put buttons on a message that, when someone presses one, show **them alone** a message, for example a promo code, a secret link, or a "thanks for reading the rules, {user}!".

A plain webhook can't do this. Discord only sends button presses to an *app*, so you need your own small bot. It costs nothing and you never have to keep a computer running:

| Piece | What it does | Cost |
| --- | --- | --- |
| A Discord app (bot) | Owns the webhook, so its buttons are clickable | Free |
| A Cloudflare Worker | Answers button presses with the private message | Free (100,000 presses a day) |
| Sonata | Builds the message and saves each button's reply to your Worker | — |

About 10 minutes, once. After that it's just: make a button, type the reply, send.

---

## 1. Make a bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), press **New Application**, and give it a name (for example "My Server Bot").
2. On **General Information**, copy the **Public Key** and keep it somewhere for step 4.
3. On **Bot**, press **Reset Token** and copy the token, also for step 4.

> 🔐 The bot token is like a password for your bot. It only ever goes into Cloudflare (step 4), never into Sonata, a chat, or a screenshot.

## 2. Make the Worker

1. Sign in to [Cloudflare](https://dash.cloudflare.com/sign-up/workers-and-pages). A free account is fine.
2. Go to **Workers & Pages** and press **Create**. Choose **Hello World**, then **Deploy**, then **Edit code**.
3. Delete everything there and paste in Sonata's Worker code. You get it from **Embed Sender → 🔒 Private reply buttons → Copy the Worker code**. The same file is at `sonata/features/embeds/embedSender/worker/sonata-private-replies.js`.
4. Press **Deploy**.

## 3. Give it somewhere to keep replies

1. In Cloudflare, go to **Storage & Databases → KV** and **Create** a namespace. The name doesn't matter, for example `sonata-replies`.
2. Open your Worker and go to **Settings → Bindings → Add → KV namespace**.
3. Set **Variable name** to `REPLIES` exactly, and pick the namespace you just made.

## 4. Add three secrets

In your Worker, go to **Settings → Variables and Secrets → Add**. Choose type **Secret** and add these three:

| Name | Value |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | The Public Key from step 1 |
| `DISCORD_BOT_TOKEN` | The bot token from step 1 |
| `SONATA_SECRET` | Any long random password. Sonata's **Make one & copy it** button makes one for you. |

`SONATA_SECRET` is what stops anyone else from changing your replies. Only your Sonata knows it.

## 5. Tell Discord where the Worker is

1. Copy your Worker's address. It looks like `https://your-worker.your-name.workers.dev`.
2. In the Developer Portal, open **General Information**, paste the address into **Interactions Endpoint URL**, and press **Save Changes**.

Discord checks the address straight away. If it says it couldn't verify it, check that `DISCORD_PUBLIC_KEY` is right and that you pressed **Deploy**.

## 6. Connect Sonata

In **Embed Sender → 🔒 Private reply buttons**:

1. Paste the Worker's address.
2. Paste the same `SONATA_SECRET`.
3. Press **Save & check**. Every step ticks green once it's working.

## 7. Add the bot and make a bot webhook

1. Use the **Invite your bot** link that appears. It only asks for *Manage Webhooks*.
2. Open the channel you want to post in, then press **Make a bot webhook here**. Sonata switches the editor to that webhook and saves it.

> Why a new webhook? Discord only lets a webhook send clickable buttons if a bot made it. Webhooks you made in Server Settings can still send 🔗 link buttons, just not 🔒 private ones.

---

## Making a private button

1. In **Buttons**, press **Add button**, then switch it from 🔗 to 🔒.
2. Give it a label and pick a colour (Blue, Grey, Green or Red).
3. Type what the presser should see. You can use these fill-ins:
   - `{user}`: mentions whoever pressed it, without pinging them.
   - `{name}`: their display name.
   - `{server}`: the server's ID.
4. Press **Send**.

**Changing the reply later:** load the message (Message Link → **Load**, or **📜 Sent → Edit again**), change the text, and press **Send**. The new reply works straight away, for everyone who presses that button from then on.

**Removing it:** delete the button and send. The old reply stays saved on your Worker, in case another message uses it. Anyone pressing a deleted reply sees *"This button's message has been removed."*

## Troubleshooting

| You see | Fix |
| --- | --- |
| "Your Worker didn't accept the secret" | `SONATA_SECRET` in Cloudflare and in Sonata must match exactly. |
| "Only work through a webhook your bot made" | Press **Make a bot webhook here** in the channel and send through that one. |
| "Your bot can't make webhooks there" | Give the bot's role **Manage Webhooks** in that channel. |
| Pressing the button says "This interaction failed" | The Interactions Endpoint URL (step 5) isn't saved, or the Worker isn't deployed. |
| Missing: `REPLIES (KV namespace)` | Redo step 3. The variable name must be `REPLIES`. |

## Is it safe?

- Discord signs every button press, and the Worker turns away anything that isn't signed by Discord.
- Only someone with your `SONATA_SECRET` can add or change replies.
- The bot token never leaves Cloudflare.
- Replies are only shown to the person who pressed the button (Discord's "ephemeral" messages).
- Mentions in replies never ping anyone.

Sharing your Sonata with a friend doesn't share your bot. The Worker address and secret are kept in *your* Equicord settings on your computer, not in the plugin files. Your friend follows this guide to make their own.
