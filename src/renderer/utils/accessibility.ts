/**
 * Accessibility utilities for screen reader support
 */

let liveEl: HTMLElement | null = null;
let last = '';

/**
 * Announce a short message to screen readers using a persistent live region.
 * - No per-call timers or DOM churn.
 * - Guaranteed re-announce of identical messages by toggling content.
 *
 * @param message - text to announce
 * @param polite  - true => aria-live="polite", false => "assertive"
 */
export function announceToScreenReader(message: string, polite = true): void {
  if (!liveEl) {
    const el = document.createElement('div');
    el.setAttribute('role', 'status');              // implicit polite, but we set explicitly below
    el.setAttribute('aria-atomic', 'true');
    el.className = 'sr-only';                       // your existing visually-hidden utility
    document.body.appendChild(el);
    liveEl = el;
  }

  // ensure current politeness
  liveEl.setAttribute('aria-live', polite ? 'polite' : 'assertive');

  // Re-announce identical text by clearing then setting on the next frame
  if (message === last) {
    liveEl.textContent = '';
    requestAnimationFrame(() => { if (liveEl) liveEl.textContent = message; });
  } else {
    liveEl.textContent = message;
    last = message;
  }
}