/**
 * MusicXML Template System for Speed Challenge Mode
 * 
 * Provides fast template loading, caching, and dynamic note injection
 * for generating speed challenge patterns. Templates are cached after
 * first load to ensure <1ms access times for subsequent requests.
 * 
 * Performance Target: <1ms template access after initial cache
 */

import { perfLogger } from '@/renderer/utils/performance-logger';

// Template types
export type TemplateType = 'single-note' | 'interval' | 'triad';

// Note data for injection
export interface NoteData {
  step: string;        // Note letter (C, D, E, F, G, A, B)
  octave: number;      // Octave number (typically 3-6 for piano)
  alter?: number;      // Alteration: 1 for sharp, -1 for flat, 0 or undefined for natural
  duration: number;    // Note duration in divisions
  type: string;        // Note type (whole, half, quarter, eighth, etc.)
}

export interface PatternData {
  notes: NoteData[];
  encodingDate?: string;
}

// Template cache for performance
const templateCache = new Map<TemplateType, string>();

// Embedded template strings for maximum performance
// These are inlined to avoid file I/O during pattern generation
const SINGLE_NOTE_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>Speed Challenge Pattern</work-title>
  </work>
  <identification>
    <creator type="composer">Speed Challenge Generator</creator>
    <encoding>
      <software>Urtext Piano</software>
      <encoding-date>{{ENCODING_DATE}}</encoding-date>
    </encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
      <score-instrument id="P1-I1">
        <instrument-name>Piano</instrument-name>
      </score-instrument>
      <midi-device id="P1-I1" port="1"></midi-device>
      <midi-instrument id="P1-I1">
        <midi-channel>1</midi-channel>
        <midi-program>1</midi-program>
        <volume>78.7402</volume>
        <pan>0</pan>
      </midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>{{NOTE_STEP}}</step>
          {{NOTE_ALTER}}
          <octave>{{NOTE_OCTAVE}}</octave>
        </pitch>
        <duration>{{NOTE_DURATION}}</duration>
        <voice>1</voice>
        <type>{{NOTE_TYPE}}</type>
        <stem>up</stem>
      </note>
    </measure>
  </part>
</score-partwise>`;

const INTERVAL_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>Speed Challenge Interval Pattern</work-title>
  </work>
  <identification>
    <creator type="composer">Speed Challenge Generator</creator>
    <encoding>
      <software>Urtext Piano</software>
      <encoding-date>{{ENCODING_DATE}}</encoding-date>
    </encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
      <score-instrument id="P1-I1">
        <instrument-name>Piano</instrument-name>
      </score-instrument>
      <midi-device id="P1-I1" port="1"></midi-device>
      <midi-instrument id="P1-I1">
        <midi-channel>1</midi-channel>
        <midi-program>1</midi-program>
        <volume>78.7402</volume>
        <pan>0</pan>
      </midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>{{NOTE1_STEP}}</step>
          {{NOTE1_ALTER}}
          <octave>{{NOTE1_OCTAVE}}</octave>
        </pitch>
        <duration>{{NOTE1_DURATION}}</duration>
        <voice>1</voice>
        <type>{{NOTE1_TYPE}}</type>
        <stem>up</stem>
      </note>
      <note>
        <chord/>
        <pitch>
          <step>{{NOTE2_STEP}}</step>
          {{NOTE2_ALTER}}
          <octave>{{NOTE2_OCTAVE}}</octave>
        </pitch>
        <duration>{{NOTE2_DURATION}}</duration>
        <voice>1</voice>
        <type>{{NOTE2_TYPE}}</type>
        <stem>up</stem>
      </note>
    </measure>
  </part>
</score-partwise>`;

const TRIAD_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work>
    <work-title>Speed Challenge Triad Pattern</work-title>
  </work>
  <identification>
    <creator type="composer">Speed Challenge Generator</creator>
    <encoding>
      <software>Urtext Piano</software>
      <encoding-date>{{ENCODING_DATE}}</encoding-date>
    </encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
      <score-instrument id="P1-I1">
        <instrument-name>Piano</instrument-name>
      </score-instrument>
      <midi-device id="P1-I1" port="1"></midi-device>
      <midi-instrument id="P1-I1">
        <midi-channel>1</midi-channel>
        <midi-program>1</midi-program>
        <volume>78.7402</volume>
        <pan>0</pan>
      </midi-instrument>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key>
          <fifths>0</fifths>
        </key>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
        <clef>
          <sign>G</sign>
          <line>2</line>
        </clef>
      </attributes>
      <note>
        <pitch>
          <step>{{NOTE1_STEP}}</step>
          {{NOTE1_ALTER}}
          <octave>{{NOTE1_OCTAVE}}</octave>
        </pitch>
        <duration>{{NOTE1_DURATION}}</duration>
        <voice>1</voice>
        <type>{{NOTE1_TYPE}}</type>
        <stem>up</stem>
      </note>
      <note>
        <chord/>
        <pitch>
          <step>{{NOTE2_STEP}}</step>
          {{NOTE2_ALTER}}
          <octave>{{NOTE2_OCTAVE}}</octave>
        </pitch>
        <duration>{{NOTE2_DURATION}}</duration>
        <voice>1</voice>
        <type>{{NOTE2_TYPE}}</type>
        <stem>up</stem>
      </note>
      <note>
        <chord/>
        <pitch>
          <step>{{NOTE3_STEP}}</step>
          {{NOTE3_ALTER}}
          <octave>{{NOTE3_OCTAVE}}</octave>
        </pitch>
        <duration>{{NOTE3_DURATION}}</duration>
        <voice>1</voice>
        <type>{{NOTE3_TYPE}}</type>
        <stem>up</stem>
      </note>
    </measure>
  </part>
</score-partwise>`;

// Pre-loaded template strings map
const TEMPLATES: Record<TemplateType, string> = {
  'single-note': SINGLE_NOTE_TEMPLATE,
  'interval': INTERVAL_TEMPLATE,
  'triad': TRIAD_TEMPLATE,
};

/**
 * Load a template from cache or disk
 * @param type - The template type to load
 * @returns The template string with placeholders
 */
export function loadTemplate(type: TemplateType): string {
  const perfStart = performance.now();

  // Check cache first
  if (templateCache.has(type)) {
    const cached = templateCache.get(type)!;
    perfLogger.debug('Template cache hit', { 
      type, 
      loadTime: performance.now() - perfStart 
    });
    return cached;
  }

  // Load template
  const template = TEMPLATES[type];
  if (!template) {
    throw new Error(`Template not found: ${type}`);
  }

  // Cache for future use
  templateCache.set(type, template);
  
  perfLogger.debug('Template loaded and cached', { 
    type, 
    loadTime: performance.now() - perfStart,
    size: template.length 
  });

  return template;
}

/**
 * Inject note data into a template
 * @param template - The template string with placeholders
 * @param data - The pattern data containing notes to inject
 * @returns The completed MusicXML string
 */
export function injectNoteData(template: string, data: PatternData): string {
  const perfStart = performance.now();
  let result = template;

  // Inject encoding date
  const encodingDate = data.encodingDate || new Date().toISOString().split('T')[0];
  result = result.replace('{{ENCODING_DATE}}', encodingDate);

  // Determine template type by checking placeholders
  const isSingleNote = template.includes('{{NOTE_STEP}}');
  const isInterval = template.includes('{{NOTE1_STEP}}') && template.includes('{{NOTE2_STEP}}');
  const isTriad = template.includes('{{NOTE3_STEP}}');

  if (isSingleNote && data.notes.length >= 1) {
    // Single note injection
    const note = data.notes[0];
    result = result.replace('{{NOTE_STEP}}', note.step);
    result = result.replace('{{NOTE_OCTAVE}}', note.octave.toString());
    result = result.replace('{{NOTE_DURATION}}', note.duration.toString());
    result = result.replace('{{NOTE_TYPE}}', note.type);
    
    // Handle alteration (sharp/flat)
    if (note.alter !== undefined && note.alter !== 0) {
      result = result.replace('{{NOTE_ALTER}}', `<alter>${note.alter}</alter>`);
    } else {
      result = result.replace('{{NOTE_ALTER}}', '');
    }
  } else if (isTriad && data.notes.length >= 3) {
    // Triad injection (3 notes)
    for (let i = 0; i < 3; i++) {
      const note = data.notes[i];
      const prefix = `NOTE${i + 1}`;
      result = result.replace(`{{${prefix}_STEP}}`, note.step);
      result = result.replace(`{{${prefix}_OCTAVE}}`, note.octave.toString());
      result = result.replace(`{{${prefix}_DURATION}}`, note.duration.toString());
      result = result.replace(`{{${prefix}_TYPE}}`, note.type);
      
      if (note.alter !== undefined && note.alter !== 0) {
        result = result.replace(`{{${prefix}_ALTER}}`, `<alter>${note.alter}</alter>`);
      } else {
        result = result.replace(`{{${prefix}_ALTER}}`, '');
      }
    }
  } else if (isInterval && data.notes.length >= 2) {
    // Interval injection (2 notes)
    for (let i = 0; i < 2; i++) {
      const note = data.notes[i];
      const prefix = `NOTE${i + 1}`;
      result = result.replace(`{{${prefix}_STEP}}`, note.step);
      result = result.replace(`{{${prefix}_OCTAVE}}`, note.octave.toString());
      result = result.replace(`{{${prefix}_DURATION}}`, note.duration.toString());
      result = result.replace(`{{${prefix}_TYPE}}`, note.type);
      
      if (note.alter !== undefined && note.alter !== 0) {
        result = result.replace(`{{${prefix}_ALTER}}`, `<alter>${note.alter}</alter>`);
      } else {
        result = result.replace(`{{${prefix}_ALTER}}`, '');
      }
    }
  } else {
    // Insufficient note data for template type
    const templateType = isTriad ? 'triad' : isInterval ? 'interval' : 'single-note';
    const required = isTriad ? 3 : isInterval ? 2 : 1;
    throw new Error(`Insufficient note data for ${templateType} template: got ${data.notes.length}, need ${required}`);
  }

  perfLogger.debug('Template injection complete', { 
    injectionTime: performance.now() - perfStart,
    noteCount: data.notes.length 
  });

  return result;
}

/**
 * Validate that a MusicXML string is properly formed
 * @param xml - The MusicXML string to validate
 * @returns True if valid, false otherwise
 */
export function validateMusicXML(xml: string): boolean {
  const perfStart = performance.now();

  try {
    // Basic structure validation
    if (!xml.includes('<?xml version=')) {
      return false;
    }

    if (!xml.includes('<score-partwise')) {
      return false;
    }

    if (!xml.includes('<part-list>') || !xml.includes('</part-list>')) {
      return false;
    }

    if (!xml.includes('<part id=')) {
      return false;
    }

    // Check for required MusicXML elements
    const requiredElements = [
      '<measure',
      '<attributes>',
      '<note>',
      '<pitch>' // At least one pitch element required
    ];

    for (const element of requiredElements) {
      if (!xml.includes(element)) {
        perfLogger.debug('MusicXML validation failed', { 
          missingElement: element,
          validationTime: performance.now() - perfStart 
        });
        return false;
      }
    }

    // Check for balanced tags (simple check)
    const openTags = (xml.match(/<[^/][^>]*>/g) || []).length;
    const closeTags = (xml.match(/<\/[^>]+>/g) || []).length;
    
    // Allow for self-closing tags and XML declaration
    if (Math.abs(openTags - closeTags) > 5) {
      perfLogger.debug('MusicXML validation failed', { 
        reason: 'Unbalanced tags',
        openTags,
        closeTags,
        validationTime: performance.now() - perfStart 
      });
      return false;
    }

    perfLogger.debug('MusicXML validation succeeded', { 
      validationTime: performance.now() - perfStart 
    });
    return true;

  } catch (error) {
    perfLogger.error('MusicXML validation error', error as Error);
    return false;
  }
}

/**
 * Pre-warm the template cache for optimal performance
 */
export function prewarmTemplateCache(): void {
  const perfStart = performance.now();
  
  const templates: TemplateType[] = ['single-note', 'interval', 'triad'];
  for (const type of templates) {
    loadTemplate(type);
  }

  perfLogger.debug('Template cache prewarmed', { 
    warmupTime: performance.now() - perfStart,
    templatesLoaded: templates.length 
  });
}

/**
 * Clear the template cache (useful for testing)
 */
export function clearTemplateCache(): void {
  templateCache.clear();
  perfLogger.debug('Template cache cleared');
}