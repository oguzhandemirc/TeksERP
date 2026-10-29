// =============================================================================
// TeksERP - Station Capability Transfer Helper
// =============================================================================
// İstasyonun özellik yeteneklerini "buradan geçen rulonun kazanacağı şeyler"
// olarak Roll'a yazar. Örnek: Kurşun istasyonuna KURSUN özelliği AUTO modunda
// atanmışsa, o istasyonda QC2 tamamlanan her top KURSUN'u otomatik kazanır.
// Boyahane fason kabulündeki kategori-bazlı kopyalamanın internal karşılığı.
//
// ⚠️ 2026-08-10 — MOD SÖZLEŞMESİ. Eskiden istasyonun TÜM özellikleri körlemesine
// kopyalanıyordu ve `schema.prisma` bunu tuzak olarak işaretlemişti ("Kurşun'un
// listesine ikinci bir özellik eklendiği gün o özellik oradan geçen HER TOPA
// sessizce yazılır"). Artık:
//   • AUTO              → her zaman yazılır (operatöre sorulmaz)
//   • OPTIONAL/REQUIRED → YALNIZ operatörün seçiminde geliyorsa yazılır
//
// ⚠️ 2026-08-11 — DEĞER SÖZLEŞMESİ. Özellik SEÇİM tipliyse (KAT, GRAMAJ…)
// operatör bir DEĞER seçer ve o değer `RollProperty.valueId`'ye yazılır.
// BAYRAK tipinde değer anlamsızdır (varlık zaten cevaptır) ve reddedilir.
//
// ⚠️ REQUIRED'ın "seçilmeden adım kapanmaz" kuralı BURADA uygulanmaz —
// `assertPropertySelectionsValid` ile operatör yolunda (kursun-qc.completeQc2,
// inventory.kursunFinish) uygulanır. Sebep: bu helper'ı operatörsüz yollar da
// çağırıyor (kursun-bypass kapanışı). Zorunluluğu buraya koymak, tabletin hiç
// dokunmadığı bir bypass kapanışını 400'e düşürürdü.
//
// Seçim gönderilmezse davranış = "yalnız AUTO" — yani eski istemci (APK) yeni
// backend'e karşı bugünkü sonucu üretmeye devam eder.
//
// ⚠️ 2026-10-24 (KQ-D4) — ÇEŞİT SÖZLEŞMESİ. SEÇİM özelliği bir BAYRAĞIN çeşidi
// olabilir (`variantOfPropertyId`: "Kurşun gramajı" → "Kurşunlu"). Çeşit değeri
// basılınca bayrak HER ZAMAN uygulanır; "bayrak uygulandı mı + hangi değerle"
// kararı TEK fonksiyondadır (`resolveProcessApplications`) — defter satırı
// (KURSUN_APPLIED) ile topun özelliği (RollProperty) aynı karardan beslenir.
// Çeşit bağı olmayan kurulumda karar bugünküyle birebir aynıdır.
// =============================================================================

import { FabricPropertyValueType, StationKind, StationPropertyMode } from "@prisma/client";
import type { TxClient } from "./roll-step.helper";
import { AppError } from "../../utils/app-error";
import { setRollPropertyValueTx } from "./property-revoke.helper";
import { KURSUN_PROPERTY_CODE } from "./quality-station.helper";

/** İstasyona bağlı bir özellik + modu + (SEÇİM ise) izin verilen değerleri. */
export interface StationPropertyCap {
  propertyId: string;
  mode: StationPropertyMode;
  code: string;
  name: string;
  valueType: FabricPropertyValueType;
  /** SEÇİM tipliyse AKTİF değerler (BAYRAK'ta boş dizi). */
  values: { id: string; code: string; name: string }[];
  /** Bu SEÇİM özelliği hangi BAYRAĞIN çeşidi? (KQ-D4; çeşit değilse null) */
  variantOfPropertyId: string | null;
  /**
   * PASİF değerler — operatöre SUNULMAZ ama çeşit özelliğinde KABUL edilir
   * (V9: çevrimdışı kuyrukta basıldığı an aktifti). Çeşit olmayan SEÇİM'de
   * bugünkü gibi reddedilir.
   */
  retiredValues: { id: string; code: string; name: string }[];
}

/** Bayrak başına tek karar: uygulanıyor mu, hangi çeşit değeriyle? */
export interface ProcessApplication {
  flagPropertyId: string;
  applied: boolean;
  valueId: string | null;
}

/**
 * Operatörün bir özellik için verdiği cevap.
 * BAYRAK'ta yalnız `propertyId` (işaretledi), SEÇİM'de `valueCode` de gelir.
 */
export interface PropertySelection {
  propertyId: string;
  valueCode?: string | null;
}

/**
 * İstasyonun özellik yetenekleri + modları + değerleri (ekran + doğrulama).
 * `kind` verilirse istasyon o türde değilse boş döner (oturumdan gelen istasyon
 * Tambur olmayabilir — Top Kesme; T1). Ek sorgu yok, aynı where.
 */
export async function loadStationPropertyCaps(
  tx: TxClient,
  stationId: string,
  opts?: { kind?: StationKind },
): Promise<StationPropertyCap[]> {
  const rows = await tx.stationProperty.findMany({
    where: { stationId, property: { isActive: true }, ...(opts?.kind ? { station: { kind: opts.kind } } : {}) },
    select: {
      propertyId: true,
      mode: true,
      property: {
        select: {
          code: true,
          name: true,
          sortOrder: true,
          valueType: true,
          variantOfPropertyId: true,
          // Pasif değer yeni seçimde SUNULMAZ (aşağıda `values`'tan ayrılır) ama
          // çeşit özelliğinde kabul edilir (V9) — o yüzden hepsi okunur.
          values: {
            select: { id: true, code: true, name: true, isActive: true },
            orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
          },
        },
      },
    },
    orderBy: [{ property: { sortOrder: "asc" } }, { property: { code: "asc" } }],
  });
  return rows.map((r) => ({
    propertyId: r.propertyId,
    mode: r.mode,
    code: r.property.code,
    name: r.property.name,
    valueType: r.property.valueType,
    values: r.property.values.filter((v) => v.isActive).map(({ id, code, name }) => ({ id, code, name })),
    variantOfPropertyId: r.property.variantOfPropertyId,
    retiredValues: r.property.values
      .filter((v) => !v.isActive)
      .map(({ id, code, name }) => ({ id, code, name })),
  }));
}

/**
 * Seçilen kodun değer satırı. Karşılaştırma locale-BAĞIMSIZ upper ile (kod
 * kimliktir; Türkçe upper "i"yi "İ" yapar — 2026-08-02 etiket dersi). Pasif
 * değer YALNIZ çeşit özelliğinde bulunur (V9); başka her yerde bugünkü gibi yok.
 */
function findCapValue(
  cap: StationPropertyCap,
  wanted: string,
): { id: string; code: string; name: string } | undefined {
  const key = wanted.toUpperCase();
  const hit = cap.values.find((v) => v.code.toUpperCase() === key);
  if (hit || cap.variantOfPropertyId === null) return hit;
  return cap.retiredValues.find((v) => v.code.toUpperCase() === key);
}

/** Seçim listesini `propertyId → seçim` haritasına indirger (son yazan kazanır). */
function toSelectionMap(
  selections: PropertySelection[] | null | undefined,
): Map<string, PropertySelection> {
  const m = new Map<string, PropertySelection>();
  for (const s of selections ?? []) m.set(s.propertyId, s);
  return m;
}

/**
 * Operatörün cevapları TUTARLI mı? Reddedilen her durumda özellik ADIYLA 400.
 *
 * Üç kural:
 *   1. REQUIRED özellik işaretlenmiş olmalı
 *   2. SEÇİM tipli özellik işaretlendiyse GEÇERLİ bir değer taşımalı
 *   3. BAYRAK tipli özelliğe değer gönderilemez — sessizce yutmak, istemcinin
 *      yanlış alanı doldurduğunu gizler ve o hata sahada aylarca yaşar
 *
 * ⚠️ İstasyonun TAŞIMADIĞI bir özellik gönderilmesi sessizce yok sayılır
 * (aşağıdaki yazımda da kesişim alınır): istemci bayat liste taşıyor olabilir
 * ve bu, vardiyayı durdurmayı hak eden bir hata değildir.
 *
 * ⚠️ "Bazı özellikler eksik" DEMEZ — eldivenli operatörün ekranda hangi tuşa
 * basacağını bilmesi gerekiyor.
 */
export function assertPropertySelectionsValid(
  caps: StationPropertyCap[],
  selections: PropertySelection[] | null | undefined,
): void {
  const picked = toSelectionMap(selections);
  const capById = new Map(caps.map((c) => [c.propertyId, c]));

  const missing = caps
    .filter((c) => c.mode === StationPropertyMode.REQUIRED && !picked.has(c.propertyId))
    .map((c) => c.name);
  if (missing.length > 0) {
    throw AppError.badRequest(
      `Bu istasyonda zorunlu olan özellik(ler) işaretlenmedi: ${missing.join(", ")}.`,
      { code: "REQUIRED_PROPERTY_MISSING", missing },
    );
  }

  for (const [propertyId, sel] of picked) {
    const cap = capById.get(propertyId);
    if (!cap) continue; // istasyonda yok → kesişimde zaten düşecek
    const wanted = (sel.valueCode ?? "").trim();

    if (cap.valueType === FabricPropertyValueType.CHOICE) {
      if (!wanted) {
        throw AppError.badRequest(
          `'${cap.name}' için bir değer seçilmeli ` +
            `(${cap.values.map((v) => v.name).join(" / ") || "tanımlı değer yok"}).`,
          { code: "PROPERTY_VALUE_REQUIRED", propertyId },
        );
      }
      const hit = findCapValue(cap, wanted);
      if (!hit) {
        throw AppError.badRequest(
          `'${wanted}' değeri '${cap.name}' için tanımlı değil. Geçerli değerler: ` +
            `${cap.values.map((v) => v.code).join(", ") || "yok"}.`,
          { code: "PROPERTY_VALUE_INVALID", propertyId },
        );
      }
    } else if (wanted) {
      throw AppError.badRequest(
        `'${cap.name}' bir BAYRAK özelliğidir — değer taşıyamaz. ` +
          `Değerli kullanmak için özelliğin tipini "Seçim" yapın.`,
        { code: "PROPERTY_VALUE_NOT_ALLOWED", propertyId },
      );
    }
  }
}

/**
 * ÇEKİRDEK karar (atmaz): her BAYRAK için uygulanıyor mu + çeşit değeri.
 *   • AUTO bayrak uygulanır
 *   • OPTIONAL/REQUIRED bayrak operatör seçtiyse uygulanır
 *   • çeşit değeri seçildiyse bayrak HER ZAMAN uygulanır, `valueId` = o değer
 * Operatörsüz yol (bypass kapanışı) da buradan geçer — zorunluluk BURADA değil.
 */
function decideApplications(
  caps: StationPropertyCap[],
  selections: PropertySelection[] | null | undefined,
): ProcessApplication[] {
  const picked = toSelectionMap(selections);
  return caps
    .filter((c) => c.valueType === FabricPropertyValueType.FLAG)
    .map((flag) => {
      const variant = caps.find((c) => c.variantOfPropertyId === flag.propertyId);
      const wanted = variant ? (picked.get(variant.propertyId)?.valueCode ?? "").trim() : "";
      const value = variant && wanted ? findCapValue(variant, wanted) : undefined;
      const applied =
        flag.mode === StationPropertyMode.AUTO || picked.has(flag.propertyId) || value !== undefined;
      return { flagPropertyId: flag.propertyId, applied, valueId: value?.id ?? null };
    });
}

/**
 * OPERATÖR YOLUNUN tek kararı (completeQc2 · kursunFinish). Çekirdeğe ek kural:
 * çeşit REQUIRED ise ve bayrak uygulanıyorsa değer ZORUNLUDUR (400, ADIYLA).
 */
export function resolveProcessApplications(
  caps: StationPropertyCap[],
  selections: PropertySelection[] | null | undefined,
): ProcessApplication[] {
  const apps = decideApplications(caps, selections);
  for (const a of apps) {
    const variant = caps.find((c) => c.variantOfPropertyId === a.flagPropertyId);
    if (a.applied && a.valueId === null && variant?.mode === StationPropertyMode.REQUIRED) {
      throw AppError.badRequest(
        `'${variant.name}' için bir değer seçilmeli ` +
          `(${variant.values.map((v) => v.name).join(" / ") || "tanımlı değer yok"}).`,
        { code: "PROPERTY_VALUE_REQUIRED", propertyId: variant.propertyId },
      );
    }
  }
  return apps;
}

/**
 * KURŞUN kararı — `KURSUN_APPLIED` defter satırı bundan yazılır. `"KURSUN"`
 * literali yalnız `KURSUN_PROPERTY_CODE`ta (AST bekçisi `test_kursun_gramaj §9`).
 * İstasyonda kurşun yoksa `applied=false`.
 */
export function resolveKursunApplication(
  caps: StationPropertyCap[],
  selections: PropertySelection[] | null | undefined,
): { applied: boolean; valueId: string | null; valueCode: string | null } {
  const kursun = caps.find((c) => c.code === KURSUN_PROPERTY_CODE);
  const app = kursun
    ? resolveProcessApplications(caps, selections).find((a) => a.flagPropertyId === kursun.propertyId)
    : undefined;
  if (!kursun || !app?.applied) return { applied: false, valueId: null, valueCode: null };
  const variant = caps.find((c) => c.variantOfPropertyId === kursun.propertyId);
  const value = variant
    ? [...variant.values, ...variant.retiredValues].find((v) => v.id === app.valueId)
    : undefined;
  return { applied: true, valueId: app.valueId, valueCode: value?.code ?? null };
}

/**
 * İstasyonun yeteneklerini Roll'a `RollProperty` olarak yazar.
 * Yazılacak küme = AUTO satırları ∪ (seçilenler ∩ istasyonun yetenekleri).
 *
 * ⚠️ Kesişim ALINIR: istemcinin gönderdiği id körlemesine yazılmaz, yoksa tablet
 * istasyonun veremeyeceği bir özelliği topa yazdırabilirdi.
 *
 * ⚠️ `createMany(skipDuplicates)` DEĞİL, satır satır `setRollPropertyValueTx`:
 * değer taşıyan satırda operatör seçimini DÜZELTEBİLMELİ (50GR → 25GR) ve
 * düzeltme yerinde güncelleme değil SÜRÜM (eski satır damgalı durur, ③a).
 * Değer GÖNDERİLMEDİYSE no-op — seçim taşımayan bir çağrı (bypass kapanışı)
 * mevcut değeri SİLMEZ ve idempotent tekrar (offline replay) güvenlidir.
 *
 * ⚠️ Sıralı döngü bilinçli: `tx` ile `Promise.all` YASAK (pg adapter tek
 * bağlantı; ESLint kuralı yakalar). İstasyon başına birkaç satır.
 */
export async function copyStationCapabilitiesToRoll(
  tx: TxClient,
  args: {
    stationId: string;
    rollId: string;
    /** Operatörün cevapları. Verilmezse yalnız AUTO yazılır. */
    selections?: PropertySelection[] | null;
    /** Zaten yüklenmiş yetenek listesi (ikinci sorguyu önler). */
    caps?: StationPropertyCap[];
    /** Değer düzeltmesinde eski satırın damgasına yazılır (`revokedById`). */
    userId?: string | null;
  },
): Promise<{ propertyIds: string[]; changed: boolean }> {
  const caps = args.caps ?? (await loadStationPropertyCaps(tx, args.stationId));
  if (caps.length === 0) return { propertyIds: [], changed: false };

  const picked = toSelectionMap(args.selections);
  const rows = caps
    .filter((c) => c.mode === StationPropertyMode.AUTO || picked.has(c.propertyId))
    .map((c) => {
      const wanted = (picked.get(c.propertyId)?.valueCode ?? "").trim();
      const value =
        c.valueType === FabricPropertyValueType.CHOICE && wanted ? findCapValue(c, wanted) : undefined;
      return { propertyId: c.propertyId, valueId: value?.id ?? null };
    });
  // Çeşit değeri seçildiyse bayrak da yazılır (defter satırıyla AYNI karar).
  for (const a of decideApplications(caps, args.selections)) {
    if (a.applied && !rows.some((r) => r.propertyId === a.flagPropertyId)) {
      rows.push({ propertyId: a.flagPropertyId, valueId: null });
    }
  }
  if (rows.length === 0) return { propertyIds: [], changed: false };

  let changed = false;
  for (const r of rows) {
    const res = await setRollPropertyValueTx(tx, {
      rollId: args.rollId,
      propertyId: r.propertyId,
      valueId: r.valueId,
      reason: "STATION_CAPABILITY_RESELECT",
      userId: args.userId ?? null,
    });
    if (res !== "noop") changed = true;
  }
  return { propertyIds: rows.map((r) => r.propertyId), changed };
}
