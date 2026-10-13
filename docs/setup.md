# Setup

From nothing to a crew that answers you on Telegram. `npm run setup` does the steps in the terminal and checks each;
this page says what you need before each step, and how to tell it worked. About 30 minutes the first time.

## 0. What you need

| | Where | Cost |
|---|---|---|
| Node.js 22 or newer and git | [nodejs.org](https://nodejs.org) | free |
| A Cloudflare account | [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) | the free plan is enough to start |
| An Anthropic API key | [console.anthropic.com](https://console.anthropic.com) → API keys | pay as you go; set a monthly limit there |
| Telegram on your phone | any | free |

A computer to run setup from (macOS, Linux, or Windows with WSL). An always-on Linux server is optional; see step 7.

## 1. Get the code

```sh
git clone https://github.com/dondiegorivera/pocketcrew.git && cd pocketcrew
npm run setup
```

**Worked when** setup prints `✓ Node v22…, packages installed`.

## 2. Sign in to Cloudflare

Setup runs `npx cf auth login`, which opens a browser to approve access.

**Worked when** setup prints `✓ signed in`, or the browser says you can close it.

## 3. Your settings

Setup asks four things and writes them to `pocketcrew.config.ts` (you can edit it any time; `src/config.ts` lists every
setting and its default):

- **Time zone**, as an IANA name such as `Europe/Berlin`. Routines, the briefing and quiet hours follow it.
- **Your workers.dev subdomain.** In the Cloudflare dashboard, Workers & Pages shows it as `<name>.workers.dev`. If
  you have none yet, pick one now; the first deploy asks for it, so type the same name there. Your crew will live at
  `https://pocketcrew.<name>.workers.dev`.
- **Plugins.** Core alone is the Lead. Say yes to what you want: `google` (Mail, Calendar, Clerk), `web` (Research,
  Radar), `notes`, `ops`, `lead-pipeline` (needs `web`). You can change this later and redeploy.
- **Budget.** An amount in US dollars and an end date: the crew paces itself to spend at most that, evenly. Use your
  monthly limit and the end of the month, or a credit grant and its expiry.

**Worked when** setup prints `✓ pocketcrew.config.ts written` and the address of your Worker.

## 4. Telegram: a bot and a group

Do this on your phone while setup waits:

1. **Make the bot.** In Telegram, open **@BotFather**, send `/newbot`, choose a name and a username ending in `bot`.
   Copy the token it gives you (it looks like `123456:ABC…`). Keep it secret.
2. **Let it read the group.** Still in @BotFather: `/mybots` → your bot → **Bot Settings** → **Group Privacy** →
   **Turn off**.
3. **Make the group.** New Group, add your bot, give it a name. Then in the group's settings turn **Topics** on.
4. **Make the bot an admin** with at least **Manage topics**: it creates one topic per agent. Being an admin also lets it
   see your reactions, which the crew takes as feedback.

**Worked when** the group shows a "General" topic and the bot is listed under Administrators.

## 5. Secrets, deploy and webhook

Setup now asks for the secrets, without echoing them:

- the **Anthropic API key**;
- the **bot token** from step 4;
- a **Google OAuth client** (only with the `google` plugin; Enter to skip and add it later, see below);
- a **GitHub token** (optional, `web` plugin: a fine-grained token with public repositories read-only) and a
  **Cloudflare API token** for site traffic (optional, `ops` plugin: Zone Read and Analytics Read).

Then it asks you to **write any message in the group's General topic**, so it can find the group and you. It deploys
the Worker with the secrets (they go to Cloudflare only, never to a file) and points the bot's webhook at it.

**Worked when** setup prints the webhook's state with your Worker's URL, then `✓ The Worker runs at …`.
If the group is not found: the message must be in the group (not a DM to the bot), Topics must be on, and Group
Privacy must be off; setup says which one it saw.

## 6. First message

Write anything in General. The first message brings up the setup checklist (`/start` shows it again any time): what is
done, what is left, and a button for each open step, such as **Create the topics** (one per agent) or **Sign in with
Google**. Then try a plain message such as "what can you do?"; the Lead answers within a few seconds.

**Worked when** the topics appear and the Lead replies. `/status` shows every agent; `/budget` shows today's allowance.

## Optional parts

Each can be done any time later.

### Google (google plugin)

1. In [console.cloud.google.com](https://console.cloud.google.com), create a project.
2. **APIs & Services → Library**: enable the Gmail API, Google Calendar API, Google Drive API, Google Docs API and
   Google Sheets API.
3. **OAuth consent screen**: External; add your own address as a test user. Publish it to **In production** when it
   works: in Testing, Google ends the sign-in after 7 days. An unverified app shows a warning to you at sign-in;
   that is expected for an app only you use.
4. **Credentials → Create credentials → OAuth client ID → Web application.** Authorized redirect URI:
   `https://pocketcrew.<name>.workers.dev/oauth/google/callback`.
5. `npm run google`, paste the client ID and secret.
6. In General: `/google connect`, open the link, approve. `/google` shows what is connected and names any permission
   that is missing.

What agents may do with Google is fixed in `src/google/allow.ts`: no sending, no deleting, no sharing.

### The reports site

Agents publish pages to a second Worker, `pocketcrew-reports.<name>.workers.dev`, which serves them only through Cloudflare
Access. In the Cloudflare dashboard: **Zero Trust → Access → Applications → Add → Self-hosted**, with the domain
`pocketcrew-reports.<name>.workers.dev` and a policy that allows your email. Copy the application's **Audience (AUD) tag** and
your team domain (`<team>.cloudflareaccess.com`) into `reportsAccess` in `pocketcrew.config.ts`, then
`npm run deploy:site`.

### A home server

Any always-on Linux machine you control. It keeps the archives in git (reports, pages, the crew's state), commits
skills saved in chat, syncs repo views (the `notes` plugin's notes, for Obsidian) and deploys on every push to `main`.
Without it the crew runs fine; only the git side waits.

```sh
bash scripts/library-setup.sh   # the archive repos, the export token, the 15-minute sync
bash scripts/ci-setup.sh        # deploy on push to main
bash plugins/notes/server/notes-setup.sh   # with the notes plugin
bash scripts/backup-setup.sh    # nightly backups to backupDir
```

Set `gitRoot` (where bare repos live) and `backupDir` in `pocketcrew.config.ts` first.

## Changing things later

- **Settings:** edit `pocketcrew.config.ts`, then `npm run deploy` (or push to `main` with the home server).
- **Secrets:** `npm run secrets` again; Enter keeps any value already set.
- **A new budget:** `/credit <usd> <YYYY-MM-DD>` in General, no deploy needed.
- **Models:** `/model <agent> <haiku|sonnet|opus>`.
