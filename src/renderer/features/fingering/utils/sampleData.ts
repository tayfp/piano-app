import { useFingeringStore } from '../stores/fingeringStore';
import { createFingeringId } from './fingeringId';

/**
 * Add sample fingering data for development and testing
 */
export const addSampleFingerings = (scoreId: string) => {
  const store = useFingeringStore.getState();
  
  // Sample fingerings for common note positions
  const sampleData = [
    { timestamp: 0, midiValue: 60, finger: 1 }, // C4 - thumb
    { timestamp: 0.5, midiValue: 62, finger: 2 }, // D4 - index
    { timestamp: 1.0, midiValue: 64, finger: 3 }, // E4 - middle
    { timestamp: 1.5, midiValue: 65, finger: 4 }, // F4 - ring
    { timestamp: 2.0, midiValue: 67, finger: 5 }, // G4 - pinky
    // Add stress test data
    ...Array.from({ length: 50 }, (_, i) => ({
      timestamp: i * 0.1,
      midiValue: 60 + (i % 12),
      finger: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5
    }))
  ];
  
  sampleData.forEach(({ timestamp, midiValue, finger }) => {
    store.setFingering(scoreId, timestamp, midiValue, finger);
  });
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`Added ${sampleData.length} sample fingerings for score ${scoreId}`);
  }
};

/**
 * Clear all fingerings for testing
 */
export const clearSampleFingerings = (scoreId: string) => {
  const store = useFingeringStore.getState();
  store.clearAnnotationsForScore(scoreId);
  if (process.env.NODE_ENV === 'development') {
    console.log(`Cleared all fingerings for score ${scoreId}`);
  }
};

// Development utility - expose on window in dev mode
if (process.env.NODE_ENV === 'development') {
  (window as any).fingeringUtils = {
    addSample: addSampleFingerings,
    clearSample: clearSampleFingerings
  };
}