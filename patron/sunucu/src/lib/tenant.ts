// KİRACI KAPSAMI — `app.*` oturum ayarlarının TEK YAZARI (sözleşme §9.2–9.3).
// Her DB işi burada açılan bir tx'te koşar ve tx'in İLK ifadesi tek bir SELECT'tir:
//   set_config('app.tesis_id', …, true) + set_config('app.projeksiyonlar', …, true)
//   + öteki arama anahtarlarının SIFIRLANMASI + (varsa) advisory kilit.
// `true` = SET LOCAL: tx bitince değer düşer (havuzlu bağlantıda sızmaz). Kapsamsız sorgu RLS'te HATA
// verir (`current_setting('app.tesis_id')` ayarsız ya da boş) ⇒ fail-closed, sıfır satır.
// Ön-kiracı aramaları (giriş e-postası, oturum/davet özeti, kurulum kimliği, bakım listesi) tek
// anahtarlı SELECT kipleridir: `app.tesis_id` sıfır UUID'dir, hiçbir kiracının satırı eşleşmez.
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Tx } from "./db";
import { LOCK_NAMESPACES, type LockSpec } from "./locks";

/** Kiracısız kiplerin `app.tesis_id` değeri: geçerli UUID ama hiçbir tesis değil. */
export const NO_TENANT = "00000000-0000-0000-0000-000000000000";

const LOOKUP_KEYS = ["app.giris_eposta", "app.oturum_ozeti", "app.davet_ozeti", "app.kurulum_id", "app.bakim"] as const;
type LookupKey = (typeof LOOKUP_KEYS)[number];

export interface TenantScope {
  readonly tesisId: string;
  /** Bu tx'te okunabilecek projeksiyon adları (RLS alan izni). Boş = hiçbiri; `*` YASAK. */
  readonly projections?: readonly string[];
  readonly lock?: LockSpec;
  /** Uzun iş (eşitleme paketi) için tx zaman aşımı. */
  readonly timeoutMs?: number;
}

export type Lookup =
  | { readonly kind: "eposta"; readonly value: string }
  | { readonly kind: "oturum"; readonly value: string }
  | { readonly kind: "davet"; readonly value: string }
  | { readonly kind: "kurulum"; readonly value: string };

const LOOKUP_GUC: Readonly<Record<Lookup["kind"], LookupKey>> = {
  eposta: "app.giris_eposta",
  oturum: "app.oturum_ozeti",
  davet: "app.davet_ozeti",
  kurulum: "app.kurulum_id",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function projectionList(projections: readonly string[] | undefined): string {
  const list = projections ?? [];
  for (const p of list) {
    if (p === "*" || p.includes(",")) throw new Error(`Geçersiz projeksiyon adı kapsamda: ${p}`);
  }
  return list.join(",");
}

function settings(tesisId: string, projections: string, set: Partial<Record<LookupKey, string>>): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`set_config('app.tesis_id', ${tesisId}, true)`,
    Prisma.sql`set_config('app.projeksiyonlar', ${projections}, true)`,
  ];
  for (const k of LOOKUP_KEYS) parts.push(Prisma.sql`set_config(${k}, ${set[k] ?? ""}, true)`);
  return Prisma.join(parts, ", ");
}

function lockExpression(lock: LockSpec | undefined): Prisma.Sql {
  if (!lock) return Prisma.sql`NULL::boolean AS kilit`;
  const ns = LOCK_NAMESPACES[lock.name];
  return lock.mode === "try"
    ? Prisma.sql`pg_try_advisory_xact_lock(${ns}::int4, hashtext(${lock.key})) AS kilit`
    : Prisma.sql`(pg_advisory_xact_lock(${ns}::int4, hashtext(${lock.key})) IS NOT NULL) AS kilit`;
}

/** İlk ifade: ayarlar + kilit TEK SELECT'te. `try` kilidi alınamadıysa false. */
interface ScopeSettings {
  readonly tesisId: string;
  readonly projections: string;
  readonly set: Partial<Record<LookupKey, string>>;
  readonly lock?: LockSpec;
}

async function openScope(tx: Tx, g: ScopeSettings): Promise<boolean> {
  const rows = await tx.$queryRaw<{ kilit: boolean | null }[]>(
    Prisma.sql`SELECT ${settings(g.tesisId, g.projections, g.set)}, ${lockExpression(g.lock)}`,
  );
  return rows[0]?.kilit !== false;
}

export class LockBusyError extends Error {
  constructor(readonly lock: LockSpec) {
    super(`Kilit dolu: ${lock.name}`);
    Object.setPrototypeOf(this, LockBusyError.prototype);
  }
}

/** Kiracı kapsamı: tx'in ilk ifadesi kiracı + alan izni + kilit. `try` kilidi doluysa LockBusyError. */
export async function withTesis<T>(db: PrismaClient, scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(scope.tesisId) || scope.tesisId === NO_TENANT) throw new Error("Kiracı kapsamı geçersiz tesis kimliğiyle açılamaz");
  const projections = projectionList(scope.projections);
  return db.$transaction(
    async (tx) => {
      const acquired = await openScope(tx, { tesisId: scope.tesisId, projections, set: {}, lock: scope.lock });
      if (!acquired && scope.lock) throw new LockBusyError(scope.lock);
      return fn(tx);
    },
    scope.timeoutMs ? { timeout: scope.timeoutMs } : undefined,
  );
}

/** Ön-kiracı tek anahtarlı arama (SELECT-yalnız politikalar). Kiracı YOK: sıfır UUID. */
export async function withLookup<T>(db: PrismaClient, lookup: Lookup, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!lookup.value) throw new Error("Boş arama anahtarı");
  return db.$transaction(async (tx) => {
    await openScope(tx, { tesisId: NO_TENANT, projections: "", set: { [LOOKUP_GUC[lookup.kind]]: lookup.value } });
    return fn(tx);
  });
}

/** Bakım işi: yalnız tesis listesi (`facilities` bakım politikası). Satır işleri ayrıca `withTesis`le. */
export async function withMaintenanceList<T>(db: PrismaClient, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (tx) => {
    await openScope(tx, { tesisId: NO_TENANT, projections: "", set: { "app.bakim": "evet" } });
    return fn(tx);
  });
}
