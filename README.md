# US Gov Deal Intelligence Tracker
### Automated daily fetch + email digest via GitHub Actions

Every day at **7:00 AM UTC** this workflow:
1. Calls the Anthropic API (Claude + live web search)
2. Finds 8-10 new US government partnership/contract/investment stories
3. Sends a formatted HTML email digest to your inbox
4. Saves a growing archive of all stories in `data/stories.json`

---

## Setup guide (15 minutes, all free)

### Step 1 — Create a GitHub account
Go to [github.com](https://github.com) and sign up for a free account if you don't have one.

---

### Step 2 — Create a new repository
1. Click the **+** button (top right) → **New repository**
2. Name it: `gov-deal-tracker`
3. Set it to **Private** (recommended — it will store your API keys as secrets)
4. Click **Create repository**

---

### Step 3 — Upload these files
Upload the entire contents of this folder to your repository. The structure must be:

```
gov-deal-tracker/
├── .github/
│   └── workflows/
│       └── daily-fetch.yml
├── scripts/
│   ├── package.json
│   └── fetch.js
├── data/                   ← create this empty folder (add a .gitkeep file inside)
└── .gitignore
```

The easiest way to upload:
- On your new repo page, click **uploading an existing file**
- Drag and drop all files maintaining the folder structure
- Or use GitHub Desktop (free app) to push the folder

---

### Step 4 — Get your Anthropic API key
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Go to **API Keys** → **Create Key**
4. Copy the key (starts with `sk-ant-...`)
5. Add $5 credit to your account (each daily run costs ~$0.05–0.15)

---

### Step 5 — Get a free SendGrid account for email sending
SendGrid sends the actual emails. The free tier allows 100 emails/day — more than enough.

1. Go to [sendgrid.com](https://sendgrid.com) and sign up for free
2. Go to **Settings** → **API Keys** → **Create API Key**
3. Choose **Restricted Access** → enable **Mail Send** → **Full Access**
4. Click **Create & View** and copy the key (starts with `SG.`)

**Verify your sender email:**
5. In SendGrid go to **Settings** → **Sender Authentication**
6. Click **Verify a Single Sender**
7. Fill in your email address and follow the verification email
8. This is the email that will appear as the "From" address

---

### Step 6 — Add secrets to GitHub
Your API keys are stored as encrypted GitHub Secrets — never visible to anyone.

1. In your GitHub repo, go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add each of these:

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic key (`sk-ant-...`) |
| `SENDGRID_API_KEY` | Your SendGrid key (`SG.....`) |
| `EMAIL_FROM` | The verified sender email (e.g. `you@gmail.com`) |
| `EMAIL_TO` | Where to send the digest (can be same or different email) |
| `EXTRA_KEYWORDS` | Optional: extra topics to track e.g. `SpaceX, TSMC, quantum computing` |

---

### Step 7 — Enable GitHub Actions
1. In your repo, click the **Actions** tab
2. If prompted, click **I understand my workflows, go ahead and enable them**

---

### Step 8 — Test it manually
Don't wait until 7 AM — run it right now:
1. Go to **Actions** tab → click **Daily Gov Deal Fetch**
2. Click **Run workflow** → **Run workflow** (green button)
3. Watch the run — it takes about 30–60 seconds
4. Check your inbox for the email digest

If it succeeds, you're done. It will now run automatically every day at 7:00 AM UTC.

---

## Adjusting the time

7:00 AM UTC is:
- 3:00 AM Eastern (US)
- 12:00 PM noon London
- 9:00 PM Sydney

To change it, edit `.github/workflows/daily-fetch.yml` and change the cron line:

```yaml
- cron: '0 7 * * *'   # minute hour day month weekday (UTC)
```

Examples:
- `'0 12 * * *'` = 12:00 PM UTC (8 AM Eastern, 1 PM London)
- `'0 6 * * 1-5'` = 6 AM UTC weekdays only
- `'0 9 * * *'` = 9 AM UTC

Use [crontab.guru](https://crontab.guru) to build any schedule.

---

## What gets saved

- `data/stories.json` — growing archive of all fetched stories (up to 500)
- `data/latest-report.html` — the most recent digest as an HTML file you can open in a browser

These files are committed back to your repo automatically after each run, so you have a full history.

---

## Costs

| Service | Cost |
|---|---|
| GitHub Actions | Free (2,000 minutes/month free — each run uses ~1 min) |
| Anthropic API | ~$0.05–$0.15 per daily run (~$2–5/month) |
| SendGrid | Free (100 emails/day free tier) |

**Total: approximately $2–5/month** (just the Anthropic API usage).

---

## Troubleshooting

**Email not arriving:**
- Check your spam folder
- Make sure the `EMAIL_FROM` address is verified in SendGrid
- Check the Actions run log for errors

**Fetch failed / JSON parse error:**
- This occasionally happens if the web search returns unusual content
- The next day's run will succeed — it's self-healing
- You can also trigger a manual run from the Actions tab

**No new stories:**
- If no new stories are found compared to the archive, the email is still sent with the most recent stories
- The archive deduplicates by title so the same story won't appear twice

---

## Viewing your archive

The `data/stories.json` file in your repo contains all collected stories. You can also open `data/latest-report.html` directly in a browser to see a nicely formatted version of the most recent digest.
