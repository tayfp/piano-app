/**
 * Mock implementation of FingeringPersistence for testing
 */

// In-memory storage for tests - create a new instance for each test
let mockStorage = new Map<string, any>();

export class FingeringPersistence {
  private mockDB = {
    fingeringAnnotations: {
      put: jest.fn(),
      count: jest.fn().mockResolvedValue(0)
    }
  };

  getDatabase() {
    return this.mockDB;
  }

  async saveFingering(scoreId: string, noteId: string, finger: number): Promise<void> {
    const key = `${scoreId}:${noteId}`;
    mockStorage.set(key, { id: Date.now(), scoreId, noteId, finger });
  }

  async loadFingerings(scoreId: string): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const [key, value] of mockStorage) {
      if (value.scoreId === scoreId) {
        result[value.noteId] = value.finger;
      }
    }
    return result;
  }

  async getFingeringAnnotation(scoreId: string, noteId: string): Promise<any> {
    const key = `${scoreId}:${noteId}`;
    return mockStorage.get(key) || null;
  }

  async removeFingering(scoreId: string, noteId: string): Promise<void> {
    const key = `${scoreId}:${noteId}`;
    mockStorage.delete(key);
  }

  async isDatabaseReady(): Promise<boolean> {
    return true;
  }

  async clearFingeringsForScore(scoreId: string): Promise<void> {
    for (const [key, value] of mockStorage) {
      if (value.scoreId === scoreId) {
        mockStorage.delete(key);
      }
    }
  }

  async saveFingeringsBatch(scoreId: string, fingerings: Record<string, number>): Promise<void> {
    for (const [noteId, finger] of Object.entries(fingerings)) {
      await this.saveFingering(scoreId, noteId, finger);
    }
  }
}

export const fingeringPersistence = new FingeringPersistence();

// Helper to clear mock storage between tests
export const clearMockStorage = () => {
  mockStorage = new Map<string, any>();
};