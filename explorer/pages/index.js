import { useState, useEffect, useCallback, useRef } from "react";
import Head from "next/head";

const DEFAULT_API_URL = "http://localhost:8787";
const ENTRIES_PER_PAGE = 20;
const POLL_INTERVAL = 2000;

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
  const [currentPage, setCurrentPage] = useState(0);
  const [newEntryIds, setNewEntryIds] = useState(new Set());
  const prevSizeRef = useRef(0);

  const fetchCheckpoint = useCallback(async () => {
    if (!apiUrl) return null;
    try {
      const res = await fetch(`${apiUrl}/checkpoint`);
      if (!res.ok) throw new Error("Failed to fetch checkpoint");
      const data = await res.json();
      setCheckpoint(data);
      setError(null);
      return data;
    } catch (err) {
      setError(err.message);
      setCheckpoint(null);
      return null;
    }
  }, [apiUrl]);

  const fetchEntries = useCallback(async (cp) => {
    if (!apiUrl || !cp || cp.size === 0) {
      setEntries([]);
      return;
    }
    try {
      const numBundles = Math.ceil(cp.size / 256);
      const allEntries = [];

      for (let i = 0; i < numBundles; i++) {
        const bundleIndex = i.toString().padStart(3, '0');
        const res = await fetch(`${apiUrl}/tile/entries/${bundleIndex}`);
        if (!res.ok) continue;
        const buffer = await res.arrayBuffer();
        const data = new Uint8Array(buffer);
        const parsed = parseEntryBundle(data, i * 256);
        allEntries.push(...parsed);
      }

      if (prevSizeRef.current > 0 && allEntries.length > prevSizeRef.current) {
        const newIds = new Set();
        for (let i = prevSizeRef.current; i < allEntries.length; i++) {
          newIds.add(i);
        }
        setNewEntryIds(newIds);
        setTimeout(() => setNewEntryIds(new Set()), 2000);
      }
      prevSizeRef.current = allEntries.length;

      setEntries(allEntries);
    } catch (err) {
      console.error("Failed to fetch entries:", err);
      setEntries([]);
    }
  }, [apiUrl]);

  useEffect(() => {
    fetchCheckpoint().then(cp => {
      if (cp) fetchEntries(cp);
    });
  }, [apiUrl]);

  useEffect(() => {
    if (!apiUrl) return;
    const pollInterval = setInterval(async () => {
      const cp = await fetchCheckpoint();
      if (cp && cp.size !== checkpoint?.size) {
        fetchEntries(cp);
      }
    }, POLL_INTERVAL);
    return () => clearInterval(pollInterval);
  }, [apiUrl, checkpoint?.size, fetchCheckpoint, fetchEntries]);

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
      const newCp = { size: data.size, root: data.root };
      setCheckpoint(newCp);
      fetchEntries(newCp);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleEntry = async (index) => {
    if (selectedEntry === index) {
      setSelectedEntry(null);
      setProof(null);
      setVerificationResult(null);
      return;
    }

    setSelectedEntry(index);
    setProof(null);
    setVerificationResult(null);

    try {
      // Fetch fresh checkpoint and proof together to ensure consistency
      const [cpRes, proofRes] = await Promise.all([
        fetch(`${apiUrl}/checkpoint`),
        fetch(`${apiUrl}/proof/${index}`)
      ]);

      if (!cpRes.ok || !proofRes.ok) {
        throw new Error("Failed to fetch proof");
      }

      const [freshCheckpoint, proofData] = await Promise.all([
        cpRes.json(),
        proofRes.json()
      ]);

      setCheckpoint(freshCheckpoint);
      setProof(proofData);

      // Verify immediately
      await verifyProofData(proofData, freshCheckpoint);
    } catch (err) {
      setError(err.message);
    }
  };

  const verifyProofData = async (proofData, cp) => {
    if (!proofData || !cp) return;
    setVerifying(true);
    try {
      // Ensure we're comparing at the same tree size
      if (proofData.size !== cp.size) {
        setVerificationResult({
          valid: false,
          error: `Size mismatch: proof is for size ${proofData.size}, checkpoint is for size ${cp.size}`
        });
        return;
      }

      const leafHash = hexToBytes(proofData.leafHash);
      let currentHash = leafHash;
      let idx = proofData.index;
      let size = proofData.size;
      let proofIdx = 0;

      while (size > 1) {
        const siblingIdx = idx ^ 1;

        if (siblingIdx < size && proofIdx < proofData.proof.length) {
          const sibling = hexToBytes(proofData.proof[proofIdx++]);
          if (idx % 2 === 0) {
            currentHash = await nodeHash(currentHash, sibling);
          } else {
            currentHash = await nodeHash(sibling, currentHash);
          }
        }
        idx = Math.floor(idx / 2);
        size = Math.ceil(size / 2);
      }

      const computedRoot = bytesToHex(currentHash);
      const isValid = computedRoot === cp.root;
      setVerificationResult({
        valid: isValid,
        computedRoot,
        expectedRoot: cp.root,
      });
    } catch (err) {
      setVerificationResult({ valid: false, error: err.message });
    } finally {
      setVerifying(false);
    }
  };

  const totalPages = Math.ceil(entries.length / ENTRIES_PER_PAGE);
  const paginatedEntries = entries
    .slice()
    .reverse()
    .slice(currentPage * ENTRIES_PER_PAGE, (currentPage + 1) * ENTRIES_PER_PAGE);

  return (
    <>
      <Head>
        <title>Tessera Explorer</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <style jsx global>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-10px); background-color: rgba(16, 185, 129, 0.2); }
          to { opacity: 1; transform: translateY(0); background-color: transparent; }
        }
        @keyframes expandIn {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 500px; }
        }
        .new-entry { animation: slideIn 0.4s ease-out; }
        .expand-in { animation: expandIn 0.3s ease-out; }
      `}</style>

      <div className="min-h-screen bg-slate-900 text-slate-100">
        {/* Header */}
        <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <span className="font-semibold">Tessera</span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-2"></span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                className="px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 w-56"
                placeholder="API URL"
              />
              <button
                onClick={() => fetchCheckpoint().then(cp => cp && fetchEntries(cp))}
                className="px-3 py-1.5 text-sm bg-slate-700 hover:bg-slate-600 rounded transition-colors"
              >
                Connect
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-6">
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Stats Row */}
          <div className="flex gap-4 mb-6">
            <div className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
              <div className="text-xs text-slate-500 mb-1">Entries</div>
              <div className="text-2xl font-bold font-mono">{checkpoint?.size ?? "—"}</div>
            </div>
            <div className="flex-[3] bg-slate-800/50 border border-slate-700/50 rounded-lg p-4">
              <div className="text-xs text-slate-500 mb-1">Root Hash</div>
              <div className="text-sm font-mono text-slate-300 truncate">{checkpoint?.root || "—"}</div>
            </div>
          </div>

          {/* Add Entry */}
          <form onSubmit={handleAddEntry} className="flex gap-2 mb-6">
            <input
              type="text"
              value={newEntry}
              onChange={(e) => setNewEntry(e.target.value)}
              placeholder="Enter data to add..."
              className="flex-1 px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={loading || !newEntry.trim()}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? "..." : "Add"}
            </button>
          </form>

          {/* Entries List */}
          <div className="bg-slate-800/30 border border-slate-700/50 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-400">Log Entries</span>
              {entries.length > 0 && (
                <span className="text-xs text-slate-500">
                  {currentPage * ENTRIES_PER_PAGE + 1}-{Math.min((currentPage + 1) * ENTRIES_PER_PAGE, entries.length)} of {entries.length}
                </span>
              )}
            </div>

            {entries.length > 0 ? (
              <div className="divide-y divide-slate-700/30">
                {paginatedEntries.map((entry) => {
                  const isNew = newEntryIds.has(entry.index);
                  const isSelected = selectedEntry === entry.index;

                  return (
                    <div key={entry.index} className={isNew ? 'new-entry' : ''}>
                      {/* Entry Row - 1 liner */}
                      <button
                        onClick={() => toggleEntry(entry.index)}
                        className={`w-full text-left px-4 py-3 flex items-center gap-4 hover:bg-slate-800/50 transition-colors ${
                          isSelected ? "bg-slate-800/70" : ""
                        }`}
                      >
                        <span className="text-xs font-mono text-emerald-400 w-10">#{entry.index}</span>
                        <span className="flex-1 font-mono text-sm truncate">{entry.content}</span>
                        <span className="text-xs text-slate-500">{entry.size}B</span>
                        <svg
                          className={`w-4 h-4 text-slate-500 transition-transform ${isSelected ? 'rotate-90' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>

                      {/* Expanded Proof Details */}
                      {isSelected && (
                        <div className="px-4 pb-4 expand-in">
                          <div className="ml-14 p-4 bg-slate-900/50 rounded-lg border border-slate-700/50 space-y-3">
                            {/* Verification Status */}
                            {verifying ? (
                              <div className="text-sm text-slate-400">Verifying...</div>
                            ) : verificationResult ? (
                              <div className={`flex items-center gap-2 ${
                                verificationResult.valid ? "text-emerald-400" : "text-red-400"
                              }`}>
                                {verificationResult.valid ? (
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                ) : (
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                )}
                                <span className="font-medium">
                                  {verificationResult.valid ? "Proof Valid" : "Proof Invalid"}
                                </span>
                                {verificationResult.error && (
                                  <span className="text-xs ml-2">({verificationResult.error})</span>
                                )}
                              </div>
                            ) : null}

                            {proof && (
                              <>
                                {/* Leaf Hash */}
                                <div>
                                  <div className="text-xs text-slate-500 mb-1">Leaf Hash</div>
                                  <div className="text-xs font-mono text-slate-400 break-all bg-slate-800/50 p-2 rounded">
                                    {proof.leafHash}
                                  </div>
                                </div>

                                {/* Proof Path */}
                                <div>
                                  <div className="text-xs text-slate-500 mb-1">
                                    Proof Path ({proof.proof.length} hashes at tree size {proof.size})
                                  </div>
                                  {proof.proof.length > 0 ? (
                                    <div className="space-y-1">
                                      {proof.proof.map((hash, i) => (
                                        <div key={i} className="text-xs font-mono text-slate-500 truncate">
                                          {i + 1}. {hash}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="text-xs text-slate-500">Single entry - no siblings needed</div>
                                  )}
                                </div>

                                {/* Root Comparison */}
                                {verificationResult && (
                                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-700/50">
                                    <div>
                                      <div className="text-xs text-slate-500 mb-1">Computed</div>
                                      <div className="text-xs font-mono text-slate-400 truncate">
                                        {verificationResult.computedRoot}
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-xs text-slate-500 mb-1">Expected</div>
                                      <div className="text-xs font-mono text-slate-400 truncate">
                                        {verificationResult.expectedRoot}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-12 text-center text-slate-500">No entries yet</div>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-slate-700/50 flex items-center justify-center gap-1">
                <button
                  onClick={() => setCurrentPage(0)}
                  disabled={currentPage === 0}
                  className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <span className="px-3 text-sm text-slate-400">
                  Page {currentPage + 1} of {totalPages}
                </span>

                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={currentPage === totalPages - 1}
                  className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                <button
                  onClick={() => setCurrentPage(totalPages - 1)}
                  disabled={currentPage === totalPages - 1}
                  className="p-1.5 text-slate-400 hover:text-white disabled:opacity-30"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}

function parseEntryBundle(data, startIndex) {
  const entries = [];
  let offset = 0;
  const decoder = new TextDecoder();

  while (offset < data.length) {
    if (offset + 2 > data.length) break;
    const len = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    if (offset + len > data.length) break;
    const entryData = data.slice(offset, offset + len);
    entries.push({
      index: startIndex + entries.length,
      content: decoder.decode(entryData),
      size: len,
    });
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
