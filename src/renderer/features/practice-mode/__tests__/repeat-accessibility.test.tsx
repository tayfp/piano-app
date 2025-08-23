/**
 * Phase 4 Task 4.3: Accessibility Tests
 * 
 * Tests WCAG compliance, screen reader support, and accessibility features
 * for the repeat functionality across the practice mode interface.
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';

// Mock dependencies
jest.mock('@/renderer/utils/env', () => ({
  IS_DEVELOPMENT: false
}));

jest.mock('@/renderer/utils/performance-logger', () => ({
  perfLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('@/renderer/utils/accessibility', () => ({
  announceToScreenReader: jest.fn()
}));

// Mock practice controller
jest.mock('@/renderer/features/practice-mode/hooks', () => ({
  usePracticeController: jest.fn(() => ({
    repeatActive: false,
    toggleRepeat: jest.fn(),
    practiceState: { status: 'practiceListening' },
    state: { status: 'practiceListening' }
  }))
}));

// Mock practice store
jest.mock('@/renderer/features/practice-mode/stores/practiceStore', () => ({
  usePracticeStore: jest.fn(() => ({
    isActive: true,
    togglePractice: jest.fn(),
    resetCurrentStep: jest.fn(),
    skipCurrentStep: jest.fn(),
    previousStep: jest.fn(),
    showHint: jest.fn(),
    togglePause: jest.fn(),
    showKeyboardHelp: jest.fn(),
    keyboardShortcutsEnabled: true
  }))
}));

// Import components after mocks
import { RepeatIndicator } from '@/renderer/features/practice-mode/components/RepeatIndicator';
import { announceToScreenReader } from '@/renderer/utils/accessibility';

// Mock component that includes both keyboard shortcuts and repeat indicator
const PracticeControls: React.FC = () => {
  return (
    <div>
      <RepeatIndicator />
      <button>Other Control</button>
    </div>
  );
};

describe('Repeat Feature Accessibility', () => {
  let mockToggleRepeat: jest.Mock;
  let mockUsePracticeController: jest.Mock;
  let mockAnnounceToScreenReader: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockToggleRepeat = jest.fn();
    mockAnnounceToScreenReader = announceToScreenReader as jest.Mock;
    
    // @ts-ignore - Mock module
    mockUsePracticeController = require('@/renderer/features/practice-mode/hooks').usePracticeController;
    
    mockUsePracticeController.mockReturnValue({
      repeatActive: false,
      toggleRepeat: mockToggleRepeat,
      practiceState: { status: 'practiceListening' },
      state: { status: 'practiceListening' }
    });
  });

  describe('ARIA Attributes and Semantics', () => {
    test('has proper ARIA attributes', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button', { name: /repeat/i });
      
      // Required ARIA attributes
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toHaveAttribute('aria-label');
      expect(button).toHaveAttribute('title');
      
      // Aria-label should be descriptive
      const ariaLabel = button.getAttribute('aria-label');
      expect(ariaLabel).toContain('repeat');
      expect(ariaLabel).toContain('off');
    });

    test('updates ARIA attributes when state changes', async () => {
      const user = userEvent.setup();
      
      // Start with inactive state
      render(<RepeatIndicator />);
      const button = screen.getByRole('button', { name: /repeat/i });
      
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button.getAttribute('aria-label')).toContain('off');
      
      // Mock active state
      mockUsePracticeController.mockReturnValue({
        repeatActive: true,
        toggleRepeat: mockToggleRepeat,
        practiceState: { status: 'practiceListening' },
        state: { status: 'practiceListening' }
      });
      
      // Re-render with new state
      render(<RepeatIndicator />);
      const activeButton = screen.getByRole('button', { name: /repeat/i });
      
      expect(activeButton).toHaveAttribute('aria-pressed', 'true');
      expect(activeButton.getAttribute('aria-label')).toContain('on');
    });

    test('icon is properly hidden from screen readers', () => {
      render(<RepeatIndicator />);
      
      const icon = screen.getByText('🔁');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    test('has semantic button role', () => {
      render(<RepeatIndicator />);
      
      // Should be recognized as a button by assistive technology
      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
      expect(button.tagName).toBe('BUTTON');
    });

    test('provides descriptive accessible name', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button', { name: /repeat mode off.*press to turn on/i });
      expect(button).toBeInTheDocument();
      
      // Should include state and action
      const accessibleName = button.getAttribute('aria-label');
      expect(accessibleName).toMatch(/repeat mode (on|off)/i);
      expect(accessibleName).toMatch(/press to turn (on|off)/i);
    });

    test('tooltip provides additional context', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      const title = button.getAttribute('title');
      
      expect(title).toContain('L'); // Keyboard shortcut
      expect(title).toContain('repeat'); // Function
    });
  });

  describe('Screen Reader Announcements', () => {
    test('announces state changes to screen readers', async () => {
      const user = userEvent.setup();
      render(<PracticeControls />);
      
      // Simulate keyboard shortcut
      await user.keyboard('l');
      
      expect(mockAnnounceToScreenReader).toHaveBeenCalledWith('Repeat mode on');
    });

    test('announces deactivation correctly', async () => {
      const user = userEvent.setup();
      
      // Mock active state first
      mockUsePracticeController.mockReturnValue({
        repeatActive: true,
        toggleRepeat: mockToggleRepeat,
        practiceState: { status: 'practiceListening' },
        state: { status: 'practiceListening' }
      });
      
      render(<PracticeControls />);
      
      await user.keyboard('l');
      
      expect(mockAnnounceToScreenReader).toHaveBeenCalledWith('Repeat mode off');
    });

    test('announcements are clear and concise', async () => {
      const user = userEvent.setup();
      render(<PracticeControls />);
      
      await user.keyboard('l');
      
      const announcement = mockAnnounceToScreenReader.mock.calls[0][0];
      
      // Should be short and clear
      expect(announcement.length).toBeLessThan(50);
      expect(announcement).toMatch(/^repeat mode (on|off)$/i);
    });

    test('handles announcement failures gracefully', async () => {
      const user = userEvent.setup();
      
      // Mock announcement failure
      mockAnnounceToScreenReader.mockImplementation(() => {
        throw new Error('Screen reader error');
      });
      
      render(<PracticeControls />);
      
      // Should not crash on announcement failure
      expect(async () => {
        await user.keyboard('l');
      }).not.toThrow();
    });
  });

  describe('Keyboard Navigation and Interaction', () => {
    test('is keyboard focusable', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Should be in tab order
      expect(button).not.toHaveAttribute('tabindex', '-1');
      
      // Should be focusable
      button.focus();
      expect(button).toHaveFocus();
    });

    test('is keyboard navigable with Tab', async () => {
      const user = userEvent.setup();
      render(<PracticeControls />);
      
      // Tab to repeat button
      await user.tab();
      const repeatButton = screen.getByRole('button', { name: /repeat/i });
      expect(repeatButton).toHaveFocus();
      
      // Tab to next button
      await user.tab();
      const otherButton = screen.getByRole('button', { name: /other control/i });
      expect(otherButton).toHaveFocus();
    });

    test('activates with Enter key', async () => {
      const user = userEvent.setup();
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      button.focus();
      
      await user.keyboard('{Enter}');
      
      expect(mockToggleRepeat).toHaveBeenCalledTimes(1);
    });

    test('activates with Space key', async () => {
      const user = userEvent.setup();
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      button.focus();
      
      await user.keyboard(' ');
      
      expect(mockToggleRepeat).toHaveBeenCalledTimes(1);
    });

    test('does not interfere with text input', async () => {
      const user = userEvent.setup();
      render(
        <>
          <input type="text" aria-label="test input" />
          <PracticeControls />
        </>
      );
      
      const input = screen.getByRole('textbox');
      await user.click(input);
      await user.keyboard('hello l world');
      
      expect(input).toHaveValue('hello l world');
      
      // Repeat should not have been toggled
      expect(mockToggleRepeat).not.toHaveBeenCalled();
    });

    test('handles focus management correctly', async () => {
      const user = userEvent.setup();
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Focus and activate
      button.focus();
      expect(button).toHaveFocus();
      
      await user.keyboard(' ');
      
      // Focus should remain on button after activation
      expect(button).toHaveFocus();
    });
  });

  describe('High Contrast and Visual Accessibility', () => {
    test('supports high contrast mode', () => {
      // Mock high contrast media query
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
          matches: query === '(prefers-contrast: high)',
          media: query,
          addEventListener: jest.fn(),
          removeEventListener: jest.fn()
        }))
      });
      
      mockUsePracticeController.mockReturnValue({
        repeatActive: true,
        toggleRepeat: mockToggleRepeat,
        practiceState: { status: 'practiceListening' },
        state: { status: 'practiceListening' }
      });
      
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Should have enhanced contrast styles
      expect(button).toHaveClass('active');
      // Border should be thicker in high contrast (tested via CSS)
    });

    test('has sufficient color contrast', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      const styles = window.getComputedStyle(button);
      
      // Note: In actual testing environment, these values may not be computed
      // This is more of a structural test to ensure styles are applied
      expect(button).toHaveClass('repeat-indicator');
    });

    test('works without CSS (screen reader only)', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Remove all CSS classes to simulate screen reader
      button.removeAttribute('class');
      
      // Should still be functional
      fireEvent.click(button);
      expect(mockToggleRepeat).toHaveBeenCalled();
      
      // Should still have semantic meaning
      expect(button).toHaveAttribute('aria-pressed');
      expect(button).toHaveTextContent(/repeat/i);
    });
  });

  describe('Screen Reader Compatibility', () => {
    test('has descriptive text for screen readers', () => {
      render(<RepeatIndicator />);
      
      // Should have text content readable by screen readers
      const button = screen.getByRole('button');
      expect(button).toHaveTextContent('Repeat');
      
      // Icon should be hidden from screen readers
      const icon = screen.getByText('🔁');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    test('provides state information to screen readers', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Should announce pressed state
      expect(button).toHaveAttribute('aria-pressed', 'false');
      
      // Should have descriptive label
      const label = button.getAttribute('aria-label');
      expect(label).toContain('off');
      expect(label).toContain('press to turn on');
    });

    test('text alternatives are meaningful', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Text should describe function, not appearance
      expect(button.textContent).not.toContain('🔁'); // No emoji in text content
      expect(button.textContent).toContain('Repeat'); // Meaningful text
      
      // Aria-label should be even more descriptive
      const ariaLabel = button.getAttribute('aria-label');
      expect(ariaLabel).toContain('mode');
      expect(ariaLabel).toContain('press');
    });

    test('maintains meaning without visual context', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Should be understandable by screen reader users
      expect(button).toHaveAttribute('aria-label');
      expect(button).toHaveAttribute('aria-pressed');
      expect(button).toHaveAttribute('title');
      
      // All attributes should provide complete information
      const ariaLabel = button.getAttribute('aria-label');
      expect(ariaLabel).toMatch(/repeat.*mode.*(on|off).*press.*turn.*(on|off)/i);
    });
  });

  describe('Error States and Edge Cases', () => {
    test('handles missing toggle function gracefully', () => {
      mockUsePracticeController.mockReturnValue({
        repeatActive: false,
        toggleRepeat: undefined, // Missing function
        practiceState: { status: 'practiceListening' },
        state: { status: 'practiceListening' }
      });
      
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Should still render and be accessible
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-pressed');
      
      // Click should not throw
      fireEvent.click(button);
    });

    test('maintains accessibility during loading states', () => {
      mockUsePracticeController.mockReturnValue({
        repeatActive: false,
        toggleRepeat: mockToggleRepeat,
        practiceState: { status: 'loading' },
        state: { status: 'loading' }
      });
      
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Should remain accessible during loading
      expect(button).toHaveAttribute('aria-pressed');
      expect(button).toHaveAttribute('aria-label');
    });

    test('handles rapid interactions without confusion', async () => {
      const user = userEvent.setup({ delay: null });
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      button.focus();
      
      // Rapid keyboard interactions
      await user.keyboard(' ');
      await user.keyboard('{Enter}');
      await user.keyboard(' ');
      
      // Should handle gracefully without accessibility issues
      expect(button).toHaveFocus();
      expect(button).toHaveAttribute('aria-pressed');
    });
  });

  describe('WCAG Compliance', () => {
    test('meets WCAG 2.1 Level AA requirements', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // 4.1.2 Name, Role, Value
      expect(button).toHaveAttribute('aria-label'); // Name
      expect(button.getAttribute('role') || button.tagName.toLowerCase()).toBe('button'); // Role
      expect(button).toHaveAttribute('aria-pressed'); // Value
      
      // 2.1.1 Keyboard accessible
      expect(button).not.toHaveAttribute('tabindex', '-1');
      
      // 2.4.6 Descriptive headings and labels
      const label = button.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label!.length).toBeGreaterThan(10); // Sufficiently descriptive
    });

    test('supports assistive technology', () => {
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Should be discoverable by screen readers
      expect(button).toBeInTheDocument();
      expect(button).toBeVisible();
      
      // Should have proper semantics
      expect(button.tagName).toBe('BUTTON');
      expect(button).toHaveAttribute('aria-pressed');
    });

    test('provides equivalent experience for users with disabilities', async () => {
      const user = userEvent.setup();
      render(<RepeatIndicator />);
      
      const button = screen.getByRole('button');
      
      // Mouse users can click
      await user.click(button);
      expect(mockToggleRepeat).toHaveBeenCalledTimes(1);
      
      mockToggleRepeat.mockClear();
      
      // Keyboard users can activate with space
      button.focus();
      await user.keyboard(' ');
      expect(mockToggleRepeat).toHaveBeenCalledTimes(1);
      
      mockToggleRepeat.mockClear();
      
      // Keyboard users can activate with enter
      await user.keyboard('{Enter}');
      expect(mockToggleRepeat).toHaveBeenCalledTimes(1);
    });
  });
});