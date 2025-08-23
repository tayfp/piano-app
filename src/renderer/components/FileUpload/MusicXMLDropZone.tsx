import React, { useCallback, useState, useRef, useEffect } from 'react';
import { useSheetMusicStore } from '../../stores/sheetMusicStore';
import { getFileLoader } from '../../services/FileLoaderService';
import { perfLogger } from '@/renderer/utils/performance-logger';
import './FileUpload.css';

export interface MusicXMLDropZoneProps {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export const MusicXMLDropZone: React.FC<MusicXMLDropZoneProps> = ({ 
  children, 
  className = '',
  disabled = false 
}) => {
  const { loadState } = useSheetMusicStore();
  const [dragState, setDragState] = useState<'idle' | 'over' | 'invalid'>('idle');
  const dragCounter = useRef(0);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  
  // Validate file type
  const isValidFileType = useCallback((file: File): boolean => {
    const validTypes = ['.xml', '.musicxml', '.mxl'];
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    return validTypes.includes(ext);
  }, []);
  
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    dragCounter.current = 0;
    
    if (disabled || loadState === 'loading') {
      setDragState('idle');
      return;
    }
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) {
      setDragState('idle');
      return;
    }
    
    const file = files[0]; // Only handle first file
    
    if (!isValidFileType(file)) {
      setDragState('invalid');
      setTimeout(() => setDragState('idle'), 750);
      return;
    }
    
    setDragState('idle');
    
    try {
      // Use FileLoaderService to handle the file (delegates properly)
      const fileLoader = getFileLoader();
      const result = await fileLoader.loadFromFile(file);
      
      if (result && result.content) {
        // The FileLoaderService handles IPC communication and validation
        // The result should be processed through the store's existing loadFromFile method
        const store = useSheetMusicStore.getState();
        await store.loadFromFile(result.fileName, result.content, result.fileSize);
      }
    } catch (error) {
      perfLogger.error('Drag-drop file loading error:', error instanceof Error ? error : undefined);
      // Error will be handled by the store and displayed in UI
    }
  }, [disabled, loadState, isValidFileType]);
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    dragCounter.current++;
    
    if (disabled || loadState === 'loading') return;
    
    // Check if dragging files (not text or other elements)
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      const item = e.dataTransfer.items[0];
      if (item.kind === 'file') {
        setDragState('over');
      }
    }
  }, [disabled, loadState]);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    dragCounter.current--;
    
    if (dragCounter.current === 0) {
      setDragState('idle');
    }
  }, []);
  
  // Reset drag counter on unmount
  useEffect(() => {
    return () => {
      dragCounter.current = 0;
    };
  }, []);
  
  return (
    <div
      ref={dropZoneRef}
      className={`drop-zone drop-zone--${dragState} ${disabled ? 'drop-zone--disabled' : ''} ${className}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      aria-label="Drag and drop zone for MusicXML files"
      role="region"
    >
      {children}
      
      {dragState === 'over' && (
        <div className="drop-zone__overlay" aria-hidden="true">
          <div className="drop-zone__content">
            <svg className="drop-zone__icon" width="64" height="64" viewBox="0 0 24 24">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" fill="currentColor"/>
            </svg>
            <p className="drop-zone__text">Drop your MusicXML file here!</p>
            <p className="drop-zone__hint">Supports .xml, .musicxml, and .mxl files</p>
          </div>
        </div>
      )}
      
      {dragState === 'invalid' && (
        <div className="drop-zone__error" role="alert" aria-live="assertive">
          <p>Only .xml, .musicxml, and .mxl files are supported</p>
        </div>
      )}
    </div>
  );
};