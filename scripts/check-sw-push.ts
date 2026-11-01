// Regressão de public/sw.js sem navegador: push, clique na notificação e política de cache.
// O arquivo real roda num contexto vm com self, clients e caches falsos.
//
//   npm run check:sw-push
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ORIGIN = "https://smv.example";

type Listener = (event: unknown) => void;
type Shown = { title: string; options: { body?: string; icon?: string; data?: { url?: string } } };

class FakeWindow {
  focused = false;
  constructor(
    public url: string,
    private readonly controlled = true,
  ) {}
  async focus() {
    this.focused = true;
    return this;
  }
  async navigate(url: string) {
    if (!this.controlled) throw new TypeError("not controlled");
    this.url = url;
    return this;
  }
}

function loadWorker() {
  const listeners = new Map<string, Listener>();
  const shown: Shown[] = [];
  const opened: string[] = [];
  const precached: string[] = [];
  let windows: FakeWindow[] = [];

  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (title: string, options: Shown["options"]) => {
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => windows,
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
  };
  const context = vm.createContext({
    self,
    URL,
    console,
    Request: class {
      constructor(public url: string) {}
    },
    Response: { error: () => ({ type: "error" }) },
    fetch: async () => ({ ok: true, type: "basic", clone: () => ({}) }),
    caches: {
      open: async () => ({
        addAll: async (requests: { url: string }[]) => precached.push(...requests.map((r) => r.url)),
        match: async () => undefined,
        put: async () => undefined,
        keys: async () => [],
        delete: async () => true,
      }),
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
  });
  vm.runInContext(readFileSync(path.resolve("public/sw.js"), "utf8"), context, { filename: "sw.js" });

  async function dispatch(type: string, event: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    const listener = listeners.get(type);
    if (!listener) throw new Error(`sem listener de ${type}`);
    listener({ ...event, waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
  }

  return {
    listeners,
    shown,
    opened,
    precached,
    setWindows: (list: FakeWindow[]) => {
      windows = list;
    },
    dispatch,
    push: (data: { json(): unknown } | null) => dispatch("push", { data }),
    click: async (data: unknown) => {
      let closed = false;
      await dispatch("notificationclick", { notification: { data, close: () => (closed = true) } });
      return closed;
    },
    fetch: (request: { method: string; url: string; mode: string }) => {
      let responded = false;
      listeners.get("fetch")!({ request, respondWith: () => (responded = true) });
      return responded;
    },
  };
}

const json = (value: unknown) => ({ json: () => value });
const text = (raw: string) => ({ json: () => JSON.parse(raw) });

const results: { name: string; ok: boolean }[] = [];
function check(name: string, ok: boolean) {
  results.push({ name, ok });
}

async function main() {
  // --- push ---
  {
    const sw = loadWorker();
    await sw.push(json({ title: "Lista aberta", body: "Responda até 15h.", url: "/sessions" }));
    const [n] = sw.shown;
    check(
      "push válido mostra título, texto e URL interna",
      n?.title === "Lista aberta" && n.options.body === "Responda até 15h." && n.options.data?.url === `${ORIGIN}/sessions`,
    );
    check("push usa o ícone do app", n?.options.icon === "/icons/icon-192.png");
  }
  {
    const sw = loadWorker();
    await sw.push(null);
    check("push sem payload mostra aviso genérico", sw.shown[0]?.title === "SMV" && sw.shown[0].options.data?.url === `${ORIGIN}/`);
  }
  {
    const sw = loadWorker();
    await sw.push(text("{not json"));
    check("push com JSON inválido mostra aviso genérico", sw.shown.length === 1 && sw.shown[0].title === "SMV");
  }
  {
    const sw = loadWorker();
    await sw.push(json(["array"]));
    await sw.push(json("texto"));
    await sw.push(json({ title: 42, body: null, url: { x: 1 } }));
    check(
      "push com tipos errados usa valores padrão",
      sw.shown.length === 3 && sw.shown.every((n) => n.title === "SMV" && n.options.data?.url === `${ORIGIN}/`),
    );
  }
  {
    const sw = loadWorker();
    const urls = ["https://evil.example/x", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "sessions"];
    for (const url of urls) await sw.push(json({ title: "a", body: "b", url }));
    check("push com URL externa ou inválida abre /", sw.shown.every((n) => n.options.data?.url === `${ORIGIN}/`));
  }
  {
    const sw = loadWorker();
    await sw.push(json({ title: "t".repeat(500), body: "b".repeat(1000), url: "/" }));
    check("push limita título e texto", sw.shown[0].title.length === 80 && sw.shown[0].options.body?.length === 180);
  }

  // --- notificationclick ---
  {
    const sw = loadWorker();
    const target = new FakeWindow(`${ORIGIN}/account`);
    const other = new FakeWindow(`${ORIGIN}/stats`);
    sw.setWindows([other, target]);
    const closed = await sw.click({ url: `${ORIGIN}/account` });
    check("clique fecha a notificação", closed);
    check("clique foca a janela já aberta na página", target.focused && !other.focused && sw.opened.length === 0);
  }
  {
    const sw = loadWorker();
    const existing = new FakeWindow(`${ORIGIN}/stats`);
    sw.setWindows([existing]);
    await sw.click({ url: `${ORIGIN}/sessions` });
    check(
      "clique reaproveita janela do SMV e navega",
      existing.focused && existing.url === `${ORIGIN}/sessions` && sw.opened.length === 0,
    );
  }
  {
    const sw = loadWorker();
    sw.setWindows([new FakeWindow(`${ORIGIN}/stats`, false)]);
    await sw.click({ url: `${ORIGIN}/sessions` });
    check("janela não controlada: abre nova", sw.opened[0] === `${ORIGIN}/sessions`);
  }
  {
    const sw = loadWorker();
    sw.setWindows([new FakeWindow("https://other.example/")]);
    await sw.click({ url: `${ORIGIN}/account` });
    check("sem janela do SMV: abre nova na URL", sw.opened[0] === `${ORIGIN}/account`);
  }
  {
    const sw = loadWorker();
    await sw.click({ url: "https://evil.example/phish" });
    await sw.click(undefined);
    await sw.click({ url: 7 });
    check("clique com URL externa ou ausente abre /", sw.opened.length === 3 && sw.opened.every((u) => u === `${ORIGIN}/`));
  }

  // --- regressão da política de cache ---
  {
    const sw = loadWorker();
    await sw.dispatch("install", {});
    check(
      "install pré-cacheia offline.html e ícones",
      sw.precached.includes("/offline.html") && sw.precached.includes("/icons/icon-192.png"),
    );
    const get = (url: string, mode = "no-cors") => sw.fetch({ method: "GET", url: `${ORIGIN}${url}`, mode });
    check("navegação passa pelo fallback offline", get("/sessions", "navigate"));
    check("estático com hash é servido do cache", get("/_next/static/chunks/app-abc123.js"));
    check("estático com query string não é interceptado", !get("/_next/static/chunks/app.js?v=1"));
    check("/api/* não é interceptado", !get("/api/live", "cors") && !get("/api/live", "navigate"));
    check("payload RSC não é interceptado", !get("/sessions?_rsc=abc", "cors"));
    check("POST (Server Action) não é interceptado", !sw.fetch({ method: "POST", url: `${ORIGIN}/account`, mode: "cors" }));
    check("outra origem não é interceptada", !sw.fetch({ method: "GET", url: "https://cdn.example/x.js", mode: "cors" }));
    check(
      "listeners registrados",
      ["install", "activate", "fetch", "push", "notificationclick"].every((type) => sw.listeners.has(type)),
    );
  }
}

main()
  .then(() => {
    for (const result of results) {
      console.log(`${result.ok ? "ok  " : "FAIL"} ${result.name}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} verificações passaram.`);
    if (failed > 0) process.exit(1);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
