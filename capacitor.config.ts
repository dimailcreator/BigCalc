import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.bigcalc.app",
  appName: "BigCalc",
  webDir: "dist-app",
  server: {
    androidScheme: "https"
  }
};

export default config;
