'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

const CATEGORIES = [
  { id: 'greeting', label: 'Greetings', prompt: 'How do you typically start a text conversation? (e.g. "yo", "heyyy", "what\'s good")' },
  { id: 'humor', label: 'Humor', prompt: 'Give an example of something funny you\'d text a friend' },
  { id: 'plans', label: 'Making plans', prompt: 'How would you text someone to make plans? (e.g. "yo u free tmrw?")' },
  { id: 'reaction', label: 'Reactions', prompt: 'How do you react to surprising news over text?' },
  { id: 'farewell', label: 'Signing off', prompt: 'How do you end a text conversation?' },
  { id: 'agreement', label: 'Agreement', prompt: 'How do you say yes or agree over text?' },
  { id: 'disagreement', label: 'Pushback', prompt: 'How do you disagree or push back in a text?' },
  { id: 'filler', label: 'Random texts', prompt: 'Paste any random texts you\'d send to a friend — the more the better' },
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
        if (data.summary) {
          setPersona({
            ...data.summary,
            quirks: typeof data.summary.quirks === 'string' ? JSON.parse(data.summary.quirks) : data.summary.quirks,
            sample_phrases: typeof data.summary.sample_phrases === 'string' ? JSON.parse(data.summary.sample_phrases) : data.summary.sample_phrases,
          });
        }
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
    try {
      const res = await fetch('/api/warmup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'synthesize' })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Something went wrong generating your voice profile');
        return;
      }
      setPersona(data.persona);
    } catch (err) {
      console.error('Synthesize error:', err);
      alert('Failed to generate voice profile. Check the console for details.');
    } finally {
      setSynthesizing(false);
    }
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

        {CATEGORIES.map(cat => (
          <div key={cat.id} className="bg-gray-900 rounded-xl p-5 mb-4">
            <h3 className="font-semibold mb-1">{cat.label}</h3>
            <p className="text-gray-400 text-sm mb-3">{cat.prompt}</p>

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

        <div className="text-center text-gray-400 text-sm mb-6">
          {examples.length} examples added {examples.length < 5 ? `(need ${5 - examples.length} more to synthesize)` : '✓'}
        </div>

        <button
          onClick={synthesize}
          disabled={synthesizing || examples.length < 5}
          className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-xl py-4 font-semibold text-lg transition-colors"
        >
          {synthesizing ? 'Building your voice profile...' : 'Generate My Voice Profile'}
        </button>

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
                  <span key={i} className="bg-gray-800 rounded-lg px-2 py-1 text-xs">&quot;{p}&quot;</span>
                ))}
              </div>
            </div>

            <button
              onClick={() => router.push('/')}
              className="w-full mt-6 bg-white text-gray-900 rounded-xl py-3 font-semibold hover:bg-gray-100 transition-colors"
            >
              Done — Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
