import React from 'react';

export interface FingeringElementProps {
  noteId: string;
  finger: number;
  position: { x: number; y: number };
  zoomLevel?: number;
  isEditing?: boolean;
  interactive?: boolean;
  onClick?: (noteId: string, finger: number, event: React.MouseEvent) => void;
}

/**
 * Individual fingering element component
 * Renders a single fingering number with zoom-aware styling and interaction
 */
export const FingeringElement: React.FC<FingeringElementProps> = ({
  noteId,
  finger,
  position,
  zoomLevel = 1.0,
  isEditing = false,
  interactive = false,
  onClick
}) => {
  const handleClick = (event: React.MouseEvent) => {
    if (interactive && onClick) {
      event.stopPropagation(); // Prevent OSMD handling
      onClick(noteId, finger, event);
    }
  };

  // Calculate zoom-aware styling
  const fontSize = Math.min(20, Math.max(9, 12 * Math.sqrt(Math.max(0.25, zoomLevel))));
  const strokeWidth = Math.min(2.5, Math.max(0.75, 1.5 * Math.sqrt(Math.max(0.25, zoomLevel))));

  return (
    <text
      key={`${noteId}-${finger}`}
      x={position.x}
      y={position.y}
      className={`fingering-number ${isEditing ? 'editing' : ''}`}
      aria-label={`Fingering ${finger} for note ${noteId}`}
      role="img"
      style={{
        // Damped scaling: text scales WITH zoom but slower
        fontSize: `${fontSize}px`,
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
        // Theme-aware colors with fallbacks
        fill: isEditing ? 'var(--abc-accent-primary, #0066cc)' : 'var(--abc-sheet-ink, #000080)',
        // Contrast stroke with background color
        stroke: 'var(--abc-bg-primary, #ffffff)',
        strokeWidth: `${strokeWidth}px`,
        paintOrder: 'stroke',
        textAnchor: 'middle',
        dominantBaseline: 'central',
        pointerEvents: 'auto',
        userSelect: 'none',
        cursor: interactive ? 'pointer' : 'default'
      }}
      data-testid={`fingering-${noteId}-${finger}`}
      onClick={handleClick}
    >
      {finger}
    </text>
  );
};