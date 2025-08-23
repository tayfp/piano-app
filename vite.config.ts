import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    // Build preload script for production
    {
      name: 'build-preload',
      apply: 'build',
      generateBundle() {
        // Use esbuild to compile preload script
        const esbuild = require('esbuild');
        const preloadPath = path.resolve(__dirname, 'src/main/preload.ts');
        const outputPath = path.resolve(__dirname, 'dist/preload.js');
        
        esbuild.buildSync({
          entryPoints: [preloadPath],
          bundle: true,
          platform: 'node',
          format: 'cjs',
          target: 'node16',
          outfile: outputPath,
          external: ['electron'],
          minify: false, // Keep readable for debugging
        });
        
        console.log('✓ Preload script compiled for production');
      }
    }
  ],
  define: {
    // Make process.env available for legacy code
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'src/renderer/index.html'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@main': path.resolve(__dirname, 'src/main'),
    },
  },
  server: {
    port: 3000,
  },
});