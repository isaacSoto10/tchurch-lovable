import type { CapacitorConfig } from '@capacitor/cli';

const productionWebAppUrl = 'https://tchurchapp.com';

const config: CapacitorConfig = {
  appId: 'app.lovable.e5ddf50ff80d4eb7a86a937f7a9f8a62.tchurch',
  appName: 'Tchurch',
  webDir: 'dist',
  server: {
    url: productionWebAppUrl,
    cleartext: false,
    hostname: 'tchurchapp.com',
    iosScheme: 'tchurchapp',
    androidScheme: 'https',
  },
};

export default config;
