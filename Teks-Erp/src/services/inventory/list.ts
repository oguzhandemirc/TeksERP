// =============================================================================
// Inventory Service / list
// =============================================================================
// Top listesi: liste where'i (buildRollWhere), findAllRolls, özet istatistikler (tekil + toplu) ve depo kapsamı.
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import { ACTIVE_ROLL_PROPERTY } from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { customerCodeSearchRollIds } from "../helpers/roll-scan-resolve.helper";
import { attachCustomerBatchNo } from "../helpers/roll-delivery-note-line.helper";
import { normalizeScanCode } from "../../utils/code-format";
import { normalizeFoldType } from "../helpers/fold-type";
import { AppError } from "../../utils/app-error";
import { ApiResponse, PaginatedResponse, QueryParams } from "../../types/api.types";
import {
  readEmanetEnabled,
} from "../system-setting.service";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
  isCursorRequested,
  applyDateRange,
  resolveSortBy,
  buildTextSearch,
  readFilterList,
  readIdCondition,
} from "../../utils/query-parser";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../../utils/cursor";
import type { CursorPaginatedResponse } from "../base.service";
import { Request } from "express";
import {
  Prisma,
  Roll,
  RollStatus,
  RollEntrySource,
  StationKind,
  ShipmentStatus,
} from "@prisma/client";
import { READY_STATUSES } from "../roll-owner.service";
import { loadProducedBuckets } from "../helpers/roll-finalize.helper";
import { outstandingItemOfOpenDispatch } from "../helpers/fason-open-dispatch.helper";
import { CONSIGNED_WHERE, ownershipScopeWhere, readOwnershipScope } from "../helpers/stock-ownership.helper";
import { ROLL_LIST_INCLUDE, type InventoryServiceThis } from "./shared";

const ROLL_DATE_FIELDS = ["createdAt"] as const;

// Rolls listesinde sıralanabilir kolonlar (UI SortableHeader'larıyla eşleşir) +
// createdAt/id kararlı tie-break. Whitelist dışı sortBy → createdAt'e düşer
// (bilinmeyen kolon 500'ünü ve indekssiz keyfi sortu engeller).
// Filtre değerlerinde UUID doğrulaması — ham string doğrudan Prisma where'ine
// düşerse "Inconsistent column data" ile 500 olur (istemci hatası 500 olmamalı).
const ROLL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ROLL_SORTABLE_FIELDS = [
  "createdAt",
  "updatedAt",
  "barcode",
  "currentQty",
  "initialQty",
  "width",
  "qualityGrade",
  "status",
  // 2026-08-04: kolon "Kat" başlığıyla SortableHeader olarak basılıyor. Bu
  // listede olmasaydı tıklama SESSİZCE iki şey yapardı: sıralama olmaz VE
  // query-parser bilinmeyen alanı fallback'e ("createdAt") düşürdüğü için
  // sekmenin updatedAt-desc varsayılanı da kaybolurdu ("Buraya geliş ≠
  // oluşturma" kuralının ihlali) — hata yok, log yok.
  "foldType",
] as const;

// CSV/dizi filtre okuma TEK KAYNAK `utils/query-parser` (readFilterList /
// readIdCondition) — aynı sözleşmeyi order, kartela ve production-balance de
// kullanıyor. Yerel kopya, çoklu-seçimin bir serviste sessizce çalışmamasına
// yol açardı (sessiz 0-satır tuzağı; gerekçe yardımcının başında).
const readList = readFilterList;

function readNumberRange(
  min: string | string[] | undefined,
  max: string | string[] | undefined
): { gte?: number; lte?: number } | null {
  const range: { gte?: number; lte?: number } = {};
  const lo = typeof min === "string" ? parseFloat(min) : NaN;
  const hi = typeof max === "string" ? parseFloat(max) : NaN;
  if (Number.isFinite(lo)) range.gte = lo;
  if (Number.isFinite(hi)) range.lte = hi;
  return Object.keys(range).length > 0 ? range : null;
}

export interface RollStats {
  totalCount: number;
  /** Filtreye uyan tüm rolların `currentQty` toplamı — metre. */
  totalQty: number;
  /** Filtreye uyan tüm rolların `weightKg` toplamı — kg (null'lar atlanır). */
  totalWeight: number;
  /** RollStatus → adet. Filtreye uyan status'ler için 0+ döner; eşleşmeyen status hiç yer almaz. */
  byStatus: Record<string, number>;
  /** qualityGrade kodu → adet (A1, FIRE, 1.KALITE, …). */
  byQuality: Record<string, number>;
  /** Emanet kırılımı (F1) — toplamın müşteri malı kısmı; yalnız `emanet.enabled` açıkken döner (kapalıyken yanıt bayt-aynı). */
  consigned?: { count: number; qty: number; weight: number };
}

export function buildRollWhere(
    params: QueryParams,
    fireCodes: readonly string[],
    // Aramanın müşteri koduyla eşleştiği toplar (D4-F1b; `customerCodeSearchRollIds`, async → dışarıda çözülür).
    customerCodeRollIds: readonly string[] = [],
  ): Record<string, unknown> {
    const f = params.filters;

    // Base where: buildWhereClause sadece düz Roll alanları için. Nested ilişki
    // filtreleri (item.isDerived, item.colorId, item.properties...) ve range
    // alanları (width, currentQty) aşağıda explicit compose ediliyor — generic
    // helper'a relation bilgisi sızdırmamak için.
    // Search'i `buildWhereClause`'a vermiyoruz; ruloyu sadece barkoda göre değil,
    // bağlı kumaş adı/kodu üzerinden de aramak için OR'u explicit kuruyoruz.
    const where = buildWhereClause(f, ["barcode"]);
    applyDateRange(where, params, ROLL_DATE_FIELDS);

    const search = params.search?.trim();
    if (search) {
      // Barkod: TAM eşleşme (unique index seek). `contains`/`startsWith` ILIKE
      // en_US.UTF-8 collation'da barcode unique indeksini KULLANAMAZ — 300k satırda
      // ölçüldü: contains ~21-87ms (seq scan), equals ~0.3ms (index scan). Barkod
      // okutulur/yapıştırılır (tam değer); ortasından substring araması gerçek bir
      // saha akışı değil. Ürün adı/kodu küçük master tabloda kaldığı için contains
      // olarak kalır → "patos" gibi fuzzy ürün araması bozulmadan çalışır.
      where.OR = [
        // ⚠️ `normalizeScanCode` ZORUNLU (2026-08-19 denetimi): el tarayıcısı
        // barkodu KÜÇÜK harfle gönderebiliyor (2026-08-17 saha vakası) ve burada
        // TAM EŞİTLİK arandığı için küçük harfli girdi sessizce 0 sonuç veriyordu.
        // Diğer bütün tam-barkod yolları (rolls/barcode ucu, tambur, çuval arama,
        // batch-trace) bu kapıdan geçiyordu; liste araması tek istisnaydı.
        { barcode: normalizeScanCode(search) },
        ...(customerCodeRollIds.length > 0 ? [{ id: { in: [...customerCodeRollIds] } }] : []),
        ...buildTextSearch<Prisma.RollWhereInput>(search, {
          // Müşteri alias'ı: operatör müşterinin kullandığı adı duyar ("BELLE"),
          // bizim adı ("18152") bilmek zorunda kalmasın.
          text: ["item.name", "color.name", "item.customerAliases.some.alias"],
          code: ["item.code"],
        }),
      ];
    }

    // Fason sevk picker'ı: belirli bir adıma SEVK EDİLEBİLİR toplar.
    // Filtre, subcontractor.service dispatch() kabul kuralının BİREBİR aynısı:
    //   serbest stok (currentStepId null & STOCK)              → auto-attach edilir
    //   bu adımdaki top (currentStepId === stepId & STOCK|IN_PRODUCTION)
    // Aşağıda OR olarak kurulur; varsayılan STOCK status'u devre dışı kalır
    // (OR kendi status'unu yönetir). FIRE hariç tutma kuralı korunur.
    const dispatchableForStepId =
      typeof f["dispatchableForStepId"] === "string" && f["dispatchableForStepId"]
        ? (f["dispatchableForStepId"] as string)
        : null;

    // --- Status: statusIn[] > status > default STOCK ---
    const statusIn = readList(f["statusIn"]);
    delete where.statusIn;
    if (statusIn.length > 0) {
      where.status = { in: statusIn as RollStatus[] };
    } else if (f["status"] === "ALL" || dispatchableForStepId) {
      delete where.status;
    } else if (!f["status"]) {
      where.status = RollStatus.STOCK;
    }

    // --- Roll-level renk + processingStatus filtreleri ---
    // ÇOKLU SEÇİM: `filter[colorId]=a,b` → `{ in: [a,b] }` (VEYA). Tekil değerde
    // şekil değişmez. `readIdCondition` olmadan CSV ham geçer; colorId uuid
    // kolonu olduğu için sonuç 0 satır DEĞİL, `invalid input syntax for type
    // uuid` → Prisma P2007 → **HTTP 400** *"Geçersiz veri formatı (örn. hatalı
    // ID)"* olur (arıza modları: query-parser'daki not).
    const colorIdFilter = readIdCondition(f["colorId"]);
    delete where.colorId;
    if (colorIdFilter) {
      where.colorId = colorIdFilter;
    }

    // DEPO filtresi — çoklu seçim (CSV → `in`). `readIdCondition` olmadan CSV ham
    // geçer ve uuid kolonunda P2007 → HTTP 400 üretir (colorId ile aynı arıza modu).
    const warehouseIdFilter = readIdCondition(f["warehouseId"]);
    delete where.warehouseId;
    if (warehouseIdFilter) {
      where.warehouseId = warehouseIdFilter;
    }

    // SAHİP (emanet, ister 3.2) — çoklu seçim. Modülden BAĞIMSIZ uygulanır (depo süzgeci emsali):
    // kapalı modülde süzgeç yok sayılmaz, veri neyse onu süzer; panel çipi modül kapalıyken çizmez.
    const ownerCustomerIdFilter = readIdCondition(f["ownerCustomerId"]);
    delete where.ownerCustomerId;
    if (ownerCustomerIdFilter) {
      where.ownerCustomerId = ownerCustomerIdFilter;
    }
    // MÜLKİYET (F1) — `filter[mulkiyet]=ALL|OWN|CONSIGNED`; ALL/boş = bugünkü şekil, tanınmayan 400.
    // AND'e eklenir: sahip süzgeciyle kesişir, onu ezmez. Modülden bağımsız (sahip süzgeci emsali).
    const ownershipWhere = ownershipScopeWhere(readOwnershipScope(f["mulkiyet"]));
    delete where.mulkiyet;
    if (ownershipWhere) {
      where.AND = [...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []), ownershipWhere];
    }

    const processingStatus = f["processingStatus"] as string | undefined;
    delete where.processingStatus;
    // M-29: istemci explicit status verdiyse processingStatus/rollScope onu
    // EZMEZ — AND ile kesişir (eski son-yazan-kazanır davranışı çelişen
    // kombinasyonda sessiz yanlış sonuç veriyordu). Explicit yoksa default
    // STOCK yerine dalın kendi kümesi geçer (eski davranış).
    const hasExplicitStatus = statusIn.length > 0 || Boolean(f["status"]);
    const applyStatusScope = (scope: unknown) => {
      if (hasExplicitStatus) {
        where.AND = [
          ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
          { status: scope },
        ];
      } else {
        where.status = scope;
      }
    };
    // F116 (M-29 türevi): explicit colorId, processingStatus'un renk koşulunu EZMEZ —
    // where.AND ile KESİŞİR. Aksi halde 'İşlenmiş' sekmesi + belirli renk birlikte
    // gelince renk sessizce düşer, TÜM renkteki işlenmiş toplar (ve aynı where'i
    // paylaşan /rolls/stats toplamları) yanlış filtreyle döner. raw+colorId çelişkisi
    // doğal boş küme döner.
    const hasExplicitColor = Boolean(colorIdFilter);
    const applyColorScope = (scope: unknown) => {
      if (hasExplicitColor) {
        where.AND = [
          ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
          { colorId: scope },
        ];
      } else {
        where.colorId = scope;
      }
    };
    if (processingStatus === "raw") {
      applyColorScope(null);
    } else if (processingStatus === "processed") {
      applyColorScope({ not: null });
      // İzinli statüler EXPLICIT (in) — eski notIn listesi CANCELLED/SHIPPED/
      // A1_STOCK/AT_KARTELA/KARTELA_CONSUMED/RETURNED'ı "işlenmekte" listesine
      // ve aynı where'i paylaşan /rolls/stats toplamlarına sızdırıyordu
      // (sözleşme: renk kazanmış + henüz Tambur'a ulaşmamış AKTİF toplar).
      applyStatusScope({
        in: [
          RollStatus.STOCK,
          RollStatus.IN_PRODUCTION,
          RollStatus.AT_SUBCONTRACTOR,
          RollStatus.RETURNED_FROM_SUBCONTRACTOR,
        ],
      });
    } else if (processingStatus === "open_fabric") {
      where.barcode = null;
      applyStatusScope(RollStatus.IN_PRODUCTION);
    } else if (processingStatus === "finished") {
      applyStatusScope(RollStatus.WAREHOUSE);
    }

    // ── KAT (foldType) FİLTRESİ — KANONİKLEŞTİRİLEREK kurulur ────────────────
    //
    // ⚠️ SESSİZ HATA TUZAĞI: `buildWhereClause` (query-parser.ts:123-133) tanımadığı
    // HER filtre anahtarını ham string olarak `where`'e kopyalar. Kat kolonunda
    // DB'de kanonik değer var ("4-KAT"); istemci "4 kat" / "4kat" gönderirse
    // Prisma eşitlik araması 0 satır döner — HATA YOK, LOG YOK, liste boş.
    // Operatör "bu kumaştan hiç yok" sanır. Bu yüzden anahtar burada AÇIKÇA
    // ele alınır (colorId/qualityGrade emsali) ve `normalizeFoldType`'tan geçer.
    const foldTypeRaw = readList(f["foldType"]);
    delete where.foldType;
    if (foldTypeRaw.length > 0) {
      const canonical = foldTypeRaw
        .map((v) => normalizeFoldType(v))
        .filter((v): v is string => v !== null);
      // Tümü boş/whitespace ise filtre HİÇ uygulanmaz (yanlışlıkla her şeyi
      // eleyen boş `in: []` üretmeyelim).
      if (canonical.length > 0) {
        where.foldType = canonical.length === 1 ? canonical[0] : { in: canonical };
      }
    }

    const qualityGradeFilter =
      typeof f["qualityGrade"] === "string" ? (f["qualityGrade"] as string) : null;
    delete where.qualityGrade;
    const includeFireRaw = f["includeFire"];
    const includeFire = includeFireRaw === "true";
    delete where.includeFire;
    if (qualityGradeFilter) {
      where.qualityGrade = qualityGradeFilter;
    } else if (!includeFire && fireCodes.length > 0) {
      // Postgres `<>` NULL-hostile: düz `{ notIn }` kalitesi NULL (kaliteye
      // bakılmadı) topları da dışlardı. Kalite artık nullable → null FIRE değildir,
      // Envanter listesinde/istatistiğinde kalmalı. where.AND'e OR olarak ekle
      // (status/renk scope'ları where.AND'i zaten kullanıyor olabilir).
      //
      // FİRE KÜMESİ KATALOGDAN (`targetStatus = SCRAP`), kod GÖMÜLÜ DEĞİL —
      // kataloğu `1K/2K/HURDA` olan fabrikada gömülü `"FIRE"` hiçbir şey
      // dışlamaz ve fire satılabilir stok sayılırdı (karar ①).
      // ⚠️ BOŞ KÜMEDE YAN TÜMCE HİÇ EKLENMEZ (yukarıdaki `length > 0`):
      // `notIn: []` ESLint'te YASAK, ve SCRAP kademesi olmayan katalogda eski
      // `not: "FIRE"` de zaten hiçbir şeyi dışlamıyordu → davranış birebir aynı.
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { OR: [{ qualityGrade: null }, { qualityGrade: { notIn: [...fireCodes] } }] },
      ];
    }

    const rollKind = f["rollKind"] as string | undefined;
    delete where.rollKind;
    if (rollKind === "OPEN_FABRIC") {
      where.barcode = null;
    } else if (rollKind === "WOUND_ROLL") {
      where.barcode = { not: null };
    }

    const currentStepKindRaw = f["currentStepKind"] as string | undefined;
    delete where.currentStepKind;
    if (
      currentStepKindRaw &&
      Object.values(StationKind).includes(currentStepKindRaw as StationKind)
    ) {
      where.currentStep = {
        is: { station: { kind: currentStepKindRaw as StationKind } },
      };
    }

    // İSTASYON KİMLİĞİ filtresi (2026-08-04) — TÜR filtresinden AYRI bir sorudur.
    //
    // currentStepKind "hangi TÜR istasyon" der (PROCESS_QC, TAMBUR…) ve iki ayrı
    // boyahaneyi tek seçenekte birleştirir. Operatörün sorduğu soru ise "ŞU
    // makinede ne var" — yani kimlik. İkisi birlikte de gelebilir.
    //
    // ⚠️ buildWhereClause tanımadığı filtre anahtarını HAM geçirir: bu blok
    // olmasaydı filter[currentStationId]=<uuid> doğrudan where içine düşer ve
    // Prisma "Unknown argument" ile 500 verirdi (foldType'taki "sessiz 0 satır"
    // tuzağının gürültülü kardeşi). Anahtar her hâlükârda silinir.
    //
    // ÇOKLU SEÇİM: UUID süzgeci LİSTENİN HER ELEMANINA ayrı uygulanır. Tek
    // string'e uygulanan eski `ROLL_UUID_RE.test(csv)` çoklu seçimde fail eder
    // ve filtre **sessizce DÜŞERDİ**. Bu, uuid kolonlarındaki 500'den DAHA
    // kötüdür: regex Prisma'dan önce devreye girdiği için hata bile doğmaz;
    // operatör iki makine seçer, TÜM istasyonların topları döner, hiçbir uyarı
    // çıkmaz (bekçi ölçümü: 2 beklenirken 6 satır).
    const currentStationIds = readList(f["currentStationId"]).filter((v) =>
      ROLL_UUID_RE.test(v)
    );
    delete where.currentStationId;
    if (currentStationIds.length > 0) {
      const prev = (where.currentStep as { is?: Record<string, unknown> } | undefined)?.is;
      where.currentStep = {
        is: {
          ...(prev ?? {}),
          // Tür filtresi de varsa istasyon koşulları BİRLEŞTİRİLİR — üstüne
          // yazmak iki filtreden birini sessizce yok saymak olurdu.
          station: {
            ...((prev?.station as Record<string, unknown> | undefined) ?? {}),
            id:
              currentStationIds.length === 1
                ? (currentStationIds[0] as string)
                : { in: currentStationIds },
          },
        },
      };
    }

    const rollScope = f["rollScope"] as string | undefined;
    delete where.rollScope;
    if (rollScope === "RAW_STOCK") {
      // ⚠️ BU KAPSAM YARI MAMULÜ **İÇERİR** — daraltma.
      //
      // "Üretime girmemiş, serbest STOCK topu" demektir; ham kumaş da dışarıdan
      // alınan yarı mamul de buraya girer. Mobil Hızlı İş Emri'nin top seçicisi
      // (`NewWorkOrderView` "Ham Stok" sekmesi) bunu kullanıyor ve tablette
      // üçüncü bir sekme YOK → buradan yarı mamulü düşürmek, o topların üretime
      // alınmasının sahadaki TEK yolunu kapatır.
      //
      // Envanterin ayrı sekmeleri (2026-08-26) aşağıdaki iki DAR kapsamı kullanır;
      // bu kapsam ikisinin BİRLEŞİMİdir ve öyle kalmalı.
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { currentStepId: null },
        { status: RollStatus.STOCK },
      ];
    } else if (rollScope === "RAW_STOCK_PURE") {
      // Envanter → "Ham Stok" sekmesi: yalnız gerçekten HAM olan mal.
      // Negasyon istemciden söylenemez (`buildWhereClause` yalnız eşitlik/CSV-in
      // üretir), o yüzden ayrı bir kapsam olarak burada yaşar.
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { currentStepId: null },
        { status: RollStatus.STOCK },
        { entrySource: { not: RollEntrySource.SEMI_FINISHED } },
      ];
    } else if (rollScope === "SEMI_FINISHED") {
      // Envanter → "Yarı Mamul" sekmesi: dışarıdan alınan boyalı/işlenmiş kumaş.
      // Ayrı DEPO değil ayrı GÖRÜNÜM (fabrikada fiziksel karşılığı yok) — statü
      // ve stok mekaniği ham stokla aynı.
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { currentStepId: null },
        { status: RollStatus.STOCK },
        { entrySource: RollEntrySource.SEMI_FINISHED },
      ];
    } else if (rollScope === "PRODUCTION_ACTIVE") {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { currentStepId: { not: null } },
        {
          status: {
            notIn: [
              RollStatus.WAREHOUSE,
              RollStatus.A1_STOCK,
              RollStatus.SCRAP,
              RollStatus.CANCELLED,
              RollStatus.TAMBUR_CONSUMED,
              RollStatus.SUBCONTRACTOR_CONSUMED,
              RollStatus.RETURNED_FROM_SUBCONTRACTOR,
            ],
          },
        },
      ];
    } else if (rollScope === "FINISHED_STOCK") {
      applyStatusScope({
        in: [...READY_STATUSES],
      });
    } else if (rollScope === "IN_SACK") {
      // "Çuvalda" sekmesi: fiziksel olarak bir çuvalda (sackId dolu) ve henüz
      // depoyu terk etmemiş (SHIPPED/CANCELLED/SCRAP değil) toplar. Sevkiyata
      // atanmış (PLANNED) ama henüz sevk edilmemiş çuvallar da hâlâ çuvaldadır.
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { sackId: { not: null } },
        {
          status: {
            notIn: [RollStatus.SHIPPED, RollStatus.CANCELLED, RollStatus.SCRAP],
          },
        },
      ];
    } else if (rollScope) {
      // TANINMAYAN KAPSAM — sessiz kalmak en kötü seçenek.
      //
      // Yukarıdaki `delete where.rollScope` koşulsuz çalıştığı için eşleşmeyen bir
      // değer hiçbir daralma YAPMAZ; istemci `status: "ALL"` de gönderdiğinden
      // varsayılan STOCK süzgeci de kalkar ve liste CANCELLED/SHIPPED/SCRAP dahil
      // TÜM tabloyu döndürür — hata yok, log yok. `rollScope` hiçbir kullanıcı
      // girdisinden gelmiyor (istemcilerde sabit değerler), o yüzden burada
      // patlamak güvenli: yeni bir sekme eklenip kapsam dalı yazılmayı unutulursa
      // geliştirme anında görünür olur.
      throw AppError.badRequest(`Bilinmeyen liste kapsamı: ${rollScope}`);
    }

    // --- Fason sevk uygunluğu (belirli adım) ---
    // buildWhereClause düz alan olarak yakaladıysa temizle, sonra OR ile compose et.
    delete where.dispatchableForStepId;
    if (dispatchableForStepId) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        {
          OR: [
            // (a) serbest stok → auto-attach edilir
            { currentStepId: null, status: RollStatus.STOCK },
            // (b) bu adımdaki top → STOCK *veya* IN_PRODUCTION (dispatch() kabul
            //     kuralının birebir aynısı: subcontractor.service guard). Eski kod
            //     yalnız STOCK kabul ediyordu → bu adımda fiilen üretimdeki
            //     (IN_PRODUCTION) toplar picker'da HATALI gizleniyordu.
            {
              currentStepId: dispatchableForStepId,
              status: { in: [RollStatus.STOCK, RollStatus.IN_PRODUCTION] },
            },
          ],
        },
      ];
    }

    // --- Sevkiyat kapsamı: serbest depo vs çuvallanmış (committed) ---
    // 'free'      = GERÇEK serbest depo: sackId null VE shipmentId null — yalnız
    //               satılabilir/okutulabilir stok. Bir çuvala konmuş ama henüz
    //               sevkiyata atanmamış top (sackId dolu, shipmentId null) serbest
    //               DEĞİLDİR (çuval havuzu modeli: fiziksel olarak çuvalda).
    // 'committed' = çuvallanmış VEYA sevkiyatta (sackId dolu ya da shipmentId dolu).
    // yok/'all'   = ayrım yapma. Depo ekranı 'free' geçer → çuvaldaki top "serbest
    //               depoda" görünmez.
    const shipmentScope = f["shipmentScope"] as string | undefined;
    delete where.shipmentScope;
    if (shipmentScope === "free") {
      where.shipmentId = null;
      where.sackId = null;
    } else if (shipmentScope === "committed") {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { OR: [{ sackId: { not: null } }, { shipmentId: { not: null } }] },
      ];
    }

    // ÇOKLU SEÇİM: `filter[itemId]=a,b` → `{ in: [a,b] }` (VEYA).
    const itemId = readIdCondition(f["itemId"]);
    delete where.itemId;
    if (itemId) {
      where.itemId = itemId;
    }

    const propertyIds = readList(f["propertyIds"]);
    delete where.propertyIds;
    if (propertyIds.length > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        ...propertyIds.map(
          (pid) => ({ properties: { some: { ...ACTIVE_ROLL_PROPERTY, propertyId: pid } } }) satisfies Prisma.RollWhereInput,
        ),
      ];
    }

    delete where.widthMin;
    delete where.widthMax;
    const widthRange = readNumberRange(f["widthMin"], f["widthMax"]);
    if (widthRange) where.width = widthRange;

    delete where.qtyMin;
    delete where.qtyMax;
    const qtyRange = readNumberRange(f["qtyMin"], f["qtyMax"]);
    if (qtyRange) where.currentQty = qtyRange;

    const markedForKartelaRaw = f["markedForKartela"];
    delete where.markedForKartela;
    if (markedForKartelaRaw === "true") {
      where.markedForKartela = true;
    }

    // --- Fasonda görünürlüğü: firma + işlem (kategori) filtresi ---
    // "Açık sevk kalemi" tanımı F85 (getOpenDispatches) ile birebir: iptalsiz +
    // doğrudan-sevksiz dispatch'in aktif (iptalsiz) receipt-item'ı OLMAYAN
    // kalemi. subcontractor-summary ucu ve ROLL_LIST_INCLUDE.dispatchItems ile
    // AYNI küme → şerit/kolon/liste sayıları sapmaz. AND'e eklenir (status/
    // renk scope'larıyla kesişir); sekme tabanı (status=AT_SUBCONTRACTOR)
    // frontend forceFilters'tan ayrıca gelir. delete where.X ŞART: buildWhereClause
    // her filter anahtarını düz kolon olarak kopyalar, Roll'da bu kolonlar yok.
    // ÇOKLU SEÇİM: iki filtre de `{ in: [...] }`'e açıldı. Firma ile kategori
    // ARALARINDA hâlâ AND'dir (aynı açık sevk kalemi hem seçili firmalardan
    // birine hem seçili kategorilerden birine ait olmalı) — kendi içlerinde OR.
    const subcontractorId = readIdCondition(f["subcontractorId"]);
    delete where.subcontractorId;
    const subcontractorCategoryId = readIdCondition(f["subcontractorCategoryId"]);
    delete where.subcontractorCategoryId;
    if (subcontractorId || subcontractorCategoryId) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        {
          dispatchItems: {
            // Açık+outstanding tanımı TEK KAYNAKTAN; buradaki `extra` yalnız
            // firma/kategori daraltmasıdır.
            some: outstandingItemOfOpenDispatch({
              ...(subcontractorId ? { subcontractorId } : {}),
              // Kategori: adımın requiredCategory'si eşleşir VEYA adım boşsa
              // firmanın kategorisi eşleşir (özet COALESCE tanımıyla hizalı —
              // firma tek kategoriliyse birebir, çok kategoride hafif geniş).
              ...(subcontractorCategoryId
                ? {
                    OR: [
                      { step: { requiredCategoryId: subcontractorCategoryId } },
                      {
                        step: { requiredCategoryId: null },
                        subcontractor: {
                          categories: { some: { categoryId: subcontractorCategoryId } },
                        },
                      },
                    ],
                  }
                : {}),
            }),
          },
        },
      ];
    }

    return where;
  }

export async function findAllRolls(this: InventoryServiceThis, 
    req: Request
  ): Promise<PaginatedResponse<Roll> | CursorPaginatedResponse<Roll>> {
    const params = parseQueryParams(req);
    // sortBy güvenlik süzgeci — bilinmeyen kolon (500) + indekssiz keyfi sort engellenir.
    params.sortBy = resolveSortBy(params.sortBy, ROLL_SORTABLE_FIELDS);
    const { fireCodes } = await loadProducedBuckets(prisma);
    const where = this.buildRollWhere(params, fireCodes, await customerCodeSearchRollIds(params.search));

    // Sevkiyat rezervasyonu: WAREHOUSE top bir çuval/sevkiyata bağlıysa "serbest depo"
    // DEĞİLDİR — listede "Çuvalda" rozeti için sevkiyat no/durum + çuval no döner.
    // Şekil modül-seviyesinde tek kaynakta (getProductionFlow ile paylaşılır).
    const include = ROLL_LIST_INCLUDE;

    // CURSOR MODE — dinamik sortBy desteği (utils/cursor.ts dynamic API).
    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      // Tavan MAX_PAGE_SIZE (500) ile hizalı: "tümünü indir" (fetchAll) 500'lük
      // sayfa ister → 30k kayıt 60 istekte iner (200 tavanında 150 istek/2.5× daha
      // yavaştı). Normal liste 100'lük ister; bu tavan yalnız büyük export'u etkiler.
      const limit = Math.min(Math.max(1, rawLimit), 500);
      const wantTotal = req.query.withTotal === "true";

      const sortBy = params.sortBy || "createdAt";
      const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";
      // Nullable sıralama kolonları (barcode: fason dönüş açık kumaşı; width:
      // rawWidthEnabled kapalıyken stokun çoğu null): nulls EN SONA + null-aware
      // cursor — yoksa DESC'te NULLS FIRST cursor'ı null grubuna kilitler ve
      // "En"/"Barkod" başlığına tıklayan operatör listenin çoğunu hiç göremezdi.
      const NULLABLE_ROLL_SORT = new Set(["barcode", "width"]);
      const sortNullable = NULLABLE_ROLL_SORT.has(sortBy);
      const orderByPrimary = sortNullable
        ? { [sortBy]: { sort: sortOrder, nulls: "last" as const } }
        : { [sortBy]: sortOrder };
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, sortBy, sortOrder, sortNullable)] }
        : where;

      const [items, totalEstimate] = await Promise.all([
        prisma.roll.findMany({
          where: cursorWhereClause,
          orderBy: [orderByPrimary, { id: sortOrder }],
          take: limit + 1,
          include,
        }),
        wantTotal ? prisma.roll.count({ where }) : Promise.resolve(undefined),
      ]);

      const hasMore = items.length > limit;
      const data = await attachCustomerBatchNo(hasMore ? items.slice(0, limit) : items);
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, sortBy) : null;

      return {
        success: true,
        data,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // OFFSET MODE (legacy, küçük gezinmelerde)
    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [rows, total] = await Promise.all([
      prisma.roll.findMany({
        where,
        orderBy,
        skip,
        take,
        include,
      }),
      prisma.roll.count({ where }),
    ]);
    const data = await attachCustomerBatchNo(rows);

    return {
      success: true,
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize),
      },
    };
  }

export async function getRollStats(this: InventoryServiceThis, req: Request): Promise<ApiResponse<RollStats>> {
    const params = parseQueryParams(req);
    // tx dışı (global prisma) iki bağımsız okuma — paralel.
    const [{ fireCodes }, emanetOn] = await Promise.all([loadProducedBuckets(prisma), readEmanetEnabled()]);
    const where = this.buildRollWhere(params, fireCodes, await customerCodeSearchRollIds(params.search)) as Prisma.RollWhereInput;

    // TEK TARAMA: (status, qualityGrade) bazlı groupBy bir scan'de hem count
    // hem sum'ları döndürür. Eskiden 3 ayrı sorgu vardı (aggregate + groupBy
    // status + groupBy qualityGrade) → 500k satırda 3 kez tarama. Bunu tek
    // geçişe indiriyoruz (CLAUDE.md DB perf kuralı). Grup sayısı küçük
    // (status × qualityGrade ≈ on'lar) → aşağıdaki JS reduce maliyetsiz.
    // Emanet kırılımı aynı where ∧ CONSIGNED_WHERE — liste/şerit ile tek where (filtre-liste.md).
    const [grouped, consignedAgg] = await Promise.all([
      prisma.roll.groupBy({
        where,
        by: ["status", "qualityGrade"],
        _count: { _all: true },
        _sum: { currentQty: true, weightKg: true },
      }),
      emanetOn
        ? prisma.roll.aggregate({
            where: { AND: [where, CONSIGNED_WHERE] },
            _count: { _all: true },
            _sum: { currentQty: true, weightKg: true },
          })
        : Promise.resolve(null),
    ]);

    let totalCount = 0;
    // Decimal toplamları Prisma.Decimal ile biriktir — JS float aritmetiği
    // ondalık metraj/ağırlıkta drift yapar (CLAUDE.md Decimal kuralı).
    let totalQty = new Prisma.Decimal(0);
    let totalWeight = new Prisma.Decimal(0);
    const byStatus: Record<string, number> = {};
    const byQuality: Record<string, number> = {};

    for (const row of grouped) {
      const n = row._count._all;
      totalCount += n;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + n;
      // qualityGrade artık nullable → null anahtarı "BELIRSIZ" kovasına düşer.
      const qualityKey = row.qualityGrade ?? "BELIRSIZ";
      byQuality[qualityKey] = (byQuality[qualityKey] ?? 0) + n;
      if (row._sum.currentQty) totalQty = totalQty.plus(row._sum.currentQty);
      if (row._sum.weightKg) totalWeight = totalWeight.plus(row._sum.weightKg);
    }

    return {
      success: true,
      data: {
        totalCount,
        totalQty: Number(totalQty),
        totalWeight: Number(totalWeight),
        byStatus,
        byQuality,
        ...(consignedAgg
          ? {
              consigned: {
                count: consignedAgg._count._all,
                qty: Number(consignedAgg._sum.currentQty ?? 0),
                weight: Number(consignedAgg._sum.weightKg ?? 0),
              },
            }
          : {}),
      },
    };
  }

export async function getRollStatsBatch(this: InventoryServiceThis, 
    items: Array<{ key: string; filters?: Record<string, unknown> }>,
  ): Promise<ApiResponse<Array<{ key: string; totalCount: number; totalQty: number }>>> {
    // Kova kümesi İSTEK BAŞINA bir kez — döngü içinde çözülseydi N katalog
    // sorgusu olurdu (bu uç 20+ karo için tek istekte çağrılır).
    const { fireCodes } = await loadProducedBuckets(prisma);
    const data = await Promise.all(
      items.map(async (it) => {
        const where = this.buildRollWhere(
          { filters: it.filters ?? {} } as QueryParams,
          fireCodes,
        ) as Prisma.RollWhereInput;
        const agg = await prisma.roll.aggregate({
          where,
          _count: { _all: true },
          _sum: { currentQty: true },
        });
        return {
          key: it.key,
          totalCount: agg._count._all,
          totalQty: Number(agg._sum.currentQty ?? 0),
        };
      }),
    );
    return { success: true, data };
  }

export async function getWarehouseScope(rawOwnership?: unknown): Promise<
    ApiResponse<{
      free: { count: number; qty: number };
      pool: { count: number; qty: number };
      planned: { count: number; qty: number };
    }>
  > {
    const ownership = ownershipScopeWhere(readOwnershipScope(rawOwnership));
    const agg = (where: Prisma.RollWhereInput) =>
      prisma.roll.aggregate({
        where: ownership ? { AND: [where, ownership] } : where,
        _count: { _all: true },
        _sum: { currentQty: true },
      });

    const [free, pool, planned] = await Promise.all([
      agg({ status: RollStatus.WAREHOUSE, shipmentId: null, sackId: null }),
      agg({ status: RollStatus.WAREHOUSE, shipmentId: null, sackId: { not: null } }),
      agg({ status: RollStatus.WAREHOUSE, shipment: { status: ShipmentStatus.PLANNED } }),
    ]);

    const pick = (r: { _count: { _all: number }; _sum: { currentQty: Prisma.Decimal | null } }) => ({
      count: r._count._all,
      qty: Number(r._sum.currentQty ?? 0),
    });

    return {
      success: true,
      data: { free: pick(free), pool: pick(pool), planned: pick(planned) },
    };
  }
