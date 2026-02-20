# iMessage Agent

AI-powered iMessage auto-responder that sounds like you. Built with Claude AI + AppleScript.

## Requirements
- macOS Ventura or later (tested on Ventura/Sonoma/Sequoia)
- Node.js 18+
- iMessage logged in and Messages.app open on your Mac
- Anthropic API key ([get one here](https://console.anthropic.com))

## Quick Start

### 1. Install dependencies

```bash
npm install
cd dashboard && npm install && cd ..
```

### 2. Configure environment

Create `.env.local` in the project root:

```
ANTHROPIC_API_KEY=sk-ant...
DB_PATH=./imessage-agent.db
POLL_INTERVAL_MS=3000
DASHBOARD_PORT=3000
REPLY_DELAY_MIN_MS=2000
REPLY_DELAY_MAX_MS=8000
```

You may change REPLY_DELAY_MIN_MS (minimum reply delay), REPLY_DELAY_MAX_MS (maximum reply delay), and POLL_INTERVAL_MS (interval in between polls) to whatever value you'd like.

> **Never commit `.env.local` to git.** Add it to `.gitignore` if you push this anywhere.

### 3. Grant macOS permissions

The daemon reads your Messages database and sends messages on your behalf. Two permissions are required:

**Full Disk Access** (required for reading messages):
- System Settings → Privacy & Security → Full Disk Access
- Add **Terminal** (or whatever app you run Node from)

**Automation — Messages** (required for sending messages):
- System Settings → Privacy & Security → Automation
- Enable **Messages** under Terminal

The first time the daemon tries to send a message, macOS may prompt you to grant this automatically.

### 4. Launch

```bash
npm start
```

This starts both the daemon (polling for messages) and the dashboard (localhost:3000).

### 5. Set up the dashboard

Open http://localhost:3000 and:
- Complete **Voice Warmup** — add 10+ examples of how you actually text
- Add contacts to the **Allowlist** — the agent only responds to people on this list
- Enable the agent with the toggle

## Privacy & Security

- **Message content is sent to Anthropic's API** to generate replies. Review [Anthropic's privacy policy](https://www.anthropic.com/privacy) if this is a concern.
- The daemon reads `~/Library/Messages/chat.db` (read-only) and writes only to its own `imessage-agent.db`.
- The agent only auto-responds to contacts you explicitly allowlist — everyone else is ignored.
- You can disable it instantly via the dashboard toggle or by stopping the daemon.

## Tips

- Keep Messages.app open and your Mac awake while the daemon runs
- Use `caffeinate -i npm run daemon` to prevent sleep
- Test with yourself first (send from another device)
- The daemon logs all conversations — check /logs in the dashboard

## Architecture

```
Messages.app ──── chat.db (read) ──── Node Daemon ──── Claude API
                                            │
                                      SQLite DB
                                            │
                                  Next.js Dashboard (localhost:3000)
                                            │
                                  AppleScript (send only)
```

## Gotchas

- Handles must match exactly what appears in Messages.app (e.g. `+1234567890` or `user@icloud.com`)
- AppleScript only works reliably with iMessage (blue bubbles), not SMS
- Poll interval should stay above 2000ms
- The daemon stops when your Mac sleeps — use `caffeinate` if running unattended
