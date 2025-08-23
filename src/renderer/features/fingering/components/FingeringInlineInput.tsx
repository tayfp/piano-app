import React, { useState, useEffect, useRef } from 'react';
import { FingeringPosition } from '../hooks/useFingeringInteraction';

// Constants for touch and non-touch device dimensions
const TOUCH_DEVICE_SIZE = 44;
const NON_TOUCH_WIDTH = 40;
const NON_TOUCH_HEIGHT = 30;

// Valid fingering range
const MIN_FINGERING = 1;
const MAX_FINGERING = 5;

interface FingeringInlineInputProps {
  position: FingeringPosition;
  initialValue?: number | null;
  onSubmit: (value: number | null) => void;
  onCancel: () => void;
}

export const FingeringInlineInput: React.FC<FingeringInlineInputProps> = ({
  position,
  initialValue,
  onSubmit,
  onCancel
}) => {
  const [value, setValue] = useState<string>('');
  const [isValid, setIsValid] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setValue(initialValue?.toString() || '');
    setIsValid(true);
    
    // Focus input with requestAnimationFrame for reliability
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [initialValue]);

  const validateAndSubmit = (inputValue: string) => {
    if (inputValue === '') {
      onSubmit(null); // Remove fingering
      return;
    }

    // Strict digits only validation - reject "1a", " 3", etc.
    const DIGITS_RE = /^\d+$/;
    if (!DIGITS_RE.test(inputValue)) {
      setIsValid(false);
      return;
    }

    const numValue = Number(inputValue);
    if (numValue < MIN_FINGERING || numValue > MAX_FINGERING) {
      setIsValid(false);
      return;
    }

    setIsValid(true);
    onSubmit(numValue);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    validateAndSubmit(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // Only cancel if focus leaves the entire input area
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      onCancel();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text/plain');
    
    // Extract first valid digit (1-5)
    const match = pastedText.match(new RegExp(`[${MIN_FINGERING}-${MAX_FINGERING}]`));
    if (match) {
      const digit = match[0];
      setValue(digit);
      setIsValid(true);
      // Auto-submit for consistency with typing behavior
      validateAndSubmit(digit);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    
    // Validate on change
    if (newValue === '') {
      setIsValid(true);
    } else {
      // Strict digits only validation - reject "1a", " 3", etc.
      const DIGITS_RE = /^\d+$/;
      if (!DIGITS_RE.test(newValue)) {
        setIsValid(false);
        return;
      }
      
      const numValue = Number(newValue);
      const isValidDigit = numValue >= MIN_FINGERING && numValue <= MAX_FINGERING;
      setIsValid(isValidDigit);
      
      // Auto-submit valid single digits
      if (isValidDigit && newValue.length === 1) {
        validateAndSubmit(newValue);
      }
    }
  };

  // Check if touch device - deferred to avoid SSR crashes
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  
  useEffect(() => {
    setIsTouchDevice('ontouchstart' in window);
  }, []);

  return (
    <div
      className="fingering-input-container"
      style={{
        position: 'absolute',
        left: position.x - 25, // Center the input
        top: position.y - 40,  // Position above the note
        zIndex: 1000,
        pointerEvents: 'auto'
      }}
    >
      <form onSubmit={handleSubmit} onBlur={handleBlur} className="fingering-input-form">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={`${MIN_FINGERING}-${MAX_FINGERING}`}
          aria-label={`Fingering number (${MIN_FINGERING}-${MAX_FINGERING})`}
          aria-invalid={!isValid}
          role="textbox"
          className="fingering-input"
          style={{
            width: isTouchDevice ? `${TOUCH_DEVICE_SIZE}px` : `${NON_TOUCH_WIDTH}px`,
            height: isTouchDevice ? `${TOUCH_DEVICE_SIZE}px` : `${NON_TOUCH_HEIGHT}px`,
            minWidth: isTouchDevice ? `${TOUCH_DEVICE_SIZE}px` : `${NON_TOUCH_WIDTH}px`,
            minHeight: isTouchDevice ? `${TOUCH_DEVICE_SIZE}px` : `${NON_TOUCH_HEIGHT}px`,
            textAlign: 'center',
            fontSize: isTouchDevice ? '16px' : '14px', // Prevent zoom on iOS
            border: isValid ? '2px solid #0066cc' : '2px solid #cc0000',
            borderRadius: '4px',
            backgroundColor: 'white',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
            outline: 'none'
          }}
          maxLength={1}
          pattern={`[${MIN_FINGERING}-${MAX_FINGERING}]`}
        />
        <div 
          className="fingering-input-help" 
          style={{
            fontSize: '10px',
            color: isValid ? '#666' : '#cc0000',
            marginTop: '2px',
            textAlign: 'center'
          }}
        >
          {isValid ? `${MIN_FINGERING}-${MAX_FINGERING} or empty to remove` : `Please enter ${MIN_FINGERING}-${MAX_FINGERING}`}
        </div>
      </form>
      
      {/* Touch area for better mobile interaction */}
      {isTouchDevice && (
        <div
          className="fingering-input-tap-area"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${TOUCH_DEVICE_SIZE}px`,
            height: `${TOUCH_DEVICE_SIZE}px`,
            cursor: 'pointer',
            pointerEvents: 'none' // Let input handle events
          }}
        />
      )}
    </div>
  );
};