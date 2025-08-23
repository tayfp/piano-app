/**
 * MusicXML Fingering Injector
 * 
 * Injects fingering annotations from IndexedDB into MusicXML before OSMD loads it.
 * This enables OSMD's native fingering rendering (drawFingerings: true).
 * 
 * Following Code review: 4's prototype instructions for minimal implementation.
 */

import { fingeringPersistence } from '@/renderer/features/fingering/services/FingeringPersistence';
import { perfLogger } from '@/renderer/utils/performance-logger';

/**
 * Inject fingerings from IndexedDB into MusicXML
 * 
 * @param musicXML - Original MusicXML string
 * @param scoreId - Score ID to load fingerings for
 * @returns Modified MusicXML with fingering elements
 */
export async function injectFingeringsIntoMusicXML(
  musicXML: string,
  scoreId: string
): Promise<string> {
  const startTime = performance.now();
  
  // ISSUE #10 DEBUG LOG 2: Log MusicXML State Before Fingering Addition
  if (process.env.NODE_ENV === 'development') {
    console.log('🐛 [ISSUE #10 DEBUG] Before adding fingering - MusicXML length:', musicXML.length);
    console.log('🐛 [ISSUE #10 DEBUG] ScoreId:', scoreId);
  }
  
  try {
    // 1. Load fingerings from IndexedDB
    const fingerings = await fingeringPersistence.loadFingerings(scoreId);
    const fingeringCount = Object.keys(fingerings).length;
    
    if (fingeringCount === 0) {
      // No fingerings to inject, return original
      if (process.env.NODE_ENV === 'development') {
        perfLogger.debug('No fingerings found for score, skipping injection');
      }
      return musicXML;
    }
    
    // 2. Parse MusicXML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(musicXML, 'text/xml');
    
    // Check for parse errors
    const parseError = xmlDoc.querySelector('parsererror');
    if (parseError) {
      perfLogger.error('Failed to parse MusicXML:', new Error(parseError.textContent || 'Unknown parse error'));
      return musicXML; // Return original on error
    }
    
    // 3. Iterate by measure → notes (optimized: eliminates closest() calls)
    const measures = xmlDoc.getElementsByTagName('measure');
    let injectedCount = 0;
    let totalNotesFound = 0;

    for (let mi = 0; mi < measures.length; mi++) {
      const measure = measures[mi];

      // IMPORTANT: carry staff/voice across notes in a measure,
      // matching current behavior exactly.
      let staffIdx = 0;
      let voiceIdx = 0;

      const notes = measure.getElementsByTagName('note');
      totalNotesFound += notes.length;
      
      for (let ni = 0; ni < notes.length; ni++) {
        const note = notes[ni];

        // Update staff/voice first (even if this turns out to be a rest)
        const staffText = note.getElementsByTagName('staff')[0]?.textContent;
        if (staffText) staffIdx = parseInt(staffText, 10) - 1;

        const voiceText = note.getElementsByTagName('voice')[0]?.textContent;
        if (voiceText) voiceIdx = parseInt(voiceText, 10) - 1;

        // Skip rests
        if (note.getElementsByTagName('rest').length) continue;

        const pitch = note.getElementsByTagName('pitch')[0];
        if (!pitch) continue;
        const step = pitch.getElementsByTagName('step')[0]?.textContent;
        const octaveText = pitch.getElementsByTagName('octave')[0]?.textContent;
        const alterText = pitch.getElementsByTagName('alter')[0]?.textContent;
        if (!step || !octaveText) continue;

        const midiNote = calculateMidiFromPitch(
          step,
          parseInt(octaveText, 10),
          alterText ? parseInt(alterText, 10) : 0
        );

        // Build fingering ID to match our format: m{measure}-s{staff}-v{voice}-n{note}-midi{midi}
        const fingeringId = `m${mi}-s${staffIdx}-v${voiceIdx}-n${ni}-midi${midiNote}`;

        // Check if we have a fingering for this note
        const finger = (fingerings as Record<string, number>)[fingeringId];
        if (!finger) continue;

        // Ensure <notations><technical><fingering>
        let notations = note.getElementsByTagName('notations')[0];
        if (!notations) {
          notations = xmlDoc.createElement('notations');
          note.appendChild(notations);
        }
        let technical = notations.getElementsByTagName('technical')[0];
        if (!technical) {
          technical = xmlDoc.createElement('technical');
          notations.appendChild(technical);
        }
        if (!technical.getElementsByTagName('fingering')[0]) {
          const fingeringEl = xmlDoc.createElement('fingering');
          fingeringEl.textContent = String(finger);
          technical.appendChild(fingeringEl);
          injectedCount++;
          
          if (process.env.NODE_ENV === 'development' && injectedCount <= 5) {
            perfLogger.debug('Injected fingering', {
              fingeringId,
              finger,
              midiNote,
              step,
              octave: octaveText
            });
          }
        }
      }
    }
    
    // 4. Serialize back to string
    const serializer = new XMLSerializer();
    const modifiedXML = serializer.serializeToString(xmlDoc);
    
    const totalTime = performance.now() - startTime;
    
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('MusicXML fingering injection complete', {
        fingeringsInDB: fingeringCount,
        notesFound: totalNotesFound,
        fingeringsInjected: injectedCount,
        processingTimeMs: totalTime.toFixed(2)
      });
      
      // ISSUE #10 DEBUG LOG 2: Log MusicXML State After Fingering Addition
      console.log('🐛 [ISSUE #10 DEBUG] After adding fingering - Updated MusicXML length:', modifiedXML.length);
      console.log('🐛 [ISSUE #10 DEBUG] Fingerings injected:', injectedCount);
    }
    
    return modifiedXML;
    
  } catch (error) {
    perfLogger.error('Failed to inject fingerings into MusicXML:', error instanceof Error ? error : new Error(String(error)));
    // Return original XML on error
    return musicXML;
  }
}

/**
 * Calculate MIDI note number from pitch information
 * C4 = 60 in MIDI
 */
function calculateMidiFromPitch(step: string, octave: number, alter: number = 0): number {
  const stepToSemitone: Record<string, number> = {
    'C': 0,
    'D': 2,
    'E': 4,
    'F': 5,
    'G': 7,
    'A': 9,
    'B': 11
  };
  
  const baseSemitone = stepToSemitone[step.toUpperCase()] || 0;
  const midiNote = (octave + 1) * 12 + baseSemitone + alter;
  
  return Math.max(0, Math.min(127, midiNote)); // Clamp to valid MIDI range
}

/**
 * Benchmark the fingering injection process
 */
export async function benchmarkFingeringInjection(
  musicXML: string,
  scoreId: string
): Promise<{
  injectionTime: number;
  totalTime: number;
  fingeringCount: number;
  success: boolean;
}> {
  const start = performance.now();
  
  try {
    // Load fingerings to get count
    const fingerings = await fingeringPersistence.loadFingerings(scoreId);
    const fingeringCount = Object.keys(fingerings).length;
    
    // Time the injection
    const injectionStart = performance.now();
    await injectFingeringsIntoMusicXML(musicXML, scoreId);
    const injectionTime = performance.now() - injectionStart;
    
    const totalTime = performance.now() - start;
    
    return {
      injectionTime,
      totalTime,
      fingeringCount,
      success: totalTime < 20 // Must be under 20ms for real-time requirement
    };
  } catch (error) {
    perfLogger.error('Benchmark failed:', error instanceof Error ? error : new Error(String(error)));
    return {
      injectionTime: 0,
      totalTime: 0,
      fingeringCount: 0,
      success: false
    };
  }
}