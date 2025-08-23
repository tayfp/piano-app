import React, { useEffect } from 'react';
import { useFingeringStore } from '@/renderer/features/fingering/hooks/useFingeringStore';
import { perfLogger } from '@/renderer/utils/performance-logger';
import { IS_DEVELOPMENT } from '@/renderer/utils/env';
import './FingeringEditIndicator.css';

export const FingeringEditIndicator: React.FC = () => {
  const { isEditingMode } = useFingeringStore();
  
  // DEBUG: Log when edit mode is active
  useEffect(() => {
    if (IS_DEVELOPMENT && isEditingMode) {
      perfLogger.debug('🎹 FINGERING DEBUG - Edit Mode Enabled!', {
        instructions: [
          'Look for blue notes when hovering (if data-note-id attributes were added)',
          'Click on any note to see debug output in console',
          'Check if notes have data-note-id attributes',
          'If no blue hover effect, notes are missing data-note-id'
        ]
      });
    }
  }, [isEditingMode]);
  
  if (!isEditingMode) return null;
  
  return (
    <div 
      className="fingering-edit-indicator"
      role="status"
      aria-live="polite"
      aria-label="Fingering edit mode is active"
    >
      <span className="edit-badge">Edit Mode</span>
      <span className="edit-hint">Click any note to add/edit fingering (1-5)</span>
    </div>
  );
};