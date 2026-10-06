// KİRACI KAPSAMI — `app.*` oturum ayarlarının ve tx açışının TEK YAZARI (sözleşme §9.2–9.3 + PATRON-TESIS-DB §4).
// Her DB işi burada açılan bir tx'te koşar; tx, yönlendiricinin (`lib/tesis-db.ts`) TESİS DB'sinde açılır ve İLK
// ifadesi tek bir SELECT'tir:
//   set_config('app.tesis_id', …, true) + set_config('app.projeksiyonlar', …, true)
//   + öteki arama anahtarlarının SIFIRLANMASI + (varsa) advisory kilit + DB bağı işareti okuması.
// DB bağı: hazırlayıcı her tesis DB'sine `app.veritabani_tesisi = <tesis>` yazar (merkeze `merkez`); işaret kapsamın
// tesisi değilse tx hiçbir sorgu koşmadan düşer ⇒ dizin bozulsa bile A'nın kapsamı B'nin DB'sinde açılamaz.
// `true` = SET LOCAL: tx bitince değer düşer (havuzlu bağlantıda sızmaz). Kapsamsız sorgu RLS'te HATA verir.
// Ön-kiracı aramaları (giriş e-postası, oturum/davet özeti, kurulum kimliği) önce TESİSİ çözer (merkez dizini ya da
// belirteç ön eki), sonra o tesisin DB'sinde tek anahtarlı SELECT kipinde koşar; çözülemeyen kimlik → null.
import { Prisma } from "@prisma/client";
import type { Tx } from "./db";
import { CloudError } from "./errors";
import { LOCK_NAMESPACES, type LockSpec } from "./locks";
import { CENTRAL_MARK } from "./tesis-db-ad";
import type { TesisDbRouter } from "./tesis-db";

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

/** Oturum ve davet aramasının tesisi belirtecin ön ekindendir (özet belirtecin TAMAMINDAN). */
export type Lookup =
  | { readonly kind: "eposta"; readonly value: string }
  | { readonly kind: "oturum"; readonly value: string; readonly tesisId: string }
  | { readonly kind: "davet"; readonly value: string; readonly tesisId: string }
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

/** İlk ifade: ayarlar + kilit + DB bağı işareti TEK SELECT'te. */
interface ScopeSettings {
  readonly tesisId: string;
  readonly projections: string;
  readonly set: Partial<Record<LookupKey, string>>;
  readonly lock?: LockSpec;
  /** Bu tx'in açılması gereken DB'nin işareti (tesis kimliği ya da `merkez`). */
  readonly mark: string;
}

export class DatabaseBindingError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string | null,
  ) {
    super("DB bağı uyuşmuyor: kapsam başka veritabanında açılamaz");
    Object.setPrototypeOf(this, DatabaseBindingError.prototype);
  }
}

async function openScope(tx: Tx, g: ScopeSettings): Promise<boolean> {
  const rows = await tx.$queryRaw<{ kilit: boolean | null; isaret: string | null }[]>(
    Prisma.sql`SELECT ${settings(g.tesisId, g.projections, g.set)}, ${lockExpression(g.lock)}, current_setting('app.veritabani_tesisi', true) AS isaret`,
  );
  const mark = rows[0]?.isaret ?? null;
  if (mark !== g.mark) throw new DatabaseBindingError(g.mark, mark);
  return rows[0]?.kilit !== false;
}

export class LockBusyError extends Error {
  constructor(readonly lock: LockSpec) {
    super(`Kilit dolu: ${lock.name}`);
    Object.setPrototypeOf(this, LockBusyError.prototype);
  }
}

/** Kiracı kapsamı: tesisin DB'sinde, ilk ifade kiracı + alan izni + kilit + DB bağı. `try` kilidi doluysa LockBusyError. */
export async function withTesis<T>(router: TesisDbRouter, scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID.test(scope.tesisId) || scope.tesisId === NO_TENANT) throw new Error("Kiracı kapsamı geçersiz tesis kimliğiyle açılamaz");
  const tesisId = scope.tesisId.toLowerCase();
  const projections = projectionList(scope.projections);
  return router.withFacilityClient(tesisId, (db) =>
    db.$transaction(
      async (tx) => {
        const acquired = await openScope(tx, { tesisId, projections, set: {}, lock: scope.lock, mark: tesisId });
        if (!acquired && scope.lock) throw new LockBusyError(scope.lock);
        return fn(tx);
      },
      scope.timeoutMs ? { timeout: scope.timeoutMs } : undefined,
    ),
  );
}

/** Aramanın tesisi: dizin (e-posta · kurulum) ya da belirteç ön eki (oturum · davet). */
async function lookupTesis(router: TesisDbRouter, lookup: Lookup): Promise<string | null> {
  switch (lookup.kind) {
    case "eposta":
      return (await router.routeOfEmail(lookup.value))?.tesisId ?? null;
    case "kurulum":
      return router.tesisOfInstallation(lookup.value);
    case "oturum":
    case "davet":
      return UUID.test(lookup.tesisId) && lookup.tesisId !== NO_TENANT ? lookup.tesisId.toLowerCase() : null;
  }
}

/**
 * Ön-kiracı tek anahtarlı arama (SELECT-yalnız politikalar), çözülen tesisin DB'sinde; kiracı ayarı sıfır UUID.
 * Tesis çözülemezse ya da tesis DB'si yoksa (imha, uydurma ön ek) sorgusuz null; hazırlanıyorsa 503 yükselir.
 */
export async function withLookup<T>(router: TesisDbRouter, lookup: Lookup, fn: (tx: Tx) => Promise<T>): Promise<T | null> {
  if (!lookup.value) throw new Error("Boş arama anahtarı");
  const tesisId = await lookupTesis(router, lookup);
  if (!tesisId) return null;
  try {
    return await router.withFacilityClient(tesisId, (db) =>
      db.$transaction(async (tx) => {
        await openScope(tx, { tesisId: NO_TENANT, projections: "", set: { [LOOKUP_GUC[lookup.kind]]: lookup.value }, mark: tesisId });
        return fn(tx);
      }),
    );
  } catch (err) {
    if (err instanceof CloudError && err.status === 404) return null;
    throw err;
  }
}

/** Bakım işi: hazır tesis DB'lerinin listesi (merkez). Satır işleri ayrıca `withTesis`le, tesis başına. */
export async function listReadyFacilities(router: TesisDbRouter): Promise<string[]> {
  return router.readyFacilities();
}

/** Merkez tx'i (yönlendirme tabloları): ilk ifade DB bağı (`merkez`) + varsa advisory kilit. Kiracı verisi YOK. */
export async function withCentral<T>(router: TesisDbRouter, g: { readonly lock?: LockSpec }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return router.centralClient.$transaction(async (tx) => {
    const acquired = await openScope(tx, { tesisId: NO_TENANT, projections: "", set: {}, lock: g.lock, mark: CENTRAL_MARK });
    if (!acquired && g.lock) throw new LockBusyError(g.lock);
    return fn(tx);
  });
}
