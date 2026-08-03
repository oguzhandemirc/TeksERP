// =============================================================================
// TeksERP - FabricProperty (Kumaş Özellik) Service (extends BaseService)
// =============================================================================
// Override 1: create → `code` backend-authoritative `OZL + GGAAYY + NNNN` (günlük
// sıralı). İstemciden gelen `code` YOK SAYILIR — Özellikler sayfası + özellik
// hızlı-ekleme aynı formatı alsın (CustomerService deseniyle birebir).
//
// Override 2 (2026-08-02): **`stationIds` ZORUNLU** — özellik hangi istasyon(lar)
// tarafından uygulanacağı bilgisiyle DOĞAR. Sebep saha vakası: `ZIMPARALI`
// 16 Temmuz'da tanımlandı, hiçbir istasyonun `StationProperty` listesine
// eklenmedi ve iki hafta boyunca HİÇBİR iş emrinde seçilemedi (0 hedef, 0 top) —
// çünkü panelde özellik seçmenin tek yolu rota adımındaki istasyon chip'leri.
// Kayıt "tanımlandı ama kullanılamaz" ara durumunda doğabildiği sürece bu
// unutulmaya devam ederdi; artık o ara durum **doğamaz**.
//
// Bağ, özellikle AYNI prisma çağrısında kurulur (`nestedCreateFields`) — iki ayrı
// yazım olsaydı ikincisi patladığında tam da önlemek istediğimiz bağsız kayıt
// kalırdı.
// =============================================================================

import { BaseService } from "./base.service";
import { ApiResponse } from "../types/api.types";
import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { dailyCodePrefix, nextDailySeq } from "../utils/code-format";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { deriveCapabilityFlags } from "./station-capability.service";

/** Özellik kodu prefix'i — tek-tip kod formatı: `OZL + GGAAYY + NNNN`. */
const PROPERTY_CODE_PREFIX = "OZL";

/**
 * Sıradaki özellik kodu: `OZL + GGAAYY + NNNN` (gün başına 1'den artan, 4 hane).
 * collation-güvenli sorgu (gte + startsWith) + sayısal max+1 — müşteri/sevkiyat/
 * çuval kodlarıyla aynı kalıp ([[code-format]]). Çakışma withBarcodeRetry ile telafi.
 */
async function nextPropertyCode(): Promise<string> {
  const prefix = dailyCodePrefix(PROPERTY_CODE_PREFIX);
  const todays = await prisma.fabricProperty.findMany({
    where: { code: { gte: prefix, startsWith: prefix } },
    select: { code: true },
  });
  const seq = nextDailySeq(
    todays.map((p) => p.code),
    prefix,
  );
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

/**
 * Gövdeden `stationIds`'i ayıklar (tekrarları eler) ve payload'dan siler.
 * `undefined` = alan hiç gönderilmedi (update'te "dokunma" demek).
 */
function extractStationIds(data: Record<string, unknown>): string[] | undefined {
  if (!("stationIds" in data)) return undefined;
  const raw = data.stationIds;
  delete data.stationIds;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) {
    throw AppError.badRequest("stationIds bir istasyon id listesi olmalı");
  }
  return [...new Set(raw as string[])];
}

/**
 * İstasyonlar var mı, aktif mi ve özellik uygulayabilir mi? Reddedilen her
 * durumda istasyon ADI ile Türkçe 400 — "bazıları geçersiz" mesajı operatöre
 * hangisini düzelteceğini söylemiyor.
 */
async function assertStationsCanApplyProperty(stationIds: string[]): Promise<void> {
  if (stationIds.length === 0) {
    throw AppError.badRequest(
      "Özelliği uygulayacak en az bir istasyon seçilmeli — istasyonsuz özellik hiçbir iş emrinde seçilemez",
    );
  }
  const stations = await prisma.station.findMany({
    where: { id: { in: stationIds } },
    select: {
      id: true,
      name: true,
      kind: true,
      isActive: true,
      defaultCategory: { select: { appliesColor: true, appliesProperty: true } },
    },
  });
  if (stations.length !== stationIds.length) {
    throw AppError.badRequest("Seçilen istasyonlardan bazıları bulunamadı");
  }
  const inactive = stations.find((s) => !s.isActive);
  if (inactive) {
    throw AppError.badRequest(`'${inactive.name}' istasyonu pasif durumda`);
  }
  const incapable = stations.find((s) => !deriveCapabilityFlags(s).canApplyProperty);
  if (incapable) {
    throw AppError.badRequest(
      `'${incapable.name}' istasyonu özellik kazandıramaz — atanmış kategorisi 'özellik veren' (appliesProperty=true) değil`,
    );
  }
}

export class FabricPropertyService extends BaseService {
  /**
   * Özellik kodu backend-authoritative: her zaman `OZL+GGAAYY+NNNN` günlük sıralı
   * üretilir; istemciden gelen `code` YOK SAYILIR. Eşzamanlı iki create aynı sıra
   * no'yu okuyup INSERT'te @unique çakışırsa (P2002) withBarcodeRetry taze no ile
   * yeniden dener. (Müşteri kodu deseniyle birebir — bkz. customer.service.ts.)
   *
   * `stationIds` ZORUNLUDUR (dosya başlığındaki gerekçe). Doğrulama retry
   * döngüsünün DIŞINDA bir kez yapılır — koddan bağımsız ve idempotent.
   */
  async create(
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const stationIds = extractStationIds(data);
    if (stationIds === undefined) {
      throw AppError.badRequest(
        "Özelliği uygulayacak istasyon(lar) belirtilmeli (stationIds)",
      );
    }
    await assertStationsCanApplyProperty(stationIds);
    // nestedCreateFields → performInsert bunu `{ create: [...] }`'a çevirir, yani
    // özellik ve istasyon bağları TEK insert'te doğar.
    data.stationCapabilities = stationIds.map((stationId) => ({ stationId }));

    return withBarcodeRetry(async () => {
      data.code = await nextPropertyCode();
      return super.create(data, userId);
    });
  }

  /**
   * `stationIds` gönderilirse istasyon bağlarını replace eder (yine en az bir
   * istasyon şart — kayıt sonradan da bağsız bırakılamaz). Gönderilmezse bağlara
   * DOKUNULMAZ; özelliğin adı/rengi düzenlenirken bağlar sessizce silinmesin.
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const stationIds = extractStationIds(data);
    if (stationIds === undefined) return super.update(id, data, userId);

    await assertStationsCanApplyProperty(stationIds);

    // SIRA ÖNEMLİ: önce skaler update (ad-mükerrer gibi asıl red sebepleri orada),
    // sonra bağ replace. Ters sırada, ad çakışmasına takılan bir düzenleme bağları
    // çoktan değiştirmiş olurdu. Bu sırada bağ yazımı patlarsa özellik ESKİ
    // bağlarıyla kalır — yani hiçbir arıza yolu kaydı bağsız bırakmaz.
    const updated = await super.update(id, data, userId);

    await prisma.$transaction(async (tx) => {
      // Hedef-set-tabanlı replace (station-capability.setCapabilities ile aynı
      // desen): bayat diff yerine `notIn` sil + createMany(skipDuplicates), böylece
      // eşzamanlı iki yazım birbirinin sonucunu ezmez.
      await tx.stationProperty.deleteMany({
        where: { propertyId: id, stationId: { notIn: stationIds } },
      });
      await tx.stationProperty.createMany({
        data: stationIds.map((stationId) => ({ stationId, propertyId: id })),
        skipDuplicates: true,
      });
    });

    return updated;
  }
}
