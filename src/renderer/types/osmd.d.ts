// Type declarations for OpenSheetMusicDisplay
// This helps with module resolution in tests

declare module 'opensheetmusicdisplay' {
  export class OpenSheetMusicDisplay {
    constructor(container: HTMLElement, options?: any);
    load(xml: string): Promise<void>;
    render(): void;
    clear(): void;
    graphic: any;
    cursor?: Cursor;
    cursors?: Cursor[];
    GraphicSheet?: {
      MeasureList: any[][];
    };
    enableOrDisableCursors(enable: boolean): void;
  }
  
  export interface Cursor {
    show(): void;
    hide(): void;
    next(): void;
    previous(): void;
    update(): void;
    reset(): void;
    resetIterator?(): void;
    visible?: boolean;
    iterator?: CursorIterator;
  }
  
  export interface CursorIterator {
    currentMeasureIndex: number;
    currentVoiceEntryIndex?: number;
    EndReached?: boolean;
    endReached?: boolean;
    CurrentVoiceEntries?: VoiceEntry[];
  }
  
  export interface VoiceEntry {
    Notes?: Note[];
    notes?: Note[];
    IsGrace?: boolean;
  }
  
  export interface Note {
    halfTone?: number;
    HalfTone?: number;
    Pitch?: Pitch;
    pitch?: Pitch;
    Tie?: {
      StartNote: Note;
    };
  }
  
  export interface Pitch {
    toString?(): string;
    Octave?: number;
    octave?: number;
  }
  
  export interface IOSMDOptions {
    autoResize?: boolean;
    backend?: string;
    drawTitle?: boolean;
    drawComposer?: boolean;
    drawingParameters?: string;
    pageFormat?: string;
    pageBackgroundColor?: string;
    drawSlurs?: boolean;
    drawFingerings?: boolean;
    drawMeasureNumbers?: boolean;
    drawPartNames?: boolean;
    cursorsOptions?: any[];
    drawCursors?: boolean;
    followCursor?: boolean;
    renderSingleHorizontalStaffline?: boolean;
  }
  
  export interface GraphicalNote {
    sourceNote: any;
    getSVGGElement?: () => SVGGElement | null;
  }
  
  export interface SourceStaffEntry {
    absoluteTimestamp: {
      realValue: number;
    };
  }
}