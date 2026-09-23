// =============================================================================
// GLOBAL ARAMA — tek kutu, çok varlık (2026-08-19)
// =============================================================================
// Ctrl+K bugüne kadar yalnız SAYFA arıyordu; veri aramak için operatörün doğru
// ekranı bilmesi ve oraya gidip o ekranın kutusunu kullanması gerekiyordu.
// Bu servis, aynı terimi izin verilen tüm varlıklarda birden arar.
//
// ── NEDEN TEK UÇ (11 paralel istemci isteği DEĞİL) ─────────────────────────
// Mevcut liste uçları palet için fazla ağır döner (`/api/items` izinli renk +
// özellik ağacını, `/api/orders` müşteri + kalemler + iş emri bağlarını taşır);
// izinsiz kovalar 403 döner ve istemci interceptor'ı toast basar; 11 ayrı
// isteğin iptali debounce'la yarışır. Tek uç üçünü birden çözer.
//
// ── NEDEN `Promise.all` (UNION ALL ham SQL DEĞİL) ──────────────────────────
// Arama semantiği tek yerde: `buildTextSearch` (kelime-AND, kod/metin kovası,
// `Fold` gölge eşlemesi). UNION ALL yazmak o motorun İKİNCİ bir uygulamasını
// kurar ve `test_search_field_config`'in kapattığı iki hata sınıfını geri açar.
//
// ⚠️ CLAUDE.md'nin `Promise.all` YASAĞI `tx.*` İÇİNDİR — pg adapter tek
// bağlantıyı seri koşturduğu için transaction içinde paralellik illüzyondur.
// Burada `prisma.*` delegate'leri kullanılıyor, havuz gerçekten paralelize eder.
// Bu ayrımı silme: seri hâle çevrilirse gecikme kova sayısı kadar katlanır.
// =============================================================================
import prisma from "../lib/prisma";
import { Prisma } from "@prisma/client";
import { matchesPermission } from "../middlewares/rbac.middleware";
import { buildTextSearch } from "../utils/query-parser";
import { foldCodeForCompare, normalizeScanCode } from "../utils/code-format";
import { foldSearchTokens } from "../utils/search-fold";
import { SEARCH_ENTITIES, type SearchEntity, type SearchEntityKey } from "../constants/search-entities";
import { classifyScannedCode } from "./helpers/series-classifier.helper";

/** Palet satırı — `ScanResolution` ile BİLEREK aynı şekil (tek satır bileşeni). */
export interface SearchRow {
  id: string;
  title: string;
  subtitle: string | null;
  code: string | null;
}

export interface SearchGroup {
  entity: SearchEntityKey;
  label: string;
  rows: SearchRow[];
  /** `take: limit + 1` ile ölçülür — toplam sayım YOK (bkz. aşağı). */
  hasMore: boolean;
}

export interface SearchResult {
  term: string;
  /** Tam-format barkod okundu: tek deterministik sonuç, fan-out koşmadı. */
  exact: { entity: string; row: SearchRow } | null;
  groups: SearchGroup[];
}

/** Kova başına gösterilecek satır. Palet listesi 10 grup × 5 = 50 satır. */
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
/** Trigram 3-gram üzerinden çalışır; 1 harflik terim seq scan'e döner. */
export const MIN_TERM_LENGTH = 2;
/** Yapıştırılan uzun metin kova başına yol×kelime kadar tarama demek. */
const MAX_TOKENS = 4;

// ── Tam-format barkodlar — artık ELLE YAZILMIYOR (2026-09-22, Faz B) ────────
// Eskiden burada panelin `barcode-kind.ts` dosyasının elle yazılmış bir İKİZİ
// vardı; ön ek değişince iki tarafın da güncellenmesi gerekiyordu ve biri
// unutulursa okutma SESSİZCE yanlış dala düşüyordu. Tür artık tek kaynaktan
// (`number-series.service.classifyScannedCode`) çözülür.

function visible(entity: SearchEntity, permissions: readonly string[]): boolean {
  return entity.permissions.some((code) => matchesPermission(permissions, code));
}

/** Terim kod biçiminde mi (boşluksuz + ASCII harf/rakam/ayraç)? */
function isCodeLike(term: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(term);
}

type RowMapper = (r: Record<string, unknown>) => SearchRow;
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const nested = (v: unknown, key: string): string | null =>
  v && typeof v === "object" ? str((v as Record<string, unknown>)[key]) : null;

/**
 * Kova → palet satırı. Servis katmanında tutuluyor çünkü bu bir SUNUM kararı;
 * katalog "nerede aranır"ı, burası "nasıl görünür"ü söyler.
 */
function linkedCustomerSubtitle(customer: unknown): string | null {
  const name = nested(customer, "name");
  if (!name) return null;
  const code = nested(customer, "code");
  return `Cari: ${name}${code ? ` (${code})` : ""}`;
}

const ROW_MAPPERS: Record<SearchEntityKey, RowMapper> = {
  customer: (r) => ({ id: String(r.id), title: String(r.name), subtitle: null, code: str(r.code) }),
  item: (r) => ({ id: String(r.id), title: String(r.name), subtitle: null, code: str(r.code) }),
  color: (r) => ({ id: String(r.id), title: String(r.name), subtitle: null, code: str(r.code) }),
  order: (r) => ({
    id: String(r.id),
    title: String(r.orderNumber),
    subtitle: nested(r.customer, "name"),
    code: str(r.orderNumber),
  }),
  workOrder: (r) => ({
    id: String(r.id),
    title: String(r.workOrderNumber),
    subtitle: nested(r.targetItem, "name"),
    code: str(r.workOrderNumber),
  }),
  shipment: (r) => ({
    id: String(r.id),
    title: String(r.shipmentNo),
    subtitle: nested(r.customer, "name"),
    code: str(r.shipmentNo),
  }),
  sack: (r) => ({
    id: String(r.id),
    title: String(r.sackNo),
    subtitle: nested(r.customer, "name"),
    code: str(r.sackNo),
  }),
  subcontractor: (r) => ({
    id: String(r.id),
    title: String(r.name),
    // Bağlı cari varsa "Cari: AD (KOD)" — bağsız fasonda alt satır yok (bugünkü görünüm).
    subtitle: linkedCustomerSubtitle(r.customer),
    code: str(r.code),
  }),
  batch: (r) => ({
    id: String(r.id),
    title: String(r.batchNumber),
    subtitle: nested(r.workOrder, "workOrderNumber"),
    code: str(r.batchNumber),
  }),
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const delegateOf = (modelName: string): any => (prisma as any)[modelName];
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * TAM-FORMAT BARKOD HIZLI YOLU — okutma, arama değil.
 *
 * Terim bir barkod biçimine BİREBİR uyuyorsa tek `findFirst` koşar ve fan-out
 * hiç çalışmaz (`rolls.barcode` unique index seek ~0.3ms). Bulunamazsa fan-out
 * normal koşar: yanlış basılmış/eski bir kodda kullanıcı yine bir şey görsün.
 *
 * ⚠️ KISMİ kodda (ör. "T1207") hızlı yol YOK — o bir okutma değil, arama.
 */
async function resolveExact(term: string): Promise<{ entity: string; row: SearchRow } | null> {
  const code = normalizeScanCode(term);
  // Tür SUNUCUNUN tek sınıflandırıcısından; tanınmayan kod hızlı yola girmez.
  // ⚠️ Dal kümesi BİLEREK dört: sınıflandırıcı SHIPMENT ve DISPATCH_DOC'u da
  // tanır ama onların hızlı yolu bugün YOK — tanınıp dalı olmayan kod fan-out'a
  // düşer, yani bugünkü davranış bayt bayt korunur.
  const kind = classifyScannedCode(code)?.kind ?? null;
  if (kind === null) return null;
  if (kind === "ROLL") {
    const roll = await prisma.roll.findFirst({
      where: { barcode: code },
      select: { id: true, barcode: true, status: true, item: { select: { name: true } } },
    });
    if (roll) {
      return {
        entity: "roll",
        row: {
          id: roll.id,
          title: roll.barcode ?? code,
          subtitle: roll.item?.name ?? null,
          code: roll.barcode,
        },
      };
    }
  }
  if (kind === "SACK") {
    const sack = await prisma.sack.findFirst({
      where: { sackNo: code },
      select: { id: true, sackNo: true, customer: { select: { name: true } } },
    });
    if (sack) {
      return {
        entity: "sack",
        row: { id: sack.id, title: sack.sackNo, subtitle: sack.customer?.name ?? null, code: sack.sackNo },
      };
    }
  }
  if (kind === "SWATCH") {
    const sw = await prisma.swatch.findFirst({
      where: { OR: [{ cardNumber: code }, { barcode: code }] },
      select: { id: true, cardNumber: true, item: { select: { name: true } } },
    });
    if (sw) {
      return {
        entity: "swatch",
        row: { id: sw.id, title: sw.cardNumber ?? code, subtitle: sw.item?.name ?? null, code: sw.cardNumber },
      };
    }
  }
  if (kind === "TRAVELER_CARD") {
    // Kart kodu = iş emri no; sonuç iş emrine götürür (scan-resolvers ile aynı).
    const wo = await prisma.workOrder.findFirst({
      where: { workOrderNumber: code },
      select: { id: true, workOrderNumber: true, targetItem: { select: { name: true } } },
    });
    if (wo) {
      return {
        entity: "workOrder",
        row: {
          id: wo.id,
          title: wo.workOrderNumber,
          subtitle: wo.targetItem?.name ?? null,
          code: wo.workOrderNumber,
        },
      };
    }
  }
  return null;
}

export class SearchService {
  /**
   * @param permissions ZORUNLU — F221'in "verilmezse atla" varyantı burada
   * KULLANILMAZ: aramada izin opsiyonel olamaz, kovalar onunla eleniyor.
   */
  async search(
    rawTerm: string,
    opts: { permissions: readonly string[]; limit?: number },
  ): Promise<SearchResult> {
    const term = rawTerm.trim();
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const empty: SearchResult = { term, exact: null, groups: [] };
    if (foldSearchTokens(term).length === 0 || term.length < MIN_TERM_LENGTH) return empty;

    const exact = await resolveExact(term);
    if (exact) return { term, exact, groups: [] };

    const codeLike = isCodeLike(term);
    const buckets = SEARCH_ENTITIES.filter(
      (e) => visible(e, opts.permissions) && (!e.codeOnly || codeLike),
    );

    const results = await Promise.all(
      buckets.map(async (e): Promise<SearchGroup | null> => {
        const leaves = buildTextSearch<Record<string, unknown>>(term, {
          text: e.searchFields,
          code: e.codeSearchFields,
        });
        // Boş yaprakta kovayı ATLA. ⚠️ Bu bir DOĞRULUK guard'ı DEĞİL, sorgu
        // önlemedir: ölçüldü (2026-08-19) — Prisma `OR: []` ile HİÇBİR kaydı
        // eşlemiyor (34 müşterinin 0'ı), yani guard olmasa da sonuç boş dönerdi.
        // Kazanç, kova sayısı kadar boşuna sorgu atmamak.
        //
        // ⚠️ ASIL koruma `buildTextSearch`in boş dizi döndürmesidir: bir gün
        // "eşleşme yoksa hepsini getir" gibi bir yaprak üretirse HER kova tüm
        // tablosunu döndürür. Bekçi o sözleşmeyi ayrıca ölçüyor.
        if (leaves.length === 0) return null;
        const where: Record<string, unknown> = { OR: leaves };
        if (e.activeOnly) where.isActive = true;
        const rows = (await delegateOf(e.modelName).findMany({
          where,
          select: e.select,
          orderBy: e.orderBy,
          take: limit + 1,
        })) as Record<string, unknown>[];
        if (rows.length === 0) return null;
        const map = ROW_MAPPERS[e.key];
        return {
          entity: e.key,
          label: e.label,
          rows: rows.slice(0, limit).map(map),
          hasMore: rows.length > limit,
        };
      }),
    );

    return { term, exact: null, groups: results.filter((g): g is SearchGroup => g !== null) };
  }
}

export const searchService = new SearchService();

// Kod aramasında kullanılan normalizasyonu dışa ver — bekçi ikisini karşılaştırır.
export { foldCodeForCompare };
export type { Prisma };
