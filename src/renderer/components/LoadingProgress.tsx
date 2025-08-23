import React, { useEffect, useState } from 'react';
import { create } from 'zustand';

interface LoadingState {
  stage: 'idle' | 'loading-initial' | 'loading-complete' | 'ready';
  measuresLoaded: number;
  totalMeasures?: number;
  progress: number;
}

interface FileLoadingStore {
  currentJob: string | null;
  stage: LoadingState['stage'];
  setCurrentJob: (jobId: string | null) => void;
  setStage: (stage: LoadingState['stage']) => void;
}

// Create a simple store for file loading state
export const useFileLoadingStore = create<FileLoadingStore>((set) => ({
  currentJob: null,
  stage: 'idle',
  setCurrentJob: (jobId) => set({ currentJob: jobId }),
  setStage: (stage) => set({ stage })
}));

export const LoadingProgress: React.FC = () => {
  const { currentJob } = useFileLoadingStore();
  const [state, setState] = useState<LoadingState>({
    stage: 'idle',
    measuresLoaded: 0,
    progress: 0
  });
  
  useEffect(() => {
    if (!currentJob) {
      setState({ stage: 'idle', measuresLoaded: 0, progress: 0 });
      return;
    }
    
    const handleFirstRender = (event: CustomEvent) => {
      const data = event.detail;
      if (data.jobId === currentJob) {
        setState(prev => ({
          ...prev,
          stage: 'loading-initial',
          measuresLoaded: data.measureCount || 0,
          progress: 30 // Estimate 30% for first render
        }));
      }
    };
    
    const handleCompleteRender = (event: CustomEvent) => {
      const data = event.detail;
      if (data.jobId === currentJob) {
        setState({
          stage: 'ready',
          measuresLoaded: data.totalMeasures || 0,
          totalMeasures: data.totalMeasures,
          progress: 100
        });
        
        // Hide after a short delay
        setTimeout(() => {
          setState({ stage: 'idle', measuresLoaded: 0, progress: 0 });
          useFileLoadingStore.getState().setStage('idle');
        }, 1000);
      }
    };
    
    window.addEventListener('osmd:first-render', handleFirstRender as EventListener);
    window.addEventListener('osmd:complete-render', handleCompleteRender as EventListener);
    
    return () => {
      window.removeEventListener('osmd:first-render', handleFirstRender as EventListener);
      window.removeEventListener('osmd:complete-render', handleCompleteRender as EventListener);
    };
  }, [currentJob]);
  
  if (state.stage === 'idle' || state.stage === 'ready') {
    return null;
  }
  
  return (
    <div className="loading-progress" style={{
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(255, 255, 255, 0.95)',
      padding: '16px 24px',
      borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
      minWidth: '300px',
      zIndex: 1000
    }}>
      <div className="progress-bar" style={{
        width: '100%',
        height: '4px',
        background: '#e0e0e0',
        borderRadius: '2px',
        overflow: 'hidden',
        marginBottom: '8px'
      }}>
        <div 
          className="progress-fill"
          style={{ 
            width: `${state.progress}%`,
            height: '100%',
            background: '#4CAF50',
            transition: 'width 0.3s ease',
            borderRadius: '2px'
          }}
        />
      </div>
      <div className="progress-text" style={{
        fontSize: '14px',
        color: '#666',
        textAlign: 'center'
      }}>
        {state.stage === 'loading-initial' 
          ? `Loading preview... (${state.measuresLoaded} measures ready)`
          : `Loading complete score...`
        }
      </div>
    </div>
  );
};