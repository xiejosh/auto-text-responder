'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

type Contact = {
  id: number;
  phone_or_handle: string;
  display_name: string;
  auto_reply: number;
  mode: string;
};

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newHandle, setNewHandle] = useState('');
  const [newName, setNewName] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/contacts')
      .then(r => r.json())
      .then(setContacts);
  }, []);

  const addContact = async () => {
    if (!newHandle.trim()) return;
    await fetch('/api/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone_or_handle: newHandle.trim(),
        display_name: newName.trim() || newHandle.trim(),
        auto_reply: 1,
        mode: 'always'
      })
    });
    setContacts(prev => [...prev, {
      id: Date.now(),
      phone_or_handle: newHandle.trim(),
      display_name: newName.trim() || newHandle.trim(),
      auto_reply: 1,
      mode: 'always'
    }]);
    setNewHandle('');
    setNewName('');
  };

  const [togglingId, setTogglingId] = useState<number | null>(null);

  const toggleContact = async (contact: Contact) => {
    if (togglingId !== null) return;
    setTogglingId(contact.id);
    const updated = { ...contact, auto_reply: contact.auto_reply === 1 ? 0 : 1 };
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      if (res.ok) {
        setContacts(prev => prev.map(c => c.id === contact.id ? updated : c));
      }
    } finally {
      setTogglingId(null);
    }
  };

  const removeContact = async (contact: Contact) => {
    await fetch('/api/contacts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone_or_handle: contact.phone_or_handle })
    });
    setContacts(prev => prev.filter(c => c.id !== contact.id));
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-2xl mx-auto">
        <button onClick={() => router.push('/')} className="text-gray-400 text-sm mb-6 hover:text-white">← Back</button>
        <h1 className="text-3xl font-bold mb-2">Contact Allowlist</h1>
        <p className="text-gray-400 mb-8">
          The agent only auto-responds to contacts in this list. Everyone else is ignored.
        </p>

        <div className="bg-gray-900 rounded-xl p-5 mb-6">
          <h3 className="font-semibold mb-3">Add Contact</h3>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={newHandle}
              onChange={e => setNewHandle(e.target.value)}
              placeholder="+1234567890 or email@icloud.com"
              className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Display name (optional)"
              className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={addContact}
              className="bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-2 text-sm font-medium"
            >
              Add
            </button>
          </div>
          <p className="text-gray-500 text-xs mt-2">
            Use the phone number or iMessage handle exactly as it appears in Messages.app
          </p>
        </div>

        {contacts.length === 0 ? (
          <p className="text-gray-500 text-center py-12">No contacts added yet</p>
        ) : (
          <div className="space-y-3">
            {contacts.map(contact => (
              <div key={contact.id} className="bg-gray-900 rounded-xl p-4 flex items-center gap-4">
                <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center text-lg font-semibold">
                  {contact.display_name?.[0]?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{contact.display_name}</p>
                  <p className="text-gray-400 text-xs truncate">{contact.phone_or_handle}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleContact(contact)}
                    disabled={togglingId !== null}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                      contact.auto_reply === 1 ? 'bg-green-500' : 'bg-gray-600'
                    } ${togglingId !== null ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${
                      contact.auto_reply === 1 ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                  <button
                    onClick={() => removeContact(contact)}
                    className="text-gray-500 hover:text-red-400 text-xl font-light"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
