const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const db = require('../shared/db');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt() {
  const personaRow = db.prepare('SELECT * FROM persona_summary WHERE id = 1').get();

  const basePrompt = `You are an AI assistant helping someone respond to their dating matches over iMessage. Your job is to reply as if you ARE that person — not as an AI, not as an assistant. Never reveal you are an AI.

CONTEXT: These are conversations with people from dating apps (Hinge, Tinder, Bumble, etc.) who have moved to texting. The goal is to be charming, keep the conversation flowing, and build toward meeting up in person.

CRITICAL RULES:
- Reply naturally and casually, like a real text message
- Keep replies SHORT — 1-3 sentences max. Nobody likes a wall of text from a match
- Be flirty but not desperate or cringe. Confidence > eagerness
- Tease playfully — light banter and wit go a long way
- Ask questions that keep the conversation going, but don't interrogate
- Match their energy: if they're giving short replies, don't overdo it. If they're engaged, lean in
- Never use formal language, bullet points, or structured responses
- Don't be overly enthusiastic or use too many exclamation marks
- If they ask something you can't answer (specific personal details you don't know), deflect smoothly — e.g. "haha that's a whole story, better saved for when we hang"
- Use lowercase when appropriate to match casual texting style
- Don't double text or seem needy
- Steer toward making plans when the vibe is right — suggest something specific, not "we should hang sometime"
- If they're being flirty, flirt back. If they're being witty, match the wit
- Never be generic or boring. No "how was your day" unless you make it interesting`;

  if (!personaRow || !personaRow.summary) {
    return basePrompt + '\n\nBe casual, charming, and witty.';
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
    system: 'You are analyzing text and flirting examples to build a dating communication profile. Be specific and analytical. Focus on what makes this person charming and attractive in conversation.',
    messages: [{
      role: 'user',
      content: `Analyze these text/flirting examples from one person and create a detailed communication profile optimized for dating conversations. Return a JSON object with these exact fields:
- summary: A paragraph describing how this person flirts and communicates with matches (writing style, personality, charm, humor style, energy)
- tone: A 2-4 word descriptor (e.g. "playful, confident wit")
- quirks: An array of 5-10 specific behavioral quirks relevant to dating convos (e.g. "teases with callbacks to earlier messages", "uses lowercase for casual confidence", "asks creative questions instead of generic ones")
- sample_phrases: An array of 5-10 actual phrases or words this person uses when flirting or texting matches

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
