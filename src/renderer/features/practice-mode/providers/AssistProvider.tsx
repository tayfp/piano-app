import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';
import { PracticeAssistService, createPracticeAssistService, type AssistMode, type AssistConfig } from '../services/PracticeAssistService';

interface AssistContextValue {
  assistService: PracticeAssistService;
  config: AssistConfig;
  setMode: (mode: AssistMode) => void;
  toggleHandDifferentiation: () => void;
  toggleFingering: () => void;
}

const AssistContext = createContext<AssistContextValue | null>(null);

interface AssistProviderProps {
  children: ReactNode;
}

export const AssistProvider: React.FC<AssistProviderProps> = ({ children }) => {
  const [config, setConfig] = useState<AssistConfig>({
    mode: 'practice',
    enableHandDifferentiation: true,
    enableFingering: false,
    enableTiming: false,
  });

  // Create unified service instance when config changes
  const assistService = useMemo(() => {
    const service = createPracticeAssistService(config.mode);
    service.updateConfig(config);
    return service;
  }, [config]);

  const setMode = (mode: AssistMode) => {
    setConfig(prev => ({ ...prev, mode }));
  };

  const toggleHandDifferentiation = () => {
    setConfig(prev => ({
      ...prev,
      enableHandDifferentiation: !prev.enableHandDifferentiation,
    }));
  };

  const toggleFingering = () => {
    setConfig(prev => ({
      ...prev,
      enableFingering: !prev.enableFingering,
    }));
  };

  const contextValue = useMemo(() => ({
    assistService,
    config,
    setMode,
    toggleHandDifferentiation,
    toggleFingering,
  }), [assistService, config]);

  return (
    <AssistContext.Provider value={contextValue}>
      {children}
    </AssistContext.Provider>
  );
};

export const useAssist = (): AssistContextValue => {
  const context = useContext(AssistContext);
  if (!context) {
    throw new Error('useAssist must be used within an AssistProvider');
  }
  return context;
};