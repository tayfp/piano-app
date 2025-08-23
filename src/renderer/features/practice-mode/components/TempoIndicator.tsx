/**
 * Tempo Indicator Component - Display current tempo with override status
 * 
 * Simple UI component that shows the current BPM being used for 
 * tempo-based cursor advancement with visual indication of manual overrides.
 * 
 * Features:
 * - Musical notation display (♩ = 120)
 * - Manual override indication
 * - Minimal UI footprint
 * - Real-time updates
 * - Accessible design
 */

import React, { useMemo } from 'react';
import { useTempoServices } from '../providers/TempoServicesProvider';

/**
 * Props for TempoIndicator component
 */
interface TempoIndicatorProps {
  /**
   * CSS class name for custom styling
   */
  className?: string;
  
  /**
   * Whether to show additional details (override status, source)
   * Default: true
   */
  showDetails?: boolean;
  
  /**
   * Size variant for different UI contexts
   * Default: 'normal'
   */
  size?: 'small' | 'normal' | 'large';
  
  /**
   * Optional click handler for tempo adjustment UI
   */
  onClick?: () => void;
}

/**
 * TempoIndicator - Displays current practice tempo
 * 
 * Shows the BPM being used for tempo-based cursor advancement with
 * clear indication of whether it's from automatic detection or manual override.
 * 
 * Usage:
 * ```tsx
 * <TempoIndicator />
 * <TempoIndicator size="small" showDetails={false} />
 * <TempoIndicator onClick={() => openTempoSettings()} />
 * ```
 */
export const TempoIndicator: React.FC<TempoIndicatorProps> = ({
  className = '',
  showDetails = true,
  size = 'normal',
  onClick
}) => {
  const { tempoService, isReady } = useTempoServices();

  // Get current tempo information
  const tempoInfo = useMemo(() => {
    if (!isReady || !tempoService) {
      return {
        bpm: 0,
        isOverridden: false,
        source: 'loading'
      };
    }

    const currentBpm = tempoService.getCurrentBpm();
    const overrideStatus = tempoService.getOverrideStatus();
    
    return {
      bpm: currentBpm,
      isOverridden: overrideStatus.isOverridden,
      source: overrideStatus.isOverridden ? 'manual' : 'auto'
    };
  }, [tempoService, isReady]);

  // Size-based styling classes
  const sizeClasses = {
    small: 'text-sm',
    normal: 'text-base',
    large: 'text-lg'
  };

  // Combine CSS classes
  const containerClasses = [
    'tempo-indicator',
    'inline-flex',
    'items-center',
    'gap-2',
    'px-2',
    'py-1',
    'rounded',
    'transition-colors',
    'duration-200',
    sizeClasses[size],
    onClick ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800' : '',
    className
  ].filter(Boolean).join(' ');

  // Loading state
  if (!isReady) {
    return (
      <div className={containerClasses}>
        <span className="text-gray-400 dark:text-gray-600">
          ♩ = --
        </span>
        {showDetails && (
          <span className="text-xs text-gray-400 dark:text-gray-600">
            Loading...
          </span>
        )}
      </div>
    );
  }

  return (
    <div 
      className={containerClasses}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      aria-label={`Current tempo: ${tempoInfo.bpm} BPM${tempoInfo.isOverridden ? ' (manual override)' : ''}`}
      title={`Tempo: ${tempoInfo.bpm} BPM (${tempoInfo.source === 'manual' ? 'Manual Override' : 'Auto-detected'})`}
    >
      {/* Main tempo display */}
      <span className={`font-mono ${tempoInfo.isOverridden ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'}`}>
        ♩ = {tempoInfo.bpm}
      </span>
      
      {/* Override indicator */}
      {showDetails && tempoInfo.isOverridden && (
        <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
          Manual
        </span>
      )}
      
      {/* Auto-detected indicator (optional) */}
      {showDetails && !tempoInfo.isOverridden && size !== 'small' && (
        <span className="text-xs text-gray-500 dark:text-gray-400">
          Auto
        </span>
      )}
      
      {/* Click hint for interactive mode */}
      {onClick && size !== 'small' && (
        <span className="text-xs text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
          Click to adjust
        </span>
      )}
    </div>
  );
};

/**
 * Compact tempo indicator for toolbar use
 * Pre-configured with small size and minimal details
 */
export const TempoIndicatorCompact: React.FC<{
  className?: string;
  onClick?: () => void;
}> = ({ className, onClick }) => (
  <TempoIndicator 
    size="small" 
    showDetails={false} 
    className={className}
    onClick={onClick}
  />
);

/**
 * Detailed tempo indicator for settings panels
 * Pre-configured with large size and full details
 */
export const TempoIndicatorDetailed: React.FC<{
  className?: string;
  onClick?: () => void;
}> = ({ className, onClick }) => (
  <TempoIndicator 
    size="large" 
    showDetails={true} 
    className={className}
    onClick={onClick}
  />
);

// Export default component
export default TempoIndicator;