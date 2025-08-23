/**
 * Keyboard Shortcuts Hook
 * 
 * Manages keyboard shortcuts for practice mode with accessibility support.
 * Provides customizable shortcuts and screen reader announcements.
 */

import { useEffect, useCallback, useRef, useState } from 'react';
import { usePracticeStore } from '../stores/practiceStore';
import { usePracticeController } from './';
import { announceToScreenReader } from '@/renderer/utils/accessibility';

interface ShortcutConfig {
  key: string;
  modifiers: ('ctrl' | 'alt' | 'shift' | 'meta')[];
}

interface CustomShortcuts {
  [action: string]: ShortcutConfig;
}

interface UseKeyboardShortcutsOptions {
  customShortcuts?: CustomShortcuts;
}

interface KeyboardHelp {
  global: Array<{ keys: string[]; description: string }>;
  practiceMode: Array<{ keys: string[]; description: string }>;
  navigation: Array<{ keys: string[]; description: string }>;
}

export function useKeyboardShortcuts(options?: UseKeyboardShortcutsOptions) {
  const {
    isActive,
    togglePractice,
    resetCurrentStep,
    skipCurrentStep,
    previousStep,
    showHint,
    togglePause,
    showKeyboardHelp,
    keyboardShortcutsEnabled = true
  } = usePracticeStore();

  // V2 controller integration for repeat feature
  const controller = usePracticeController();
  const toggleRepeat = controller?.toggleRepeat;
  const repeatActive = controller?.repeatActive || false;
  const practiceStatus = controller?.practiceState?.status || controller?.state?.status;

  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Default shortcuts
  const defaultShortcuts = useRef<CustomShortcuts>({
    togglePractice: { key: 'p', modifiers: ['ctrl'] },
    resetCurrentStep: { key: 'r', modifiers: ['ctrl'] },
    showHint: { key: 'h', modifiers: ['ctrl'] },
    nextStep: { key: 'ArrowRight', modifiers: [] },
    previousStep: { key: 'ArrowLeft', modifiers: [] },
    togglePause: { key: ' ', modifiers: [] },
    showHelp: { key: '?', modifiers: [] }
  }).current;

  const shortcuts = options?.customShortcuts || defaultShortcuts;

  // Validate shortcuts for conflicts
  useEffect(() => {
    const shortcutMap = new Map<string, string>();
    const foundConflicts: string[] = [];

    Object.entries(shortcuts).forEach(([action, config]) => {
      const key = `${config.modifiers.sort().join('+')}+${config.key}`;
      if (shortcutMap.has(key)) {
        foundConflicts.push(action);
      } else {
        shortcutMap.set(key, action);
      }
    });

    setConflicts(foundConflicts);
  }, [shortcuts]);

  // Announce status changes for screen readers
  const announceStatus = useCallback((message: string) => {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', 'polite');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    document.body.appendChild(announcement);

    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }, []);

  // Show help modal
  const showHelpModal = useCallback(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    setHelpModalOpen(true);
    
    // Create modal
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Keyboard shortcuts help');
    modal.innerHTML = `
      <div class="keyboard-help-modal">
        <h2>Keyboard Shortcuts</h2>
        <button class="close-button">Close</button>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Focus first focusable element
    const closeButton = modal.querySelector('button');
    closeButton?.focus();
  }, []);

  // Close help modal
  const closeHelpModal = useCallback(() => {
    setHelpModalOpen(false);
    const modal = document.querySelector('[role="dialog"]');
    if (modal) {
      document.body.removeChild(modal);
    }
    
    // Restore focus
    if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, []);

  // Get keyboard help content
  const getKeyboardHelp = useCallback((): KeyboardHelp => {
    const isMac = navigator.platform.includes('Mac');
    const ctrlKey = isMac ? '⌘' : 'Ctrl';

    return {
      global: [
        { keys: [ctrlKey, 'P'], description: 'Toggle practice mode' },
        { keys: [ctrlKey, 'H'], description: 'Show hint' },
        { keys: [ctrlKey, 'R'], description: 'Reset current step' }
      ],
      practiceMode: [
        { keys: ['Space'], description: 'Pause/Resume' },
        { keys: ['?'], description: 'Show keyboard help' },
        { keys: ['L'], description: 'Toggle measure repeat' }
      ],
      navigation: [
        { keys: ['→'], description: 'Next step' },
        { keys: ['←'], description: 'Previous step' }
      ]
    };
  }, []);

  // Handle keyboard events
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Don't handle shortcuts if disabled
    if (!keyboardShortcutsEnabled) return;

    // Don't interfere with text input
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as HTMLElement).isContentEditable) {
      return;
    }

    // Don't trigger shortcuts when modals are open
    if (document.querySelector('[role="dialog"]')) {
      return;
    }

    // Check for matching shortcut
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;
    
    // Toggle practice mode (Ctrl/Cmd + P)
    if ((event.key === 'p' || event.key === 'P') && isCtrlOrCmd) {
      event.preventDefault();
      togglePractice();
      announceStatus(isActive ? 'Practice mode stopped' : 'Practice mode started');
      return;
    }

    // Show hint (Ctrl/Cmd + H)
    if ((event.key === 'h' || event.key === 'H') && isCtrlOrCmd) {
      event.preventDefault();
      showHint();
      announceStatus('Hint shown');
      return;
    }

    // Reset current step (Ctrl/Cmd + R)
    if ((event.key === 'r' || event.key === 'R') && isCtrlOrCmd) {
      event.preventDefault();
      resetCurrentStep();
      announceStatus('Step reset');
      return;
    }

    // Practice mode navigation (only when active)
    if (isActive) {
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault();
          skipCurrentStep();
          announceStatus('Next step');
          break;
          
        case 'ArrowLeft':
          event.preventDefault();
          previousStep();
          announceStatus('Previous step');
          break;
          
        case ' ':
          event.preventDefault();
          togglePause();
          announceStatus('Practice paused');
          break;
          
        case '?':
          event.preventDefault();
          showKeyboardHelp();
          break;
      }
    }

    // Handle 'L' key for repeat toggle
    if (event.key === 'l' || event.key === 'L') {
      // Check if practice is active (using V2 controller status)
      const isPracticeActive = practiceStatus && ['practiceListening', 'practiceEvaluating', 'practiceFeedbackCorrect', 'practiceFeedbackIncorrect', 'advancing'].includes(practiceStatus);
      
      if (!isPracticeActive) {
        return;
      }

      // Don't hijack when typing
      const activeElement = document.activeElement;
      const isTyping = activeElement?.tagName === 'INPUT' || 
                       activeElement?.tagName === 'TEXTAREA' ||
                       (activeElement as HTMLElement)?.isContentEditable;
      
      // Don't trigger with Ctrl/Cmd modifiers
      if (isTyping || event.ctrlKey || event.metaKey) {
        return;
      }

      // Prevent default action
      event.preventDefault();
      
      // Toggle repeat if function is available
      if (toggleRepeat) {
        toggleRepeat();
        
        // Announce to screen readers
        const message = repeatActive ? 'Repeat mode off' : 'Repeat mode on';
        announceToScreenReader(message);
      }
    }

  }, [
    keyboardShortcutsEnabled,
    isActive,
    togglePractice,
    showHint,
    resetCurrentStep,
    skipCurrentStep,
    previousStep,
    togglePause,
    showKeyboardHelp,
    announceStatus,
    toggleRepeat,
    repeatActive,
    practiceStatus
  ]);

  // Register keyboard event listener
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return {
    announceStatus,
    getKeyboardHelp,
    showHelpModal,
    closeHelpModal,
    shortcuts,
    conflicts
  };
}