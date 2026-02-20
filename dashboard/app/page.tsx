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

  const [toggling, setToggling] = useState(false);

  const toggleAgent = async () => {
    if (toggling) return;
    setToggling(true);
    const newVal = settings.agent_enabled === '1' ? '0' : '1';
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_enabled: newVal })
      });
      if (res.ok) {
        setSettings(prev => ({ ...prev, agent_enabled: newVal }));
      }
    } finally {
      setToggling(false);
    }
  };

  const isEnabled = settings.agent_enabled === '1';
  const warmupComplete = settings.warmup_complete === '1';
  const toggleDisabled = toggling || !warmupComplete;

  if (loading) return <div className="p-8 text-gray-400">Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">iMessage Agent</h1>
        <p className="text-gray-400 mb-8">AI auto-responder for your iMessages</p>

        <div className="bg-gray-900 rounded-2xl p-6 mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Agent Status</h2>
            <p className="text-gray-400 text-sm mt-1">
              {isEnabled ? 'Auto-responding to allowlisted contacts' : 'Agent is paused'}
            </p>
          </div>
          <button
            onClick={toggleAgent}
            disabled={toggleDisabled}
            className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${
              isEnabled ? 'bg-green-500' : 'bg-gray-600'
            } ${toggleDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform duration-200 ${
              isEnabled ? 'translate-x-7' : 'translate-x-0'
            }`} />
          </button>
        </div>

        {!warmupComplete && (
          <div className="bg-yellow-900/30 border border-yellow-700 rounded-xl p-4 mb-6">
            <p className="text-yellow-400 text-sm">
              Complete the voice warmup before enabling the agent.{' '}
              <Link href="/warmup" className="underline">Do it now</Link>
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4">
          <Link href="/warmup" className="bg-gray-900 hover:bg-gray-800 rounded-xl p-5 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">Voice Warmup</h3>
                <p className="text-gray-400 text-sm mt-1">
                  {warmupComplete ? 'Persona trained — click to update' : 'Train the bot to sound like you'}
                </p>
              </div>
              <span className="text-2xl">{warmupComplete ? '✓' : '⏳'}</span>
            </div>
          </Link>

          <Link href="/contacts" className="bg-gray-900 hover:bg-gray-800 rounded-xl p-5 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">Contact Allowlist</h3>
                <p className="text-gray-400 text-sm mt-1">Choose who the agent responds to</p>
              </div>
              <span className="text-gray-400">→</span>
            </div>
          </Link>

          <Link href="/logs" className="bg-gray-900 hover:bg-gray-800 rounded-xl p-5 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">Message Logs</h3>
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
