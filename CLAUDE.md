# iMessage AI Auto-Responder — Claude Code Build Guide

A Mac-native iMessage agent that reads incoming texts, generates replies in your voice using Claude, and sends them automatically. Includes a contact allowlist UI and a "voice warmup" onboarding flow so the bot sounds like you.

---

## Project Overview

**Name:** `imessage-agent`  
**Stack:** Node.js daemon + AppleScript bridge + Claude API + Next.js dashboard  
**Platform:** macOS only (requires Messages.app logged into iMessage)  
**Runtime:** Local — runs on your Mac, no cloud deployment needed for core functionality

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Your Mac                           │
│                                                         │
│  Messages.app ──── AppleScript Bridge ──── Node Daemon  │
│                                                 │        │
│                                          Claude API      │
│                                                 │        │
│                                        Reply sent back   │
│                                        via AppleScript   │
│                                                          │
│  Next.js Dashboard (localhost:3000)                      │
│  - Contact allowlist management                          │
│  - Voice warmup onboarding                               │
│  - Conversation logs                                     │
│  - Toggle auto-reply on/off                              │
└─────────────────────────────────────────────────────────┘
```

---

## File Structure

```
imessage-agent/
├── daemon/
│   ├── index.js              # Main polling daemon
│   ├── imessage.js           # AppleScript bridge
│   ├── agent.js              # Claude API agent logic
│   ├── store.js              # SQLite state management
│   └── scripts/
│       ├── read_messages.applescript
│       ├── send_message.applescript
│       └── get_contacts.applescript
├── dashboard/                # Next.js app
│   ├── app/
│   │   ├── page.tsx          # Main dashboard
│   │   ├── warmup/
│   │   │   └── page.tsx      # Voice warmup onboarding
│   │   ├── contacts/
│   │   │   └── page.tsx      # Allowlist manager
│   │   └── logs/
│   │       └── page.tsx      # Conversation logs
│   ├── components/
│   │   ├── ContactCard.tsx
│   │   ├── WarmupWizard.tsx
│   │   ├── ConversationLog.tsx
│   │   └── ToggleSwitch.tsx
│   └── api/
│       ├── contacts/route.ts
│       ├── warmup/route.ts
│       ├── logs/route.ts
│       └── settings/route.ts
├── shared/
│   └── db.js                 # Shared SQLite instance
├── package.json
├── .env.local
└── README.md
```

---

## Phase 1: Project Setup

### 1.1 Initialize the project

```bash
mkdir imessage-agent && cd imessage-agent
npm init -y
mkdir -p daemon/scripts dashboard shared

# Install daemon dependencies
npm install @anthropic-ai/sdk better-sqlite3 node-cron dotenv chokidar

# Initialize Next.js dashboard
npx create-next-app@latest dashboard --typescript --tailwind --app --no-src-dir
cd dashboard && npm install better-sqlite3 @types/better-sqlite3
cd ..
```

### 1.2 Environment setup

Create `.env.local` in project root:

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
POLL_INTERVAL_MS=3000
DB_PATH=./imessage-agent.db
DASHBOARD_PORT=3000
```

---

## Phase 2: SQLite Database Schema

### `shared/db.js`

```javascript
const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './imessage-agent.db';
const db = new Database(DB_PATH);

db.exec(`
  -- Settings table
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Contacts allowlist
  -- auto_reply: 0 = off, 1 = on
  -- mode: 'always' | 'when_busy' | 'manual_trigger'
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_or_handle TEXT UNIQUE NOT NULL,
    display_name TEXT,
    auto_reply INTEGER DEFAULT 0,
    mode TEXT DEFAULT 'always',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Voice persona — the "warmup" data
  CREATE TABLE IF NOT EXISTS persona (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,        -- e.g. 'greeting', 'humor', 'farewell', 'filler'
    example TEXT NOT NULL,         -- raw example text the user provided
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Processed persona summary (generated by Claude from examples)
  CREATE TABLE IF NOT EXISTS persona_summary (
    id INTEGER PRIMARY KEY DEFAULT 1,
    summary TEXT,                  -- Claude's synthesized voice description
    tone TEXT,                     -- e.g. 'casual', 'dry humor', 'warm'
    quirks TEXT,                   -- JSON array of specific quirks
    sample_phrases TEXT,           -- JSON array of phrases to emulate
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Message log
  CREATE TABLE IF NOT EXISTS message_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_or_handle TEXT NOT NULL,
    direction TEXT NOT NULL,       -- 'inbound' | 'outbound'
    body TEXT NOT NULL,
    auto_generated INTEGER DEFAULT 0,
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Seen messages (to avoid double-processing)
  CREATE TABLE IF NOT EXISTS seen_messages (
    message_id TEXT PRIMARY KEY,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Insert defaults
  INSERT OR IGNORE INTO settings (key, value) VALUES ('agent_enabled', '0');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('warmup_complete', '0');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('reply_delay_min_ms', '2000');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('reply_delay_max_ms', '8000');
`);

module.exports = db;
```

---

## Phase 3: AppleScript Bridge

### `daemon/scripts/read_messages.applescript`

```applescript
-- Read messages from the last N minutes
-- Usage: osascript read_messages.applescript <minutes>
on run argv
  set minutesBack to (item 1 of argv) as integer
  set cutoffTime to (current date) - (minutesBack * minutes)
  
  set messageList to {}
  
  tell application "Messages"
    repeat with theChat in chats
      try
        repeat with theMessage in messages of theChat
          if date of theMessage > cutoffTime then
            if direction of theMessage is incoming then
              set msgData to {|id|:(id of theMessage as string), |body|:(content of theMessage), |handle|:(handle of sender of theMessage as string), |chatId|:(id of theChat as string), |timestamp|:(date of theMessage as string)}
              set end of messageList to msgData
            end if
          end if
        end repeat
      end try
    end repeat
  end tell
  
  -- Convert to JSON-like string for parsing
  set output to ""
  repeat with msg in messageList
    set output to output & (|id| of msg) & "|||" & (|body| of msg) & "|||" & (|handle| of msg) & "|||" & (|chatId| of msg) & "|||" & (|timestamp| of msg) & "~~~"
  end repeat
  
  return output
end run
```

### `daemon/scripts/send_message.applescript`

```applescript
-- Send a message to a handle
-- Usage: osascript send_message.applescript <handle> <message>
on run argv
  set targetHandle to item 1 of argv
  set messageBody to item 2 of argv
  
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy targetHandle of targetService
    send messageBody to targetBuddy
  end tell
  
  return "sent"
end run
```

### `daemon/scripts/get_contacts.applescript`

```applescript
-- Get list of recent chat participants
on run
  set contactList to ""
  
  tell application "Messages"
    repeat with theChat in chats
      try
        repeat with thePart in participants of theChat
          set handle to handle of thePart as string
          set name to name of thePart as string
          set contactList to contactList & handle & "|||" & name & "~~~"
        end repeat
      end try
    end repeat
  end tell
  
  return contactList
end run
```

### `daemon/imessage.js`

```javascript
const { execSync, exec } = require('child_process');
const path = require('path');

const SCRIPTS_DIR = path.join(__dirname, 'scripts');

function runAppleScript(script, args = []) {
  const escapedArgs = args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `osascript "${path.join(SCRIPTS_DIR, script)}" ${escapedArgs}`;
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (err) {
    console.error(`AppleScript error (${script}):`, err.message);
    return '';
  }
}

function parseMessages(raw) {
  if (!raw) return [];
  return raw.split('~~~')
    .filter(Boolean)
    .map(block => {
      const [id, body, handle, chatId, timestamp] = block.split('|||');
      return { id, body, handle, chatId, timestamp };
    });
}

function parseContacts(raw) {
  if (!raw) return [];
  const seen = new Set();
  return raw.split('~~~')
    .filter(Boolean)
    .map(block => {
      const [handle, name] = block.split('|||');
      return { handle, name };
    })
    .filter(c => {
      if (seen.has(c.handle)) return false;
      seen.add(c.handle);
      return true;
    });
}

module.exports = {
  // Get messages from the last N minutes
  getRecentMessages(minutesBack = 2) {
    const raw = runAppleScript('read_messages.applescript', [minutesBack]);
    return parseMessages(raw);
  },

  // Send a message
  sendMessage(handle, body) {
    return runAppleScript('send_message.applescript', [handle, body]);
  },

  // Get recent chat contacts
  getRecentContacts() {
    const raw = runAppleScript('get_contacts.applescript');
    return parseContacts(raw);
  }
};
```

---

## Phase 4: Claude Agent

### `daemon/agent.js`

```javascript
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../shared/db');
require('dotenv').config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Build system prompt from persona data
function buildSystemPrompt() {
  const personaRow = db.prepare('SELECT * FROM persona_summary WHERE id = 1').get();
  
  const basePrompt = `You are an AI assistant helping someone respond to their iMessages. Your job is to reply as if you ARE that person — not as an AI, not as an assistant. Never reveal you are an AI.

CRITICAL RULES:
- Reply naturally and casually, like a real text message
- Keep replies SHORT — 1-3 sentences max unless the conversation calls for more
- Match the energy of the incoming message
- Never use formal language, bullet points, or structured responses
- Don't be overly enthusiastic or use too many exclamation marks
- If you genuinely don't know how to respond to something (e.g. very specific personal question), send a deflecting but natural reply like "lol hold on lemme get back to u on that"
- Never start with "Hey!" or "Hi!" unless the conversation just started
- Use lowercase when appropriate to match casual texting style
- Mirror the vibe: if they're being funny, be funny back. If they're being serious, match that.`;

  if (!personaRow || !personaRow.summary) {
    return basePrompt + '\n\nBe casual and natural.';
  }

  return `${basePrompt}

PERSONA PROFILE (this is how the person you're impersonating communicates):
${personaRow.summary}

Tone: ${personaRow.tone || 'casual'}

Specific quirks to emulate:
${personaRow.quirks ? JSON.parse(personaRow.quirks).map(q => `- ${q}`).join('\n') : '- Be natural'}

Sample phrases this person actually uses:
${personaRow.sample_phrases ? JSON.parse(personaRow.sample_phrases).map(p => `- "${p}"`).join('\n') : ''}

IMPORTANT: Use these quirks and phrases naturally — don't force them into every message, just let them show up organically.`;
}

// Get recent conversation history for context
function getConversationHistory(handle, limit = 10) {
  const rows = db.prepare(`
    SELECT direction, body, sent_at 
    FROM message_log 
    WHERE phone_or_handle = ? 
    ORDER BY sent_at DESC 
    LIMIT ?
  `).all(handle, limit);
  
  return rows.reverse().map(row => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    content: row.body
  }));
}

// Generate a reply
async function generateReply(handle, incomingMessage) {
  const systemPrompt = buildSystemPrompt();
  const history = getConversationHistory(handle, 10);
  
  // Build messages array with history + new message
  const messages = [
    ...history,
    { role: 'user', content: incomingMessage }
  ];

  // If no history, add context
  if (history.length === 0) {
    messages.unshift({
      role: 'user',
      content: `[Context: This is the start of a conversation with ${handle}]`
    });
    messages.shift(); // remove context, just use the message
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages
    });

    return response.content[0].text.trim();
  } catch (err) {
    console.error('Claude API error:', err.message);
    return null;
  }
}

// Synthesize persona from warmup examples
async function synthesizePersona() {
  const examples = db.prepare('SELECT category, example FROM persona').all();
  
  if (examples.length === 0) return null;

  const examplesText = examples
    .map(e => `[${e.category}]: "${e.example}"`)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: 'You are analyzing text message examples to build a communication profile. Be specific and analytical.',
    messages: [{
      role: 'user',
      content: `Analyze these text message examples from one person and create a detailed communication profile. Return a JSON object with these exact fields:
- summary: A paragraph describing how this person communicates (writing style, personality, energy)
- tone: A 2-4 word descriptor (e.g. "dry humor, laid back")
- quirks: An array of 5-10 specific behavioral quirks (e.g. "rarely uses capital letters", "uses 'lol' ironically", "asks follow-up questions")
- sample_phrases: An array of 5-10 actual phrases or words this person uses

Examples to analyze:
${examplesText}

Return ONLY valid JSON, no markdown.`
    }]
  });

  try {
    const parsed = JSON.parse(response.content[0].text.trim());
    
    db.prepare(`
      INSERT OR REPLACE INTO persona_summary (id, summary, tone, quirks, sample_phrases, updated_at)
      VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      parsed.summary,
      parsed.tone,
      JSON.stringify(parsed.quirks),
      JSON.stringify(parsed.sample_phrases)
    );

    return parsed;
  } catch (err) {
    console.error('Failed to parse persona JSON:', err.message);
    return null;
  }
}

module.exports = { generateReply, synthesizePersona };
```

---

## Phase 5: Main Daemon

### `daemon/index.js`

```javascript
const { getRecentMessages, sendMessage } = require('./imessage');
const { generateReply } = require('./agent');
const db = require('../shared/db');
require('dotenv').config();

const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '3000');
const REPLY_DELAY_MIN = parseInt(process.env.REPLY_DELAY_MIN_MS || '2000');
const REPLY_DELAY_MAX = parseInt(process.env.REPLY_DELAY_MAX_MS || '8000');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function isContactAllowlisted(handle) {
  const contact = db.prepare(
    'SELECT * FROM contacts WHERE phone_or_handle = ? AND auto_reply = 1'
  ).get(handle);
  return !!contact;
}

function markSeen(messageId) {
  db.prepare('INSERT OR IGNORE INTO seen_messages (message_id) VALUES (?)').run(messageId);
}

function isAlreadySeen(messageId) {
  const row = db.prepare('SELECT 1 FROM seen_messages WHERE message_id = ?').get(messageId);
  return !!row;
}

function logMessage(handle, direction, body, autoGenerated = false) {
  db.prepare(`
    INSERT INTO message_log (phone_or_handle, direction, body, auto_generated)
    VALUES (?, ?, ?, ?)
  `).run(handle, direction, body, autoGenerated ? 1 : 0);
}

function randomDelay(min, max) {
  return new Promise(resolve => {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    setTimeout(resolve, delay);
  });
}

async function processMessage(message) {
  const { id, body, handle } = message;

  // Skip if already processed
  if (isAlreadySeen(id)) return;
  markSeen(id);

  // Log inbound
  logMessage(handle, 'inbound', body);

  // Check if agent is globally enabled
  const agentEnabled = getSetting('agent_enabled') === '1';
  if (!agentEnabled) {
    console.log(`[DAEMON] Agent disabled, skipping message from ${handle}`);
    return;
  }

  // Check if this contact is in the allowlist
  if (!isContactAllowlisted(handle)) {
    console.log(`[DAEMON] ${handle} not in allowlist, skipping`);
    return;
  }

  console.log(`[DAEMON] Processing message from ${handle}: "${body}"`);

  // Generate reply
  const reply = await generateReply(handle, body);
  if (!reply) {
    console.error(`[DAEMON] Failed to generate reply for ${handle}`);
    return;
  }

  // Human-like delay before replying
  await randomDelay(REPLY_DELAY_MIN, REPLY_DELAY_MAX);

  // Send reply
  const result = sendMessage(handle, reply);
  if (result === 'sent') {
    logMessage(handle, 'outbound', reply, true);
    console.log(`[DAEMON] Sent reply to ${handle}: "${reply}"`);
  } else {
    console.error(`[DAEMON] Failed to send message to ${handle}`);
  }
}

async function poll() {
  try {
    const messages = getRecentMessages(2); // last 2 minutes
    for (const msg of messages) {
      await processMessage(msg);
    }
  } catch (err) {
    console.error('[DAEMON] Poll error:', err.message);
  }
}

console.log('[DAEMON] iMessage Agent starting...');
console.log(`[DAEMON] Polling every ${POLL_INTERVAL}ms`);

// Initial poll
poll();

// Set interval
setInterval(poll, POLL_INTERVAL);
```

---

## Phase 6: Next.js Dashboard

### Dashboard API Routes

#### `dashboard/app/api/settings/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || '../imessage-agent.db';
const db = new Database(path.resolve(DB_PATH));

export async function GET() {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(body)) {
    stmt.run(key, String(value));
  }
  return NextResponse.json({ ok: true });
}
```

#### `dashboard/app/api/contacts/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || '../imessage-agent.db';
const db = new Database(path.resolve(DB_PATH));

export async function GET() {
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY display_name').all();
  return NextResponse.json(contacts);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { phone_or_handle, display_name, auto_reply, mode } = body;

  db.prepare(`
    INSERT INTO contacts (phone_or_handle, display_name, auto_reply, mode)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(phone_or_handle) DO UPDATE SET
      display_name = excluded.display_name,
      auto_reply = excluded.auto_reply,
      mode = excluded.mode,
      updated_at = CURRENT_TIMESTAMP
  `).run(phone_or_handle, display_name, auto_reply ? 1 : 0, mode || 'always');

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { phone_or_handle } = await req.json();
  db.prepare('DELETE FROM contacts WHERE phone_or_handle = ?').run(phone_or_handle);
  return NextResponse.json({ ok: true });
}
```

#### `dashboard/app/api/warmup/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';

const DB_PATH = process.env.DB_PATH || '../imessage-agent.db';
const db = new Database(path.resolve(DB_PATH));
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Get current persona
export async function GET() {
  const examples = db.prepare('SELECT * FROM persona ORDER BY created_at').all();
  const summary = db.prepare('SELECT * FROM persona_summary WHERE id = 1').get();
  return NextResponse.json({ examples, summary });
}

// Add example
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { category, example } = body;

  if (body.action === 'synthesize') {
    // Trigger persona synthesis
    const examples = db.prepare('SELECT category, example FROM persona').all() as { category: string; example: string }[];
    
    const examplesText = examples
      .map((e) => `[${e.category}]: "${e.example}"`)
      .join('\n');

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: 'You are analyzing text message examples to build a communication profile. Be specific and analytical.',
      messages: [{
        role: 'user',
        content: `Analyze these text message examples from one person and create a detailed communication profile. Return a JSON object with these exact fields:
- summary: A paragraph describing how this person communicates
- tone: A 2-4 word descriptor
- quirks: An array of 5-10 specific behavioral quirks
- sample_phrases: An array of 5-10 actual phrases this person uses

Examples:
${examplesText}

Return ONLY valid JSON.`
      }]
    });

    const parsed = JSON.parse(response.content[0].text.trim());
    
    db.prepare(`
      INSERT OR REPLACE INTO persona_summary (id, summary, tone, quirks, sample_phrases, updated_at)
      VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      parsed.summary,
      parsed.tone,
      JSON.stringify(parsed.quirks),
      JSON.stringify(parsed.sample_phrases)
    );

    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('warmup_complete', '1')").run();

    return NextResponse.json({ ok: true, persona: parsed });
  }

  // Add example
  db.prepare('INSERT INTO persona (category, example) VALUES (?, ?)').run(category, example);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  db.prepare('DELETE FROM persona WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
```

#### `dashboard/app/api/logs/route.ts`

```typescript
import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = process.env.DB_PATH || '../imessage-agent.db';
const db = new Database(path.resolve(DB_PATH));

export async function GET() {
  const logs = db.prepare(`
    SELECT * FROM message_log 
    ORDER BY sent_at DESC 
    LIMIT 200
  `).all();
  return NextResponse.json(logs);
}
```

---

## Phase 7: Dashboard UI

### `dashboard/app/page.tsx` — Main Dashboard

```tsx
'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function Dashboard() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then(data => { setSettings(data); setLoading(false); });
  }, []);

  const toggleAgent = async () => {
    const newVal = settings.agent_enabled === '1' ? '0' : '1';
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_enabled: newVal })
    });
    setSettings(prev => ({ ...prev, agent_enabled: newVal }));
  };

  const isEnabled = settings.agent_enabled === '1';
  const warmupComplete = settings.warmup_complete === '1';

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">iMessage Agent</h1>
        <p className="text-gray-400 mb-8">AI auto-responder for your iMessages</p>

        {/* Main toggle */}
        <div className="bg-gray-900 rounded-2xl p-6 mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Agent Status</h2>
            <p className="text-gray-400 text-sm mt-1">
              {isEnabled ? 'Auto-responding to allowlisted contacts' : 'Agent is paused'}
            </p>
          </div>
          <button
            onClick={toggleAgent}
            disabled={!warmupComplete}
            className={`relative w-16 h-8 rounded-full transition-colors duration-200 ${
              isEnabled ? 'bg-green-500' : 'bg-gray-600'
            } ${!warmupComplete ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ${
              isEnabled ? 'translate-x-9' : 'translate-x-1'
            }`} />
          </button>
        </div>

        {!warmupComplete && (
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 mb-6">
            <p className="text-yellow-400 text-sm">
              ⚠️ Complete the voice warmup before enabling the agent.{' '}
              <Link href="/warmup" className="underline">Do it now →</Link>
            </p>
          </div>
        )}

        {/* Nav cards */}
        <div className="grid grid-cols-1 gap-4">
          <Link href="/warmup" className="bg-gray-900 hover:bg-gray-800 rounded-xl p-5 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">🎙️ Voice Warmup</h3>
                <p className="text-gray-400 text-sm mt-1">
                  {warmupComplete ? 'Persona trained — click to update' : 'Train the bot to sound like you'}
                </p>
              </div>
              <span className="text-2xl">{warmupComplete ? '✅' : '⏳'}</span>
            </div>
          </Link>

          <Link href="/contacts" className="bg-gray-900 hover:bg-gray-800 rounded-xl p-5 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">👥 Contact Allowlist</h3>
                <p className="text-gray-400 text-sm mt-1">Choose who the agent responds to</p>
              </div>
              <span className="text-gray-400">→</span>
            </div>
          </Link>

          <Link href="/logs" className="bg-gray-900 hover:bg-gray-800 rounded-xl p-5 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">📋 Message Logs</h3>
                <p className="text-gray-400 text-sm mt-1">See what the agent has sent</p>
              </div>
              <span className="text-gray-400">→</span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
```

### `dashboard/app/warmup/page.tsx` — Voice Warmup Wizard

```tsx
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const CATEGORIES = [
  { id: 'greeting', label: '👋 Greetings', prompt: 'How do you typically start a text conversation? (e.g. "yo", "heyyy", "what\'s good")' },
  { id: 'humor', label: '😂 Humor', prompt: 'Give an example of something funny you\'d text a friend' },
  { id: 'plans', label: '📅 Making plans', prompt: 'How would you text someone to make plans? (e.g. "yo u free tmrw?")' },
  { id: 'reaction', label: '😲 Reactions', prompt: 'How do you react to surprising news over text?' },
  { id: 'farewell', label: '✌️ Signing off', prompt: 'How do you end a text conversation?' },
  { id: 'agreement', label: '👍 Agreement', prompt: 'How do you say yes or agree over text?' },
  { id: 'disagreement', label: '🙅 Pushback', prompt: 'How do you disagree or push back in a text?' },
  { id: 'filler', label: '💬 Random texts', prompt: 'Paste any random texts you\'d send to a friend — the more the better' },
];

type Example = {
  id: number;
  category: string;
  example: string;
};

type Persona = {
  summary: string;
  tone: string;
  quirks: string[];
  sample_phrases: string[];
};

export default function WarmupPage() {
  const [examples, setExamples] = useState<Example[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [persona, setPersona] = useState<Persona | null>(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/warmup')
      .then(r => r.json())
      .then(data => {
        setExamples(data.examples || []);
        setPersona(data.summary || null);
      });
  }, []);

  const addExample = async (category: string) => {
    const example = inputs[category]?.trim();
    if (!example) return;

    await fetch('/api/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, example })
    });

    setExamples(prev => [...prev, { id: Date.now(), category, example }]);
    setInputs(prev => ({ ...prev, [category]: '' }));
  };

  const deleteExample = async (id: number) => {
    await fetch('/api/warmup', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    setExamples(prev => prev.filter(e => e.id !== id));
  };

  const synthesize = async () => {
    if (examples.length < 5) {
      alert('Add at least 5 examples first so the bot has enough to work with');
      return;
    }
    setSynthesizing(true);
    const res = await fetch('/api/warmup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'synthesize' })
    });
    const data = await res.json();
    setPersona(data.persona);
    setSynthesizing(false);
  };

  const getExamplesForCategory = (category: string) => 
    examples.filter(e => e.category === category);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => router.push('/')} className="text-gray-400 text-sm mb-6 hover:text-white">← Back</button>
        <h1 className="text-3xl font-bold mb-2">Voice Warmup</h1>
        <p className="text-gray-400 mb-8">
          Give examples of how you actually text. The more you add, the more the bot will sound like you.
          Aim for at least 10-15 examples across different categories.
        </p>

        {/* Example input sections */}
        {CATEGORIES.map(cat => (
          <div key={cat.id} className="bg-gray-900 rounded-xl p-5 mb-4">
            <h3 className="font-semibold mb-1">{cat.label}</h3>
            <p className="text-gray-400 text-sm mb-3">{cat.prompt}</p>
            
            {/* Existing examples */}
            {getExamplesForCategory(cat.id).map(ex => (
              <div key={ex.id} className="flex items-center gap-2 mb-2">
                <span className="bg-gray-800 rounded-lg px-3 py-1.5 text-sm flex-1">
                  {ex.example}
                </span>
                <button 
                  onClick={() => deleteExample(ex.id)}
                  className="text-gray-500 hover:text-red-400 text-lg"
                >
                  ×
                </button>
              </div>
            ))}

            {/* Input */}
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={inputs[cat.id] || ''}
                onChange={e => setInputs(prev => ({ ...prev, [cat.id]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && addExample(cat.id)}
                placeholder="Type an example..."
                className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={() => addExample(cat.id)}
                className="bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-2 text-sm font-medium"
              >
                Add
              </button>
            </div>
          </div>
        ))}

        {/* Total count */}
        <div className="text-center text-gray-400 text-sm mb-6">
          {examples.length} examples added {examples.length < 5 ? `(need ${5 - examples.length} more to synthesize)` : '✓'}
        </div>

        {/* Synthesize button */}
        <button
          onClick={synthesize}
          disabled={synthesizing || examples.length < 5}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl py-4 font-semibold text-lg transition-colors"
        >
          {synthesizing ? 'Building your voice profile...' : '✨ Generate My Voice Profile'}
        </button>

        {/* Persona result */}
        {persona && (
          <div className="mt-8 bg-gray-900 rounded-xl p-6">
            <h2 className="font-bold text-xl mb-4">Your Voice Profile</h2>
            
            <div className="mb-4">
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Summary</p>
              <p className="text-sm">{persona.summary}</p>
            </div>

            <div className="mb-4">
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Tone</p>
              <span className="bg-blue-900/50 text-blue-300 rounded-full px-3 py-1 text-sm">{persona.tone}</span>
            </div>

            <div className="mb-4">
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Quirks</p>
              <div className="flex flex-wrap gap-2">
                {persona.quirks?.map((q, i) => (
                  <span key={i} className="bg-gray-800 rounded-lg px-2 py-1 text-xs">{q}</span>
                ))}
              </div>
            </div>

            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Your Phrases</p>
              <div className="flex flex-wrap gap-2">
                {persona.sample_phrases?.map((p, i) => (
                  <span key={i} className="bg-gray-800 rounded-lg px-2 py-1 text-xs">"{p}"</span>
                ))}
              </div>
            </div>

            <button
              onClick={() => router.push('/')}
              className="w-full mt-6 bg-white text-gray-900 rounded-xl py-3 font-semibold hover:bg-gray-100 transition-colors"
            >
              Done — Go to Dashboard →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

### `dashboard/app/contacts/page.tsx` — Allowlist Manager

```tsx
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Contact = {
  id: number;
  phone_or_handle: string;
  display_name: string;
  auto_reply: number;
  mode: string;
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newHandle, setNewHandle] = useState('');
  const [newName, setNewName] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/contacts')
      .then(r => r.json())
      .then(setContacts);
  }, []);

  const addContact = async () => {
    if (!newHandle.trim()) return;
    await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_or_handle: newHandle.trim(),
        display_name: newName.trim() || newHandle.trim(),
        auto_reply: 1,
        mode: 'always'
      })
    });
    setContacts(prev => [...prev, {
      id: Date.now(),
      phone_or_handle: newHandle.trim(),
      display_name: newName.trim() || newHandle.trim(),
      auto_reply: 1,
      mode: 'always'
    }]);
    setNewHandle('');
    setNewName('');
  };

  const toggleContact = async (contact: Contact) => {
    const updated = { ...contact, auto_reply: contact.auto_reply === 1 ? 0 : 1 };
    await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    setContacts(prev => prev.map(c => c.id === contact.id ? updated : c));
  };

  const removeContact = async (contact: Contact) => {
    await fetch('/api/contacts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_or_handle: contact.phone_or_handle })
    });
    setContacts(prev => prev.filter(c => c.id !== contact.id));
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => router.push('/')} className="text-gray-400 text-sm mb-6 hover:text-white">← Back</button>
        <h1 className="text-3xl font-bold mb-2">Contact Allowlist</h1>
        <p className="text-gray-400 mb-8">
          The agent only auto-responds to contacts in this list. Everyone else is ignored.
        </p>

        {/* Add contact */}
        <div className="bg-gray-900 rounded-xl p-5 mb-6">
          <h3 className="font-semibold mb-3">Add Contact</h3>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newHandle}
              onChange={e => setNewHandle(e.target.value)}
              placeholder="+1234567890 or email@icloud.com"
              className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Display name (optional)"
              className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={addContact}
              className="bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-2 text-sm font-medium"
            >
              Add
            </button>
          </div>
          <p className="text-gray-500 text-xs mt-2">
            Use the phone number or iMessage handle (email/Apple ID) exactly as it appears in Messages.app
          </p>
        </div>

        {/* Contact list */}
        {contacts.length === 0 ? (
          <p className="text-gray-500 text-center py-12">No contacts added yet</p>
        ) : (
          <div className="space-y-3">
            {contacts.map(contact => (
              <div key={contact.id} className="bg-gray-900 rounded-xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center text-lg font-semibold">
                  {contact.display_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{contact.display_name}</p>
                  <p className="text-gray-400 text-xs truncate">{contact.phone_or_handle}</p>
                </div>
                <div className="flex items-center gap-3">
                  {/* Toggle */}
                  <button
                    onClick={() => toggleContact(contact)}
                    className={`relative w-12 h-6 rounded-full transition-colors ${
                      contact.auto_reply === 1 ? 'bg-green-500' : 'bg-gray-600'
                    }`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                      contact.auto_reply === 1 ? 'translate-x-6' : 'translate-x-0.5'
                    }`} />
                  </button>
                  {/* Remove */}
                  <button
                    onClick={() => removeContact(contact)}
                    className="text-gray-500 hover:text-red-400 text-xl font-light"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

### `dashboard/app/logs/page.tsx` — Message Logs

```tsx
'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type LogEntry = {
  id: number;
  phone_or_handle: string;
  direction: string;
  body: string;
  auto_generated: number;
  sent_at: string;
};

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/logs')
      .then(r => r.json())
      .then(setLogs);
  }, []);

  const grouped = logs.reduce<Record<string, LogEntry[]>>((acc, log) => {
    const key = log.phone_or_handle;
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => router.push('/')} className="text-gray-400 text-sm mb-6 hover:text-white">← Back</button>
        <h1 className="text-3xl font-bold mb-2">Message Logs</h1>
        <p className="text-gray-400 mb-8">Everything the agent has seen and sent</p>

        {Object.keys(grouped).length === 0 ? (
          <p className="text-gray-500 text-center py-12">No messages logged yet</p>
        ) : (
          Object.entries(grouped).map(([handle, messages]) => (
            <div key={handle} className="mb-8">
              <h3 className="text-gray-400 text-sm font-medium mb-3 uppercase tracking-wider">{handle}</h3>
              <div className="space-y-2">
                {messages.slice(0, 20).map(msg => (
                  <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs rounded-2xl px-4 py-2 text-sm ${
                      msg.direction === 'outbound'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-800 text-white'
                    }`}>
                      <p>{msg.body}</p>
                      <p className="text-xs opacity-50 mt-1 flex items-center gap-1">
                        {new Date(msg.sent_at).toLocaleTimeString()}
                        {msg.auto_generated === 1 && <span>• 🤖</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

---

## Phase 8: Package.json & Scripts

### Root `package.json`

```json
{
  "name": "imessage-agent",
  "version": "1.0.0",
  "scripts": {
    "daemon": "node daemon/index.js",
    "dashboard": "cd dashboard && npm run dev",
    "start": "concurrently \"npm run daemon\" \"npm run dashboard\"",
    "setup": "node scripts/setup.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "better-sqlite3": "^9.4.0",
    "concurrently": "^8.2.0",
    "dotenv": "^16.0.0"
  }
}
```

---

## Phase 9: macOS Permissions Setup

Before running, the user must grant permissions:

1. **Accessibility Access** — System Settings → Privacy & Security → Accessibility → Add Terminal (or your Node.js binary)
2. **Automation Access** — System Settings → Privacy & Security → Automation → Terminal → Messages ✓
3. **Full Disk Access** (sometimes needed for Messages DB) — System Settings → Privacy & Security → Full Disk Access → Terminal

The app should prompt for these on first launch with a setup script:

### `scripts/setup.js`

```javascript
const { execSync } = require('child_process');

console.log('\n🔧 iMessage Agent Setup\n');
console.log('This app needs permission to control Messages.app via AppleScript.');
console.log('\nPlease grant the following permissions:\n');
console.log('1. System Settings → Privacy & Security → Accessibility → Add Terminal');
console.log('2. System Settings → Privacy & Security → Automation → Terminal → Messages ✓');
console.log('\nPress Enter after granting permissions...');

process.stdin.once('data', () => {
  console.log('\nTesting Messages.app access...');
  try {
    const result = execSync('osascript -e "tell application \\"Messages\\" to get name"', {
      encoding: 'utf8',
      timeout: 5000
    }).trim();
    console.log(`✅ Messages.app accessible: ${result}`);
    console.log('\nSetup complete! Run "npm start" to launch.\n');
  } catch (err) {
    console.error('❌ Cannot access Messages.app. Please check permissions and try again.');
    process.exit(1);
  }
  process.exit(0);
});
```

---

## Phase 10: README

### `README.md`

```markdown
# iMessage Agent

AI-powered iMessage auto-responder that sounds like you. Built with Claude AI + AppleScript.

## Requirements
- macOS (tested on Ventura/Sonoma)
- Node.js 18+
- iMessage logged in on your Mac
- Anthropic API key

## Quick Start

1. Clone and install:
   \`\`\`bash
   npm install
   cd dashboard && npm install && cd ..
   \`\`\`

2. Create `.env.local`:
   \`\`\`
   ANTHROPIC_API_KEY=your_key_here
   \`\`\`

3. Run setup (grants permissions):
   \`\`\`bash
   npm run setup
   \`\`\`

4. Launch everything:
   \`\`\`bash
   npm start
   \`\`\`

5. Open http://localhost:3000 and:
   - Complete the Voice Warmup (add 10+ examples of how you text)
   - Add contacts to the allowlist
   - Enable the agent

## How it works

The daemon polls Messages.app via AppleScript every 3 seconds. When a new message arrives from an allowlisted contact, it generates a reply using Claude with your voice persona, waits a random human-like delay, then sends it.

## Notes
- Keep your Mac awake and Messages.app open
- Use a test contact first before going live
- The agent logs all conversations — check /logs in the dashboard
- Disable instantly via the dashboard toggle
```

---

## Build Order for Claude Code

When building this project with Claude Code, follow this sequence:

1. **Run `npm run setup`** — verify permissions before writing any code
2. **Build `shared/db.js`** — foundation everything depends on
3. **Build `daemon/scripts/*.applescript`** — test each script manually with `osascript`
4. **Build `daemon/imessage.js`** — test reads/sends work
5. **Build `daemon/agent.js`** — test Claude integration standalone
6. **Build `daemon/index.js`** — wire it all together, test with one contact
7. **Scaffold Next.js dashboard** — API routes first, then UI
8. **Test end-to-end** — send yourself a message from another device

---

## Known Gotchas

- **AppleScript handle format** — Handles in Messages.app can be phone numbers (`+1234567890`) or emails (`user@icloud.com`). Make sure to add the exact format shown in Messages.
- **Message deduplication** — The daemon uses a `seen_messages` table to avoid double-processing. If the SQLite DB gets corrupted, clear this table.
- **Rate limiting** — Don't set `POLL_INTERVAL_MS` below 2000ms or you'll hammer AppleScript.
- **iMessage vs SMS** — AppleScript can only send iMessages reliably. Green bubble (SMS) contacts may fail.
- **Mac sleep** — The daemon stops when your Mac sleeps. Use `caffeinate -i npm run daemon` to prevent sleep while running.