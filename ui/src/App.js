"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = require("react");
const lucide_react_1 = require("lucide-react");
require("./index.css");
function App() {
    const [activeTab, setActiveTab] = (0, react_1.useState)('queue');
    // Queue State
    const [status, setStatus] = (0, react_1.useState)({ state: 'LOADING', stats: { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 } });
    // Knowledge State
    const [knowledgeStats, setKnowledgeStats] = (0, react_1.useState)({ totalChunks: 0, sources: { obsidian: 0, zotero: 0 } });
    const [sources, setSources] = (0, react_1.useState)([]);
    const [selectedSource, setSelectedSource] = (0, react_1.useState)(null);
    const [chunks, setChunks] = (0, react_1.useState)([]);
    // Polling for Queue Status
    (0, react_1.useEffect)(() => {
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
    // Fetch Knowledge Data
    (0, react_1.useEffect)(() => {
        if (activeTab === 'knowledge') {
            fetch('/api/knowledge/stats')
                .then(res => res.json())
                .then(setKnowledgeStats)
                .catch(console.error);
            fetch('/api/knowledge/sources')
                .then(res => res.json())
                .then(setSources)
                .catch(console.error);
        }
    }, [activeTab]);
    // Fetch Chunks when source selected
    (0, react_1.useEffect)(() => {
        if (selectedSource) {
            fetch(`/api/knowledge/chunks?path=${encodeURIComponent(selectedSource)}`)
                .then(res => res.json())
                .then(setChunks)
                .catch(console.error);
        }
        else {
            setChunks([]);
        }
    }, [selectedSource]);
    const controlQueue = (action) => {
        fetch(`/api/${action}`, { method: 'POST' }).catch(console.error);
    };
    return (<div className="app-container">
      <header className="header">
        <h1 className="title">OmniMind Control Panel</h1>
        <div className="status-badge" style={{ color: status.state === 'PAUSED' ? 'var(--status-paused)' : 'var(--status-running)' }}>
          <div className="status-indicator" style={{ background: status.state === 'PAUSED' ? 'var(--status-paused)' : 'var(--status-running)' }}/>
          {status.state}
        </div>
      </header>

      <div className="tabs">
        <button className={`tab ${activeTab === 'queue' ? 'active' : ''}`} onClick={() => setActiveTab('queue')}>
          Queue Dashboard
        </button>
        <button className={`tab ${activeTab === 'knowledge' ? 'active' : ''}`} onClick={() => setActiveTab('knowledge')}>
          Knowledge Base Browser
        </button>
      </div>

      {activeTab === 'queue' && (<div className="glass-panel">
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
              <lucide_react_1.Pause size={18}/> Pause Queue
            </button>
            <button className="btn btn-resume" onClick={() => controlQueue('resume')}>
              <lucide_react_1.Play size={18}/> Resume Queue
            </button>
            <button className="btn btn-retry" onClick={() => controlQueue('retry')}>
              <lucide_react_1.RotateCcw size={18}/> Retry Failed
            </button>
          </div>
        </div>)}

      {activeTab === 'knowledge' && (<>
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
                <lucide_react_1.Database size={18}/> Ingested Sources
              </div>
              <div className="source-items">
                {sources.map(source => (<div key={source.path} className={`source-item ${selectedSource === source.path ? 'active' : ''}`} onClick={() => setSelectedSource(source.path)}>
                    <div className="source-icon">
                      {source.source === 'obsidian' ? <lucide_react_1.FileText size={16}/> : <lucide_react_1.BookOpen size={16}/>}
                    </div>
                    <div className="source-content">
                      <div className="source-name" title={source.path}>
                        {source.path.split(/\\|\//).pop()}
                      </div>
                      <div className="source-type">{source.source}</div>
                    </div>
                  </div>))}
                {sources.length === 0 && (<div className="empty-state">
                    No sources ingested yet.
                  </div>)}
              </div>
            </div>

            <div className="chunks-view">
              {selectedSource ? (<>
                  <div className="chunks-header">
                    Text Chunks ({chunks.length})
                  </div>
                  <div className="chunks-list">
                    {chunks.map(chunk => (<div key={chunk.id} className="chunk-card">
                        <div className="chunk-id">ID: {chunk.id}</div>
                        <div className="chunk-text">{chunk.text}</div>
                      </div>))}
                  </div>
                </>) : (<div className="empty-state">
                  <lucide_react_1.Database className="empty-icon"/>
                  <h2>Select a source</h2>
                  <p>Click on an ingested source to view the exact text chunks that were stored in LanceDB.</p>
                </div>)}
            </div>
          </div>
        </>)}
    </div>);
}
exports.default = App;
//# sourceMappingURL=App.js.map