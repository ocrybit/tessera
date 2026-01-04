import { useState, useEffect, useCallback } from "react";
import Head from "next/head";

export default function Home() {
  const [apiUrl, setApiUrl] = useState("");
  const [checkpoint, setCheckpoint] = useState(null);
  const [entries, setEntries] = useState([]);
  const [newEntry, setNewEntry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchCheckpoint = useCallback(async () => {
    if (!apiUrl) return;
    try {
      const res = await fetch(`${apiUrl}/checkpoint`);
      if (!res.ok) throw new Error("Failed to fetch checkpoint");
      const data = await res.json();
      setCheckpoint(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [apiUrl]);

  const fetchEntries = useCallback(async () => {
    if (!apiUrl || !checkpoint || checkpoint.size === 0) return;
    try {
      const res = await fetch(`${apiUrl}/tile/entries/000`);
      if (!res.ok) {
        setEntries([]);
        return;
      }
      const buffer = await res.arrayBuffer();
      const data = new Uint8Array(buffer);
      const parsed = parseEntryBundle(data);
      setEntries(parsed);
    } catch (err) {
      console.error("Failed to fetch entries:", err);
      setEntries([]);
    }
  }, [apiUrl, checkpoint]);

  useEffect(() => {
    if (apiUrl) {
      fetchCheckpoint();
    }
  }, [apiUrl, fetchCheckpoint]);

  useEffect(() => {
    fetchEntries();
  }, [checkpoint, fetchEntries]);

  const handleAddEntry = async (e) => {
    e.preventDefault();
    if (!apiUrl || !newEntry.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiUrl}/add`, {
        method: "POST",
        body: newEntry,
      });
      if (!res.ok) throw new Error("Failed to add entry");
      const data = await res.json();
      setNewEntry("");
      setCheckpoint({ size: data.size, root: data.root });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Tessera Explorer</title>
        <meta name="description" content="Transparency log explorer for Tessera" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 shadow">
          <div className="max-w-4xl mx-auto px-4 py-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Tessera Explorer
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Transparency Log Viewer
            </p>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 py-8">
          {/* API URL Input */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Tessera API URL
            </label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="http://localhost:8787"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Checkpoint Info */}
          {checkpoint && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Checkpoint
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Tree Size</p>
                  <p className="text-2xl font-mono font-bold text-gray-900 dark:text-white">
                    {checkpoint.size}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Root Hash</p>
                  <p className="text-sm font-mono text-gray-900 dark:text-white break-all">
                    {checkpoint.root || "empty"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Add Entry Form */}
          {apiUrl && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Add Entry
              </h2>
              <form onSubmit={handleAddEntry} className="flex gap-4">
                <input
                  type="text"
                  value={newEntry}
                  onChange={(e) => setNewEntry(e.target.value)}
                  placeholder="Enter data to add to the log..."
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={loading || !newEntry.trim()}
                  className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? "Adding..." : "Add"}
                </button>
              </form>
            </div>
          )}

          {/* Entries List */}
          {entries.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Entries ({entries.length})
              </h2>
              <div className="space-y-2">
                {entries.map((entry, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-4 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg"
                  >
                    <span className="text-sm font-mono text-gray-500 dark:text-gray-400 w-8">
                      #{idx}
                    </span>
                    <span className="text-sm font-mono text-gray-900 dark:text-white break-all">
                      {entry}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {apiUrl && checkpoint && checkpoint.size === 0 && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              <p>No entries yet. Add your first entry above!</p>
            </div>
          )}
        </main>

        <footer className="max-w-4xl mx-auto px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          <p>Tessera Transparency Log Explorer</p>
        </footer>
      </div>
    </>
  );
}

function parseEntryBundle(data) {
  const entries = [];
  let offset = 0;
  const decoder = new TextDecoder();

  while (offset < data.length) {
    if (offset + 2 > data.length) break;
    const len = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    if (offset + len > data.length) break;
    const entryData = data.slice(offset, offset + len);
    entries.push(decoder.decode(entryData));
    offset += len;
  }

  return entries;
}
