/**
 * Sunucu keşfi — orkestrasyon + IPC.
 *
 * TASARIM: AYAKLAR YARIŞIR, SIRAYLA KOŞMAZ. t=0'da paralel başlar:
 *   • mDNS dinleme (her ilan ANINDA doğrulamaya gider)
 *   • kayıtlı adres · son kullanılanlar · localhost probu
 * t=1200ms'de hâlâ doğrulanmış aday yoksa alt ağ taraması devreye girer.
 * Doğrulanmış bir aday sabitlenmiş kimlikle eşleşir eşleşmez tur BİTER —
 * ikinci ve sonraki açılışların normal yolu budur ve tipik olarak <300 ms sürer.
 *
 * ⚠️ SONUÇ "PUSH" EDİLMEZ, "PULL" EDİLİR. Splash penceresi renderer'a
 * `loadFile`→`loadURL` ile geçiyor ve bu geçiş `webContents.send` dinleyicilerini
 * DÜŞÜRÜR. Bu yüzden bir `onResult` kanalı BİLEREK yok: renderer `invoke` ile
 * çeker. Eksik sanıp eklemeyin — sessizce kaybolan bildirimler üretir.
 *
 * ⚠️ TARAMA EMNİYETİ: sabitlenmiş kimlik + kayıtlı adres cevap veriyorsa tarama
 * HİÇ koşmaz. Açılış başına 253 bağlantı denemesi, 15 makine aynı anda açılırsa
 * ~3800 eder; bu ancak gerçekten gerektiğinde meşrudur.
 */
import { ipcMain } from "electron";
import os from "node:os";
import log from "electron-log";
import {
  DISCOVERY_DEFAULT_PORT,
  LAST_DISCOVERY_KEY,
  PINNED_IDENTITY_KEY,
  baseUrlOf,
  bySourceRank,
  compareIdentity,
  dedupeCandidates,
  groupByInstallation,
  rankCandidates,
  scanTargetsFor,
  type DiscoveredServer,
  type DiscoverySource,
  type ServerIdentity,
} from "../../shared/discovery.js";
import type { DiscoveryState } from "../../shared/ipc-contract.js";
import { readSecureValue, writeSecureValue } from "./secure-store.ipc.js";
import { browseMdns } from "../discovery/mdns-browser.js";
import { scanSubnet } from "../discovery/subnet-scan.js";
import { probeIdentity } from "../discovery/probe.js";

/** Electron'daki API adresi anahtarı — `src/lib/api-config.ts` ile AYNI olmalı. */
const API_BASE_URL_KEY = "config.apiBaseUrl";
const API_RECENT_KEY = "config.apiBaseUrl.recent";

const SPLASH_TIMEOUT_MS = 8_000;
const MANUAL_TIMEOUT_MS = 12_000;
/** mDNS'e bu kadar süre şans tanınır; sonra tarama da başlar. */
const SCAN_DELAY_MS = 1_200;
/** Aynı taramayı arka arkaya koşturmamak için. */
const SCAN_COOLDOWN_MS = 30_000;

function emptyState(): DiscoveryState {
  return {
    status: "idle",
    startedAt: null,
    finishedAt: null,
    candidates: [],
    groups: [],
    applied: null,
    mdns: { available: false, error: null, hits: 0 },
    scan: { ran: false, targets: 0, open: 0, skippedReason: null },
    pinnedInstallationId: null,
    error: null,
  };
}

let state: DiscoveryState = emptyState();
let running: Promise<DiscoveryState> | null = null;
let lastScanAt = 0;

function readPinnedId(): string | null {
  try {
    const raw = readSecureValue(PINNED_IDENTITY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { installationId?: unknown };
    return typeof parsed.installationId === "string" ? parsed.installationId : null;
  } catch {
    return null;
  }
}

function readRecentUrls(): string[] {
  try {
    const raw = readSecureValue(API_RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** `http://host:port[/api]` → `{host, port}`. Çözülemezse null. */
function splitUrl(url: string): { host: string; port: number } | null {
  const m = /^https?:\/\/([^:/\s]+)(?::(\d+))?/i.exec((url ?? "").trim());
  if (!m || !m[1]) return null;
  return { host: m[1], port: m[2] ? Number(m[2]) : DISCOVERY_DEFAULT_PORT };
}

/** Bir adresi doğrular ve aday nesnesine çevirir. Aday değilse null. */
async function verify(
  host: string,
  port: number,
  via: DiscoverySource,
  pinnedId: string | null,
  timeoutMs = 2000,
): Promise<DiscoveredServer | null> {
  const baseUrl = baseUrlOf(host, port);
  const res = await probeIdentity(baseUrl, timeoutMs);
  if (!res) return null;
  return {
    baseUrl,
    host,
    port,
    via,
    identity: res.identity,
    rttMs: res.rttMs,
    matchesPinned: compareIdentity(pinnedId, res.identity?.installationId ?? null),
  };
}

/** Bu makinenin LAN arayüzleri — tarama dilimini maskeden çözmek için. */
function localInterfaces(): Array<{ address: string; netmask: string }> {
  const out: Array<{ address: string; netmask: string }> = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const net of addrs ?? []) {
      const isIPv4 = net.family === "IPv4" || (net.family as unknown as number) === 4;
      if (isIPv4 && !net.internal) out.push({ address: net.address, netmask: net.netmask });
    }
  }
  return out;
}

async function runDiscovery(timeoutMs: number): Promise<DiscoveryState> {
  const pinnedId = readPinnedId();
  const deadline = Date.now() + timeoutMs;
  const found: DiscoveredServer[] = [];
  const controller = new AbortController();

  state = {
    ...emptyState(),
    status: "running",
    startedAt: Date.now(),
    pinnedInstallationId: pinnedId,
  };

  /** Sabitlenmiş kimlikle eşleşen aday bulunduğu an turu bitirir. */
  let resolveEarly: (() => void) | null = null;
  const earlyExit = new Promise<void>((r) => {
    resolveEarly = r;
  });
  const collect = (c: DiscoveredServer | null): void => {
    if (!c) return;
    found.push(c);
    if (c.matchesPinned === "match") {
      controller.abort();
      resolveEarly?.();
    }
  };

  // --- Ayak 1: bilinen adresler (kayıtlı + son kullanılanlar + localhost) ----
  const knownProbes: Array<Promise<void>> = [];
  const storedUrl = readSecureValue(API_BASE_URL_KEY);
  const seenAddr = new Set<string>();
  const pushKnown = (url: string, via: DiscoverySource): void => {
    const parts = splitUrl(url);
    if (!parts) return;
    const key = `${parts.host}:${parts.port}`;
    if (seenAddr.has(key)) return;
    seenAddr.add(key);
    knownProbes.push(verify(parts.host, parts.port, via, pinnedId, 1500).then(collect));
  };
  if (storedUrl) pushKnown(storedUrl, "stored");
  for (const u of readRecentUrls()) pushKnown(u, "recent");
  pushKnown(`http://localhost:${DISCOVERY_DEFAULT_PORT}`, "localhost");

  // --- Ayak 2: mDNS (her ilan anında doğrulanır) ----------------------------
  const mdnsProbes: Array<Promise<void>> = [];
  const mdnsPromise = browseMdns(Math.min(timeoutMs, 4000), (hit) => {
    // ⚠️ TXT'deki kimliğe bakıp ÖN ELEME YAPILMAZ. Sabitlenmişle uyuşmayan bir
    // ilan da doğrulanır: kullanıcıya "farklı kurulum, yine de bağlan?" sorusunu
    // sorabilmek için adayın gerçek olduğunu bilmemiz gerekir. Sessizce elenirse
    // sunucusu yeniden kurulmuş bir fabrika hiçbir aday göremez.
    const hosts = hit.addresses.length > 0 ? hit.addresses : [hit.host];
    for (const h of hosts) {
      if (!h) continue;
      const key = `${h}:${hit.port}`;
      if (seenAddr.has(key)) continue;
      seenAddr.add(key);
      mdnsProbes.push(
        verify(h, hit.port || DISCOVERY_DEFAULT_PORT, "mdns", pinnedId, 2000).then(collect),
      );
    }
  });

  // --- Ayak 3: alt ağ taraması (gecikmeli — mDNS'e şans tanı) ---------------
  const scanPromise = (async (): Promise<void> => {
    await Promise.race([
      new Promise((r) => setTimeout(r, SCAN_DELAY_MS)),
      earlyExit,
    ]);
    if (controller.signal.aborted) {
      state.scan.skippedReason = "sabitlenmiş sunucu zaten bulundu";
      return;
    }
    if (found.length > 0) {
      state.scan.skippedReason = "bilinen adres cevap verdi";
      return;
    }
    if (Date.now() - lastScanAt < SCAN_COOLDOWN_MS) {
      state.scan.skippedReason = "son tarama çok yakın (30sn)";
      return;
    }
    lastScanAt = Date.now();
    const targets = scanTargetsFor(localInterfaces()).filter(
      (h) => !seenAddr.has(`${h}:${DISCOVERY_DEFAULT_PORT}`),
    );
    state.scan.ran = true;
    state.scan.targets = targets.length;
    const open = await scanSubnet(targets, DISCOVERY_DEFAULT_PORT, {
      signal: controller.signal,
      socketTimeoutMs: 300,
    });
    state.scan.open = open.length;
    await Promise.all(
      open.map((h) => verify(h, DISCOVERY_DEFAULT_PORT, "scan", pinnedId, 2000).then(collect)),
    );
  })();

  // Turu bitiren üç şey: erken çıkış · tüm ayakların bitmesi · süre dolması.
  const allLegs = (async (): Promise<void> => {
    await mdnsPromise.then((r) => {
      state.mdns = { available: r.available, error: r.error, hits: r.hits.length };
    });
    await Promise.all([...knownProbes, ...mdnsProbes]);
    await scanPromise;
    await Promise.all(mdnsProbes);
  })();

  await Promise.race([
    earlyExit,
    allLegs,
    new Promise((r) => setTimeout(r, Math.max(0, deadline - Date.now()))),
  ]);

  // ⚠️ ÖNCE tekilleştir, SONRA sırala. Aynı sunucunun iki adresi iki ayrı aday
  // gibi sıralanırsa "tek aday mı" sorusu da (otomatik adres uygulama kapısı)
  // yanlış cevaplanır — çok adresli sunucu hiçbir zaman "tek" görünmezdi.
  const groups = groupByInstallation(found, bySourceRank);
  const candidates = rankCandidates(dedupeCandidates(found, bySourceRank));
  state = {
    ...state,
    status: "done",
    finishedAt: Date.now(),
    candidates,
    groups,
  };
  log.info("[discovery] tur bitti", {
    adaylar: candidates.length,
    mdns: state.mdns,
    tarama: state.scan,
  });
  return state;
}

/** Adresi yerel kasaya yazar (kayıtlı + son kullanılanlar). */
function applyAddress(baseUrl: string, reason: "single" | "pin-moved"): void {
  try {
    writeSecureValue(API_BASE_URL_KEY, baseUrl);
    const recent = [baseUrl, ...readRecentUrls().filter((u) => u !== baseUrl)].slice(0, 6);
    writeSecureValue(API_RECENT_KEY, JSON.stringify(recent));
    state.applied = { baseUrl, reason };
    log.info(`[discovery] adres otomatik uygulandı (${reason}): ${baseUrl}`);
  } catch (e) {
    log.warn("[discovery] adres yazılamadı:", (e as Error).message);
  }
}

/**
 * Açılışta çağrılır. Kayıtlı adres cevap veriyorsa hiçbir şey yapmaz (hızlı yol).
 * Aksi halde keşif koşar ve GÜVENLİ olduğunda adresi kendi yazar.
 *
 * OTOMATİK UYGULAMA POLİTİKASI:
 *   A) kayıtlı adres YOK + TEK doğrulanmış aday              → yaz
 *   C) kayıtlı adres ÖLÜ + pin'le EŞLEŞEN tek aday           → yaz (sunucu taşınmış)
 *   D) pin ile UYUŞMAYAN aday                                → ASLA yazma, kullanıcı karar verir
 *   B/E) çok aday / hiç aday                                 → yazma, renderer gösterir
 */
export async function startDiscoveryIfNeeded(): Promise<void> {
  try {
    const stored = readSecureValue(API_BASE_URL_KEY);
    const pinnedId = readPinnedId();

    if (stored) {
      const parts = splitUrl(stored);
      if (parts) {
        const ok = await verify(parts.host, parts.port, "stored", pinnedId, 1500);
        if (ok && ok.matchesPinned !== "mismatch") {
          state = {
            ...emptyState(),
            status: "done",
            candidates: [ok],
            groups: groupByInstallation([ok], bySourceRank),
            finishedAt: Date.now(),
          };
          log.info(`[discovery] kayıtlı adres cevap verdi, keşif gerekmedi: ${stored}`);
          return;
        }
      }
    }

    const result = await runDiscovery(SPLASH_TIMEOUT_MS);
    const usable = result.candidates.filter((c) => c.matchesPinned !== "mismatch");

    if (!stored && usable.length === 1 && usable[0]) {
      applyAddress(usable[0].baseUrl, "single");
    } else if (stored && pinnedId) {
      const moved = usable.filter((c) => c.matchesPinned === "match");
      if (moved.length === 1 && moved[0] && moved[0].baseUrl !== stored) {
        applyAddress(moved[0].baseUrl, "pin-moved");
      }
    }

    try {
      writeSecureValue(LAST_DISCOVERY_KEY, JSON.stringify({ at: Date.now(), state }));
    } catch {
      /* önemsiz */
    }
  } catch (e) {
    state = { ...state, status: "error", error: (e as Error).message, finishedAt: Date.now() };
    log.warn("[discovery] keşif turu hata verdi:", (e as Error).message);
  }
}

export function registerDiscoveryIpc(): void {
  ipcMain.handle("discovery:state", () => state);

  ipcMain.handle("discovery:start", async (_e, opts?: { timeoutMs?: number }) => {
    if (running) return running;
    const timeout = Math.min(30_000, Math.max(2_000, opts?.timeoutMs ?? MANUAL_TIMEOUT_MS));
    running = runDiscovery(timeout).finally(() => {
      running = null;
    });
    return running;
  });

  ipcMain.handle("discovery:probe", async (_e, baseUrl: string) => {
    if (typeof baseUrl !== "string") return null;
    const parts = splitUrl(baseUrl);
    if (!parts) return null;
    return verify(parts.host, parts.port, "stored", readPinnedId(), 5000);
  });

  ipcMain.handle("discovery:pin", (_e, installationId: string | null) => {
    if (installationId === null) {
      writeSecureValue(PINNED_IDENTITY_KEY, JSON.stringify({}));
      return;
    }
    if (typeof installationId !== "string" || !installationId.trim()) return;
    writeSecureValue(
      PINNED_IDENTITY_KEY,
      JSON.stringify({ installationId: installationId.trim(), pinnedAt: new Date().toISOString() }),
    );
    state.pinnedInstallationId = installationId.trim();
  });
}

export type { ServerIdentity };
