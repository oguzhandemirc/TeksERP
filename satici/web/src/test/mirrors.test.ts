// AYNA BEKÇİSİ — arayüzün sunucudan KOPYALADIĞI her bilgi sunucunun tek kaynağıyla ölçülür (elle
// kopya sessizce ayrışır): izin tablosu (roles.ts), modül kataloğu ve sınıflar (ekran adı eksiksiz),
// arayüzün dallandığı hata kodları, sayısal eşikler ve biçim desenleri (ağır K3 günü, taksit
// varsayılanı, bakım ay tavanı, kanal kodu, sürüm metni), ve arayüzün çağırdığı HER uç (yöntem +
// yol) sunucunun rota tablosunda var mı — satıcı sayfaları satıcı tablosunda, bayi sayfaları bayi
// tablosunda.
// Kaynak metin olarak okunur (sunucu kodu arayüz derlemesine girmez).
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RETRY_CONFLICT_CODE } from "../shared/api";
import { LOGIN_RATE_LIMIT_CODE } from "../shared/LoginPage";
import { DEFAULT_MAINTENANCE_MONTHS, MAX_MAINTENANCE_MONTHS } from "../shared/CeilingFields";
import { CHANNEL_HEALTH_LABEL, CLASS_LABEL, MODULE_LABEL, NOTIFICATION_CHANNEL_LABEL, NOTIFICATION_EVENT_LABEL, NOTIFICATION_STATUS_LABEL } from "../shared/labels";
import { PORTAL_PERMISSIONS } from "../shared/permissions";
import { HEAVY_K3_MIN_DAYS, INSTALLMENT_DEFAULT_RESTRICTION_DAYS } from "../shared/sanctions";
import { CHANNEL_CODE_PATTERN, CHANNEL_KIND_LABEL, VERSION_PATTERN } from "../portal/pages/Channels";
import { CLOUD_RETENTION_DEFAULT, CLOUD_RETENTION_MONTHS, SYNC_MINUTES_DEFAULT, SYNC_MINUTES_MAX, SYNC_MINUTES_MIN } from "../shared/cloud-settings";

const WEB_SRC = path.resolve(__dirname, "..");
const SERVER_SRC = path.resolve(__dirname, "../../../sunucu/src");
const read = (p: string) => readFileSync(path.join(SERVER_SRC, p), "utf8");

function listStrings(src: string, name: string): string[] {
  const m = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(src);
  if (!m) throw new Error(`${name} bulunamadı`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

/** Yolu parametre olarak alan sorgu yardımcıları: çağrı yerindeki `useGet/usePaged("/…")` literali ölçülür. */
const PATH_HELPERS: readonly string[] = [path.join("shared", "hooks.ts")];

// ---------------------------------------------------------------- rota tablosu

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
}

const segs = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);

function serverRoutes(file: string): Route[] {
  const src = read(file);
  const out: Route[] = [];
  for (const m of src.matchAll(/method:\s*"(get|post|patch)",\s*path:\s*(?:"([^"]+)"|`([^`]+)`)/g)) {
    out.push({ method: m[1]!.toUpperCase(), segments: segs((m[2] ?? m[3]!).replace(/\$\{[^}]+\}/g, ":p")) });
  }
  for (const m of src.matchAll(/activeToggle\(\s*"([^"]+)"/g)) out.push({ method: "POST", segments: segs(m[1]!) });
  return out;
}

function sessionRoutes(): Route[] {
  return [...read("http/portal-http.ts").matchAll(/router\.(get|post|patch)\(\s*"([^"]+)"/g)].map((m) => ({ method: m[1]!.toUpperCase(), segments: segs(m[2]!) }));
}

const isParam = (s: string) => s.startsWith(":");

/** Bir `${…}` şablon parçasını olası literallerine açar: `${c ? "a" : "b"}` → a | b; çözülemeyen → parametre. */
function expand(template: string): string[] {
  const m = /\$\{([^}]*)\}/.exec(template);
  if (!m) return [template];
  const literals = [...m[1]!.matchAll(/"([^"]*)"/g)].map((x) => x[1]!);
  const choices = literals.length >= 2 && m[1]!.includes("?") ? literals : [":p"];
  return choices.flatMap((c) => expand(template.slice(0, m.index) + c + template.slice(m.index + m[0].length)));
}

interface Call {
  readonly file: string;
  readonly key: string;
  readonly method: string;
  readonly segments: readonly string[];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === "test" ? [] : walk(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

function clientCalls(): Call[] {
  const out: Call[] = [];
  const pattern = /(?:api\.(get|post|patch)(?:<[^>]*>)?|use(Get|Paged)<[^>]*>)\(\s*(?:\[[^\]]*\],\s*)?(`[^`]*`|"[^"]*")/g;
  for (const file of walk(WEB_SRC)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(pattern)) {
      const method = m[1] ? m[1].toUpperCase() : "GET";
      const raw = m[3]!.slice(1, -1);
      if (!raw.startsWith("/")) continue;
      for (const p of expand(raw)) out.push({ file: path.relative(WEB_SRC, file), key: `${method} ${p}`, method, segments: segs(p) });
    }
  }
  return out;
}

function matches(call: Call, routes: readonly Route[]): boolean {
  return routes.some(
    (r) => r.method === call.method && r.segments.length === call.segments.length && r.segments.every((s, i) => isParam(s) || isParam(call.segments[i]!) || s === call.segments[i]),
  );
}

describe("izin tablosu aynası (satici/sunucu src/portal/roles.ts)", () => {
  it("anahtarlar ve rol kümeleri birebir aynı", () => {
    const src = read("portal/roles.ts");
    const groups: Record<string, string[]> = { VENDOR: listStrings(src, "const VENDOR: readonly PortalRole\\[\\]"), ADMIN: listStrings(src, "const ADMIN: readonly PortalRole\\[\\]") };
    const body = /export const PORTAL_PERMISSIONS = \{([\s\S]*?)\} as const/.exec(src)![1]!;
    const server: Record<string, string[]> = {};
    for (const m of body.matchAll(/"([a-z]+:[a-z-]+)":\s*(VENDOR|ADMIN|\[[^\]]*\])/g)) {
      server[m[1]!] = m[2]!.startsWith("[") ? [...m[2]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!) : groups[m[2]!]!;
    }
    expect(Object.keys(server).length).toBeGreaterThan(5);
    const web = Object.fromEntries(Object.entries(PORTAL_PERMISSIONS).map(([k, v]) => [k, [...v].sort()]));
    expect(web).toEqual(Object.fromEntries(Object.entries(server).map(([k, v]) => [k, [...v].sort()])));
  });
});

describe("katalog ekran adları", () => {
  it("her portal modül anahtarının ekran adı var", () => {
    const keys = listStrings(read("portal/module-catalog.ts"), "export const PORTAL_MODULE_KEYS");
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !MODULE_LABEL[k])).toEqual([]);
  });

  it("her lisans sınıfının ekran adı var", () => {
    const classes = listStrings(read("lisans-protokol/belgeler.ts"), "export const LICENSE_CLASSES");
    expect(classes.filter((c) => !CLASS_LABEL[c])).toEqual([]);
  });

  it("arayüzün dallandığı hata kodları sunucuda tanımlı", () => {
    const codes = listStrings(read("lib/errors.ts"), "export const PORTAL_ERROR_CODES");
    for (const c of ["OTURUM_YOK", "GIRIS_BASARISIZ", "IMZA_PAROLASI_HATALI", "IMZA_PAROLASI_KILITLI"]) expect(codes).toContain(c);
    // "Tekrar deneyin" (işlem kimliği yapışır) ve giriş hız sınırı protokolün ortak kod listesinde yaşar.
    const vendorCodes = listStrings(read("lisans-protokol/uclar.ts"), "export const VENDOR_ERROR_CODES");
    expect(vendorCodes).toContain(RETRY_CONFLICT_CODE);
    expect(vendorCodes).toContain(LOGIN_RATE_LIMIT_CODE);
  });

  it("her bildirim olayı · kanalı · durumunun ekran adı var (notifications/catalog.ts)", () => {
    const src = read("notifications/catalog.ts");
    for (const [name, map] of [
      ["export const NOTIFICATION_EVENTS", NOTIFICATION_EVENT_LABEL],
      ["export const NOTIFICATION_CHANNELS", NOTIFICATION_CHANNEL_LABEL],
      ["export const NOTIFICATION_STATES", NOTIFICATION_STATUS_LABEL],
    ] as const) {
      const values = listStrings(src, name);
      expect(values.length).toBeGreaterThan(1);
      expect(values.filter((v) => !map[v])).toEqual([]);
      expect(Object.keys(map).filter((k) => !values.includes(k))).toEqual([]);
    }
  });

  it("her bildirim kanal durumunun ekran adı var (notifications/portal-view.ts, iki yönlü)", () => {
    const states = listStrings(read("notifications/portal-view.ts"), "export const CHANNEL_HEALTH_STATES");
    expect(states.length).toBeGreaterThan(3);
    expect(states.filter((v) => !CHANNEL_HEALTH_LABEL[v])).toEqual([]);
    expect(Object.keys(CHANNEL_HEALTH_LABEL).filter((k) => !states.includes(k))).toEqual([]);
  });

  it("her kanal türünün ekran adı var", () => {
    const kinds = listStrings(read("services/channel.service.ts"), "export const CHANNEL_KINDS");
    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.filter((k) => !(k in CHANNEL_KIND_LABEL))).toEqual([]);
  });
});

/** `export const AD = <sayı>;` ya da `(…) => … ?? <sayı>` — sunucu sabitinin değeri. */
function numberConst(src: string, pattern: RegExp): number {
  const m = pattern.exec(src);
  if (!m) throw new Error(`sabit bulunamadı: ${pattern}`);
  return Number(m[1]);
}

/** `z.string().regex(/…/)` kaynağı — arayüzdeki desenle metin olarak aynı olmalı. */
function schemaRegex(src: string, name: string): string {
  const m = new RegExp(`export const ${name} = z\\.string\\(\\)\\.regex\\(\\/(.+)\\/\\);`).exec(src);
  if (!m) throw new Error(`${name} bulunamadı`);
  return m[1]!;
}

describe("eşikler ve biçim desenleri aynası", () => {
  it("ağır K3 eşiği ve taksit kısıtlama varsayılanı (sanction.service.ts)", () => {
    const src = read("services/sanction.service.ts");
    expect(HEAVY_K3_MIN_DAYS).toBe(numberConst(src, /export const HEAVY_K3_MIN_DAYS = (\d+);/));
    expect(INSTALLMENT_DEFAULT_RESTRICTION_DAYS).toBe(numberConst(src, /installmentRestrictionDays = [^\n]*\?\? (\d+);/));
  });

  it("patron bulutu eşitleme aralığı ve saklama seçenekleri (cloud-entitlement.ts)", () => {
    const src = read("services/cloud-entitlement.ts");
    expect(SYNC_MINUTES_MIN).toBe(numberConst(src, /export const SYNC_MINUTES_MIN = (\d+);/));
    expect(SYNC_MINUTES_MAX).toBe(numberConst(src, /export const SYNC_MINUTES_MAX = (\d+);/));
    expect(SYNC_MINUTES_DEFAULT).toBe(numberConst(src, /export const SYNC_MINUTES_DEFAULT = (\d+);/));
    expect(CLOUD_RETENTION_DEFAULT).toBe(numberConst(src, /export const CLOUD_RETENTION_DEFAULT = (\d+);/));
    const m = /export const CLOUD_RETENTION_MONTHS = \[([^\]]*)\] as const;/.exec(src);
    expect(m, "CLOUD_RETENTION_MONTHS bulunamadı").not.toBeNull();
    expect([...CLOUD_RETENTION_MONTHS]).toEqual(m![1]!.split(",").map((x) => Number(x.trim())));
  });

  it("bakım ay tavanı varsayılanı ve üst sınırı (dealer.service.ts)", () => {
    const src = read("services/dealer.service.ts");
    expect(DEFAULT_MAINTENANCE_MONTHS).toBe(numberConst(src, /export const DEFAULT_MAINTENANCE_MONTHS = (\d+);/));
    expect(MAX_MAINTENANCE_MONTHS).toBe(numberConst(src, /export const MAX_MAINTENANCE_MONTHS = (\d+);/));
  });

  it("kanal kodu ve sürüm metni desenleri (lisans-protokol/belgeler.ts)", () => {
    const src = read("lisans-protokol/belgeler.ts");
    expect(CHANNEL_CODE_PATTERN.source).toBe(schemaRegex(src, "ChannelCodeSchema"));
    expect(VERSION_PATTERN.source).toBe(schemaRegex(src, "VersionTextSchema"));
  });
});

describe("arayüzün çağırdığı her uç sunucuda var", () => {
  // Satıcı tablosu başka dosyadan yayılan parçaları da taşır (`...SUPPORT_PORTAL_ROUTES`): her yayılan tablo bu listede.
  const VENDOR_ROUTE_FILES = ["http/portal-routes.ts", "http/distribution-routes.ts", "http/support-routes.ts", "http/notification-routes.ts"];
  const vendor = [...VENDOR_ROUTE_FILES.flatMap(serverRoutes), ...sessionRoutes()];
  const dealer = [...serverRoutes("http/dealer-routes.ts"), ...sessionRoutes()];
  const calls = clientCalls();

  it("satıcı tablosuna yayılan her parça tarayıcının dosya listesinde (sessiz kör nokta yok)", () => {
    const spreads = [...read("http/portal-routes.ts").matchAll(/\.\.\.([A-Z_]+_PORTAL_ROUTES)\b/g)].map((m) => m[1]!);
    const declared = VENDOR_ROUTE_FILES.flatMap((f) => [...read(f).matchAll(/export const ([A-Z_]+_PORTAL_ROUTES)\b/g)].map((m) => m[1]!));
    expect(spreads.length).toBeGreaterThan(0);
    expect(spreads.filter((x) => !declared.includes(x))).toEqual([]);
  });

  it("tarayıcı gerçekten ölçüyor (boş küme sahte yeşil verir)", () => {
    expect(vendor.length).toBeGreaterThan(40);
    expect(dealer.length).toBeGreaterThan(10);
    expect(calls.length).toBeGreaterThan(40);
    expect(calls.some((c) => c.key === "POST /kurulumlar/:p/agir-yaptirim")).toBe(true);
    expect(calls.some((c) => c.key === "PATCH /kanallar/:p")).toBe(true);
  });

  it("her çağrının yolu kaynakta LİTERAL (değişkenden gelen yol ya da eylem parçası ölçülemez)", () => {
    const opaque: string[] = [];
    for (const file of walk(WEB_SRC).filter((f) => !PATH_HELPERS.includes(path.relative(WEB_SRC, f)))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/api\.(get|post|patch)(?:<[^>]*>)?\(\s*([^`"\s])/g)) opaque.push(`${path.relative(WEB_SRC, file)}: api.${m[1]}(${m[2]}…`);
    }
    const unresolved = calls.filter((c) => c.segments.some((s, i) => isParam(s) && i === c.segments.length - 1 && i > 0 && isParam(c.segments[i - 1]!)));
    expect([...opaque, ...unresolved.map((c) => `${c.file}: ${c.key}`)]).toEqual([]);
  });

  it("satıcı sayfaları satıcı tablosunda, bayi sayfaları bayi tablosunda, ortak parçalar en az birinde", () => {
    const missing = calls.filter((c) => {
      if (c.file.startsWith("portal")) return !matches(c, vendor);
      if (c.file.startsWith("bayi")) return !matches(c, dealer);
      return !matches(c, vendor) && !matches(c, dealer);
    });
    expect(missing.map((c) => `${c.file}: ${c.key}`)).toEqual([]);
  });
});

describe("ham dağıtım uçları (JSON tablosu dışı) sunucuda var", () => {
  // distribution-raw.ts `/portal/api/ham` altına bağlanır; arayüz yolu `/portal/api/ham/…` şablonuyla yazar.
  const raw = [...read("http/distribution-raw.ts").matchAll(/router\.(get|put)\(\s*"([^"]+)"/g)].map((m) => ({ method: m[1]!.toUpperCase(), segments: segs(`/portal/api/ham${m[2]!}`) }));
  const used = walk(WEB_SRC).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/`(\/portal\/api\/ham\/[^`]+)`/g)].map((m) => segs(m[1]!.replace(/\$\{[^}]+\}/g, ":p"))));

  it("tarayıcı gerçekten ölçüyor", () => {
    expect(raw.length).toBeGreaterThanOrEqual(2);
    expect(used.length).toBeGreaterThanOrEqual(2);
  });

  it("arayüzün her ham yolu sunucunun ham yönlendiricisinde", () => {
    const missing = used.filter((u) => !raw.some((r) => r.segments.length === u.length && r.segments.every((s, i) => isParam(s) || isParam(u[i]!) || s === u[i])));
    expect(missing.map((m) => m.join("/"))).toEqual([]);
  });
});
