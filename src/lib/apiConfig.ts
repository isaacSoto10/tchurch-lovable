const configuredApiBase = import.meta.env.VITE_API_URL || "http://localhost:3000/api";

export const API_BASE = configuredApiBase.replace(
  /^https:\/\/tchurchapp\.com\/api\/?$/,
  "https://www.tchurchapp.com/api",
);
