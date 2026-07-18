import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch',
  appName: 'Tchurch',
  webDir: 'dist',
  loggingBehavior: 'none',
  server: {
    hostname: 'tchurchapp.com',
    iosScheme: 'tchurchapp',
    androidScheme: 'https',
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

export default config;
