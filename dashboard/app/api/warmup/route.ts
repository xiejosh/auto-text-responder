import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import db from '@/lib/db';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET() {
  const examples = db.prepare('SELECT * FROM persona ORDER BY created_at').all();
  const summary = db.prepare('SELECT * FROM persona_summary WHERE id = 1').get();
  return NextResponse.json({ examples, summary });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === 'synthesize') {
    try {
      const examples = db.prepare('SELECT category, example FROM persona').all() as { category: string; example: string }[];

      if (examples.length === 0) {
        return NextResponse.json({ error: 'No examples to synthesize' }, { status: 400 });
      }

      const examplesText = examples
        .map((e) => `[${e.category}]: "${e.example}"`)
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
- quirks: An array of 5-10 specific behavioral quirks relevant to dating convos (e.g. "teases with callbacks to earlier messages", "uses lowercase for casual confidence")
- sample_phrases: An array of 5-10 actual phrases or words this person uses when flirting or texting matches

Examples:
${examplesText}

Return ONLY valid JSON, no markdown fences.`
        }]
      });

      const firstBlock = response.content[0];
      if (firstBlock.type !== 'text') {
        return NextResponse.json({ error: 'Unexpected response from Claude' }, { status: 500 });
      }

      // Strip markdown code fences if Claude wraps the JSON
      let jsonText = firstBlock.text.trim();
      if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }

      const parsed = JSON.parse(jsonText);

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
    } catch (err) {
      console.error('Synthesize error:', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json({ error: `Synthesis failed: ${message}` }, { status: 500 });
    }
  }

  // Add example
  const { category, example } = body;
  db.prepare('INSERT INTO persona (category, example) VALUES (?, ?)').run(category, example);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  db.prepare('DELETE FROM persona WHERE id = ?').run(id);
  return NextResponse.json({ ok: true });
}
