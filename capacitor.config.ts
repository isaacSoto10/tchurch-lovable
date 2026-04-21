import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.tchurchapp.tchurch',
  appName: 'Tchurch',
  webDir: 'dist',
  server: {
    iosScheme: 'https',
    androidScheme: 'https',
  },
};

export default config;
