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
    
    // 3. Find all notes in the score
    const notes = xmlDoc.querySelectorAll('note');
    let injectedCount = 0;
    let measureIndex = -1;
    let staffIndex = 0;
    let voiceIndex = 0;
    let noteIndexInMeasure = 0;
    
    // Track current measure to update indices
    let currentMeasure: Element | null = null;
    
    notes.forEach((note) => {
      // Update measure tracking
      const measure = note.closest('measure');
      if (measure !== currentMeasure) {
        currentMeasure = measure;
        measureIndex++;
        noteIndexInMeasure = 0;
        
        // Reset staff/voice for new measure
        staffIndex = 0;
        voiceIndex = 0;
      } else {
        noteIndexInMeasure++;
      }
      
      // Get staff number from note
      const staffEl = note.querySelector('staff');
      if (staffEl?.textContent) {
        staffIndex = parseInt(staffEl.textContent) - 1; // MusicXML uses 1-based indexing
      }
      
      // Get voice number from note
      const voiceEl = note.querySelector('voice');
      if (voiceEl?.textContent) {
        voiceIndex = parseInt(voiceEl.textContent) - 1; // MusicXML uses 1-based indexing
      }
      
      // Skip rests
      const isRest = note.querySelector('rest') !== null;
      if (isRest) return;
      
      // Get pitch information to calculate MIDI note
      const pitch = note.querySelector('pitch');
      if (!pitch) return;
      
      const step = pitch.querySelector('step')?.textContent;
      const octave = pitch.querySelector('octave')?.textContent;
      const alter = pitch.querySelector('alter')?.textContent;
      
      if (!step || !octave) return;
      
      // Calculate MIDI note number
      const midiNote = calculateMidiFromPitch(step, parseInt(octave), alter ? parseInt(alter) : 0);
      
      // Build fingering ID to match our format: m{measure}-s{staff}-v{voice}-n{note}-midi{midi}
      const fingeringId = `m${measureIndex}-s${staffIndex}-v${voiceIndex}-n${noteIndexInMeasure}-midi${midiNote}`;
      
      // Check if we have a fingering for this note
      const finger = fingerings[fingeringId];
      if (finger) {
        // Check if technical element exists
        let technical = note.querySelector('technical');
        if (!technical) {
          technical = xmlDoc.createElement('technical');
          // Insert after notations if it exists, otherwise at the end
          const notations = note.querySelector('notations');
          if (notations) {
            notations.appendChild(technical);
          } else {
            // Create notations element
            const notationsEl = xmlDoc.createElement('notations');
            notationsEl.appendChild(technical);
            note.appendChild(notationsEl);
          }
        }
        
        // Check if fingering already exists (don't duplicate)
        const existingFingering = technical.querySelector('fingering');
        if (!existingFingering) {
          // Add fingering element
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
              octave
            });
          }
        }
      }
    });
    
    // 4. Serialize back to string
    const serializer = new XMLSerializer();
    const modifiedXML = serializer.serializeToString(xmlDoc);
    
    const totalTime = performance.now() - startTime;
    
    if (process.env.NODE_ENV === 'development') {
      perfLogger.debug('MusicXML fingering injection complete', {
        fingeringsInDB: fingeringCount,
        notesFound: notes.length,
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