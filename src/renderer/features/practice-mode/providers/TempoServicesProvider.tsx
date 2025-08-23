/**
 * Tempo Services Provider - React Context for Service Lifecycle Management
 * 
 * Provides centralized access to TempoService and WebAudioScheduler
 * with proper lifecycle management and cleanup.
 * 
 * Key features:
 * - Single service instances per provider scope
 * - Automatic cleanup on unmount
 * - Integration with useOSMDStore for tempo data
 * - Error boundary protection
 * - Performance monitoring
 */

import React, { createContext, useContext, useMemo, useEffect, useRef, useState } from 'react';
import { TempoServiceImpl } from '../services/TempoService';
import { WebAudioScheduler } from '../services/WebAudioScheduler';
import { useOSMDStore } from '@/renderer/stores/osmdStore';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { logger } from '@/renderer/utils/simple-logger';

// Type definitions for tempo services context
interface TempoServicesContextType {
  tempoService: TempoServiceImpl;
  scheduler: WebAudioScheduler;
  isReady: boolean;
}

// Create React context for tempo services
const TempoServicesContext = createContext<TempoServicesContextType | null>(null);

/**
 * Props for TempoServicesProvider
 */
interface TempoServicesProviderProps {
  children: React.ReactNode;
  /**
   * Optional configuration for WebAudioScheduler
   * Allows customization of look-ahead timing and fallback behavior
   */
  schedulerConfig?: {
    lookAheadTimeMs?: number;
    fallbackMode?: 'setTimeout' | 'auto';
    maxRetries?: number;
  };
}

/**
 * TempoServicesProvider - Context provider for tempo-aware cursor advancement services
 * 
 * This provider creates and manages the lifecycle of TempoService and WebAudioScheduler
 * instances, ensuring they are properly initialized and cleaned up.
 * 
 * Usage:
 * ```tsx
 * <TempoServicesProvider>
 *   <PracticeMode />
 * </TempoServicesProvider>
 * ```
 */
export const TempoServicesProvider: React.FC<TempoServicesProviderProps> = React.memo(({ 
  children, 
  schedulerConfig = {}
}) => {
  // Track initialization state
  const [isReady, setIsReady] = useState(false);
  const initializationRef = useRef<boolean>(false);
  const cleanupRef = useRef<(() => void)[]>([]);

  // Create service instances with useMemo to prevent recreation on re-renders
  // This is critical for performance and prevents memory leaks
  const services = useMemo(() => {
    // Creating service instances
    
    // Create TempoService instance with getter for OSMD store
    // Using getter pattern to avoid subscribing to store changes at component level
    const tempoService = new TempoServiceImpl(() => useOSMDStore.getState());
    
    // Create WebAudioScheduler with optional configuration
    const scheduler = new WebAudioScheduler(schedulerConfig);
    
    // Register cleanup for scheduler (prevents memory leaks)
    const cleanup = () => {
      // Cleaning up services
      scheduler.cleanup();
    };
    
    // Clear accumulated functions to prevent duplicates in dev mode
    cleanupRef.current = [];
    cleanupRef.current.push(cleanup);
    
    return {
      tempoService,
      scheduler
    };
  }, [schedulerConfig]); // Dependencies for service recreation - osmdStore removed to prevent recreations

  // Initialize services when provider mounts
  useEffect(() => {
    const initializeServices = async () => {
      if (initializationRef.current) {
        return; // Already initialized
      }

      // Close race window immediately by marking as initialized before await
      initializationRef.current = true;

      try {
        // Initializing services
        
        // Initialize WebAudioScheduler session
        await services.scheduler.startSession();
        
        // Update ready state (triggers re-render to provide ready services)
        setIsReady(true);
        
        logger.system('[TEMPO] Services ready');
        
      } catch (error) {
        // Reset flag on error to allow retry
        initializationRef.current = false;
        
        perfLogger.error('TempoServicesProvider: Service initialization failed:', error as Error);
        // Services will still be available but may use fallback modes
        setIsReady(true); // Mark as ready even with errors (fallback handling)
      }
    };

    initializeServices();

    // Cleanup function for useEffect
    return () => {
      // Cleaning up on unmount
      
      // Execute all registered cleanup functions
      cleanupRef.current.forEach(cleanup => {
        try {
          cleanup();
        } catch (error) {
          perfLogger.warn('TempoServicesProvider: Cleanup function failed:', error);
        }
      });
      
      cleanupRef.current = [];
      initializationRef.current = false;
    };
  }, []); // Services never change after initial creation

  // Create properly reactive context value
  const contextValue = useMemo(() => ({
    tempoService: services.tempoService,
    scheduler: services.scheduler,
    isReady
  }), [services, isReady]);

  return (
    <TempoServicesContext.Provider value={contextValue}>
      {children}
    </TempoServicesContext.Provider>
  );
});

/**
 * Hook to access tempo services from context
 * 
 * Must be used within a TempoServicesProvider or will throw an error.
 * This enforces proper provider setup and prevents runtime errors.
 * 
 * @returns Object containing tempoService, scheduler, and isReady flag
 * @throws Error if used outside TempoServicesProvider
 */
export const useTempoServices = (): TempoServicesContextType => {
  const context = useContext(TempoServicesContext);
  
  if (!context) {
    throw new Error(
      'useTempoServices must be used within a TempoServicesProvider. ' +
      'Make sure to wrap your component tree with <TempoServicesProvider>'
    );
  }
  
  return context;
};

/**
 * Hook for conditional tempo services access
 * Returns null if not within provider context (useful for optional features)
 * 
 * @returns TempoServicesContextType or null if not in provider
 */
export const useTempoServicesOptional = (): TempoServicesContextType | null => {
  return useContext(TempoServicesContext);
};

/**
 * Higher-order component to wrap components with TempoServicesProvider
 * Useful for testing or when you need to ensure services are available
 * 
 * @param Component Component to wrap
 * @param providerProps Optional provider configuration
 * @returns Wrapped component with TempoServicesProvider
 */
export const withTempoServices = <P extends object>(
  Component: React.ComponentType<P>,
  providerProps?: Partial<TempoServicesProviderProps>
) => {
  const WrappedComponent: React.FC<P> = (props) => (
    <TempoServicesProvider {...providerProps}>
      <Component {...props} />
    </TempoServicesProvider>
  );
  
  WrappedComponent.displayName = `withTempoServices(${Component.displayName || Component.name})`;
  
  return WrappedComponent;
};

// Export context for advanced use cases (testing, etc.)
export { TempoServicesContext };