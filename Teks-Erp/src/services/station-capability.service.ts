// =============================================================================
// TeksERP - Station Capability Service
// =============================================================================
// Bir istasyonun uygulayabileceği ÖZELLİK yetkinliklerini yönetir.
// İç istasyon ve fason istasyonu ayrımı YOK — her istasyon buradan yönetilir.
//
// ⚠️ RENK ARTIK KISIT DEĞİL (2026-08-02). `colors` alanı okuma yanıtlarında
// geriye dönük uyum için duruyor ama hiçbir yer onu filtre olarak KULLANMAZ:
// rota adımının renk seçicisi tüm aktif renk kataloğunu gösterir. Gerekçe ve
// kalıcı not: `schema.prisma` → StationColor. Buraya renk kısıtı geri ekleme.
//
// Davranış: Bir istasyondan geçen rulo, o istasyonun propertyCapabilities
// listesindeki tüm özellikleri otomatik kazanır (per-roll action içinde
// `copyStationCapabilitiesToRoll` helper'ı çağırır). Fason kabul akışında
// aynı transfer kategori bayraklarına (appliesColor/appliesProperty)
// göre WO target'larından kopyalama olarak çalışır.
//
// API: GET ve PUT — bulk get / bulk replace pattern.
// =============================================================================

import {
  FabricPropertyValueType,
  Prisma,
  StationKind,
  StationPropertyMode,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";

export interface StationCapabilityDto {
  stationId: string;
  stationCode: string;
  stationName: string;
  stationKind: StationKind;
  /** İstasyona varsayılan kategori atanmış mı? */
  hasDefaultCategory: boolean;
  /** Bu istasyon renk uygulayabilir mi? Kategori varsa appliesColor; yoksa true. */
  canApplyColor: boolean;
  /** Bu istasyon özellik uygulayabilir mi? Kategori varsa appliesProperty; yoksa true. */
  canApplyProperty: boolean;
  colors: { id: string; code: string; name: string; hex: string | null }[];
  properties: StationCapabilityProperty[];
}

/**
 * İstasyona bağlı bir özellik + istasyondaki DAVRANIŞI + (SEÇİM tipliyse) izin
 * verilen değerleri. Tablet ekranı bu üçlüden çizilir; panel de aynı şekli okur.
 */
export interface StationCapabilityProperty {
  id: string;
  code: string;
  name: string;
  category: string | null;
  /** BAYRAK (var/yok) mı, SEÇİM (değerlerden biri) mi? */
  valueType: FabricPropertyValueType;
  /** AUTO → sorulmaz · OPTIONAL → tuş · REQUIRED → tuş + kapanış engeli. */
  mode: StationPropertyMode;
  /** SEÇİM tipliyse izin verilen değerler (BAYRAK'ta boş dizi). */
  values: { code: string; name: string; isActive: boolean }[];
}

/**
 * Özellik + değer seçimi — DTO ile aynı şekli üreten ortak `select`.
 *
 * ⚠️ `satisfies` kullanılıyor, `as const` DEĞİL: `as const` diziyi `readonly`
 * yapar ve Prisma'nın `orderBy` tipi mutable dizi bekler → seçim bütünüyle
 * reddedilir ve hata mesajı ilgisiz yerlerde ("colorCapabilities yok") patlar.
 */
const CAPABILITY_PROPERTY_SELECT = {
  id: true,
  code: true,
  name: true,
  category: true,
  valueType: true,
  isActive: true,
  values: {
    select: { code: true, name: true, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  },
} satisfies Prisma.FabricPropertySelect;

/**
 * Pivot satırı → DTO. TEK YERDE: `findByStation` ve `listAllDetailed` aynı şekli
 * döndürmek zorunda, ayrışırsa liste ile detay aynı istasyon için farklı şey der.
 */
function toCapabilityProperty(row: {
  mode: StationPropertyMode;
  property: {
    id: string;
    code: string;
    name: string;
    category: string | null;
    valueType: FabricPropertyValueType;
    values: { code: string; name: string; isActive: boolean }[];
  };
}): StationCapabilityProperty {
  return {
    id: row.property.id,
    code: row.property.code,
    name: row.property.name,
    category: row.property.category,
    valueType: row.property.valueType,
    mode: row.mode,
    values: row.property.values,
  };
}

/**
 * İstasyonun renk/özellik yeteneği — 2026-08-10'dan beri İSTASYONUN KENDİ
 * ALANLARINDAN okunur (`Station.appliesColor` / `appliesProperty`).
 *
 * Eskiden bu, `defaultCategory` bayraklarından TÜRETİLİYORDU ve kategorisi
 * olmayan istasyonda "ikisi de açık" varsayılıyordu. O varsayım "bilinmiyor →
 * serbest" demekti, "yapabilir" değil — bu yüzden renk tarafında çağıranlar
 * bileşik `hasDefaultCategory && canApplyColor` koşulu yazmak zorundaydı ve o
 * bileşiği unutmak Tambur adımına renk yazılmasına izin veriyordu.
 * Artık bayrak DÜRÜST: göçte iç istasyonlara `appliesColor=false` yazıldı,
 * çağıranlar tek koşula indi.
 *
 * `hasDefaultCategory` DTO'da KALIR (panel ipucu metni kullanıyor) ama artık
 * hiçbir KARAR ona bakmaz.
 *
 * EXPORT: `fabric-property.service` özellik doğarken istasyon bağını kurarken
 * aynı kuralı uygular. Kuralı ORAYA KOPYALAMA.
 */
export function deriveCapabilityFlags(station: {
  kind: StationKind;
  appliesColor: boolean;
  appliesProperty: boolean;
  defaultCategory: { appliesColor: boolean; appliesProperty: boolean } | null;
}): {
  hasDefaultCategory: boolean;
  canApplyColor: boolean;
  canApplyProperty: boolean;
} {
  return {
    hasDefaultCategory: !!station.defaultCategory,
    canApplyColor: station.appliesColor,
    canApplyProperty: station.appliesProperty,
  };
}

export class StationCapabilityService {
  /**
   * Bir istasyonun mevcut renk + özellik yetkinliklerini döner.
   */
  async findByStation(
    stationId: string,
  ): Promise<ApiResponse<StationCapabilityDto>> {
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        appliesColor: true,
        appliesProperty: true,
        defaultCategory: {
          select: { appliesColor: true, appliesProperty: true },
        },
      },
    });
    if (!station) throw AppError.notFound("İstasyon bulunamadı");
    const flags = deriveCapabilityFlags(station);

    const [colorRows, propertyRows] = await Promise.all([
      prisma.stationColor.findMany({
        where: { stationId },
        include: {
          color: {
            select: { id: true, code: true, name: true, hex: true, isActive: true },
          },
        },
      }),
      prisma.stationProperty.findMany({
        where: { stationId },
        select: { mode: true, property: { select: CAPABILITY_PROPERTY_SELECT } },
        orderBy: [{ property: { sortOrder: "asc" } }, { property: { code: "asc" } }],
      }),
    ]);

    return {
      success: true,
      data: {
        stationId: station.id,
        stationCode: station.code,
        stationName: station.name,
        stationKind: station.kind,
        hasDefaultCategory: flags.hasDefaultCategory,
        canApplyColor: flags.canApplyColor,
        canApplyProperty: flags.canApplyProperty,
        colors: colorRows
          .filter((r) => r.color.isActive)
          .map((r) => ({
            id: r.color.id,
            code: r.color.code,
            name: r.color.name,
            hex: r.color.hex,
          })),
        properties: propertyRows
          .filter((r) => r.property.isActive)
          .map((r) => toCapabilityProperty(r)),
      },
    };
  }

  /**
   * Aktif çalışma OTURUMUNUN istasyonunun yetkinlikleri — `peripherals/for-session`
   * kardeşi. Tablet kendi istasyon id'sini bilmek zorunda kalmasın diye var:
   * Tambur kat tuşlarını ve Kurşun/QC2 özellik tuşlarını buradan çizer.
   *
   * ⚠️ Oturum yoksa 404 DEĞİL, "yetkinlik yok" döner mi? HAYIR — 400 döner.
   * Boş liste, Tambur'da "kat seçeneği tanımlı değil" ile "oturum açık değil"i
   * aynı ekrana çıkarırdı; operatör hangisini düzelteceğini bilemezdi.
   */
  async getForSession(
    stationId: string | null | undefined,
  ): Promise<ApiResponse<StationCapabilityDto>> {
    if (!stationId) {
      throw AppError.badRequest(
        "Aktif çalışma oturumu yok — istasyon çözülemedi. Oturum açıp tekrar deneyin.",
      );
    }
    return this.findByStation(stationId);
  }

  /**
   * Bir istasyonun renk + özellik yetkinliklerini topluca değiştirir.
   * Eski liste silinip yeni liste yazılır (replace semantics).
   * Audit'e tek CUD logu yazılır (yetkinlik bütünü tek kayıt gibi davranır).
   *
   * ⚠️ `colorIds` OPSİYONEL (2026-08-02): renk artık istasyon bazlı kısıt DEĞİL
   * (bkz. StationColor deprecation notu). Alan gönderilmezse mevcut renk
   * satırlarına DOKUNULMAZ — `[]` göndermekle karıştırma, `[]` hepsini SİLER
   * ve canlıdaki geçmiş atamalar geri dönülemez şekilde gider.
   *
   * ⚠️ MOD (2026-08-10): `properties[].mode` verilmezse mevcut satırın modu
   * KORUNUR; yeni satır şema varsayılanını (OPTIONAL) alır. Bu, replace
   * deseninin (`deleteMany notIn` + `createMany skipDuplicates`) doğal
   * sonucudur — mevcut satır GÜNCELLENMEZ — ve istenen davranıştır: listeye bir
   * özellik eklemek, dokunulmayan satırların modunu sıfırlamamalı. Mod
   * değişikliği ayrıca `update` ile yazılır (aşağıda).
   */
  async setCapabilities(
    stationId: string,
    data: {
      colorIds?: string[];
      /** Eski sözleşme — modsuz id listesi. */
      propertyIds?: string[];
      /** Yeni sözleşme — id + mod. İkisi de gelirse BU kazanır. */
      properties?: { propertyId: string; mode?: StationPropertyMode }[];
    },
    userId?: string,
  ): Promise<ApiResponse<StationCapabilityDto>> {
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        appliesColor: true,
        appliesProperty: true,
        isActive: true,
        defaultCategory: {
          select: { appliesColor: true, appliesProperty: true },
        },
      },
    });
    if (!station) throw AppError.notFound("İstasyon bulunamadı");
    if (!station.isActive) {
      throw AppError.badRequest("Pasif istasyona yetkinlik atanamaz");
    }

    // Renk/özellik atama, varsayılan kategorinin appliesColor / appliesProperty
    // bayraklarına bağlıdır (kategori yoksa ikisi de açık). Boş listeye izin
    // var (mevcut kayıtları silmek için).
    // İki sözleşmenin tekleştirilmesi — aşağıdaki her şey `targets` üzerinden
    // çalışır, böylece eski/yeni gövde ayrımı TEK yerde kalır.
    const targets: { propertyId: string; mode?: StationPropertyMode }[] =
      data.properties ?? (data.propertyIds ?? []).map((propertyId) => ({ propertyId }));
    const targetIds = [...new Set(targets.map((t) => t.propertyId))];

    const { canApplyColor, canApplyProperty } = deriveCapabilityFlags(station);
    if (data.colorIds && data.colorIds.length > 0 && !canApplyColor) {
      throw AppError.badRequest(
        "Bu istasyona renk atanamaz — atanmış kategori 'renk veren' (appliesColor=true) değil",
      );
    }
    if (targetIds.length > 0 && !canApplyProperty) {
      throw AppError.badRequest(
        "Bu istasyona özellik atanamaz — atanmış kategori 'özellik veren' (appliesProperty=true) değil",
      );
    }

    // Renk + özellik referans doğrulaması (her biri DB'de var ve aktif mi?)
    if (data.colorIds && data.colorIds.length > 0) {
      const colors = await prisma.color.findMany({
        where: { id: { in: data.colorIds }, isActive: true },
        select: { id: true },
      });
      if (colors.length !== new Set(data.colorIds).size) {
        throw AppError.badRequest(
          "Bazı renkler bulunamadı veya pasif durumda",
        );
      }
    }
    if (targetIds.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: targetIds }, isActive: true },
        select: { id: true, name: true, valueType: true },
      });
      if (props.length !== targetIds.length) {
        throw AppError.badRequest(
          "Bazı özellikler bulunamadı veya pasif durumda",
        );
      }

      // ⚠️ SEÇİM tipli özellik AUTO moda ALINAMAZ (2026-08-11).
      // AUTO = "operatöre sorulmaz, adım kapanınca yazılır". Seçim tipinde
      // yazılacak DEĞER operatörün cevabıdır; sorulmadan yazmak sistemin
      // değerlerden birini KENDİ SEÇMESİ demek olurdu — 25GR mi 50GR mi?
      // Uydurma varsayılan, boş değerden zararlıdır (raporda gerçek sanılır).
      const byId = new Map(props.map((p) => [p.id, p]));
      const badAuto = targets.find(
        (t) => t.mode === "AUTO" && byId.get(t.propertyId)?.valueType === "CHOICE",
      );
      if (badAuto) {
        throw AppError.badRequest(
          `'${byId.get(badAuto.propertyId)!.name}' bir SEÇİM özelliğidir — "Otomatik" moda alınamaz. ` +
            `Değeri operatör seçmelidir: "Opsiyonel" ya da "Zorunlu" kullanın.`,
        );
      }
    }

    // Eski snapshot — audit için (mod dahil: değişikliğin izi kaybolmasın)
    const [oldColors, oldProperties] = await Promise.all([
      prisma.stationColor.findMany({
        where: { stationId },
        select: { colorId: true },
      }),
      prisma.stationProperty.findMany({
        where: { stationId },
        select: { propertyId: true, mode: true },
      }),
    ]);

    await prisma.$transaction(async (tx) => {
      // F239: hedef-set-tabanlı replace — eski snapshot (tx DIŞI) üzerinden diff
      // yerine `notIn` sil + createMany(skipDuplicates). İki eşzamanlı PUT bayat
      // diff'le birbirinin yazımını ezmez; sonuç her zaman data.colorIds/propertyIds.
      // notIn: [] Prisma'da "tümü" demek → hedef boşsa hepsi silinir (istenen).
      // colorIds hiç gönderilmediyse renk tarafı BÜTÜNÜYLE atlanır.
      if (data.colorIds) {
        const colorIds = data.colorIds;
        await tx.stationColor.deleteMany({
          where: { stationId, colorId: { notIn: colorIds } },
        });
        if (colorIds.length > 0) {
          await tx.stationColor.createMany({
            data: colorIds.map((colorId) => ({ stationId, colorId })),
            skipDuplicates: true,
          });
        }
      }

      await tx.stationProperty.deleteMany({
        where: { stationId, propertyId: { notIn: targetIds } },
      });
      if (targetIds.length > 0) {
        await tx.stationProperty.createMany({
          data: targetIds.map((propertyId) => ({ stationId, propertyId })),
          skipDuplicates: true,
        });
        // ⚠️ `createMany(skipDuplicates)` MEVCUT satırı güncellemez — mod
        // değişikliği bu yüzden ayrı yazılır. Yalnız AÇIKÇA mod gönderilen
        // satırlara dokunulur; gönderilmeyen satırın modu KORUNUR (özellik
        // eklerken dokunulmayan satırların modu sıfırlanmasın).
        //
        // Sıralı döngü bilinçli: `tx` ile `Promise.all` YASAK (pg adapter tek
        // bağlantı, ESLint kuralı). Liste istasyon başına birkaç satır.
        for (const t of targets) {
          if (!t.mode) continue;
          await tx.stationProperty.updateMany({
            where: { stationId, propertyId: t.propertyId },
            data: { mode: t.mode },
          });
        }
      }
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "STATION_CAPABILITY",
      recordId: stationId,
      oldData: {
        ...(data.colorIds ? { colorIds: oldColors.map((r) => r.colorId) } : {}),
        // Mod da yazılır: "KURSUN otomatikten opsiyonele çekildi" kararının tek izi.
        properties: oldProperties.map((r) => ({ propertyId: r.propertyId, mode: r.mode })),
      },
      newData: {
        ...(data.colorIds ? { colorIds: data.colorIds } : {}),
        properties: targets,
      },
    });

    return this.findByStation(stationId);
  }

  /**
   * Tüm istasyonların yetkinlik özetini döner (UI'da liste için).
   */
  async listAll(): Promise<
    ApiResponse<
      {
        stationId: string;
        stationCode: string;
        stationName: string;
        stationKind: StationKind;
        hasDefaultCategory: boolean;
        canApplyColor: boolean;
        canApplyProperty: boolean;
        colorCount: number;
        propertyCount: number;
      }[]
    >
  > {
    const stations = await prisma.station.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        appliesColor: true,
        appliesProperty: true,
        defaultCategory: {
          select: { appliesColor: true, appliesProperty: true },
        },
        _count: {
          select: { colorCapabilities: true, propertyCapabilities: true },
        },
      },
      orderBy: { code: "asc" },
    });

    return {
      success: true,
      data: stations.map((s) => {
        const flags = deriveCapabilityFlags(s);
        return {
          stationId: s.id,
          stationCode: s.code,
          stationName: s.name,
          stationKind: s.kind,
          hasDefaultCategory: flags.hasDefaultCategory,
          canApplyColor: flags.canApplyColor,
          canApplyProperty: flags.canApplyProperty,
          colorCount: s._count.colorCapabilities,
          propertyCount: s._count.propertyCapabilities,
        };
      }),
    };
  }

  /**
   * Tüm istasyonların yetkinlik DETAYINI tek seferde döner.
   * UI için: WO oluştururken adım-renk/özellik filtreleme tek istek ile çözülür.
   */
  async listAllDetailed(): Promise<ApiResponse<StationCapabilityDto[]>> {
    const stations = await prisma.station.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        kind: true,
        appliesColor: true,
        appliesProperty: true,
        defaultCategory: {
          select: { appliesColor: true, appliesProperty: true },
        },
        colorCapabilities: {
          include: {
            color: {
              select: {
                id: true,
                code: true,
                name: true,
                hex: true,
                isActive: true,
              },
            },
          },
        },
        propertyCapabilities: {
          select: { mode: true, property: { select: CAPABILITY_PROPERTY_SELECT } },
          orderBy: [{ property: { sortOrder: "asc" } }, { property: { code: "asc" } }],
        },
      },
      orderBy: { code: "asc" },
    });

    return {
      success: true,
      data: stations.map((s) => {
        const flags = deriveCapabilityFlags(s);
        return {
          stationId: s.id,
          stationCode: s.code,
          stationName: s.name,
          stationKind: s.kind,
          hasDefaultCategory: flags.hasDefaultCategory,
          canApplyColor: flags.canApplyColor,
          canApplyProperty: flags.canApplyProperty,
          colors: s.colorCapabilities
            .filter((r) => r.color.isActive)
            .map((r) => ({
              id: r.color.id,
              code: r.color.code,
              name: r.color.name,
              hex: r.color.hex,
            })),
          properties: s.propertyCapabilities
            .filter((r) => r.property.isActive)
            .map((r) => toCapabilityProperty(r)),
        };
      }),
    };
  }
}
