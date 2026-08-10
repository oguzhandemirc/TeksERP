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
// =============================================================================

import { FabricPropertyValueType, StationPropertyMode } from "@prisma/client";
import type { TxClient } from "./roll-step.helper";
import { AppError } from "../../utils/app-error";

/** İstasyona bağlı bir özellik + modu + (SEÇİM ise) izin verilen değerleri. */
export interface StationPropertyCap {
  propertyId: string;
  mode: StationPropertyMode;
  code: string;
  name: string;
  valueType: FabricPropertyValueType;
  /** SEÇİM tipliyse AKTİF değerler (BAYRAK'ta boş dizi). */
  values: { id: string; code: string; name: string }[];
}

/**
 * Operatörün bir özellik için verdiği cevap.
 * BAYRAK'ta yalnız `propertyId` (işaretledi), SEÇİM'de `valueCode` de gelir.
 */
export interface PropertySelection {
  propertyId: string;
  valueCode?: string | null;
}

/** İstasyonun özellik yetenekleri + modları + değerleri (ekran + doğrulama). */
export async function loadStationPropertyCaps(
  tx: TxClient,
  stationId: string,
): Promise<StationPropertyCap[]> {
  const rows = await tx.stationProperty.findMany({
    where: { stationId, property: { isActive: true } },
    select: {
      propertyId: true,
      mode: true,
      property: {
        select: {
          code: true,
          name: true,
          sortOrder: true,
          valueType: true,
          // Yalnız AKTİF değerler: pasif değer yeni seçimde sunulmaz (ama
          // geçmiş kayıtlarda durmaya devam eder).
          values: {
            where: { isActive: true },
            select: { id: true, code: true, name: true },
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
    values: r.property.values,
  }));
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
      // Karşılaştırma locale-BAĞIMSIZ upper ile (kod kimliktir; Türkçe upper
      // "i"yi "İ" yapıp eşleşmeyi sessizce bozar — 2026-08-02 etiket dersi).
      const hit = cap.values.find((v) => v.code.toUpperCase() === wanted.toUpperCase());
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
 * İstasyonun yeteneklerini Roll'a `RollProperty` olarak yazar.
 * Yazılacak küme = AUTO satırları ∪ (seçilenler ∩ istasyonun yetenekleri).
 *
 * ⚠️ Kesişim ALINIR: istemcinin gönderdiği id körlemesine yazılmaz, yoksa tablet
 * istasyonun veremeyeceği bir özelliği topa yazdırabilirdi.
 *
 * ⚠️ `createMany(skipDuplicates)` DEĞİL, satır satır `upsert`: değer taşıyan
 * satırda operatör seçimini DÜZELTEBİLMELİ (50GR → 25GR). skipDuplicates ilk
 * yazılanı dondurur ve düzeltme sessizce kaybolurdu. Değer GÖNDERİLMEDİYSE
 * `update: {}` ile no-op — yani seçim taşımayan bir çağrı (bypass kapanışı)
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
  },
): Promise<{ propertyIds: string[] }> {
  const caps = args.caps ?? (await loadStationPropertyCaps(tx, args.stationId));
  if (caps.length === 0) return { propertyIds: [] };

  const picked = toSelectionMap(args.selections);
  const rows = caps
    .filter((c) => c.mode === StationPropertyMode.AUTO || picked.has(c.propertyId))
    .map((c) => {
      const wanted = (picked.get(c.propertyId)?.valueCode ?? "").trim();
      const value =
        c.valueType === FabricPropertyValueType.CHOICE && wanted
          ? c.values.find((v) => v.code.toUpperCase() === wanted.toUpperCase())
          : undefined;
      return { propertyId: c.propertyId, valueId: value?.id ?? null };
    });
  if (rows.length === 0) return { propertyIds: [] };

  for (const r of rows) {
    await tx.rollProperty.upsert({
      where: { rollId_propertyId: { rollId: args.rollId, propertyId: r.propertyId } },
      create: { rollId: args.rollId, propertyId: r.propertyId, valueId: r.valueId },
      update: r.valueId ? { valueId: r.valueId } : {},
    });
  }
  return { propertyIds: rows.map((r) => r.propertyId) };
}
