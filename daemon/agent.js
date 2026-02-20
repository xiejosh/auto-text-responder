const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const db = require('../shared/db');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

async function generateReply(handle, incomingMessage) {
  const systemPrompt = buildSystemPrompt();
  const history = getConversationHistory(handle, 10);

  const messages = [
    ...history,
    { role: 'user', content: incomingMessage }
  ];

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
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

async function synthesizePersona() {
  const examples = db.prepare('SELECT category, example FROM persona').all();

  if (examples.length === 0) return null;

  const examplesText = examples
    .map(e => `[${e.category}]: "${e.example}"`)
    .join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
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
