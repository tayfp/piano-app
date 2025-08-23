/**
 * Accessibility utilities for screen reader support
 */

/**
 * Announce a message to screen readers using ARIA live regions
 * @param message - The message to announce
 */
export function announceToScreenReader(message: string): void {
  // Create temporary ARIA live region
  const announcement = document.createElement('div');
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  announcement.className = 'sr-only'; // Visually hidden
  announcement.textContent = message;
  
  document.body.appendChild(announcement);
  
  // Remove after announcement (1 second should be enough for screen readers to pick it up)
  setTimeout(() => {
    if (document.body.contains(announcement)) {
      document.body.removeChild(announcement);
    }
  }, 1000);
}