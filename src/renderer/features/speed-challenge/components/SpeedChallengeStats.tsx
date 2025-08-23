import React, { useEffect } from 'react';
import { useSpeedChallengeStatsStore } from '../stores/speedChallengeStatsStore';
import { useSpeedChallengeStore } from '../stores/speedChallengeStore';
import './SpeedChallengeStats.css';

export const SpeedChallengeStats: React.FC = () => {
  const {
    isOpen,
    isLoading,
    activeTab,
    closeStats,
    setActiveTab,
    loadStats,
    exportData,
    showClearConfirmation,
    setShowClearConfirmation,
    clearAllStats,
    isClearing,
    getDataStatistics,
    dataStatistics
  } = useSpeedChallengeStatsStore();
  
  const { isActive } = useSpeedChallengeStore();
  
  useEffect(() => {
    if (isOpen) {
      loadStats();
      if (activeTab === 'manage') {
        getDataStatistics();
      }
    }
  }, [isOpen, activeTab, loadStats, getDataStatistics]);
  
  if (!isOpen) return null;
  
  return (
    <div className="speed-challenge-stats-overlay">
      <div className="stats-modal">
        <header className="stats-header">
          <h2>Speed Challenge Statistics</h2>
          <button className="stats-close" onClick={closeStats} aria-label="Close statistics">✕</button>
        </header>
        
        <nav className="stats-tabs">
          <button 
            className={activeTab === 'overview' ? 'active' : ''}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button 
            className={activeTab === 'details' ? 'active' : ''}
            onClick={() => setActiveTab('details')}
          >
            Note Analysis
          </button>
          <button 
            className={activeTab === 'trends' ? 'active' : ''}
            onClick={() => setActiveTab('trends')}
          >
            Progress Trends
          </button>
          <button 
            className={activeTab === 'manage' ? 'active' : ''}
            onClick={() => setActiveTab('manage')}
          >
            Manage Data
          </button>
        </nav>
        
        <div className="stats-content">
          {isLoading ? (
            <div className="stats-loading">Loading statistics...</div>
          ) : (
            <>
              {activeTab === 'overview' && <OverviewTab />}
              {activeTab === 'details' && <NoteAnalysisTab />}
              {activeTab === 'trends' && <TrendsTab />}
              {activeTab === 'manage' && <ManageDataTab />}
            </>
          )}
        </div>
        
        {activeTab !== 'manage' && (
          <footer className="stats-footer">
            <button className="stats-export" onClick={exportData}>
              Export Data
            </button>
          </footer>
        )}
        
        {showClearConfirmation && (
          <ClearConfirmationDialog 
            onConfirm={clearAllStats}
            onCancel={() => setShowClearConfirmation(false)}
            isClearing={isClearing}
          />
        )}
      </div>
    </div>
  );
};

const OverviewTab: React.FC = () => {
  const { 
    allTimeSessions, 
    overallAccuracy, 
    fastestTime, 
    slowestTime, 
    totalPracticeTime,
    longestStreak 
  } = useSpeedChallengeStatsStore();
  
  const formatTime = (ms: number) => {
    if (!isFinite(ms) || ms === 0) return 'N/A';
    return `${(ms / 1000).toFixed(1)}s`;
  };
  
  const formatDuration = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };
  
  return (
    <div className="stats-overview">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">🎹</div>
          <div className="stat-value">{allTimeSessions}</div>
          <div className="stat-label">Total Sessions</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">⏱️</div>
          <div className="stat-value">{formatDuration(totalPracticeTime)}</div>
          <div className="stat-label">Practice Time</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🎯</div>
          <div className="stat-value">{Math.round(overallAccuracy * 100)}%</div>
          <div className="stat-label">Overall Accuracy</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">⚡</div>
          <div className="stat-value">{formatTime(fastestTime)}</div>
          <div className="stat-label">Fastest Time</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🐢</div>
          <div className="stat-value">{formatTime(slowestTime)}</div>
          <div className="stat-label">Slowest Time</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-icon">🔥</div>
          <div className="stat-value">{longestStreak}</div>
          <div className="stat-label">Longest Streak</div>
        </div>
      </div>
      
      <div className="stats-insights">
        <h3>💡 Insights</h3>
        <ul>
          {overallAccuracy > 0.9 && <li>🏆 Excellent accuracy! Consider increasing difficulty.</li>}
          {overallAccuracy < 0.7 && overallAccuracy > 0 && <li>💪 Keep practicing! Your accuracy will improve.</li>}
          {fastestTime < 1000 && fastestTime > 0 && <li>⚡ Lightning fast responses!</li>}
          {allTimeSessions > 10 && <li>🔥 Great consistency! Keep it up!</li>}
          {longestStreak >= 5 && <li>🎯 Nice streak! Consistency is key to improvement.</li>}
          {slowestTime > 3000 && <li>🎵 Some patterns took time - that's okay, accuracy matters!</li>}
        </ul>
      </div>
    </div>
  );
};

const NoteAnalysisTab: React.FC = () => {
  const { notePerformance } = useSpeedChallengeStatsStore();
  
  // Filter out notes with no attempts
  const validNotes = notePerformance.filter(n => n.attempts > 0);
  const worstNotes = validNotes.slice(0, 3);
  const bestNotes = [...validNotes].sort((a, b) => b.accuracy - a.accuracy).slice(0, 3);
  
  return (
    <div className="stats-note-analysis">
      <div className="note-performance-section">
        <h3>🎯 Note Recognition Performance</h3>
        
        {validNotes.length === 0 ? (
          <div className="no-data-message">
            No note data available yet. Complete some sessions to see your performance!
          </div>
        ) : (
          <>
            <div className="performance-lists">
              <div className="worst-notes">
                <h4>⚠️ Needs Practice</h4>
                {worstNotes.map(note => (
                  <div key={note.note} className="note-item poor">
                    <span className="note-name">{note.noteName}</span>
                    <span className="note-accuracy">{Math.round(note.accuracy)}%</span>
                    <div className="accuracy-bar">
                      <div 
                        className="accuracy-fill poor"
                        style={{ width: `${note.accuracy}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="best-notes">
                <h4>✨ Your Strengths</h4>
                {bestNotes.map(note => (
                  <div key={note.note} className="note-item good">
                    <span className="note-name">{note.noteName}</span>
                    <span className="note-accuracy">{Math.round(note.accuracy)}%</span>
                    <div className="accuracy-bar">
                      <div 
                        className="accuracy-fill good"
                        style={{ width: `${note.accuracy}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="all-notes-section">
              <h4>All Notes</h4>
              <div className="all-notes-grid">
                {validNotes.map(note => (
                  <div 
                    key={note.note} 
                    className={`note-badge ${note.accuracy > 80 ? 'good' : note.accuracy > 60 ? 'medium' : 'poor'}`}
                    title={`${note.attempts} attempts, ${(note.averageTime / 1000).toFixed(1)}s avg`}
                  >
                    <div className="note-badge-name">{note.noteName}</div>
                    <div className="note-badge-accuracy">{Math.round(note.accuracy)}%</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const TrendsTab: React.FC = () => {
  const { recentSessions } = useSpeedChallengeStatsStore();
  
  if (recentSessions.length === 0) {
    return (
      <div className="stats-trends">
        <h3>📈 Progress Trends</h3>
        <div className="no-data-message">
          No session data available yet. Complete some practice sessions to see your trends!
        </div>
      </div>
    );
  }
  
  // Calculate trend
  const calculateTrend = () => {
    if (recentSessions.length < 5) return null;
    
    const recent5 = recentSessions.slice(0, 5);
    const older5 = recentSessions.slice(5, 10);
    
    if (older5.length === 0) return null;
    
    const recentAvg = recent5.reduce((sum, s) => sum + s.accuracy, 0) / recent5.length;
    const olderAvg = older5.reduce((sum, s) => sum + s.accuracy, 0) / older5.length;
    
    return {
      improving: recentAvg > olderAvg,
      difference: Math.abs(recentAvg - olderAvg) * 100
    };
  };
  
  const trend = calculateTrend();
  
  return (
    <div className="stats-trends">
      <h3>📈 Progress Trends</h3>
      
      <div className="trend-summary">
        <p>Last {Math.min(30, recentSessions.length)} Sessions Performance</p>
        
        <div className="mini-chart">
          {recentSessions.slice(0, 30).reverse().map((session, index) => (
            <div 
              key={index}
              className="chart-bar"
              style={{ 
                height: `${session.accuracy * 100}%`,
                backgroundColor: session.accuracy > 0.8 ? '#10b981' : 
                               session.accuracy > 0.6 ? '#f59e0b' : '#ef4444'
              }}
              title={`Session ${index + 1}: ${Math.round(session.accuracy * 100)}%`}
            />
          ))}
        </div>
        
        <div className="trend-insights">
          {trend && (
            <>
              {trend.improving ? (
                <p className="trend-up">
                  📈 Improving! +{Math.round(trend.difference)}% in last 5 sessions
                </p>
              ) : (
                <p className="trend-down">
                  📉 Performance dip detected. Consider taking a break or slowing down.
                </p>
              )}
            </>
          )}
          
          {recentSessions.length >= 10 && (
            <p className="trend-info">
              Average accuracy over last 10 sessions: {Math.round(
                recentSessions.slice(0, 10).reduce((sum, s) => sum + s.accuracy, 0) / 10 * 100
              )}%
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const ManageDataTab: React.FC = () => {
  const { 
    dataStatistics, 
    getDataStatistics, 
    exportData,
    setShowClearConfirmation 
  } = useSpeedChallengeStatsStore();
  
  const { isActive } = useSpeedChallengeStore();
  
  useEffect(() => {
    getDataStatistics();
  }, [getDataStatistics]);
  
  const formatDate = (timestamp: number | null) => {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleDateString();
  };
  
  return (
    <div className="stats-manage">
      <div className="data-statistics">
        <h3>📊 Data Statistics</h3>
        {dataStatistics ? (
          <div className="stats-info-grid">
            <div className="info-item">
              <span className="info-label">Total Sessions:</span>
              <span className="info-value">{dataStatistics.sessionCount}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Pattern Records:</span>
              <span className="info-value">{dataStatistics.patternCount}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Oldest Session:</span>
              <span className="info-value">{formatDate(dataStatistics.oldestSession)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Newest Session:</span>
              <span className="info-value">{formatDate(dataStatistics.newestSession)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Estimated Size:</span>
              <span className="info-value">{dataStatistics.estimatedSizeKB} KB</span>
            </div>
          </div>
        ) : (
          <div className="loading-message">Loading data statistics...</div>
        )}
      </div>
      
      <div className="export-section">
        <h3>💾 Export Data</h3>
        <p>Export all your practice data to a JSON file for backup or analysis.</p>
        <button className="export-button" onClick={exportData}>
          Export All Data
        </button>
      </div>
      
      <div className="danger-zone">
        <h3>⚠️ Danger Zone</h3>
        <div className="danger-content">
          <p><strong>Clear All Statistics</strong></p>
          <p className="danger-warning">
            This will permanently delete all your practice history, session records, and note performance data. 
            This action cannot be undone.
          </p>
          {isActive && (
            <p className="active-session-warning">
              ⚠️ Cannot clear data while a session is active. Please end your current session first.
            </p>
          )}
          <button 
            className="clear-button" 
            onClick={() => setShowClearConfirmation(true)}
            disabled={isActive}
          >
            Clear All Data
          </button>
        </div>
      </div>
    </div>
  );
};

const ClearConfirmationDialog: React.FC<{
  onConfirm: () => void;
  onCancel: () => void;
  isClearing: boolean;
}> = ({ onConfirm, onCancel, isClearing }) => {
  return (
    <div className="confirmation-overlay">
      <div className="confirmation-dialog">
        <h3>⚠️ Confirm Data Deletion</h3>
        <p>
          Are you absolutely sure you want to delete all your Speed Challenge statistics?
        </p>
        <p className="confirmation-warning">
          This will permanently remove:
          • All session records
          • Note performance metrics
          • Practice history
          • Progress trends
        </p>
        <p className="confirmation-final">
          <strong>This action cannot be undone!</strong>
        </p>
        <div className="confirmation-buttons">
          <button 
            className="confirm-cancel" 
            onClick={onCancel}
            disabled={isClearing}
          >
            Cancel
          </button>
          <button 
            className="confirm-delete" 
            onClick={onConfirm}
            disabled={isClearing}
          >
            {isClearing ? 'Clearing...' : 'Yes, Delete Everything'}
          </button>
        </div>
      </div>
    </div>
  );
};