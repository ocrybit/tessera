import { useState, useEffect, useCallback } from "react";
import Head from "next/head";

const DEFAULT_API_URL = "http://localhost:8787";

export default function Home() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL);
  const [checkpoint, setCheckpoint] = useState(null);
  const [entries, setEntries] = useState([]);
  const [newEntry, setNewEntry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [proof, setProof] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState(null);

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
      setCheckpoint(null);
    }
  }, [apiUrl]);

  const fetchEntries = useCallback(async () => {
    if (!apiUrl || !checkpoint || checkpoint.size === 0) {
      setEntries([]);
      return;
    }
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
    fetchCheckpoint();
  }, [fetchCheckpoint]);

  useEffect(() => {
    fetchEntries();
  }, [checkpoint, fetchEntries]);

  const handleAddEntry = async (e) => {
    e.preventDefault();
    if (!apiUrl || !newEntry.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiUrl}/add`, {
        method: "POST",
        body: newEntry,
      });
      if (!res.ok) throw new Error("Failed to add entry");
      const data = await res.json();
      setNewEntry("");
      setCheckpoint({ size: data.size, root: data.root });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchProof = async (index) => {
    setSelectedEntry(index);
    setProof(null);
    setVerificationResult(null);
    try {
      const res = await fetch(`${apiUrl}/proof/${index}`);
      if (!res.ok) throw new Error("Failed to fetch proof");
      const data = await res.json();
      setProof(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const verifyProof = async () => {
    if (!proof || !checkpoint) return;
    setVerifying(true);
    try {
      const leafHash = hexToBytes(proof.leafHash);
      let currentHash = leafHash;
      let idx = proof.index;

      for (const siblingHex of proof.proof) {
        const sibling = hexToBytes(siblingHex);
        if (idx % 2 === 0) {
          currentHash = await nodeHash(currentHash, sibling);
        } else {
          currentHash = await nodeHash(sibling, currentHash);
        }
        idx = Math.floor(idx / 2);
      }

      const computedRoot = bytesToHex(currentHash);
      const isValid = computedRoot === checkpoint.root;
      setVerificationResult({
        valid: isValid,
        computedRoot,
        expectedRoot: checkpoint.root,
      });
    } catch (err) {
      setVerificationResult({ valid: false, error: err.message });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <Head>
        <title>Tessera Explorer</title>
        <meta name="description" content="Transparency log explorer" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        {/* Header */}
        <header className="border-b border-slate-700/50 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-6xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-white">Tessera Explorer</h1>
                  <p className="text-xs text-slate-400">Transparency Log Viewer</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded-lg text-slate-200 focus:ring-2 focus:ring-emerald-500 focus:border-transparent w-64"
                  placeholder="API URL"
                />
                <button
                  onClick={fetchCheckpoint}
                  className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  Connect
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-4 py-8">
          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <span className="text-slate-400 text-sm">Total Entries</span>
              </div>
              <p className="text-3xl font-bold text-white font-mono">
                {checkpoint?.size ?? "—"}
              </p>
            </div>

            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6 md:col-span-2">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <span className="text-slate-400 text-sm">Root Hash</span>
              </div>
              <p className="text-sm font-mono text-white break-all">
                {checkpoint?.root || "No entries yet"}
              </p>
            </div>
          </div>

          {/* Add Entry */}
          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Entry
            </h2>
            <form onSubmit={handleAddEntry} className="flex gap-3">
              <input
                type="text"
                value={newEntry}
                onChange={(e) => setNewEntry(e.target.value)}
                placeholder="Enter data to add to the log..."
                className="flex-1 px-4 py-3 bg-slate-900/50 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={loading || !newEntry.trim()}
                className="px-6 py-3 bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-medium rounded-xl hover:from-emerald-600 hover:to-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-emerald-500/25"
              >
                {loading ? "Adding..." : "Add Entry"}
              </button>
            </form>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Entries List */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Log Entries
              </h2>
              {entries.length > 0 ? (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {entries.map((entry, idx) => (
                    <button
                      key={idx}
                      onClick={() => fetchProof(idx)}
                      className={`w-full text-left p-3 rounded-lg transition-all ${
                        selectedEntry === idx
                          ? "bg-emerald-500/20 border border-emerald-500/30"
                          : "bg-slate-900/50 border border-slate-700/50 hover:border-slate-600"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-slate-500 w-8">#{idx}</span>
                        <span className="text-sm font-mono text-slate-200 truncate">{entry}</span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-500">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p>No entries yet</p>
                </div>
              )}
            </div>

            {/* Proof Verification */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Inclusion Proof
              </h2>

              {proof ? (
                <div className="space-y-4">
                  <div className="p-3 bg-slate-900/50 rounded-lg">
                    <p className="text-xs text-slate-500 mb-1">Entry #{proof.index}</p>
                    <p className="text-xs font-mono text-slate-300 break-all">{proof.leafHash}</p>
                  </div>

                  <div className="p-3 bg-slate-900/50 rounded-lg">
                    <p className="text-xs text-slate-500 mb-2">Proof Path ({proof.proof.length} hashes)</p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {proof.proof.map((hash, i) => (
                        <p key={i} className="text-xs font-mono text-slate-400 truncate">{hash}</p>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={verifyProof}
                    disabled={verifying}
                    className="w-full px-4 py-2 bg-amber-500/20 border border-amber-500/30 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                  >
                    {verifying ? "Verifying..." : "Verify Proof"}
                  </button>

                  {verificationResult && (
                    <div className={`p-4 rounded-lg ${
                      verificationResult.valid
                        ? "bg-emerald-500/20 border border-emerald-500/30"
                        : "bg-red-500/20 border border-red-500/30"
                    }`}>
                      <div className="flex items-center gap-2 mb-2">
                        {verificationResult.valid ? (
                          <>
                            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="font-medium text-emerald-400">Proof Valid</span>
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="font-medium text-red-400">Proof Invalid</span>
                          </>
                        )}
                      </div>
                      {verificationResult.error && (
                        <p className="text-xs text-red-400">{verificationResult.error}</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-500">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                  <p>Select an entry to view its proof</p>
                </div>
              )}
            </div>
          </div>
        </main>

        <footer className="border-t border-slate-700/50 mt-12">
          <div className="max-w-6xl mx-auto px-4 py-6 text-center text-sm text-slate-500">
            Tessera Transparency Log Explorer
          </div>
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

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function nodeHash(left, right) {
  const prefixed = new Uint8Array(65);
  prefixed[0] = 0x01;
  prefixed.set(left, 1);
  prefixed.set(right, 33);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", prefixed));
}
