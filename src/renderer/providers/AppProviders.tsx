/**
 * App Providers
 * 
 * Consolidates all context providers for the app.
 * This keeps App.tsx clean and makes the provider hierarchy clear.
 */

import React from 'react';
import { MidiProvider } from '@/renderer/contexts/MidiContext';
import { OSMDProvider } from '@/renderer/contexts/OSMDContext';
import { AssistProvider } from '@/renderer/features/practice-mode/providers/AssistProvider';
import { TempoServicesProvider } from '@/renderer/features/practice-mode/providers/TempoServicesProvider';
import { ThemeProvider } from '@/renderer/features/theme';
import type { MidiEvent } from '@/renderer/types/midi';

interface AppProvidersProps {
  children: React.ReactNode;
  onMidiEvent: (event: MidiEvent) => void;
  onKeysChanged?: (keys: number[]) => void;
}

export function AppProviders({ children, onMidiEvent, onKeysChanged }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <MidiProvider onMidiEvent={onMidiEvent} onKeysChanged={onKeysChanged}>
        <TempoServicesProvider>
          <OSMDProvider>
            <AssistProvider>
              {children}
            </AssistProvider>
          </OSMDProvider>
        </TempoServicesProvider>
      </MidiProvider>
    </ThemeProvider>
  );
}