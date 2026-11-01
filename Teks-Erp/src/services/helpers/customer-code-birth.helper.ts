// =============================================================================
// MÜŞTERİ SERİSİNDEN KOD DOĞUMU — biçim + sayaç kapsamı + tx içi doğum (D4-F2, DALGA4 §7.4–7.5)
// =============================================================================
// Müşteri kodu iç numara değildir: biçimi `customer_barcode_series`te, sayacı `number_series_counters`
// satırındadır (`seriesKey = customerCode:<seriesId>`). Kapsam (`scopeKey`) iç serilerle AYNI çekirdekten
// (`counterScopeKey`) kurulur ve `formatChangedAt`i İÇERİR: biçim değişince yeni satır doğar, sayaç yeni
// biçimden başlar; eski kodlar dokunulmaz (bekçi `test_musteri_barkod_serisi` §4 bunu ölçer).
//
// ⚠️ TX İÇİ SAYAÇ BİLİNÇLİ: kod çocuk topla AYNI tx'te materyalize olur (numaralandirma.md). Satır kilidi
// commit'e kadar sürer ama kapsam MÜŞTERİ başınadır (fabrika-tek top sayacı değil); aynı müşterinin iki
// eşzamanlı Tambur çıkışı sıraya girer, diğer müşteriler etkilenmez.
// Çakışma ("P2002 retry"): tx'i bozmamak için ekleme `createMany skipDuplicates`; 0 dönerse sıradaki numara denenir.
// =============================================================================
import { CustomerCodeSource, type CustomerBarcodeSeries, type Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AppError } from "../../utils/app-error";
import { normalizeScanCode } from "../../utils/code-format";
import { AuditService } from "../audit.service";
import { formatSeriesCode, seriesPrefix, type NumberSeriesFormat } from "./series-format.helper";
import { counterScopeKey } from "./series-counter-store.helper";
import { nextCounterSeq } from "./series-counter.helper";
import { classifyScannedCode } from "./series-classifier.helper";
import { customerCodeValueUsed } from "./roll-scan-resolve.helper";

type Db = Prisma.TransactionClient;
type SeriesFormatFields = Pick<CustomerBarcodeSeries, "prefix" | "dateSegment" | "digits" | "separator" | "startValue" | "maxValue"> & {
  /** null = henüz kaydedilmemiş biçim (önizleme). */
  formatChangedAt: Date | null;
};

/** Bir seride ardışık dolu kod sınırı — aşılırsa 409 (sonsuz döngü yerine okunur hata). */
export const CUSTOMER_CODE_SKIP_LIMIT = 200;

export function customerSeriesCounterKey(seriesId: string): string {
  return `customerCode:${seriesId}`;
}

/** Serinin biçimi — iç serilerin saf çekirdeğine (`series-format`) verilecek biçimde. */
export function customerSeriesFormat(series: SeriesFormatFields): NumberSeriesFormat {
  return {
    prefix: series.prefix,
    dateSegment: series.dateSegment,
    digits: series.digits,
    separator: series.separator,
    retiredPrefixes: [],
    formatChangedAt: series.formatChangedAt,
    startValue: series.startValue,
    maxValue: series.maxValue,
  };
}

/** Sayaç satırının kapsamı — `formatChangedAt` DAHİL (biçim değişimi = yeni kapsam = sayaç baştan). */
export function customerSeriesScope(series: SeriesFormatFields & { id: string }, date: Date) {
  const fmt = customerSeriesFormat(series);
  const fullPrefix = seriesPrefix(fmt, date);
  return { fmt, fullPrefix, seriesKey: customerSeriesCounterKey(series.id), scopeKey: counterScopeKey(fmt, fullPrefix) };
}

type Scope = ReturnType<typeof customerSeriesScope>;

/**
 * Kodun sırası — ön ek TAM kesilerek okunur. `seriesCodeSeq` sondaki rakam koşusunu aldığı için ayraçsız ve
 * rakamla biten müşteri ön ekinde ("GK1" + "0001") ön ekin rakamlarını sıraya katar; müşteri ön eki serbesttir.
 */
function seqAfterPrefix(scope: Scope, code: string): number | null {
  if (!code.startsWith(scope.fullPrefix)) return null;
  const tail = code.slice(scope.fullPrefix.length);
  if (!/^\d+$/.test(tail) || tail.length < scope.fmt.digits || tail.length > 15) return null;
  const n = Number.parseInt(tail, 10);
  if (n < (scope.fmt.startValue ?? 1) || (scope.fmt.maxValue != null && n > scope.fmt.maxValue)) return null;
  return n;
}

/**
 * Kapsam başı tohumu: serinin aynı görünür ön ekli TÜM kodlarından (kaldırılmış dahil, tarih süzgeci YOK) en
 * büyük sıra + 1. Üst sınır yükseltme ya da A→B→A dönüşü yeni kapsam satırı doğurur; tohum eski kodların
 * üstünden sürmezse her doğum dolu kodlara çarpar ve atlama sınırına takılır (PR #383 inceleme bulgusu).
 */
async function seedSeq(db: Db, seriesId: string, scope: Scope): Promise<number> {
  // Koda göre süzme yok (tek okutma boğazı kuralı): satırlar seriden, ön ek bellekte.
  const rows = await db.rollCustomerCode.findMany({ where: { seriesId }, select: { code: true } });
  const max = rows.reduce((m, r) => Math.max(m, seqAfterPrefix(scope, r.code) ?? 0), 0);
  return nextCounterSeq(scope.fmt, max, scope.fullPrefix);
}

async function bump(db: Db, scope: Scope): Promise<number | null> {
  const rows = await db.$queryRaw<Array<{ n: number }>>`
    UPDATE "number_series_counters" SET "n" = "n" + 1, "updatedAt" = ${new Date()}
     WHERE "seriesKey" = ${scope.seriesKey} AND "scopeKey" = ${scope.scopeKey}
 RETURNING "n"`;
  return rows.length ? Number(rows[0]!.n) : null;
}

/** Sıradaki sıra — çağıranın tx'inde (satır kilidi commit'e kadar; kapsam müşteri başına). */
async function takeSeqTx(db: Db, seriesId: string, scope: Scope): Promise<number> {
  let n = await bump(db, scope);
  if (n === null) {
    const seed = await seedSeq(db, seriesId, scope);
    const won = await db.$queryRaw<Array<{ n: number }>>`
      INSERT INTO "number_series_counters" ("id", "seriesKey", "scopeKey", "n", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), ${scope.seriesKey}, ${scope.scopeKey}, ${seed}, ${new Date()}, ${new Date()})
      ON CONFLICT ("seriesKey", "scopeKey") DO NOTHING
      RETURNING "n"`;
    if (won.length) return seed;
    n = await bump(db, scope);
    if (n === null) throw new Error(`"${scope.seriesKey}" sayaç satırı tohumlandıktan sonra bulunamadı`);
  }
  // Üst sınır ve hata metni iç serilerle TEK çekirdekten.
  return nextCounterSeq(scope.fmt, n - 1, scope.fullPrefix);
}

/** Kod bizim iç biçimimizle ya da bir top barkoduyla çakışıyor mu (okutmada iç barkod hep önce kazanır). */
export async function customerCodeCollidesWithOurs(db: Pick<Db, "roll">, code: string): Promise<boolean> {
  if (classifyScannedCode(code)) return true;
  return (await db.roll.findUnique({ where: { barcode: normalizeScanCode(code) }, select: { id: true } })) !== null;
}

/** Önizleme: sayacı TÜKETMEDEN sıradaki sıra (sayaç satırı yoksa tohum hesabı). */
export async function peekCustomerSeriesSeq(
  db: Db,
  series: SeriesFormatFields & { id: string },
  date: Date = new Date(),
): Promise<number> {
  const scope = customerSeriesScope(series, date);
  const row = await db.numberSeriesCounter.findUnique({
    where: { seriesKey_scopeKey: { seriesKey: scope.seriesKey, scopeKey: scope.scopeKey } },
    select: { n: true },
  });
  return row ? row.n + 1 : seedSeq(db, series.id, scope);
}

/** Önizleme: sayacı TÜKETMEDEN sıradaki kod. */
export async function peekCustomerSeriesCode(
  db: Db,
  series: SeriesFormatFields & { id: string },
  date: Date = new Date(),
): Promise<string> {
  return formatSeriesCode(customerSeriesFormat(series), await peekCustomerSeriesSeq(db, series, date), date);
}

export interface BornCustomerCode {
  id: string;
  rollId: string;
  customerId: string;
  code: string;
  seriesId: string;
}

export interface CustomerCodeBirthResult {
  born: BornCustomerCode[];
  /** Seri doldu / atlama sınırı aşıldı → kalan toplar kodsuz; üretim DURMAZ (basımda `label.customerCodeMissing`). */
  warning: string | null;
}

/** Kod doğumunun "seri tükendi" hataları — finalize'ı geri almaz, uyarıya döner. */
const NON_FATAL_CODES = new Set(["NUMBER_SERIES_RANGE_EXHAUSTED", "CUSTOMER_SERIES_EXHAUSTED"]);

function nonFatalBirthError(e: unknown): string | null {
  if (!(e instanceof AppError)) return null;
  const code = (e.details as { code?: string } | undefined)?.code;
  return code && NON_FATAL_CODES.has(code) ? e.message : null;
}

/** Tek topa sıradaki kod; dolu kodlar atlanır. Topun zaten aktif kodu varsa null. */
async function birthOneTx(
  tx: Db,
  ctx: { series: CustomerBarcodeSeries; scope: Scope; at: Date; customerId: string; userId: string | null },
  rollId: string,
): Promise<BornCustomerCode | null> {
  const { series, scope, at } = ctx;
  const input = ctx;
  for (let attempt = 0; ; attempt++) {
    if (attempt >= CUSTOMER_CODE_SKIP_LIMIT) {
      throw AppError.conflict(
        `Müşteri barkod serisinde ${CUSTOMER_CODE_SKIP_LIMIT} ardışık kod dolu — cari kartta Barkod serisi biçimini kontrol edin.`,
        { code: "CUSTOMER_SERIES_EXHAUSTED", seriesId: series.id },
      );
    }
    const code = formatSeriesCode(scope.fmt, await takeSeqTx(tx, series.id, scope), at);
    // Kaldırılmış kod da DAHİL: bir kod değeri müşteride iki kez doğmaz.
    if ((await customerCodeValueUsed(tx, input.customerId, code)) || (await customerCodeCollidesWithOurs(tx, code))) continue;
    const id = randomUUID();
    // skipDuplicates = ON CONFLICT DO NOTHING: kısmi unique çakışması tx'i bozmadan 0 döner.
    const inserted = await tx.rollCustomerCode.createMany({
      data: [{ id, rollId, customerId: input.customerId, code, source: CustomerCodeSource.CUSTOMER_SERIES, seriesId: series.id, clientToken: randomUUID(), createdById: input.userId }],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return { id, rollId, customerId: input.customerId, code, seriesId: series.id };
    // Çakışma: eşzamanlı bağlama aynı kodu aldıysa sıradaki numara; topun zaten aktif kodu varsa top atlanır.
    const hasActive = await tx.rollCustomerCode.findFirst({ where: { rollId, revokedAt: null }, select: { id: true } });
    if (hasActive) return null;
  }
}

/**
 * Tambur çıkışı (D4-F2): müşterinin AKTİF serisinden her top için sıradaki kod, çağıranın tx'inde.
 * Seri yok/pasif → boş (hiçbir yazım yok). Seri tükenirse kalan toplar kodsuz kalır + uyarı (üretim durmaz).
 * Audit çağıranın işidir (tx dışında, commit sonrası).
 */
export async function birthCustomerCodesTx(
  tx: Db,
  input: { customerId: string; rollIds: string[]; userId: string | null; at?: Date },
): Promise<CustomerCodeBirthResult> {
  if (input.rollIds.length === 0) return { born: [], warning: null };
  const series = await tx.customerBarcodeSeries.findUnique({ where: { customerId: input.customerId } });
  if (!series || !series.isActive) return { born: [], warning: null };
  const at = input.at ?? new Date();
  const scope = customerSeriesScope(series, at);
  const born: BornCustomerCode[] = [];
  for (const [i, rollId] of input.rollIds.entries()) {
    try {
      const one = await birthOneTx(tx, { series, scope, at, customerId: input.customerId, userId: input.userId }, rollId);
      if (one) born.push(one);
    } catch (e) {
      const msg = nonFatalBirthError(e);
      if (msg === null) throw e;
      return { born, warning: `${input.rollIds.length - i} topa müşteri kodu verilemedi: ${msg}` };
    }
  }
  return { born, warning: null };
}

/** Tambur çıkışında doğan kodların audit'i — tx DIŞINDA, commit sonrası (best-effort). */
export async function auditBornCustomerCodes(
  userId: string | undefined,
  born: ReadonlyArray<BornCustomerCode>,
): Promise<void> {
  if (born.length === 0) return;
  await AuditService.logMany(
    born.map((b) => ({
      userId,
      action: "CREATE" as const,
      tableName: "ROLL_CUSTOMER_CODE",
      recordId: b.id,
      newData: { rollId: b.rollId, customerId: b.customerId, code: b.code, source: "CUSTOMER_SERIES", seriesId: b.seriesId },
    })),
  ).catch(() => undefined);
}

/** Tambur geri alımı ters yolu: iptal edilen çocuğun aktif kodu damgalanır (etiket ölü topa bağlı kalmasın). */
export const TAMBUR_UNDO_CODE_REASON = "Tambur geri alındı — top iptal";

/**
 * İptal edilen toplarının AKTİF müşteri kodlarını çağıranın tx'inde damgalar (satır silinmez; kod değeri
 * kaldırılmış olarak müşteride kalır, yeniden verilmez). Yalnız GERÇEKTEN damgalanan satırlar döner.
 */
export async function revokeCustomerCodesOfRollsTx(
  tx: Db,
  args: { rollIds: string[]; userId: string | null; reason: string },
): Promise<Array<{ id: string; rollId: string; customerId: string; code: string }>> {
  if (args.rollIds.length === 0) return [];
  const rows = await tx.rollCustomerCode.findMany({
    where: { rollId: { in: args.rollIds }, revokedAt: null },
    orderBy: { id: "asc" },
    select: { id: true, rollId: true, customerId: true, code: true },
  });
  const stamped: typeof rows = [];
  const data = { revokedAt: new Date(), revokedById: args.userId, revokeReason: args.reason.slice(0, 300) };
  for (const r of rows) {
    if ((await tx.rollCustomerCode.updateMany({ where: { id: r.id, revokedAt: null }, data })).count > 0) stamped.push(r);
  }
  return stamped;
}

/** Damgalanan kodların audit'i — tx DIŞINDA (best-effort). */
export async function auditRevokedCustomerCodes(
  userId: string | undefined,
  rows: ReadonlyArray<{ id: string; rollId: string; customerId: string; code: string }>,
  reason: string,
): Promise<void> {
  if (rows.length === 0) return;
  await AuditService.logMany(
    rows.map((r) => ({
      userId,
      action: "UPDATE" as const,
      tableName: "ROLL_CUSTOMER_CODE",
      recordId: r.id,
      oldData: { revokedAt: null },
      newData: { rollId: r.rollId, customerId: r.customerId, code: r.code, revoked: true, reason },
    })),
  ).catch(() => undefined);
}
