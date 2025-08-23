import { ipcMain } from 'electron';
import { performanceLogger } from '../utils/performanceLogger';

/**
 * Registers performance monitoring IPC handlers (development only)
 */
export function registerPerformanceHandlers(): void {
  // Only register in development mode
  if (process.env.NODE_ENV !== 'development') {
    return;
  }
  
  ipcMain.handle('performance:getReport', async (): Promise<any> => {
    return performanceLogger.getReport();
  });
  
  ipcMain.handle('performance:getMeasures', async (): Promise<any> => {
    return performanceLogger.getMeasures();
  });
  
  ipcMain.handle('performance:reset', async (): Promise<{ success: boolean }> => {
    performanceLogger.reset();
    return { success: true };
  });
}