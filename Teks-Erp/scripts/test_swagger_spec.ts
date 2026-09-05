// =============================================================================
// Test: OpenAPI (swagger-jsdoc) blokları geçerli mi + her uç belgeli mi? (2026-08-21, 2026-09-05)
// Çalıştır: npx tsx scripts/test_swagger_spec.ts   [--yaz]
// =============================================================================
// NEDEN (1): `swagger-jsdoc` bozuk bir `@openapi` bloğunu varsayılan ayarda yalnız
// KONSOLA yazar ve atlar — uç Swagger UI'dan SESSİZCE kaybolur, hiçbir test
// kırmızı vermez. 2026-08-21'de `GET /api/work-orders/{id}/roll-attribute-targets`
// böyle kayboldu: `summary: "Toplara da uygula" için …` (tırnaklı değerin
// ardından metin → YAML hatası). Bu bekçi aynı seçenekleri `failOnErrors: true`
// ile koşar → bozuk blok = KIRMIZI, hangi dosya olduğu mesajda yazar.
//
// NEDEN (2): Yol SAYMAK belgesizliği yakalamaz. 2026-09-05 ölçümü: spec 612 işlem,
// Express 727 uç → 117 belgesiz uç varken zemin (120) yeşil veriyordu. Bu bekçi
// artık Express'in KENDİ router ağacından uç listesini çıkarır (mount yolları
// `Router.prototype.use` yamasıyla toplanır) ve spec ile İKİ YÖNLÜ karşılaştırır:
//   · belgesiz uç  → devralınanlar `swagger-belgesiz-baseline.json`da DONAR, yeni uç KIRMIZI
//   · hayalet blok → spec'te olup kodda olmayan yol (silinen uç, kalan @openapi) KIRMIZI
// Tavan YALNIZ DÜŞER: belgelenen ya da kaldırılan uç baseline'dan çıkarılmazsa kırmızı
// (`lint-baseline` felsefesi). Baseline'ı bugüne sabitlemek: `--yaz`.
//
// Körlük zemini iki yerde: spec yol sayısı ve Express uç sayısı alt sınırın
// altındaysa KIRMIZI — glob/uzantı kayarsa ya da router yaması tutmazsa
// "hata yok" ile "hiçbir şey taranmadı" aynı yeşile çıkmasın (F11 dersi).
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import express from "express";
import swaggerJSDoc from "swagger-jsdoc";
import { swaggerOptions } from "../src/config/swagger";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** Bugün 502 yol var; zemin bilerek gevşek (yeni uç ekleyen bekçiyi güncellemesin). */
const PATH_COUNT_FLOOR = 120;
/** Bugün 727 uç çıkıyor; zemin router yamasının tuttuğunu doğrular, uç sayısını değil. */
const ENDPOINT_COUNT_FLOOR = 500;
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const BASELINE_PATH = path.resolve(__dirname, "..", "swagger-belgesiz-baseline.json");

type Spec = { paths?: Record<string, Record<string, unknown>> };
type Edge = { parent: unknown; mount: string; child: { stack?: unknown[] } };

/**
 * Express 5 Layer'ı mount yolunu SAKLAMAZ (`router/lib/layer.js`: `this.path = undefined`),
 * yalnız derlenmiş matcher'ı tutar. Bu yüzden ağacı gezmek yetmez; `use` çağrılarını
 * yakalayıp kenarları (ebeveyn → yol → çocuk router) kendimiz kaydediyoruz.
 */
const edges: Edge[] = [];
function patchRouterUse(): void {
  const RouterCtor = express.Router as unknown as { prototype: Record<string, unknown> };
  const original = RouterCtor.prototype.use as (...args: unknown[]) => unknown;
  RouterCtor.prototype.use = function patchedUse(this: unknown, ...args: unknown[]) {
    const first = args[0];
    const mount = typeof first === "string" ? first : "/";
    const handlers = (typeof first === "string" ? args.slice(1) : args).flat();
    for (const fn of handlers) {
      if (fn && Array.isArray((fn as { stack?: unknown[] }).stack)) {
        edges.push({ parent: this, mount, child: fn as { stack?: unknown[] } });
      }
    }
    return original.apply(this, args);
  };
}

function joinPath(prefix: string, segment: string): string {
  const joined = `${prefix}${segment}`.replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

/** Express yolunu OpenAPI yazımına çevirir: `:id` → `{id}`, `{*yol}`/`*yol` → `{yol}`. */
function toOpenApiPath(p: string): string {
  return p
    .replace(/\{\*([A-Za-z0-9_]+)\}/g, "{$1}")
    .replace(/\*([A-Za-z0-9_]+)/g, "{$1}")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function collectEndpoints(router: unknown, prefix: string, out: Set<string>): void {
  const stack = (router as { stack?: unknown[] }).stack;
  if (!Array.isArray(stack)) return;
  for (const layer of stack) {
    const route = (layer as { route?: { path?: string; methods?: Record<string, boolean> } }).route;
    if (!route?.path) continue;
    const full = toOpenApiPath(joinPath(prefix, route.path));
    for (const method of Object.keys(route.methods ?? {})) {
      if (HTTP_METHODS.includes(method)) out.add(`${method.toUpperCase()} ${full}`);
    }
  }
  for (const edge of edges) {
    if (edge.parent !== router) continue;
    collectEndpoints(edge.child, joinPath(prefix, toOpenApiPath(edge.mount)), out);
  }
}

type Baseline = { _not?: string; _olcum?: string; uclar: string[] };
function readBaseline(): Baseline {
  if (!fs.existsSync(BASELINE_PATH)) return { uclar: [] };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")) as Baseline;
}

async function main(): Promise<void> {
  let spec: Spec | null = null;
  let error: string | null = null;
  try {
    spec = swaggerJSDoc({ ...swaggerOptions, failOnErrors: true }) as Spec;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  check("tüm @openapi blokları geçerli YAML (failOnErrors)", error === null, (error ?? "").split("\n").slice(0, 3).join(" | "));

  const paths = spec?.paths ?? {};
  const pathCount = Object.keys(paths).length;
  check(`körlük zemini: en az ${PATH_COUNT_FLOOR} yol tarandı`, pathCount >= PATH_COUNT_FLOOR, `${pathCount} yol`);

  // Yol+metot çakışması: aynı uç iki blokta tanımlıysa swagger sonuncuyu sessizce kazandırır.
  const specOps = new Set(
    Object.entries(paths).flatMap(([p, methods]) =>
      Object.keys(methods).filter((m) => HTTP_METHODS.includes(m)).map((m) => `${m.toUpperCase()} ${p}`),
    ),
  );
  check("yol+metot kümesi boş değil", specOps.size > 0, `${specOps.size} işlem`);

  patchRouterUse();
  const app = (await import("../src/app")).default as unknown as { router?: unknown };
  const endpoints = new Set<string>();
  collectEndpoints(app.router, "", endpoints);
  // Swagger yalnız /api yüzeyini belgeler; /health gibi altyapı uçları kapsam dışı.
  const apiEndpoints = [...endpoints].filter((e) => e.includes(" /api/")).sort();
  check(
    `körlük zemini: Express ağacından en az ${ENDPOINT_COUNT_FLOOR} uç çıkarıldı`,
    apiEndpoints.length >= ENDPOINT_COUNT_FLOOR,
    `${apiEndpoints.length} uç, ${edges.length} mount`,
  );

  const undocumented = apiEndpoints.filter((e) => !specOps.has(e));
  const ghosts = [...specOps].filter((s) => s.includes(" /api/") && !endpoints.has(s)).sort();

  if (process.argv.includes("--yaz")) {
    const next: Baseline = {
      _not: "BELGESİZ uç TAVANI — yalnız DÜŞER. Yeni uç belgesiz olamaz. Ölçüm: npx tsx scripts/test_swagger_spec.ts --yaz",
      _olcum: `${new Date().toISOString().slice(0, 10)} · ${apiEndpoints.length} uç / ${specOps.size} belgeli işlem`,
      uclar: undocumented,
    };
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\n📝 baseline yazıldı: ${undocumented.length} belgesiz uç donduruldu`);
    process.exit(0);
  }

  const baseline = new Set(readBaseline().uclar);
  const yeniBelgesiz = undocumented.filter((e) => !baseline.has(e));
  check(
    "yeni uç belgesiz olamaz (baseline dışı belgesiz uç yok)",
    yeniBelgesiz.length === 0,
    yeniBelgesiz.length ? `${yeniBelgesiz.length} yeni: ${yeniBelgesiz.slice(0, 5).join(" · ")}` : `${undocumented.length} devralınan belgesiz uç baseline'da`,
  );

  const cirit = [...baseline].filter((e) => !undocumented.includes(e));
  check(
    "tavan yalnız düşer: baseline'da artık belgesiz olmayan uç kalmadı",
    cirit.length === 0,
    cirit.length ? `${cirit.length} satır silinmeli (--yaz): ${cirit.slice(0, 5).join(" · ")}` : "baseline güncel",
  );

  check(
    "hayalet @openapi bloğu yok (spec'te var, kodda yok)",
    ghosts.length === 0,
    ghosts.length ? ghosts.slice(0, 5).join(" · ") : `${specOps.size} işlemin tamamı canlı uçla eşleşti`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
