/**
 * Platform Detection Service
 * 
 * Detects the runtime environment and MIDI capabilities
 * to provide appropriate user experience and fallback strategies.
 */

export interface PlatformEnvironment {
  os: 'windows' | 'macos' | 'linux' | 'unknown';
  isWSL2: boolean;
  isElectron: boolean;
  isDevelopment: boolean;
}

export interface MidiCapability {
  webMidiSupported: boolean;
  webMidiReasonIfUnsupported?: string;
  nativeMidiAvailable: boolean;
  recommendedApproach: 'web-midi' | 'native-midi' | 'virtual-only';
}

export interface SetupInstruction {
  title: string;
  description: string;
  commands?: string[];
  isOptional: boolean;
  difficulty: 'easy' | 'medium' | 'advanced';
}

class PlatformDetectionService {
  private cachedEnvironment: PlatformEnvironment | null = null;
  private cachedCapability: MidiCapability | null = null;

  /**
   * Detect the current platform environment
   */
  detectEnvironment(): PlatformEnvironment {
    if (this.cachedEnvironment) {
      return this.cachedEnvironment;
    }

    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();
    
    // Detect OS
    let os: PlatformEnvironment['os'] = 'unknown';
    if (platform.includes('win') || userAgent.includes('windows')) {
      os = 'windows';
    } else if (platform.includes('mac') || userAgent.includes('mac')) {
      os = 'macos';
    } else if (platform.includes('linux') || userAgent.includes('linux')) {
      os = 'linux';
    }

    // Detect WSL2
    const isWSL2 = this.detectWSL2();

    // Detect Electron
    const isElectron = !!(window as any).electronAPI || 
                      !!(window as any).require || 
                      navigator.userAgent.includes('Electron');

    // Detect development mode
    const isDevelopment = process.env.NODE_ENV === 'development' || 
                         window.location.hostname === 'localhost' ||
                         window.location.hostname === '127.0.0.1';

    this.cachedEnvironment = {
      os,
      isWSL2,
      isElectron,
      isDevelopment
    };

    return this.cachedEnvironment;
  }

  /**
   * Check MIDI capabilities for the current environment
   */
  async checkMidiCapability(): Promise<MidiCapability> {
    if (this.cachedCapability) {
      return this.cachedCapability;
    }

    const environment = this.detectEnvironment();
    
    // Check Web MIDI API support
    const webMidiSupported = 'requestMIDIAccess' in navigator;
    let webMidiReasonIfUnsupported: string | undefined;
    
    if (!webMidiSupported) {
      webMidiReasonIfUnsupported = 'Browser does not support Web MIDI API';
    } else if (environment.isWSL2) {
      webMidiReasonIfUnsupported = 'WSL2 environment lacks USB MIDI device access';
    } else if (environment.os === 'linux' && !environment.isElectron) {
      webMidiReasonIfUnsupported = 'Linux browser may require additional MIDI permissions';
    }

    // Test actual Web MIDI access (with timeout)
    let actualWebMidiWorks = false;
    if (webMidiSupported && !webMidiReasonIfUnsupported) {
      try {
        const testAccess = await Promise.race([
          navigator.requestMIDIAccess({ sysex: false }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);
        actualWebMidiWorks = !!(testAccess as MIDIAccess);
      } catch (error) {
        webMidiReasonIfUnsupported = error instanceof Error ? error.message : 'Web MIDI access failed';
      }
    }

    // Native MIDI availability (theoretical - would need to implement)
    const nativeMidiAvailable = environment.isElectron && (
      environment.os === 'windows' || 
      environment.os === 'macos' || 
      (environment.os === 'linux' && !environment.isWSL2)
    );

    // Determine recommended approach
    let recommendedApproach: MidiCapability['recommendedApproach'];
    if (actualWebMidiWorks) {
      recommendedApproach = 'web-midi';
    } else if (nativeMidiAvailable) {
      recommendedApproach = 'native-midi';
    } else {
      recommendedApproach = 'virtual-only';
    }

    this.cachedCapability = {
      webMidiSupported: actualWebMidiWorks,
      webMidiReasonIfUnsupported,
      nativeMidiAvailable,
      recommendedApproach
    };

    return this.cachedCapability;
  }

  /**
   * Get setup instructions for the current platform
   */
  getRecommendedSetup(): SetupInstruction[] {
    const environment = this.detectEnvironment();
    
    if (environment.isWSL2) {
      return this.getWSL2SetupInstructions();
    } else if (environment.os === 'linux') {
      return this.getLinuxSetupInstructions();
    } else if (environment.os === 'windows') {
      return this.getWindowsSetupInstructions();
    } else if (environment.os === 'macos') {
      return this.getMacSetupInstructions();
    } else {
      return this.getUnknownPlatformInstructions();
    }
  }

  /**
   * Clear cached results (useful for testing or environment changes)
   */
  clearCache(): void {
    this.cachedEnvironment = null;
    this.cachedCapability = null;
  }

  // Private methods

  private detectWSL2(): boolean {
    // Multiple detection methods for WSL2
    const userAgent = navigator.userAgent.toLowerCase();
    const platform = navigator.platform.toLowerCase();
    
    // Check for WSL2 in user agent
    if (userAgent.includes('wsl')) {
      return true;
    }
    
    // Check for Linux platform with Windows-like characteristics
    if (platform.includes('linux')) {
      // Additional heuristics could be added here
      // For now, we'll be conservative and not assume WSL2
      return false;
    }
    
    return false;
  }

  private getWSL2SetupInstructions(): SetupInstruction[] {
    return [
      {
        title: 'Development Mode: Virtual Piano',
        description: 'For development in WSL2, use the built-in virtual piano which provides all practice features.',
        isOptional: false,
        difficulty: 'easy'
      },
      {
        title: 'Hardware MIDI: USB Forwarding (Advanced)',
        description: 'Forward USB MIDI devices from Windows host to WSL2 for hardware testing.',
        commands: [
          'winget install usbipd',
          'usbipd wsl list',
          'usbipd wsl attach --busid <BUSID> --distribution Ubuntu'
        ],
        isOptional: true,
        difficulty: 'advanced'
      },
      {
        title: 'Production Testing',
        description: 'Test MIDI hardware integration on Windows or macOS for production validation.',
        isOptional: true,
        difficulty: 'easy'
      }
    ];
  }

  private getLinuxSetupInstructions(): SetupInstruction[] {
    return [
      {
        title: 'Install ALSA MIDI Support',
        description: 'Install required Linux MIDI system components.',
        commands: [
          'sudo apt-get update',
          'sudo apt-get install alsa-utils alsa-plugins'
        ],
        isOptional: false,
        difficulty: 'medium'
      },
      {
        title: 'Configure User Permissions',
        description: 'Add your user to the audio group for MIDI device access.',
        commands: [
          'sudo usermod -a -G audio $USER',
          'newgrp audio  # or logout and login'
        ],
        isOptional: false,
        difficulty: 'medium'
      },
      {
        title: 'Set Device Permissions',
        description: 'Create udev rule for MIDI device permissions.',
        commands: [
          'echo \'SUBSYSTEM=="sound", GROUP="audio", MODE="0664"\' | sudo tee /etc/udev/rules.d/50-midi.rules',
          'sudo udevadm control --reload-rules'
        ],
        isOptional: true,
        difficulty: 'advanced'
      }
    ];
  }

  private getWindowsSetupInstructions(): SetupInstruction[] {
    return [
      {
        title: 'Connect MIDI Device',
        description: 'Connect your USB MIDI keyboard or controller to your computer.',
        isOptional: false,
        difficulty: 'easy'
      },
      {
        title: 'Driver Installation',
        description: 'Windows should automatically install MIDI drivers. If not, check manufacturer website.',
        isOptional: true,
        difficulty: 'easy'
      }
    ];
  }

  private getMacSetupInstructions(): SetupInstruction[] {
    return [
      {
        title: 'Connect MIDI Device',
        description: 'Connect your USB MIDI keyboard or controller to your Mac.',
        isOptional: false,
        difficulty: 'easy'
      },
      {
        title: 'Audio MIDI Setup (if needed)',
        description: 'Use Audio MIDI Setup app to configure advanced MIDI routing if needed.',
        isOptional: true,
        difficulty: 'medium'
      }
    ];
  }

  private getUnknownPlatformInstructions(): SetupInstruction[] {
    return [
      {
        title: 'Virtual Piano Mode',
        description: 'Use the built-in virtual piano for the full learning experience.',
        isOptional: false,
        difficulty: 'easy'
      },
      {
        title: 'Check Platform Support',
        description: 'Verify your platform supports Web MIDI API at https://caniuse.com/midi',
        isOptional: true,
        difficulty: 'easy'
      }
    ];
  }
}

// Export singleton instance
export const platformService = new PlatformDetectionService();

// Export types for use elsewhere
export type { PlatformEnvironment, MidiCapability, SetupInstruction };