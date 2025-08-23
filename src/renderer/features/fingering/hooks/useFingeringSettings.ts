import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FingeringSettings {
  isEnabled: boolean;
  showOnAllNotes: boolean;
  fontSize: number;
  color: string;
  clickToEdit: boolean;
}

interface FingeringSettingsStore extends FingeringSettings {
  updateSettings: (updates: Partial<FingeringSettings>) => void;
  resetToDefaults: () => void;
}

const defaultSettings: FingeringSettings = {
  isEnabled: true,
  showOnAllNotes: false,
  fontSize: 12,
  color: '#000080',
  clickToEdit: true
};

export const useFingeringSettingsStore = create<FingeringSettingsStore>()(
  persist(
    (set) => ({
      ...defaultSettings,
      
      updateSettings: (updates) => set(
        (state) => ({ ...state, ...updates }),
        false,
        'updateFingeringSettings'
      ),
      
      resetToDefaults: () => set(
        defaultSettings,
        false,
        'resetFingeringSettings'
      )
    }),
    {
      name: 'abc-piano-fingering-settings',
      version: 1,
      migrate: (persistedState: any, version: number) => {
        if (version === 0) {
          // Handle migration from version 0 to 1
          // Map old property names to new ones if needed
          const migratedState = { ...defaultSettings };
          if (persistedState && typeof persistedState === 'object') {
            // Map old 'enabled' to new 'isEnabled' if it exists
            if ('enabled' in persistedState) {
              migratedState.isEnabled = persistedState.enabled;
            }
            // Preserve other valid properties
            Object.keys(persistedState).forEach(key => {
              if (key in defaultSettings && key !== 'enabled') {
                (migratedState as any)[key] = persistedState[key];
              }
            });
          }
          return migratedState;
        }
        return persistedState as FingeringSettings;
      },
      storage: {
        getItem: (name: string) => {
          try {
            return localStorage.getItem(name);
          } catch (error) {
            console.warn('Failed to read fingering settings from localStorage:', error);
            return null;
          }
        },
        setItem: (name: string, value: string) => {
          try {
            localStorage.setItem(name, value);
          } catch (error) {
            console.error('Failed to save fingering settings to localStorage:', error);
            // Could show user notification here in future
          }
        },
        removeItem: (name: string) => {
          try {
            localStorage.removeItem(name);
          } catch (error) {
            console.warn('Failed to remove fingering settings from localStorage:', error);
          }
        }
      }
    }
  )
);

// Performance-optimized selectors to prevent unnecessary re-renders
export const useFingeringSettings = () => {
  const settings = useFingeringSettingsStore();
  return settings;
};

// Individual selectors for performance-critical components
export const useFingeringEnabled = () => useFingeringSettingsStore(state => state.isEnabled);
export const useFingeringColor = () => useFingeringSettingsStore(state => state.color);
export const useFingeringFontSize = () => useFingeringSettingsStore(state => state.fontSize);
export const useShowOnAllNotes = () => useFingeringSettingsStore(state => state.showOnAllNotes);
export const useClickToEdit = () => useFingeringSettingsStore(state => state.clickToEdit);