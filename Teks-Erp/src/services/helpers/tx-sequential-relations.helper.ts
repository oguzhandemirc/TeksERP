/**
 * Tx içinde ilişki yüklemesini SIRALI yapar (S15a, 2026-11-03).
 *
 * Neden: Prisma 7 (adapter-pg) tek `findMany/findUnique/create/update` çağrısında
 * AYNI düzeydeki birden çok ilişkiyi ayrı SQL'lerle PARALEL ister. Havuzda her sorgu
 * ayrı bağlantı alır, sorun yok; interaktif tx'te ise hepsi TEK bağlantıdadır ve pg
 * 8.x ikinciyi kuyruğa alıp "client.query() when the client is already executing a
 * query" uyarısı basar — pg@9'da bu bir HATA olur. (`_count` SQL içinde çözülür,
 * ilişki sayılmaz — ölçüldü.)
 *
 * Nasıl: `sequentialTx(tx).model.op(args)` — tip ve sonuç şekli `tx.model.op(args)` ile
 * aynıdır. Bir düzeyde ≥2 ilişki varsa ilki satır içinde kalır, kalanlar ana satır
 * okunduktan sonra `id IN (...)` ile TEK TEK, `await` sırasıyla eklenir; iç içe
 * düzeyler özyinelemeli aynı kuralla. Anahtar sırası Prisma'nınkiyle aynı kurulur
 * (select → argüman sırası; include → skalerler, sonra include sırası). `id`siz model
 * (bileşik anahtar) bölünemez, satır içi kalır. Bekçi: `scripts/test_pg_eszamanli_sorgu.ts`.
 */
import { Prisma } from "@prisma/client";

type Obj = Record<string, unknown>;
type Mode = "include" | "select";

interface ModelInfo {
  delegate: string;
  relations: Map<string, string>;
  hasId: boolean;
}

const BY_DELEGATE = new Map<string, ModelInfo>();
const BY_MODEL = new Map<string, ModelInfo>();
for (const m of Prisma.dmmf.datamodel.models) {
  const relations = new Map<string, string>();
  for (const f of m.fields) if (f.kind === "object") relations.set(f.name, f.type);
  const info: ModelInfo = { delegate: m.name[0].toLowerCase() + m.name.slice(1), relations, hasId: m.fields.some((f) => f.name === "id") };
  BY_MODEL.set(m.name, info);
  BY_DELEGATE.set(info.delegate, info);
}

const WRAPPED_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "create", "update", "upsert",
]);

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** İlişki değerinin alt kipi ve alt nesnesi (`true` → alt yok). */
function childSpec(v: unknown): { mode: Mode; spec: Obj } | null {
  if (!isObj(v)) return null;
  if (isObj(v.select)) return { mode: "select", spec: v.select };
  if (isObj(v.include)) return { mode: "include", spec: v.include };
  return null;
}

function relationKeys(model: ModelInfo, spec: Obj): string[] {
  return Object.keys(spec).filter((k) => model.relations.has(k) && spec[k] !== false && spec[k] !== undefined);
}

const childModel = (model: ModelInfo, key: string): ModelInfo | undefined => BY_MODEL.get(model.relations.get(key) ?? "");

/** Bu düzeyde ya da altında aynı bağlantıya paralel sorgu düşer mi? */
function isRisky(model: ModelInfo, spec: Obj): boolean {
  const rels = relationKeys(model, spec);
  if (rels.length >= 2) return true;
  return rels.some((k) => {
    const sub = childSpec(spec[k]);
    const cm = childModel(model, k);
    return !!sub && !!cm && isRisky(cm, sub.spec);
  });
}

interface DetachedRelation {
  key: string;
  /** Ana modelin `select: { id, [key]: value }` içine giden değer (alt düzey ayıklanmış). */
  value: unknown;
  child: Plan | null;
}

interface Plan {
  model: ModelInfo;
  mode: Mode;
  original: Obj;
  inline: Obj;
  detached: DetachedRelation[];
}

/** Bir düzeyin planı: satır içi kalan spec + ayrı yüklenecek ilişkiler. */
function plan(model: ModelInfo, mode: Mode, spec: Obj): Plan {
  const p: Plan = { model, mode, original: spec, inline: { ...spec }, detached: [] };
  if (!model.hasId || !isRisky(model, spec)) return p;
  const rels = relationKeys(model, spec);
  // İlk "altı güvenli" ilişki satır içinde kalır — bir sorgu tasarrufu.
  const keptInline = rels.find((k) => {
    const sub = childSpec(spec[k]);
    const cm = childModel(model, k);
    return !sub || !cm || !isRisky(cm, sub.spec);
  });
  for (const k of rels) {
    if (k === keptInline) continue;
    delete p.inline[k];
    const cm = childModel(model, k);
    const sub = childSpec(spec[k]);
    if (!sub || !cm) {
      p.detached.push({ key: k, value: spec[k], child: null });
      continue;
    }
    const cp = plan(cm, sub.mode, sub.spec);
    p.detached.push({ key: k, value: { ...(spec[k] as Obj), [sub.mode]: queryableSpec(cp) }, child: cp.detached.length ? cp : null });
  }
  queryableSpec(p);
  return p;
}

/** Planın sorguya giden spec'i; ayrı ilişki varsa select kipinde `id` eklenir (sonda geri düşer). */
function queryableSpec(p: Plan): Obj {
  if (p.mode === "select" && p.detached.length && !p.inline.id) p.inline.id = true;
  return p.inline;
}

/** Sorgu argümanı: include boşaldıysa anahtar düşer. */
function buildArgs(args: Obj, p: Plan): Obj {
  const out: Obj = { ...args };
  if (p.mode === "include" && Object.keys(p.inline).length === 0) delete out.include;
  else out[p.mode] = p.inline;
  return out;
}

/** Düz nesne/dizi kopyası; Date/Decimal gibi sınıf örnekleri olduğu gibi kalır. */
function clonePlain(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clonePlain);
  if (isObj(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) out[k] = clonePlain(x);
    return out;
  }
  return v;
}

type Delegate = Record<string, (args: Obj) => Promise<unknown>>;

const delegateOf = (tx: object, model: ModelInfo): Delegate => Reflect.get(tx, model.delegate) as Delegate;

function asRows(v: unknown): Obj[] {
  if (Array.isArray(v)) return v.filter(isObj);
  return isObj(v) ? [v] : [];
}

/** Planın ayrı ilişkilerini satırlara SIRAYLA ekler, sonra anahtar sırasını kurar. */
async function attach(tx: object, p: Plan, rows: Obj[]): Promise<void> {
  if (rows.length === 0) return;
  const ids = [...new Set(rows.map((r) => r.id).filter((x): x is string => typeof x === "string"))];
  for (const d of p.detached) {
    const byId = new Map<string, unknown>();
    if (ids.length > 0) {
      const res = await delegateOf(tx, p.model).findMany({ where: { id: { in: ids } }, select: { id: true, [d.key]: d.value } });
      for (const r of asRows(res)) byId.set(r.id as string, r[d.key]);
    }
    const seen = new Set<string>();
    const childRows: Obj[] = [];
    for (const r of rows) {
      const id = r.id as string;
      // Aynı id'li ikinci satır (iki ebeveynin ortak çocuğu) kendi kopyasını alır — Prisma da ayrı nesne verir.
      const v = seen.has(id) ? clonePlain(byId.get(id)) : byId.get(id);
      seen.add(id);
      r[d.key] = v === undefined ? null : v;
      if (d.child) childRows.push(...asRows(r[d.key]));
    }
    if (d.child) await attach(tx, d.child, childRows);
  }
  for (const r of rows) reorder(p, r);
}

/** Prisma'nın anahtar sırası: select → argüman sırası; include → skalerler, sonra include sırası. */
function reorder(p: Plan, r: Obj): void {
  const wanted = Object.keys(p.original).filter((k) => p.original[k] !== false && p.original[k] !== undefined);
  const order = p.mode === "select" ? wanted : [...Object.keys(r).filter((k) => !(k in p.original)), ...wanted];
  const prev: Obj = { ...r };
  for (const k of Object.keys(r)) delete r[k];
  for (const k of order) if (k in prev) r[k] = prev[k];
}

/** `tx.<delegate>.<op>(args)` ile aynı sonucu ilişkileri sıralı yükleyerek üretir. */
async function run(tx: object, model: ModelInfo, op: string, args: Obj): Promise<unknown> {
  const mode: Mode | null = isObj(args.select) ? "select" : isObj(args.include) ? "include" : null;
  const delegate = delegateOf(tx, model);
  if (!mode) return delegate[op](args);
  const p = plan(model, mode, args[mode] as Obj);
  if (p.detached.length === 0) return delegate[op](args);
  const result = await delegate[op](buildArgs(args, p));
  await attach(tx, p, asRows(result));
  return result;
}

/**
 * Tx istemcisinin "ilişkileri sıralı yükleyen" görünümü. Yalnız okuma + create/update/
 * upsert sarılır; diğer her şey (raw, createMany, delete…) olduğu gibi geçer.
 */
export function sequentialTx<T extends object>(tx: T): T {
  // Kök istemci (havuz) her sorguya ayrı bağlantı verir — dokunulmaz. Ayırt edici `$disconnect`:
  // Prisma 7 tx istemcisi iç içe `$transaction` taşır ama `$connect/$disconnect` taşımaz (ölçüldü).
  if (typeof Reflect.get(tx, "$disconnect") === "function") return tx;
  const cache = new Map<string, object>();
  return new Proxy(tx, {
    get(target, prop) {
      const v: unknown = Reflect.get(target, prop, target);
      if (typeof v === "function") return (...a: unknown[]): unknown => Reflect.apply(v, target, a) as unknown;
      if (typeof prop !== "string" || !isObj(v)) return v;
      const model = BY_DELEGATE.get(prop);
      if (!model) return v;
      const hit = cache.get(prop);
      if (hit) return hit;
      const wrapped = new Proxy(v, {
        get(d, op) {
          const fn: unknown = Reflect.get(d, op, d);
          if (typeof fn !== "function") return fn;
          if (typeof op === "string" && WRAPPED_OPS.has(op)) {
            return (args: Obj) => run(target, model, op, args ?? {});
          }
          return (...a: unknown[]): unknown => Reflect.apply(fn, d, a) as unknown;
        },
      });
      cache.set(prop, wrapped);
      return wrapped;
    },
  });
}

/** Bekçi içindir: verilen argüman tx'te paralel ilişki sorgusu doğurur mu (statik). */
export function hasParallelRelationRisk(delegate: string, args: Obj): boolean {
  const model = BY_DELEGATE.get(delegate);
  if (!model) return false;
  const spec = isObj(args.select) ? args.select : isObj(args.include) ? args.include : null;
  return !!spec && isRisky(model, spec);
}
