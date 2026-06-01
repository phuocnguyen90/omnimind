import { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Database, FileText, BookOpen, Settings } from 'lucide-react';
import './index.css';

function App() {
  const [activeTab, setActiveTab] = useState<'queue' | 'knowledge' | 'settings'>('queue');
  
  // Queue State
  const [status, setStatus] = useState({ state: 'LOADING', stats: { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 } });
  
  // Knowledge State
  const [knowledgeStats, setKnowledgeStats] = useState({ totalChunks: 0, sources: { obsidian: 0, zotero: 0 } });
  const [sources, setSources] = useState<any[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [chunks, setChunks] = useState<any[]>([]);
  
  // Settings State
  const [searchConfig, setSearchConfig] = useState({ algorithm: 'vector', mmrDiversity: 0.5 });
  const [saveStatus, setSaveStatus] = useState('');

  // Load Settings
  useEffect(() => {
    fetch('/api/config')
      .then(res => res.json())
      .then(setSearchConfig)
      .catch(console.error);
  }, []);

  const saveSettings = async (newConfig: any) => {
    setSearchConfig(newConfig);
    setSaveStatus('Saving...');
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (e) {
      setSaveStatus('Error saving');
    }
  };

  // Polling for Queue Status
  useEffect(() => {
    const fetchStatus = () => {
      fetch('/api/status')
        .then(res => res.json())
        .then(data => setStatus(data))
        .catch(console.error);
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Knowledge Data (Poll every 2s)
  useEffect(() => {
    if (activeTab === 'knowledge') {
      const fetchData = () => {
        fetch('/api/knowledge/stats')
          .then(res => res.json())
          .then(setKnowledgeStats)
          .catch(console.error);
          
        fetch('/api/knowledge/sources')
          .then(res => res.json())
          .then(setSources)
          .catch(console.error);
      };
      
      fetchData(); // Initial fetch
      const interval = setInterval(fetchData, 2000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  // Fetch Chunks when source selected
  useEffect(() => {
    if (selectedSource) {
      fetch(`/api/knowledge/chunks?path=${encodeURIComponent(selectedSource)}`)
        .then(res => res.json())
        .then(setChunks)
        .catch(console.error);
    } else {
      setChunks([]);
    }
  }, [selectedSource]);

  const controlQueue = (action: 'pause' | 'resume' | 'retry') => {
    fetch(`/api/${action}`, { method: 'POST' }).catch(console.error);
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1 className="title">OmniMind Control Panel</h1>
        <div className="status-badge" style={{ color: status.state === 'PAUSED' ? 'var(--status-paused)' : 'var(--status-running)' }}>
          <div className="status-indicator" style={{ background: status.state === 'PAUSED' ? 'var(--status-paused)' : 'var(--status-running)' }} />
          {status.state}
        </div>
      </header>

      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          Queue Dashboard
        </button>
        <button 
          className={`tab ${activeTab === 'knowledge' ? 'active' : ''}`}
          onClick={() => setActiveTab('knowledge')}
        >
          Knowledge Base Browser
        </button>
        <button 
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Search Settings
        </button>
      </div>

      {activeTab === 'queue' && (
        <div className="glass-panel">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">Total Jobs</div>
              <div className="stat-value">{status.stats.total}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Pending</div>
              <div className="stat-value" style={{ color: 'var(--status-pending)' }}>{status.stats.pending}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Processing</div>
              <div className="stat-value" style={{ color: 'var(--accent-primary)' }}>{status.stats.processing}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Completed</div>
              <div className="stat-value" style={{ color: 'var(--status-running)' }}>{status.stats.completed}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Failed</div>
              <div className="stat-value" style={{ color: 'var(--status-failed)' }}>{status.stats.failed}</div>
            </div>
          </div>

          <div className="btn-group">
            <button className="btn btn-pause" onClick={() => controlQueue('pause')}>
              <Pause size={18} /> Pause Queue
            </button>
            <button className="btn btn-resume" onClick={() => controlQueue('resume')}>
              <Play size={18} /> Resume Queue
            </button>
            <button className="btn btn-retry" onClick={() => controlQueue('retry')}>
              <RotateCcw size={18} /> Retry Failed
            </button>
          </div>
        </div>
      )}

      {activeTab === 'knowledge' && (
        <>
          <div className="glass-panel" style={{ marginBottom: '20px', padding: '20px' }}>
             <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="stat-card">
                  <div className="stat-label">Total Vector Chunks</div>
                  <div className="stat-value">{knowledgeStats.totalChunks}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Obsidian Notes</div>
                  <div className="stat-value" style={{ color: 'var(--accent-secondary)' }}>{knowledgeStats.sources.obsidian}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Zotero Papers</div>
                  <div className="stat-value" style={{ color: 'var(--status-failed)' }}>{knowledgeStats.sources.zotero}</div>
                </div>
             </div>
          </div>

          <div className="split-layout">
            <div className="source-list">
              <div className="source-header">
                <Database size={18} /> Ingested Sources
              </div>
              <div className="source-items">
                {sources.map(source => (
                  <div 
                    key={source.path} 
                    className={`source-item ${selectedSource === source.path ? 'active' : ''}`}
                    onClick={() => setSelectedSource(source.path)}
                  >
                    <div className="source-icon">
                      {source.source === 'obsidian' ? <FileText size={16} /> : <BookOpen size={16} />}
                    </div>
                    <div className="source-content">
                      <div className="source-name" title={source.path}>
                        {source.path.split(/\\|\//).pop()}
                      </div>
                      <div className="source-type">{source.source}</div>
                    </div>
                  </div>
                ))}
                {sources.length === 0 && (
                  <div className="empty-state">
                    No sources ingested yet.
                  </div>
                )}
              </div>
            </div>

            <div className="chunks-view">
              {selectedSource ? (
                <>
                  <div className="chunks-header">
                    Text Chunks ({chunks.length})
                  </div>
                  <div className="chunks-list">
                    {chunks.map(chunk => (
                      <div key={chunk.id} className="chunk-card">
                        <div className="chunk-id">ID: {chunk.id}</div>
                        <div className="chunk-text">{chunk.text}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <Database className="empty-icon" />
                  <h2>Select a source</h2>
                  <p>Click on an ingested source to view the exact text chunks that were stored in LanceDB.</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === 'settings' && (
        <div className="glass-panel" style={{ padding: '30px', maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
            <Settings size={24} style={{ marginRight: '10px' }} />
            <h2 style={{ margin: 0 }}>Advanced Search Algorithm</h2>
          </div>
          
          <p style={{ color: 'var(--text-secondary)', marginBottom: '30px', lineHeight: '1.6' }}>
            Configure how the LLM Agent retrieves documents from LanceDB. These settings are applied dynamically in real-time.
          </p>

          <div style={{ marginBottom: '30px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '10px' }}>Search Engine Backend</label>
            <select 
              value={searchConfig.algorithm}
              onChange={(e) => saveSettings({ ...searchConfig, algorithm: e.target.value })}
              style={{ width: '100%', padding: '12px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', outline: 'none' }}
            >
              <option value="vector" style={{ background: '#1e1e2e', color: 'white' }}>Standard Vector Similarity (Default)</option>
              <option value="bm25" style={{ background: '#1e1e2e', color: 'white' }}>BM25 Full-Text Keyword Search (Tantivy)</option>
              <option value="hybrid" style={{ background: '#1e1e2e', color: 'white' }}>Hybrid Search (Vector + BM25 with Reciprocal Rank Fusion)</option>
              <option value="mmr" style={{ background: '#1e1e2e', color: 'white' }}>Maximal Marginal Relevance (Vector with Diversity Penalty)</option>
            </select>
            
            <div style={{ marginTop: '15px', padding: '15px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '0.9em', color: 'var(--text-secondary)' }}>
              {searchConfig.algorithm === 'vector' && "Uses standard Cosine Similarity. Best for conceptual understanding."}
              {searchConfig.algorithm === 'bm25' && "Uses exact keyword matching. Best for finding specific names, IDs, or exact phrases."}
              {searchConfig.algorithm === 'hybrid' && "Queries both Vector and BM25 simultaneously, merging the results for the highest accuracy."}
              {searchConfig.algorithm === 'mmr' && "Optimizes for diversity. Fetches more documents and re-ranks them to minimize redundant information."}
            </div>
          </div>

          {searchConfig.algorithm === 'mmr' && (
            <div style={{ marginBottom: '30px', padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                <label style={{ fontWeight: 'bold' }}>MMR Diversity Factor</label>
                <span style={{ fontWeight: 'bold', color: 'var(--accent-primary)' }}>{searchConfig.mmrDiversity.toFixed(2)}</span>
              </div>
              <input 
                type="range" 
                min="0" max="1" step="0.05"
                value={searchConfig.mmrDiversity}
                onChange={(e) => saveSettings({ ...searchConfig, mmrDiversity: parseFloat(e.target.value) })}
                style={{ width: '100%', cursor: 'pointer' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '0.8em', color: 'var(--text-secondary)' }}>
                <span>0.0 (Pure Relevance)</span>
                <span>1.0 (Pure Diversity)</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: '40px' }}>
            {saveStatus && <span style={{ color: 'var(--status-running)', marginRight: '15px', fontWeight: 'bold' }}>{saveStatus}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
