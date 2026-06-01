import assert from "node:assert/strict";
import test from "node:test";
import { apiFetch, API_TOKEN_STORAGE_KEY, readApiToken, subscribeToDeltas } from "../../src/api";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) || null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

test("API token is read from URL hash, stored for fetch headers, and stripped from browser history", () => {
  const storage = new MemoryStorage();
  const replacedUrls: string[] = [];
  withWindow({
    hash: "#token=local-token",
    storage,
    replacedUrls
  }, () => {
    assert.equal(readApiToken(), "local-token");
    assert.equal(storage.getItem(API_TOKEN_STORAGE_KEY), "local-token");
    assert.deepEqual(replacedUrls, ["/atlas?mode=radar"]);
  });
});

test("API token hash stripping preserves unrelated hash state", () => {
  const storage = new MemoryStorage();
  const replacedUrls: string[] = [];
  withWindow({
    hash: "#mode=radar&living_atlas_token=local-token",
    storage,
    replacedUrls
  }, () => {
    assert.equal(readApiToken(), "local-token");
    assert.deepEqual(replacedUrls, ["/atlas?mode=radar#mode=radar"]);
  });
});

test("API token falls back to session storage when hash has no token", () => {
  const storage = new MemoryStorage();
  storage.setItem(API_TOKEN_STORAGE_KEY, "stored-token");
  withWindow({
    hash: "",
    storage,
    replacedUrls: []
  }, () => {
    assert.equal(readApiToken(), "stored-token");
  });
});

test("API fetch uses Authorization header from the stored local token", async () => {
  const storage = new MemoryStorage();
  storage.setItem(API_TOKEN_STORAGE_KEY, "stored-token");
  let capturedHeaders: HeadersInit | undefined;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: string, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("{}", { status: 200 });
    }
  });
  await withWindow({
    hash: "",
    storage,
    replacedUrls: []
  }, async () => {
    await apiFetch("http://127.0.0.1:8787/api/health");
  });
  assert.deepEqual(capturedHeaders, { Authorization: "Bearer stored-token" });
  Reflect.deleteProperty(globalThis, "fetch");
});

test("SSE subscription uses query token because EventSource cannot send headers", () => {
  const storage = new MemoryStorage();
  storage.setItem(API_TOKEN_STORAGE_KEY, "stored-token");
  let eventSourceUrl = "";
  class FakeEventSource {
    constructor(url: string) {
      eventSourceUrl = url;
    }

    addEventListener() {}

    close() {}
  }
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: FakeEventSource
  });
  withWindow({
    hash: "",
    storage,
    replacedUrls: []
  }, () => {
    const source = subscribeToDeltas(() => undefined);
    source?.close();
  });
  assert.equal(eventSourceUrl, "http://127.0.0.1:8787/api/events?token=stored-token");
  Reflect.deleteProperty(globalThis, "EventSource");
});

function withWindow(
  options: { hash: string; storage: MemoryStorage; replacedUrls: string[] },
  callback: () => void | Promise<void>
) {
  const fakeWindow = {
    document: { title: "Living Atlas" },
    history: {
      replaceState(_state: unknown, _title: string, url: string) {
        options.replacedUrls.push(url);
      }
    },
    location: {
      hash: options.hash,
      origin: "http://127.0.0.1:8787",
      pathname: "/atlas",
      search: "?mode=radar"
    },
    sessionStorage: options.storage
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow
  });
  try {
    return callback();
  } finally {
    Reflect.deleteProperty(globalThis, "window");
  }
}
