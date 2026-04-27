import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@app': path.resolve(__dirname, 'src/app'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@game': path.resolve(__dirname, 'src/game'),
      '@render': path.resolve(__dirname, 'src/render'),
      '@lib': path.resolve(__dirname, 'src/lib'),
    },
  },
});
