import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_OBS_WEBSOCKET_ENDPOINT,
  DEFAULT_PROPRESENTER_ENDPOINT,
  disconnectActivePresentationObsConnection,
  getActivePresentationObsConnection,
  installPresentationObsBackgroundLifecycle,
  ObsWebSocketClient,
  normalizeObsProtocolFrame,
  normalizePresentationConnectorEndpoint,
  normalizePresentationLocalConnectorSettings,
  presentationConnectorStorageKey,
  readPresentationLocalConnectorSettings,
  requestProPresenter,
  setActivePresentationObsConnection,
  validatePresentationConnectorResponseUrl,
  writePresentationLocalConnectorSettings,
} from "./presentationLocalConnectors";

describe("local presentation connectors", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    disconnectActivePresentationObsConnection();
  });

  it("accepts only loopback and private LAN connector endpoints", () => {
    expect(normalizePresentationConnectorEndpoint("http://localhost:50001", "propresenter")).toBe(DEFAULT_PROPRESENTER_ENDPOINT);
    expect(normalizePresentationConnectorEndpoint("http://192.168.1.24:50001", "propresenter")).toBe("http://192.168.1.24:50001");
    expect(normalizePresentationConnectorEndpoint("ws://10.0.0.4:4455", "obs")).toBe("ws://10.0.0.4:4455");
    expect(() => normalizePresentationConnectorEndpoint("https://example.com/internal", "propresenter")).toThrow(/red local/i);
    expect(() => normalizePresentationConnectorEndpoint("http://user:secret@localhost:50001", "propresenter")).toThrow(/credenciales/i);
    expect(() => normalizePresentationConnectorEndpoint("file:///tmp/obs", "obs")).toThrow(/ws:\/\//i);
  });

  it("persists endpoints but never connector passwords", () => {
    const settings = writePresentationLocalConnectorSettings("church-1", {
      schemaVersion: 1,
      propresenterEndpoint: "http://localhost:50001",
      obsEndpoint: "ws://localhost:4455",
      studioBridgeEndpoint: "http://localhost:4317",
    });
    expect(readPresentationLocalConnectorSettings("church-1")).toEqual(settings);
    const stored = localStorage.getItem(presentationConnectorStorageKey("church-1"));
    expect(stored).not.toMatch(/password|secret|token/i);
    expect(normalizePresentationLocalConnectorSettings({ schemaVersion: 2, obsEndpoint: "ws://10.0.0.1:4455" }).obsEndpoint).toBe(DEFAULT_OBS_WEBSOCKET_ENDPOINT);
  });

  it("fails closed on malformed OBS protocol frames", () => {
    expect(normalizeObsProtocolFrame({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1 } })).toEqual({ op: 0, d: { obsWebSocketVersion: "5.5.0", rpcVersion: 1 } });
    expect(normalizeObsProtocolFrame({ op: 2, d: { negotiatedRpcVersion: 1 } })).toEqual({ op: 2, d: { negotiatedRpcVersion: 1 } });
    expect(() => normalizeObsProtocolFrame({ op: 7, d: { requestId: "x" } })).toThrow(/inválida/i);
    expect(() => normalizeObsProtocolFrame({ op: 7, d: { requestType: "GetVersion", requestId: "x", requestStatus: { result: true, code: 101 } } })).toThrow(/inválida/i);
    expect(() => normalizeObsProtocolFrame({ op: 5, d: {} })).toThrow(/no esperada/i);
    expect(() => normalizeObsProtocolFrame({ op: 2, d: { negotiatedRpcVersion: 2 } })).toThrow(/RPC 1/i);
  });

  it("simulates every mutating ProPresenter action during rehearsal", async () => {
    await expect(requestProPresenter(DEFAULT_PROPRESENTER_ENDPOINT, "next", { mode: "rehearsal" })).resolves.toEqual({ simulated: true, action: "next" });
  });

  it("uses the active-presentation route and revalidates browser response URLs", async () => {
    const request = vi.fn(async () => ({ ok: true, status: 200, url: "http://localhost:50001/v1/presentation/active/next/trigger", text: async () => "" }));
    await expect(requestProPresenter(DEFAULT_PROPRESENTER_ENDPOINT, "next", { mode: "live" }, { isNativePlatform: () => false, nativeGet: vi.fn(), browserFetch: request as unknown as typeof fetch })).resolves.toEqual({ simulated: false, action: "next" });
    expect(request).toHaveBeenCalledWith("http://localhost:50001/v1/presentation/active/next/trigger", expect.objectContaining({ redirect: "error", credentials: "omit" }));
    expect(() => validatePresentationConnectorResponseUrl("http://evil.example/v1/presentation/active/next/trigger", DEFAULT_PROPRESENTER_ENDPOINT, "/v1/presentation/active/next/trigger", "propresenter")).toThrow(/otra dirección/i);
  });

  it("uses CapacitorHttp natively with redirects disabled, bounded timeouts, and a private final URL", async () => {
    const nativeGet = vi.fn().mockResolvedValue({
      data: JSON.stringify({ version: "20.1", platform: "macOS", name: "ProPresenter" }),
      status: 200,
      headers: {},
      url: "http://192.168.1.24:50001/version",
    });
    const runtime = { isNativePlatform: () => true, nativeGet, browserFetch: vi.fn() as unknown as typeof fetch };
    await expect(requestProPresenter("http://192.168.1.24:50001", "status", { mode: "live" }, runtime)).resolves.toMatchObject({ connected: true, version: "20.1", host: "192.168.1.24:50001" });
    expect(nativeGet).toHaveBeenCalledWith(expect.objectContaining({ url: "http://192.168.1.24:50001/version", connectTimeout: 5_000, readTimeout: 5_000, disableRedirects: true }));
    nativeGet.mockResolvedValueOnce({ data: "", status: 200, headers: {}, url: "https://public.example/version" });
    await expect(requestProPresenter("http://192.168.1.24:50001", "status", { mode: "live" }, runtime)).rejects.toThrow(/otra dirección/i);
  });

  it("does not expose an OBS password as durable client state", () => {
    const client = new ObsWebSocketClient();
    expect(JSON.stringify(client)).not.toMatch(/password|secret/i);
  });

  it("disconnects a global OBS socket on background even after its panel is unmounted", async () => {
    let appStateListener: ((state: { isActive: boolean }) => void) | null = null;
    let visibilityListener: (() => void) | null = null;
    let hidden = false;
    const removeApp = vi.fn();
    const removeVisibility = vi.fn();
    const firstClient = { isConnected: true, disconnect: vi.fn() } as unknown as ObsWebSocketClient;
    setActivePresentationObsConnection({ client: firstClient, endpoint: "ws://localhost:4455", version: "5.5.0", scope: "scope-1" });
    const cleanup = installPresentationObsBackgroundLifecycle({
      addAppStateListener: async (listener) => { appStateListener = listener; return { remove: removeApp }; },
      addVisibilityListener: (listener) => { visibilityListener = listener; return removeVisibility; },
      isDocumentHidden: () => hidden,
    });
    await Promise.resolve();
    expect(getActivePresentationObsConnection("scope-1")?.client).toBe(firstClient);
    appStateListener?.({ isActive: false });
    expect(firstClient.disconnect).toHaveBeenCalledOnce();
    expect(getActivePresentationObsConnection()).toBeNull();

    const secondClient = { isConnected: true, disconnect: vi.fn() } as unknown as ObsWebSocketClient;
    setActivePresentationObsConnection({ client: secondClient, endpoint: "ws://localhost:4455", version: "5.5.0", scope: "scope-1" });
    hidden = true;
    visibilityListener?.();
    expect(secondClient.disconnect).toHaveBeenCalledOnce();
    expect(getActivePresentationObsConnection()).toBeNull();
    cleanup();
    expect(removeVisibility).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(removeApp).toHaveBeenCalledOnce();
    disconnectActivePresentationObsConnection();
  });

  it("limits iOS transport exceptions to the user-selected local network", () => {
    const plist = readFileSync("ios/App/App/Info.plist", "utf8");
    expect(plist).toContain("NSLocalNetworkUsageDescription");
    expect(plist).toContain("NSAllowsLocalNetworking");
    expect(plist).not.toContain("NSAllowsArbitraryLoads");
    expect(plist).not.toContain("_obs-websocket._tcp");
  });
});
