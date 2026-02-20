const { execSync } = require('child_process');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

const SCRIPTS_DIR = path.join(__dirname, 'scripts');
const MESSAGES_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

// Mac CoreData epoch starts Jan 1, 2001; Unix epoch is Jan 1, 1970
const MAC_EPOCH_OFFSET_SEC = 978307200;

function openMessagesDb() {
  return new Database(MESSAGES_DB, { readonly: true, fileMustExist: true });
}

// Extract plain text from an attributedBody blob (Apple typedstream format).
// On modern macOS some messages store text only in this column, leaving `text` NULL.
function extractTextFromAttributedBody(blob) {
  if (!blob || blob.length === 0) return null;

  for (let i = 0; i < blob.length - 2; i++) {
    if (blob[i] === 0x01 && blob[i + 1] === 0x2B) {
      let offset = i + 2;
      const firstByte = blob[offset];
      let textLength;

      if (firstByte < 0x80) {
        textLength = firstByte;
        offset += 1;
      } else if (firstByte === 0x81 && offset + 2 < blob.length) {
        textLength = (blob[offset + 1] << 8) | blob[offset + 2];
        offset += 3;
      } else if (firstByte === 0x82 && offset + 4 < blob.length) {
        textLength = (blob[offset + 1] << 24) | (blob[offset + 2] << 16) |
                     (blob[offset + 3] << 8) | blob[offset + 4];
        offset += 5;
      } else {
        continue;
      }

      if (textLength > 0 && offset + textLength <= blob.length) {
        const text = blob.slice(offset, offset + textLength).toString('utf-8').trim();
        if (text.length > 0) return text;
      }
    }
  }

  return null;
}

function runAppleScript(script, args = []) {
  const escapedArgs = args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
  const cmd = `osascript "${path.join(SCRIPTS_DIR, script)}" ${escapedArgs}`;
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim();
  } catch (err) {
    console.error(`AppleScript error (${script}):`, err.message);
    return '';
  }
}

module.exports = {
  // Read messages by querying chat.db directly — fast, no AppleScript iteration
  getRecentMessages(minutesBack = 2) {
    let db;
    try {
      db = openMessagesDb();
    } catch (err) {
      console.error('[iMessage] Cannot open chat.db — grant Full Disk Access to Terminal in System Settings:', err.message);
      return [];
    }

    try {
      const cutoffSec = (Date.now() / 1000) - (minutesBack * 60);
      // chat.db stores dates as nanoseconds since Mac epoch (macOS Sierra+)
      const cutoffMac = (cutoffSec - MAC_EPOCH_OFFSET_SEC) * 1e9;

      const rows = db.prepare(`
        SELECT
          m.guid            AS id,
          m.text            AS body,
          m.attributedBody  AS attributedBody,
          h.id              AS handle,
          m.date            AS ts
        FROM message m
        JOIN handle h ON m.handle_id = h.rowid
        WHERE m.is_from_me = 0
          AND (m.text IS NOT NULL OR m.attributedBody IS NOT NULL)
          AND m.date > ?
        ORDER BY m.date ASC
      `).all(cutoffMac);

      return rows.map(row => {
        let body = row.body;
        if (!body && row.attributedBody) {
          body = extractTextFromAttributedBody(row.attributedBody);
        }
        return {
          id: row.id,
          body: body || '',
          handle: row.handle,
          chatId: null,
          timestamp: new Date((row.ts / 1e9 + MAC_EPOCH_OFFSET_SEC) * 1000).toISOString()
        };
      }).filter(r => r.body);
    } catch (err) {
      console.error('[iMessage] DB query error:', err.message);
      return [];
    } finally {
      db.close();
    }
  },

  // Sending still requires AppleScript
  sendMessage(handle, body) {
    return runAppleScript('send_message.applescript', [handle, body]);
  },

  // Get recent contacts from chat.db
  getRecentContacts() {
    let db;
    try {
      db = openMessagesDb();
    } catch (err) {
      console.error('[iMessage] Cannot open chat.db:', err.message);
      return [];
    }

    try {
      const rows = db.prepare(`
        SELECT DISTINCT h.id AS handle, '' AS name
        FROM handle h
        JOIN message m ON m.handle_id = h.rowid
        ORDER BY m.date DESC
        LIMIT 100
      `).all();

      db.close();
      return rows;
    } catch (err) {
      db.close();
      console.error('[iMessage] DB query error:', err.message);
      return [];
    }
  }
};
