import { useEffect } from 'react';
import { perfLogger } from '@/renderer/utils/performance-logger';

/**
 * Cursor Scroll Following
 * 
 * Implements the "follow the cursor" feature for scrollable sheet music.
 * When cursor moves out of view, smoothly scrolls to keep it visible.
 * 
 * This solves the UX problem that remains after fixing container sizing:
 * when music is taller than container, cursor needs to scroll into view.
 */
export const useCursorScrollFollow = (osmd: any, isReady: boolean) => {
  const DEV = process.env.NODE_ENV !== 'production';
  const CURSOR_PATCH = Symbol.for('cursorScrollFollowPatch');

  useEffect(() => {
    if (!osmd || !isReady || !osmd.cursor) return;

    const cursor = osmd.cursor as any;
    
    // Coalesce multiple calls into a single rAF per frame
    let rafId: number | 0 = 0;

    const scrollToMakeCursorVisible = () => {
      rafId = 0;

      const cursorElement = document.querySelector('[id^="cursorImg"]') as HTMLElement | null;
      const scrollContainer = document.querySelector('.sheet-music-area') as HTMLElement | null;
      
      if (!cursorElement || !scrollContainer) return;

      const cursorRect = cursorElement.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();

      // Check if cursor is above or below the visible area of the container
      const cursorAboveContainer = cursorRect.top < containerRect.top;
      const cursorBelowContainer = cursorRect.bottom > containerRect.bottom;
      
      if (cursorAboveContainer || cursorBelowContainer) {
        if (DEV) perfLogger.debug('[CursorFollow] Scrolling to follow cursor');
        
        // Scroll the cursor into the center of the view for smoother experience
        cursorElement.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
      }
    };

    const scheduleScrollCheck = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(scrollToMakeCursorVisible);
    };

    // Idempotent monkey-patch (patch once per cursor instance)
    if (!cursor[CURSOR_PATCH]) {
      const patch = {
        show: cursor.show,
        next: cursor.next,
        previous: cursor.previous,
        reset: cursor.reset,
      };
      cursor[CURSOR_PATCH] = patch;

      cursor.show = function (...args: any[]) {
        const r = patch.show.apply(this, args);
        scheduleScrollCheck();
        return r;
      };
      cursor.next = function (...args: any[]) {
        const r = patch.next.apply(this, args);
        scheduleScrollCheck();
        return r;
      };
      cursor.previous = function (...args: any[]) {
        const r = patch.previous.apply(this, args);
        scheduleScrollCheck();
        return r;
      };
      cursor.reset = function (...args: any[]) {
        const r = patch.reset.apply(this, args);
        scheduleScrollCheck();
        return r;
      };
    }

    // Ensure we run an initial check as soon as the cursor first renders
    scheduleScrollCheck();

    // Cleanup: restore originals and cancel any rAF
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      const patch = cursor[CURSOR_PATCH];
      if (patch) {
        cursor.show = patch.show;
        cursor.next = patch.next;
        cursor.previous = patch.previous;
        cursor.reset = patch.reset;
        delete cursor[CURSOR_PATCH];
      }
    };
  }, [osmd, isReady, DEV, CURSOR_PATCH]);
};