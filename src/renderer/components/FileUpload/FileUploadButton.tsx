import React, { useCallback, useRef, useState, useEffect } from 'react';
import { useSheetMusicStore } from '../../stores/sheetMusicStore';
import { perfLogger } from '@/renderer/utils/performance-logger';
import './FileUpload.css';

export interface FileUploadButtonProps {
  variant?: 'primary' | 'secondary';
  className?: string;
  showRecent?: boolean; // Version New prop for recent files
}

export const FileUploadButton = React.forwardRef<HTMLButtonElement, FileUploadButtonProps>(({ 
  variant = 'primary',
  className = '',
  showRecent = true
}, ref) => {
  const { 
    loadFromDialog, 
    loadState, 
    error, 
    fileName,
    clearError,
    recentFiles, // Version Recent files from store
    clearRecentFiles // Version Clear method
  } = useSheetMusicStore();
  
  // Version Dropdown state management
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const handleClick = useCallback(async () => {
    if (loadState === 'loading') return;
    await loadFromDialog();
  }, [loadFromDialog, loadState]);
  
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  }, [handleClick]);
  
  // Version Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDropdown(false);
      }
    };
    
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscapeKey);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        document.removeEventListener('keydown', handleEscapeKey);
      };
    }
  }, [showDropdown]);
  
  // Version File size formatting utility
  const formatFileSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }, []);
  
  // Version Date formatting utility
  const formatDate = useCallback((dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  }, []);
  
  return (
    <div className={`file-upload-container ${className}`}>
      {/* Version Button group with optional dropdown trigger */}
      <div className="file-upload-group">
        <button 
          ref={ref}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          disabled={loadState === 'loading'}
          className={`file-upload-button file-upload-button--${variant}`}
          aria-label="Load music score file"
          aria-busy={loadState === 'loading'}
        >
          {loadState === 'loading' ? (
            <>
              <span className="file-upload-spinner" aria-hidden="true" />
              <span>Loading...</span>
            </>
          ) : (
            <>
              <svg 
                className="file-upload-icon" 
                width="20" 
                height="20" 
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" fill="currentColor"/>
              </svg>
              <span>Load Score</span>
            </>
          )}
        </button>
        
        {/* Version Recent files dropdown trigger */}
        {showRecent && recentFiles.length > 0 && (
          <button
            className={`file-upload-dropdown-trigger file-upload-button--${variant}`}
            onClick={() => setShowDropdown(!showDropdown)}
            aria-label="Show recent files"
            aria-expanded={showDropdown}
            aria-haspopup="menu"
            type="button"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 10l5 5 5-5H7z" fill="currentColor"/>
            </svg>
          </button>
        )}
      </div>
      
      {/* Version Recent files dropdown */}
      {showDropdown && recentFiles.length > 0 && (
        <div 
          ref={dropdownRef}
          className="file-upload-dropdown"
          role="menu"
          aria-label="Recent files"
        >
          <div className="file-upload-dropdown-header">Recent Files</div>
          {recentFiles.slice(0, 5).map((file, index) => (
            <button
              key={`${file.name}-${file.lastOpened}-${index}`}
              className="file-upload-dropdown-item"
              onClick={() => {
                setShowDropdown(false);
                // Version Recent file loading will be implemented
                // when we add IPC support for file paths
                if (process.env.NODE_ENV === 'development') {
                  perfLogger.debug('Load recent file requested:', file.name);
                }
              }}
              role="menuitem"
              type="button"
            >
              <svg className="file-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z" fill="currentColor"/>
              </svg>
              <div className="file-info">
                <span className="file-name">{file.name}</span>
                <span className="file-meta">
                  {formatFileSize(file.size)} • {formatDate(file.lastOpened)}
                </span>
              </div>
            </button>
          ))}
          <button
            className="file-upload-dropdown-item file-upload-dropdown-clear"
            onClick={() => {
              setShowDropdown(false);
              clearRecentFiles();
            }}
            role="menuitem"
            type="button"
          >
            Clear Recent Files
          </button>
        </div>
      )}
      
      {fileName && loadState === 'success' && (
        <div className="file-upload-status" role="status" aria-live="polite">
          <svg className="status-icon status-icon--success" width="16" height="16" viewBox="0 0 24 24">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/>
          </svg>
          <span className="status-text">{fileName}</span>
        </div>
      )}
      
      {error && loadState === 'error' && (
        <div className="file-upload-error" role="alert" aria-live="assertive">
          <svg className="error-icon" width="16" height="16" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" fill="currentColor"/>
          </svg>
          <span className="error-text">{error}</span>
          <button 
            className="error-dismiss"
            onClick={clearError}
            aria-label="Dismiss error"
            type="button"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
});

FileUploadButton.displayName = 'FileUploadButton';