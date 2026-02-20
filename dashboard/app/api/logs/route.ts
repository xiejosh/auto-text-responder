import { NextResponse } from 'next/server';
import db from '@/lib/db';

export async function GET() {
  const logs = db.prepare(`
    SELECT * FROM message_log
    WHERE direction = 'outbound' AND auto_generated = 1
    ORDER BY sent_at DESC
    LIMIT 200
  `).all();
  return NextResponse.json(logs);
}
