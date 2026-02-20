import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

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
