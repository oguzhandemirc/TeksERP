// =============================================================================
// Patron bulutu — KİRLİ BAYRAK (olay güdümlü tur tetikleyicisi; TEK YAZAR `markDirty`)
// =============================================================================
// Katalog değişiklik kaynaklarına yazan her Prisma işlemi bellek-içi kümeye tablo adı
// bırakır; olay turu (`jobs/cloud-sync.job.ts` `requestEventRound`) kümeyi `takeDirty` ile
// tüketir. Bayrak YALNIZ "şimdi tur koş" der: neyin gideceğini yine filigran + güvenli
// ufuk belirler (doğruluk katmanı değişmez). Kaçan yazım (script, ikinci süreç, trigger)
// 5 dk emniyet turunda gider — bu dosya bir iyileştirmedir, doğruluk kaynağı DEĞİL.
// Hook maliyeti: yazan işlemde bir `Map.get` + `Set.add`; okuma işlemleri dokunulmaz.
// =============================================================================
import { uyari } from "../lib/logger";
import { RECORD_PROJECTIONS, SNAPSHOT_PROJECTIONS, SYNC_AUX_READS } from "./projections";

/**
 * Kök OLMAYAN değişiklik kaynağı tablosu → Prisma model adı (beyanlı). Kökler katalogdaki
 * `root.{table,model}` çiftinden gelir. Küme = kaynaklar ∪ tetikleyici işaretçileri ∪
 * türetilmiş/anlık `reads` ∪ birleştirme defteri − kökler; bekçi `test_bulut_olay_gudumlu` §7
 * iki yönlü ölçer (eksik satır = o tablonun yazımı olay turu doğurmaz; fazla = ölü beyan).
 */
export const READS_MODEL_MAP: Readonly<Record<string, string>> = {
  cari_balances: "CariBalance",
  cari_holds: "CariHold",
  machine_cost_rates: "MachineCostRate",
  payment_allocations: "PaymentAllocation",
  roll_movements: "RollMovement",
  roll_returns: "RollReturn",
  rolls: "Roll",
  service_billing_links: "ServiceBillingLink",
  service_consumable_norms: "ServiceConsumableNorm",
  shipment_orders: "ShipmentOrder",
  subcontractor_dispatch_items: "SubcontractorDispatchItem",
  subcontractor_dispatches: "SubcontractorDispatch",
  work_order_steps: "WorkOrderStep",
  work_order_to_order_lines: "WorkOrderToOrderLine",
  standard_cost_lines: "StandardCostLine",
  merge_operations: "MergeOperation",
  merge_operation_refs: "MergeOperationRef",
};

/** Katalogdan türeyen izlenen tablo kümesi (bekçi §7 bunu `READS_MODEL_MAP` ∪ köklerle kıyaslar). */
export function catalogChangeTables(): Set<string> {
  const out = new Set<string>();
  for (const p of RECORD_PROJECTIONS) {
    out.add(p.root.table);
    for (const s of p.sources) out.add(s.table);
    for (const m of p.markedBy ?? []) out.add(m.table);
    for (const d of p.derived) for (const t of d.reads) out.add(t);
  }
  for (const s of SNAPSHOT_PROJECTIONS) for (const t of s.reads) out.add(t);
  // `sync_marks`ı tetikleyiciler yazar (Prisma değil) ve budama onu siler — izlenmez.
  for (const a of SYNC_AUX_READS) if (a.table !== "sync_marks") out.add(a.table);
  return out;
}

const TABLE_BY_MODEL: ReadonlyMap<string, string> = new Map<string, string>([
  ...RECORD_PROJECTIONS.map((p) => [p.root.model, p.root.table] as [string, string]),
  ...Object.entries(READS_MODEL_MAP).map(([table, model]) => [model, table] as [string, string]),
]);
const WATCHED_TABLES: ReadonlySet<string> = new Set(TABLE_BY_MODEL.values());

/** Yazan model işlemleri — okuma (`find*`, `count`, `aggregate`, `groupBy`) işaret bırakmaz. */
const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  "create", "createMany", "createManyAndReturn",
  "update", "updateMany", "updateManyAndReturn", "upsert",
  "delete", "deleteMany",
]);
const RAW_OPERATIONS: ReadonlySet<string> = new Set(["$executeRaw", "$executeRawUnsafe", "$queryRaw", "$queryRawUnsafe"]);
/** Ham SQL'de yazılan tablo: `INSERT INTO "t"`, `UPDATE "t"`, `DELETE FROM "t"` (CTE içi dahil). */
const RAW_WRITE_RE = /\b(?:insert\s+into|update|delete\s+from)\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;

let dirty = new Set<string>();
let firstDirtyAt: number | null = null;
let listener: (() => void) | null = null;
let clock: () => number = Date.now;

/** İşaretleme/dinleyici hatası iz aralığı: log seli olmasın, ama sessiz ölüm de olmasın. */
const TRACK_ERROR_LOG_GAP_MS = 60_000;
let lastTrackErrorLogAt: number | null = null;

/** İyileştirme katmanının hatası yazmayı ASLA kırmaz; yalnız dakikada en fazla bir uyarı bırakır. */
function reportTrackError(where: string, err: unknown): void {
  try {
    const now = Date.now();
    if (lastTrackErrorLogAt !== null && now - lastTrackErrorLogAt < TRACK_ERROR_LOG_GAP_MS) return;
    lastTrackErrorLogAt = now;
    uyari("patron-bulut", `kirli bayrak ${where} hatası yutuldu (yazma sürdü; emniyet turu kapsar)`, err);
  } catch {
    // Log da fırlatırsa susulur: yazma yolu her koşulda sürer.
  }
}

/** TEK YAZAR (dışa açık değil; yalnız istemci sarması çağırır): tablo adı + ilk kirlenme anı + dinleyici. */
function markDirty(table: string): void {
  if (dirty.size === 0) firstDirtyAt = clock();
  dirty.add(table);
  try {
    listener?.();
  } catch (err) {
    reportTrackError("dinleyici", err);
  }
}

/** İşaretleme adımı korumalı: fırlatsa bile çağıran gerçek Prisma çağrısını yapar. */
function safeMark(mark: () => void): void {
  try {
    mark();
  } catch (err) {
    reportTrackError("işaretleme", err);
  }
}

/** Kümeyi tüketir (tur başlarken); tur sürerken gelen yazım yeni kümeye düşer. */
export function takeDirty(): { tables: ReadonlySet<string>; firstDirtyAt: number | null } {
  const out = { tables: dirty as ReadonlySet<string>, firstDirtyAt };
  dirty = new Set<string>();
  firstDirtyAt = null;
  return out;
}

/** Tüketmeden bakış (durum ekranı + bekçi). */
export function peekDirty(): { tables: ReadonlySet<string>; firstDirtyAt: number | null } {
  return { tables: new Set(dirty), firstDirtyAt };
}

/** Tek dinleyici (eşitleme işi); `null` kaldırır. */
export function onDirty(fn: (() => void) | null): void {
  listener = fn;
}

/** Test-only: kümeyi boşaltır, saati enjekte eder. */
export function __resetDirtyForTests(p: { now?: () => number } = {}): void {
  dirty = new Set<string>();
  firstDirtyAt = null;
  lastTrackErrorLogAt = null;
  if (p.now) clock = p.now;
}

/** Ham SQL metni: şablon çağrısı (`strings`, …değerler), `Prisma.sql` nesnesi ya da `(metin, …değerler)`. */
function rawSqlText(args: readonly unknown[]): string | null {
  const first = args[0];
  if (typeof first === "string") return first;
  if (Array.isArray(first) && first.every((x) => typeof x === "string")) return first.join("?");
  if (first && typeof first === "object") {
    const a = first as { sql?: unknown; strings?: unknown };
    if (typeof a.sql === "string") return a.sql;
    if (Array.isArray(a.strings)) return a.strings.join("?");
  }
  return null;
}

/** Ham SQL'in yazdığı izlenen tablolar; metin çözülemezse "*" (fazla tur, kaçan değişiklik değil). */
export function rawWrittenTables(args: readonly unknown[]): string[] {
  const text = rawSqlText(args);
  if (text === null) return ["*"];
  const out: string[] = [];
  for (const m of text.matchAll(RAW_WRITE_RE)) {
    const t = m[1].toLowerCase();
    if (WATCHED_TABLES.has(t)) out.push(t);
  }
  return out;
}

/** Prisma delege anahtarı (model adının ilk harfi küçük) → tablo. */
const TABLE_BY_DELEGATE: ReadonlyMap<string, string> = new Map(
  [...TABLE_BY_MODEL].map(([model, table]) => [model.charAt(0).toLowerCase() + model.slice(1), table] as [string, string]),
);

/** Bekçi §7: haritadaki her delege anahtarı istemcide gerçekten bir model delegesi olmalı. */
export function watchedDelegateKeys(): string[] {
  return [...TABLE_BY_DELEGATE.keys()];
}

type AnyFn = (...args: unknown[]) => unknown;

/**
 * Sarma önbelleği KAYNAK kimliğine bağlıdır: test kancası (`scripts/lib/zorlanmis-sira.ts`) yöntemi
 * yerinde değiştirirse yeni kaynak sarılır; geri yüklenen kendi sarmamız yeniden sarılmaz.
 */
const OWN_WRAPPERS = new WeakSet<object>();
function cachedWrap(cache: Map<PropertyKey, { src: unknown; fn: AnyFn }>, prop: PropertyKey, v: AnyFn, make: (v: AnyFn) => AnyFn): AnyFn {
  if (OWN_WRAPPERS.has(v)) return v;
  const hit = cache.get(prop);
  if (hit && hit.src === v) return hit.fn;
  const fn = make(v);
  OWN_WRAPPERS.add(fn);
  cache.set(prop, { src: v, fn });
  return fn;
}

/** İzlenen delegenin yazan yöntemleri ÇAĞRI anında işaretler; dönen PrismaPromise'e dokunulmaz (toplu tx bozulmaz). */
function wrapDelegate(delegate: object, table: string): object {
  const cache = new Map<PropertyKey, { src: unknown; fn: AnyFn }>();
  return new Proxy(delegate, {
    get(target, prop) {
      const v: unknown = Reflect.get(target, prop, target);
      if (typeof prop !== "string" || !WRITE_OPERATIONS.has(prop) || typeof v !== "function") return v;
      return cachedWrap(cache, prop, v as AnyFn, (src) => (...args: unknown[]): unknown => {
        safeMark(() => markDirty(table));
        return Reflect.apply(src, target, args) as unknown;
      });
    },
  });
}

/**
 * İstemciyi kirli bayrak izlemesiyle sarar — `lib/prisma.ts` TEK noktada uygular. Prisma
 * `$extends` yolu denendi: genişletilmiş tip 139 dosyada `Prisma.TransactionClient` imzalarını
 * kırdı (P4 durma kuralı) → Proxy tipi korur. İşaret ÇAĞRI anında bırakılır (hata veren ya da
 * geri alınan yazım yalnız boş bir tur doğurur); itx istemcisi de aynı sarmadan geçer.
 */
export function withDirtyTracking<T extends object>(client: T): T {
  const delegates = new Map<string, { src: object; proxy: object }>();
  const fns = new Map<PropertyKey, { src: unknown; fn: AnyFn }>();
  return new Proxy(client, {
    get(target, prop) {
      const v: unknown = Reflect.get(target, prop, target);
      if (typeof prop === "string") {
        const table = TABLE_BY_DELEGATE.get(prop);
        if (table && v && typeof v === "object") {
          const hit = delegates.get(prop);
          if (hit && hit.src === v) return hit.proxy;
          const proxy = wrapDelegate(v, table);
          delegates.set(prop, { src: v, proxy });
          return proxy;
        }
      }
      if (typeof v !== "function") return v;
      return cachedWrap(fns, prop, v as AnyFn, (src) => {
        if (prop === "$transaction") {
          // İnteraktif tx: geri çağrıya verilen tx istemcisi de sarılır; dizi biçimi dokunulmaz.
          return (arg: unknown, ...rest: unknown[]): unknown => {
            const wrapped = typeof arg === "function" ? (tx: object): unknown => Reflect.apply(arg, undefined, [withDirtyTracking(tx)]) as unknown : arg;
            return Reflect.apply(src, target, [wrapped, ...rest]) as unknown;
          };
        }
        if (typeof prop === "string" && RAW_OPERATIONS.has(prop)) {
          return (...args: unknown[]): unknown => {
            safeMark(() => {
              for (const t of rawWrittenTables(args)) markDirty(t);
            });
            return Reflect.apply(src, target, args) as unknown;
          };
        }
        return (...args: unknown[]): unknown => Reflect.apply(src, target, args) as unknown;
      });
    },
  });
}
