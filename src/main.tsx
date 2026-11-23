import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.tsx";
import { initializeMobileAuthSession } from "./lib/mobileAuth";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("is-native-app");
  void initializeMobileAuthSession().then(() => root.render(<App />));
} else {
  root.render(<App />);
}
