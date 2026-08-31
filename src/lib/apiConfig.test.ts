import { describe, expect, it } from "vitest";

import {
  ApiBaseConfigurationError,
  PRODUCTION_API_BASE,
  resolveApiBaseUrl,
} from "./apiConfig";

describe("resolveApiBaseUrl", () => {
  it("defaults to the canonical production API", () => {
    expect(resolveApiBaseUrl()).toBe(PRODUCTION_API_BASE);
    expect(resolveApiBaseUrl(null)).toBe(PRODUCTION_API_BASE);
    expect(resolveApiBaseUrl("")).toBe(PRODUCTION_API_BASE);
  });

  it.each([
    "https://www.tchurchapp.com/api",
    "https://www.tchurchapp.com/api/",
    "https://tchurchapp.com/api",
    "https://tchurchapp.com/api/",
  ])("canonicalizes the approved endpoint %s", (value) => {
    expect(resolveApiBaseUrl(value)).toBe(PRODUCTION_API_BASE);
  });

  it.each([
    "http://www.tchurchapp.com/api",
    "http://tchurchapp.com/api",
    "https://localhost:3000/api",
    "http://localhost:3000/api",
    "https://127.0.0.1/api",
    "https://tchurch-native-staging-api.example.com/api",
    "https://9iwar7xu.us-east.insforge.app/api",
    "https://api.example.com/api",
    "https://tchurchapp.com/",
    "https://www.tchurchapp.com",
    "https://www.tchurchapp.com/api/v1",
    "https://www.tchurchapp.com/api/other",
    "https://www.tchurchapp.com/api?environment=production",
    "https://www.tchurchapp.com/api#fragment",
    "https://user:password@www.tchurchapp.com/api",
    "https://www.tchurchapp.com:443/api",
    "https://www.tchurchapp.com/api%2F",
    "https://www.tchurchapp.com/api/ ",
    " www.tchurchapp.com/api",
    "not a url",
  ])("rejects an unapproved endpoint: %s", (value) => {
    expect(() => resolveApiBaseUrl(value)).toThrow(ApiBaseConfigurationError);
  });

  it.each([
    "https://user:secret-password@www.tchurchapp.com/api",
    "https://www.tchurchapp.com/api?token=secret-token",
    "https://www.tchurchapp.com/api#secret-fragment",
  ])("does not echo sensitive endpoint input", (value) => {
    try {
      resolveApiBaseUrl(value);
      throw new Error("expected resolver to reject the endpoint");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiBaseConfigurationError);
      expect((error as Error).message).not.toContain("secret");
    }
  });
});
