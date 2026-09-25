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
import { nextSeriesNo } from "./number-series.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { deriveCapabilityFlags } from "./station-capability.service";
import { FOLD_PROPERTY_CODE } from "./helpers/fold-type";
import { gatedSoftDelete, gatedUpdate } from "./helpers/master-data-archive.helper";
import { FABRIC_PROPERTY_ARCHIVE } from "./helpers/archive-gate/fabric-property-archive.helper";

/** Özellik kodu prefix'i — tek-tip kod formatı: `OZL + GGAAYY + NNNN`. */
const PROPERTY_CODE_PREFIX = "OZL";

/**
 * Sıradaki özellik kodu: `OZL + GGAAYY + NNNN` (gün başına 1'den artan, 4 hane).
 * collation-güvenli sorgu (gte + startsWith) + sayısal max+1 — müşteri/sevkiyat/
 * çuval kodlarıyla aynı kalıp ([[code-format]]). Çakışma withBarcodeRetry ile telafi.
 */
async function nextPropertyCode(): Promise<string> {
  // ⚠️ TEK TARİH — `nextCustomerCode` gerekçesi ("iki tarih" sınıfı).
  // ⚠️ C0 KAPSAMI: sayaç yalnız BU BİÇİM yürürlüğe girdikten sonra doğan kodlara
  // bakar; `nextSeriesNo` kapsamı, tek tarihi ve çakışma atlamasını taşır.
  return nextSeriesNo("fabricProperty", async (prefix) =>
    prisma.fabricProperty
      .findMany({
        where: { code: { gte: prefix, startsWith: prefix } },
        select: { code: true, createdAt: true },
      })
      .then((rows) => rows.map((r) => ({ code: r.code, createdAt: r.createdAt }))), new Date());
}

/** SEÇİM tipli özelliğin değer satırı — istemci sözleşmesi (DÜZ, nested write DEĞİL). */
export interface PropertyValueInput {
  code: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * Gövdeden `values`'ı ayıklar. `undefined` = alan gönderilmedi (dokunma).
 *
 * ⚠️ İstemci sözleşmesi DÜZ NESNE dizisidir, ham Prisma nested write DEĞİL —
 * `stationIds` ile aynı gerekçe (F209 seddi: generic CRUD üzerinden ilişki
 * manipülasyonu kapalı). Çeviriyi servis yapar.
 */
function extractValues(data: Record<string, unknown>): PropertyValueInput[] | undefined {
  if (!("values" in data)) return undefined;
  const raw = data.values;
  delete data.values;
  if (!Array.isArray(raw)) {
    throw AppError.badRequest("values bir değer listesi olmalı");
  }
  return raw.map((v, i) => {
    if (!v || typeof v !== "object") {
      throw AppError.badRequest(`${i + 1}. değer satırı geçersiz`);
    }
    const row = v as Record<string, unknown>;
    const code = typeof row.code === "string" ? row.code.trim().toUpperCase() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!code) throw AppError.badRequest(`${i + 1}. değerin kodu boş olamaz`);
    if (!name) throw AppError.badRequest(`'${code}' değerinin adı boş olamaz`);
    // ⚠️ ASCII ZORUNLU. Kod `Roll.foldType` gibi kolonlara aynen yazılıyor ve
    // API'den serbest metin de gelebiliyor; "TÜP" kodu, ASCII yazan her
    // istemciyi ("TUP") sessizce reddettirir. Görünen ad Türkçe kalabilir.
    if (!/^[\x20-\x7E]+$/.test(code)) {
      throw AppError.badRequest(
        `'${code}' kodunda Türkçe/ASCII-dışı karakter var. Kod kimliktir ve İngilizce ` +
          `harflerle yazılmalı (örn. TUP); Türkçe yazım GÖRÜNEN AD alanına yazılır (Tüp).`,
      );
    }
    return {
      code,
      name,
      sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : (i + 1) * 10,
      isActive: row.isActive === undefined ? true : Boolean(row.isActive),
    };
  });
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
      appliesColor: true,
      appliesProperty: true,
      appliesQuality: true,
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

/**
 * SEÇİM tipli özellik en az bir AKTİF değer taşımalı. Değersiz bir SEÇİM
 * özelliği, `stationIds`siz doğan özelliğin ikizidir: tanımlı ama seçilemez —
 * Tambur ekranında hiç tuş çıkmaz ve sebebi hiçbir yerde yazmaz.
 */
function assertChoiceHasValues(
  valueType: string,
  values: PropertyValueInput[] | undefined,
  existingActiveCount: number,
): void {
  if (valueType !== "CHOICE") return;
  // `isActive` verilmemişse yazma yolu `?? true` ile AKTİF yazar — sayaç da aynı
  // varsayımı yapmalı, yoksa isActive'siz gönderen istemci "0 aktif değer" diye
  // sahte 400 yer (yazılacak satırlar gerçekte aktif olacakken).
  const incomingActive = values?.filter((v) => v.isActive !== false).length;
  const effective = incomingActive === undefined ? existingActiveCount : incomingActive;
  if (effective === 0) {
    throw AppError.badRequest(
      "Seçim tipli özellik en az bir AKTİF değer taşımalı — değersiz bir seçim listesi " +
        "hiçbir ekranda seçilemez.",
    );
  }
}

/**
 * Değer listesini replace eder — ama HİÇBİR SATIRI FİZİKSEL SİLMEZ.
 * Listede olmayan kod PASİFLEŞTİRİLİR (kök CLAUDE.md "sadece soft delete").
 *
 * ⚠️ Sert silme, o kodu taşıyan GEÇMİŞ kayıtları (`Roll.foldType = "TUP"`)
 * anlamsız bırakırdı: kolonda metin durur, karşılığı katalogda yoktur ve
 * `resolveFoldTypeForWrite` o kaydın düzenlenmesini reddetmeye başlar.
 * Kodu tekrar listeye eklemek satırı yeniden aktifleştirir.
 */
async function replaceValuesTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  propertyId: string,
  values: PropertyValueInput[],
): Promise<void> {
  const keep = values.map((v) => v.code);
  await tx.fabricPropertyValue.updateMany({
    where: { propertyId, code: { notIn: keep } },
    data: { isActive: false },
  });
  for (const v of values) {
    await tx.fabricPropertyValue.upsert({
      where: { propertyId_code: { propertyId, code: v.code } },
      create: {
        propertyId,
        code: v.code,
        name: v.name,
        sortOrder: v.sortOrder ?? 0,
        isActive: v.isActive ?? true,
      },
      update: { name: v.name, sortOrder: v.sortOrder ?? 0, isActive: v.isActive ?? true },
    });
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
    const values = extractValues(data);
    if (stationIds === undefined) {
      throw AppError.badRequest(
        "Özelliği uygulayacak istasyon(lar) belirtilmeli (stationIds)",
      );
    }
    await assertStationsCanApplyProperty(stationIds);

    const valueType = typeof data.valueType === "string" ? data.valueType : "FLAG";
    if (valueType === "FLAG" && values && values.length > 0) {
      throw AppError.badRequest(
        "Bayrak tipli özellik değer listesi taşıyamaz — değer listesi için tipi 'Seçim' yapın.",
      );
    }
    assertChoiceHasValues(valueType, values, 0);

    // nestedCreateFields → performInsert bunu `{ create: [...] }`'a çevirir, yani
    // özellik, istasyon bağları ve (varsa) değerleri TEK insert'te doğar. Değerler
    // de nested: `stationIds`siz özellik gibi, DEĞERSİZ bir seçim özelliği de ara
    // durumda doğmasın.
    data.stationCapabilities = stationIds.map((stationId) => ({ stationId }));
    if (values && values.length > 0) {
      data.values = values.map((v) => ({
        code: v.code,
        name: v.name,
        sortOrder: v.sortOrder ?? 0,
        isActive: v.isActive ?? true,
      }));
    }

    return withBarcodeRetry(async () => {
      data.code = await nextPropertyCode();
      return super.create(data, userId);
    });
  }

  /**
   * `stationIds` gönderilirse istasyon bağlarını replace eder (yine en az bir
   * istasyon şart — kayıt sonradan da bağsız bırakılamaz). Gönderilmezse bağlara
   * DOKUNULMAZ; özelliğin adı/rengi düzenlenirken bağlar sessizce silinmesin.
   *
   * `values` için aynı sözleşme: gönderilmezse dokunulmaz, gönderilirse replace
   * (listede olmayan kod PASİFLEŞİR, silinmez — bkz. `replaceValuesTx`).
   */
  /** `DELETE` = pasife al — arşiv kapısından (URUN-YASAM-DONGUSU.md §6). */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    return gatedSoftDelete(FABRIC_PROPERTY_ARCHIVE, id, userId, (tx) =>
      tx.fabricProperty.update({ where: { id }, data: { isActive: false } }),
    );
  }

  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return gatedUpdate(FABRIC_PROPERTY_ARCHIVE, id, data, {
      userId,
      write: (tx) => tx.fabricProperty.update({ where: { id }, data: { isActive: false } }),
      next: (rest) => this.updateFields(id, rest, userId),
    });
  }

  private async updateFields(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const stationIds = extractStationIds(data);
    const values = extractValues(data);
    // ⚠️ ERKEN DÖNÜŞ `data.valueType` VARKEN KULLANILAMAZ (denetim F5). Eski
    // hâli yalnız stationIds/values yokluğuna bakıyordu; `PATCH {valueType:
    // "FLAG"}` o dala girip TÜM tip-geçiş guard'larını atlıyordu — KAT bayrağa
    // çevrilip hedef seçicilere sızabilir, 0 değerli SEÇİM doğabilirdi.
    if (stationIds === undefined && values === undefined && data.valueType === undefined) {
      return super.update(id, data, userId);
    }

    if (stationIds !== undefined) await assertStationsCanApplyProperty(stationIds);

    // Etkin tip: gövde tipi değiştiriyorsa o, değilse mevcut kayıttaki.
    const current = await prisma.fabricProperty.findUnique({
      where: { id },
      select: {
        code: true,
        name: true,
        valueType: true,
        _count: { select: { values: { where: { isActive: true } } } },
      },
    });
    if (!current) throw AppError.notFound("Özellik bulunamadı");
    const valueType = typeof data.valueType === "string" ? data.valueType : current.valueType;
    const typeChanging =
      typeof data.valueType === "string" && data.valueType !== current.valueType;

    if (typeChanging) {
      // ── TİP GEÇİŞ KİLİTLERİ (2026-08-11, denetim F5 + SEK-3) ────────────────
      // KAT'ın tipi HİÇ değiştirilemez: `fold-type.ts` ve üç istemcinin kat
      // tuşları bu özelliğin CHOICE olmasına dayanıyor; FLAG'e çevirmek katalog
      // doğrulamasını fail-open'a düşürür ve KAT'ı hedef seçicilere sokar.
      if (current.code === FOLD_PROPERTY_CODE) {
        throw AppError.badRequest(
          `'${current.name}' (KAT) sistem karakteristiğidir — tipi değiştirilemez.`,
        );
      }
      if (valueType === "FLAG") {
        // CHOICE→FLAG: değer listesi ya da topa yazılmış değer varsa YASAK.
        // Değer satırları silinmez (pasifleşir) → tip geri dönerse liste durur;
        // bayrağa çevirmek o kayıtları "değeri olan bayrak" limbosuna atardı ve
        // isTargetableProperty özelliği hedef seçicilere AÇARDI.
        const [valueCount, usedCount] = await Promise.all([
          prisma.fabricPropertyValue.count({ where: { propertyId: id } }),
          // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): soru "HİÇ değer taşıdı mı" — geçmişte
          // değer taşımış özelliği BAYRAK'a çevirmek "değerli bayrak" limbosu üretir.
          prisma.rollProperty.count({ where: { propertyId: id, valueId: { not: null } } }),
        ]);
        if (valueCount > 0 || usedCount > 0) {
          throw AppError.badRequest(
            `'${current.name}' Seçim tipinden Bayrak'a çevrilemez: ` +
              (usedCount > 0
                ? `${usedCount} topta seçilmiş değeri var.`
                : `değer listesi taşıyor (${valueCount} satır).`) +
              " Yanlış tanımlandıysa özelliği pasifleştirip yenisini açın.",
          );
        }
      } else {
        // FLAG→CHOICE: (a) AUTO modlu istasyon bağı varsa yasak — CHOICE+AUTO
        // yasağının yan kapısı (SEK-3): AUTO "sorulmaz" demek, seçim sorulmadan
        // yazılamaz. (b) Hedef/planlama pivotlarında kullanılıyorsa yasak —
        // hedef listeleri yalnız BAYRAK taşır; tip değişince o satırlar
        // "hedefte duran seçim" tutarsızlığına dönüşürdü.
        const autoRow = await prisma.stationProperty.findFirst({
          where: { propertyId: id, mode: "AUTO" },
          select: { station: { select: { name: true } } },
        });
        if (autoRow) {
          throw AppError.badRequest(
            `'${current.name}' özelliği '${autoRow.station.name}' istasyonunda Otomatik modda — ` +
              `Seçim tipine çevirmeden önce o istasyonda modu Opsiyonel/Zorunlu yapın.`,
          );
        }
        const [woT, lineT, routeT, itemT] = await Promise.all([
          // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): tip dönüşümü kilidi tarihsel kullanımı da sayar.
          prisma.workOrderTargetProperty.count({ where: { propertyId: id } }),
          prisma.orderLineRequiredProperty.count({ where: { propertyId: id } }),
          prisma.routeStepProperty.count({ where: { propertyId: id } }),
          prisma.itemAllowedProperty.count({ where: { propertyId: id } }),
        ]);
        const usage: string[] = [];
        if (woT > 0) usage.push(`${woT} iş emri hedefi`);
        if (lineT > 0) usage.push(`${lineT} sipariş kalemi`);
        if (routeT > 0) usage.push(`${routeT} rota adımı`);
        if (itemT > 0) usage.push(`${itemT} ürün izinli listesi`);
        if (usage.length > 0) {
          throw AppError.badRequest(
            `'${current.name}' Bayrak'tan Seçim'e çevrilemez: hedef/planlama listelerinde ` +
              `kullanılıyor (${usage.join(", ")}). Önce o bağları kaldırın.`,
          );
        }
      }
    }

    if (valueType === "FLAG" && values && values.length > 0) {
      throw AppError.badRequest(
        "Bayrak tipli özellik değer listesi taşıyamaz — değer listesi için tipi 'Seçim' yapın.",
      );
    }
    assertChoiceHasValues(valueType, values, current._count.values);

    // SIRA ÖNEMLİ: önce skaler update (ad-mükerrer gibi asıl red sebepleri orada),
    // sonra bağ replace. Ters sırada, ad çakışmasına takılan bir düzenleme bağları
    // çoktan değiştirmiş olurdu. Bu sırada bağ yazımı patlarsa özellik ESKİ
    // bağlarıyla kalır — yani hiçbir arıza yolu kaydı bağsız bırakmaz.
    const updated = await super.update(id, data, userId);

    await prisma.$transaction(async (tx) => {
      if (stationIds !== undefined) {
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
      }
      if (values !== undefined) await replaceValuesTx(tx, id, values);
    });

    // ⚠️ YANITI TAZELE. `super.update` bağ/değer yazımından ÖNCE koştuğu için
    // döndürdüğü nesne BAYAT `stationCapabilities`/`values` taşır. Sahada
    // gözlendi (2026-08-10, HTTP sondası): panelden "6-KAT" eklendi, DB'ye
    // yazıldı, ama yanıt eski üç değeri döndü — kullanıcı için bu "kaydettim,
    // görünmedi" demektir. Sıra bilinçli (önce skaler update: ad-mükerrer gibi
    // asıl red sebepleri orada), o yüzden çözüm sırayı değiştirmek değil,
    // yazımdan SONRA yeniden okumaktır.
    if (stationIds !== undefined || values !== undefined) {
      return super.findById(id);
    }
    return updated;
  }
}
