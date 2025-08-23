import React from 'react';
import './AppLayout.css';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return (
    <div className="app-layout-root">
      <div className="app-layout-content">
        {children}
      </div>
    </div>
  );
};