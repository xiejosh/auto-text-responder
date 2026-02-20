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
          m.guid       AS id,
          m.text       AS body,
          h.id         AS handle,
          m.date       AS ts
        FROM message m
        JOIN handle h ON m.handle_id = h.rowid
        WHERE m.is_from_me = 0
          AND m.text IS NOT NULL
          AND m.text != ''
          AND m.date > ?
        ORDER BY m.date ASC
      `).all(cutoffMac);

      return rows.map(row => ({
        id: row.id,
        body: row.body,
        handle: row.handle,
        chatId: null,
        timestamp: new Date((row.ts / 1e9 + MAC_EPOCH_OFFSET_SEC) * 1000).toISOString()
      }));
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
