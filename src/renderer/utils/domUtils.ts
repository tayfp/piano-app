import { perfLogger } from '@/renderer/utils/performance-logger';
/**
 * DOM Utilities - Safe cross-platform element manipulation
 * Handles both HTML and SVG elements properly
 */

/**
 * Safely checks if an element has a given CSS class.
 * Works for both HTMLElement and SVGElement, with defensive fallbacks.
 * 
 * @param el - The element to check (HTML or SVG)
 * @param className - The CSS class to search for
 * @returns true if the class exists, false otherwise
 */
export function elementHasClass(el: Element, className: string): boolean {
  try {
    // Fast path: Modern browsers with classList support (HTML and SVG)
    if ('classList' in el && el.classList) {
      return el.classList.contains(className);
    }
  } catch (error) {
    // Log unexpected errors in development
    if (process.env.NODE_ENV === 'development') {
      perfLogger.warn('elementHasClass: classList access failed', error);
    }
  }

  // Fallback path for edge cases or older browsers
  try {
    const classNameProp = (el as any).className;
    
    // SVG elements: className is SVGAnimatedString with baseVal
    if (classNameProp && typeof classNameProp === 'object' && 'baseVal' in classNameProp) {
      return typeof classNameProp.baseVal === 'string' 
        ? classNameProp.baseVal.includes(className)
        : false;
    }
    
    // HTML elements: className is a string
    if (typeof classNameProp === 'string') {
      return classNameProp.includes(className);
    }
    
    // Unknown element type - return false safely
    return false;
  } catch (error) {
    // Ultimate fallback - log and return false
    if (process.env.NODE_ENV === 'development') {
      perfLogger.warn('elementHasClass: fallback failed', error, el);
    }
    return false;
  }
}

/**
 * Safely gets an element's class list as a string.
 * Useful for debugging and logging.
 */
export function getElementClasses(el: Element): string {
  try {
    if ('classList' in el && el.classList) {
      return Array.from(el.classList).join(' ');
    }
    
    const classNameProp = (el as any).className;
    if (classNameProp && typeof classNameProp === 'object' && 'baseVal' in classNameProp) {
      return classNameProp.baseVal || '';
    }
    
    return typeof classNameProp === 'string' ? classNameProp : '';
  } catch (error) {
    return '';
  }
}

/**
 * Type guard to check if an element is an SVG element
 */
export function isSVGElement(el: Element): el is SVGElement {
  return el instanceof SVGElement;
}

/**
 * Debug utility to log element information
 * Only active in development mode
 */
export function debugElement(el: Element, context?: string): void {
  if (process.env.NODE_ENV !== 'development') return;
  
  console.log(`[DOM Debug${context ? ` - ${context}` : ''}]`, {
    tagName: el.tagName,
    isSVG: isSVGElement(el),
    classes: getElementClasses(el),
    attributes: Array.from(el.attributes).reduce((acc, attr) => {
      acc[attr.name] = attr.value;
      return acc;
    }, {} as Record<string, string>)
  });
}