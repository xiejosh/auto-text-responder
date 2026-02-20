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
        <p className="text-gray-400 mb-8">Auto-generated replies sent by the agent</p>

        {Object.keys(grouped).length === 0 ? (
          <p className="text-gray-500 text-center py-12">No replies sent yet</p>
        ) : (
          Object.entries(grouped).map(([handle, messages]) => (
            <div key={handle} className="mb-8">
              <h3 className="text-gray-400 text-sm font-medium mb-3 uppercase tracking-wider">{handle}</h3>
              <div className="space-y-2">
                {messages.slice(0, 20).map(msg => (
                  <div key={msg.id} className="bg-blue-600 rounded-2xl px-4 py-2 text-sm max-w-xs ml-auto">
                    <p>{msg.body}</p>
                    <p className="text-xs opacity-50 mt-1">
                      {new Date(msg.sent_at).toLocaleTimeString()}
                    </p>
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
