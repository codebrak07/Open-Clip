import React, { useState } from 'react';

interface VectorSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobId?: string;
  onSelectTime: (startTime: number) => void;
}

export const VectorSearchModal: React.FC<VectorSearchModalProps> = ({
  isOpen,
  onClose,
  jobId,
  onSelectTime
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setSearching(true);
    try {
      const res = await fetch('/api/search/vector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: jobId || 'demo', query, limit: 6 })
      });
      const data = await res.json();
      setResults(data.results || []);
    } catch (err) {
      console.error('Vector search error', err);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
      <div className="bg-[#0D0F17] border border-[#23293D] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl space-y-4 p-6">
        <div className="flex items-center justify-between border-b border-[#1F2436] pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">⚡</span>
            <h3 className="text-lg font-bold text-white">Instant Vector AI Search</h3>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg font-mono px-2"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            placeholder="Type e.g. 'funny moments', 'startup advice', 'viral hook', 'arguments'..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-[#141824] border border-[#2A314A] rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-sm font-medium"
            autoFocus
          />
          <button
            type="submit"
            disabled={searching}
            className="absolute right-2 top-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-xs font-semibold"
          >
            {searching ? 'Searching...' : 'Search Vector DB'}
          </button>
        </form>

        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {results.length === 0 && !searching && (
            <div className="text-center text-gray-500 text-sm py-8">
              Search returns instant semantic video matches computed locally via vector similarity.
            </div>
          )}

          {results.map((res, idx) => (
            <div
              key={idx}
              onClick={() => {
                onSelectTime(res.chunk.startTime);
                onClose();
              }}
              className="bg-[#141824] hover:bg-[#1A2033] border border-[#23293D] hover:border-indigo-500/50 rounded-xl p-3 cursor-pointer transition-all flex items-center justify-between"
            >
              <div className="space-y-1 max-w-[80%]">
                <div className="flex items-center gap-2">
                  <span className="bg-indigo-950 text-indigo-300 text-[10px] font-mono border border-indigo-800 px-2 py-0.5 rounded">
                    Chunk #{res.chunk.chunkIndex} ({Math.round(res.chunk.startTime)}s - {Math.round(res.chunk.endTime)}s)
                  </span>
                  <span className="text-emerald-400 text-xs font-bold font-mono">
                    Match: {Math.round(res.score * 100)}%
                  </span>
                </div>
                <p className="text-xs text-gray-300 line-clamp-2">{res.chunk.text}</p>
              </div>
              <button className="bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600 hover:text-white px-3 py-1 rounded text-xs font-semibold">
                Jump To Time
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
