import { useMemo } from 'react';
import { generatePianoKeys } from '../utils/pianoUtils';

export const usePiano = () => {
  const keys = useMemo(() => generatePianoKeys(), []);
  const whiteKeys = useMemo(() => keys.filter(k => k.type === 'white'), [keys]);
  const blackKeys = useMemo(() => keys.filter(k => k.type === 'black'), [keys]);
  
  return { keys, whiteKeys, blackKeys };
};