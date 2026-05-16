import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App.tsx";
import "./index.css";

if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("is-native-app");
}

createRoot(document.getElementById("root")!).render(<App />);
