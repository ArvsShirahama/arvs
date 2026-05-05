import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arvin.arvs',
  appName: 'arvs',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
