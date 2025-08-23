import React from 'react';
import './AlphaBanner.css';

export const AlphaBanner: React.FC = () => {
  return (
    <div className="alpha-banner">
      <span className="alpha-badge">ALPHA</span>
      <span className="alpha-text">Early Access - Expect Bugs!</span>
      <a 
        href="https://github.com/urtextpiano-dev/urtext-piano/issues" 
        target="_blank" 
        rel="noopener noreferrer"
        className="alpha-link"
      >
        Report Issues →
      </a>
    </div>
  );
};