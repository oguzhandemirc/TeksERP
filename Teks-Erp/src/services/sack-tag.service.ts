// =============================================================================
// ÇUVAL İZLERİ (ETİKET) — SERVİS (2026-09-04)
// =============================================================================
// Paketlemeci çuvala "buna sonra bir şey daha ekleyeceğim" / "bunu kontrol
// edeceğim" izi bırakır. macOS Finder etiketleri gibi: nesnenin KENDİSİNİ
// değiştirmeyen, yalnız iz bırakan bir işaret.
//
// ── EMSAL BİREBİR: `setSackNotes` (shipping.service.ts) ─────────────────────
// İz ne ÖLÇÜM ne İÇERİKTİR — annotation'dır. Bu, çuval yorumuyla aynı sınıf ve
// aynı ÜÇ SONUCU doğurur. Üçü de "eksik" sanılıp eklenmeye açık olduğu için
// gerekçeleriyle burada yazılıdır (aşağıdaki `applyTagsTx` başlığı).
//
// ── SEVKTE TEMİZLİK SOFT'TUR (§D) ──────────────────────────────────────────
// `performDispatchTx` `clearedAt`+`clearedShipmentId` damgalar; `undoDispatch`
// storno dalı damgayı geri alır. Okuma yüzeylerinin tamamı TEK yüklemden geçer:
// `ACTIVE_TAG_WHERE` (helpers/sack-tag.helper.ts).
// =============================================================================

import { Prisma, ShipmentStatus } from "@prisma/client";

import prisma from "../lib/prisma";
import { AppError } from "../utils/app-error";
import { ApiResponse } from "../types/api.types";
import { AuditService } from "./audit.service";
import {
  ACTIVE_TAG_WHERE,
  HEX_RE,
  SackTagBadge,
  slugifySackTagCode,
} from "./helpers/sack-tag.helper";

/**
 * Audit modül adı. ⚠️ `"SACK"` DEĞİL: katalog satırı bir çuval değildir; aynı
 * ada yazmak "Çuval" modülünün geçmişine katalog düzenlemelerini karıştırırdı.
 * ATAMA yazmaları ise `"SACK"` altında kalır (çuvalın kendi geçmişi orada
 * okunuyor — `SACK_NOTES` emsali).
 */
const TAG_TABLE = "sack_tags";

const TAG_SELECT = {
  id: true,
  code: true,
  name: true,
  hex: true,
  sortOrder: true,
  isActive: true,
} satisfies Prisma.SackTagSelect;

export interface SackTagDto {
  id: string;
  code: string;
  name: string;
  hex: string;
  sortOrder: number;
  isActive: boolean;
}

/** Toplu uçta atlanan çuvalın gerekçesi — istemci satır satır gösterir. */
export interface SackTagSkip {
  sackId: string;
  reason: string;
}

export interface BulkTagResult {
  added: number;
  removed: number;
  skipped: SackTagSkip[];
}

/**
 * TOPLU UÇ TAVANI — `sack-search.service`'in çeki listesi/döküm tavanıyla AYNI
 * sayı. İkinci bir tavan icat edilmez: operatör aynı listede aynı seçimle
 * çalışıyor, iki farklı sınır "20 çuval seçtim, biri çalıştı biri çalışmadı"
 * demektir.
 */
export const MAX_BULK_TAG_SACKS = 200;

/** Ada göre benzersiz kod üretir (`ETIKET`, `ETIKET_2`, …). */
async function nextFreeTagCode(base: string): Promise<string> {
  const taken = new Set(
    (
      await prisma.sackTag.findMany({
        where: { OR: [{ code: base }, { code: { startsWith: `${base}_` } }] },
        select: { code: true },
      })
    ).map((r) => r.code),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const c = `${base}_${i}`.slice(0, 64);
    if (!taken.has(c)) return c;
  }
  throw AppError.badRequest("Etiket kodu üretilemedi — adı farklılaştırın");
}

function normalizeName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ").slice(0, 60);
  if (name.length < 2) throw AppError.badRequest("Etiket adı en az 2 karakter olmalı");
  return name;
}

function normalizeHex(raw: string): string {
  const hex = raw.trim();
  if (!HEX_RE.test(hex)) throw AppError.badRequest("Renk `#RRGGBB` biçiminde olmalı");
  return hex.toUpperCase();
}

/**
 * Toplu iz kapsamı — çuval id'leri.
 *
 * ⚠️ PAKETLEME GRUBU verilirse id'leri SUNUCU çözer. İstemci grubun çuvallarını
 * kendisi sayıp gönderemez: liste cursor'lu sayfalıdır, ekrandaki sayfa grubun
 * TAMAMI olmayabilir. "Gruba iz bırak" dendiğinde yarım gruba iz bırakmak sessiz
 * yanlış cevaptır (grup dökümüyle BİREBİR aynı ders).
 *
 * Kapsam HAVUZ çuvallarıdır (`shipmentId: null`) — grubun canlı tanımı.
 */
async function resolveBulkTagScope(
  sackIds: string[],
  packingGroupId: string | undefined,
): Promise<string[]> {
  if (packingGroupId) {
    const rows = await prisma.sack.findMany({
      where: { packingGroupId, shipmentId: null },
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) throw AppError.badRequest("Bu grupta havuz çuvalı kalmamış");
    return ids;
  }
  const ids = [...new Set(sackIds)];
  if (ids.length === 0) throw AppError.badRequest("Çuval seçilmedi");
  return ids;
}

export const SackTagService = {
  // =========================================================================
  // KATALOG (ReasonPreset kalıbı)
  // =========================================================================

  /**
   * Katalog listesi. `includeInactive` yalnız DÜZENLEME yüzeyi içindir —
   * operatör ekranları aktifleri alır (gizlenen satır orada çizilmemeli).
   */
  async listTags(params: { includeInactive?: boolean } = {}): Promise<ApiResponse<SackTagDto[]>> {
    const rows = await prisma.sackTag.findMany({
      where: params.includeInactive ? {} : { isActive: true },
      select: TAG_SELECT,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return { success: true, data: rows };
  },

  async createTag(
    input: { name: string; hex: string; sortOrder?: number },
    userId?: string,
  ): Promise<ApiResponse<SackTagDto>> {
    const name = normalizeName(input.name);
    const hex = normalizeHex(input.hex);
    const dup = await prisma.sackTag.findFirst({ where: { name }, select: { id: true } });
    if (dup) throw AppError.conflict("Bu adla bir etiket zaten var");

    const code = await nextFreeTagCode(slugifySackTagCode(name));
    const sortOrder =
      input.sortOrder ??
      ((await prisma.sackTag.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 10;

    const row = await prisma.sackTag.create({
      data: { code, name, hex, sortOrder, createdById: userId ?? null, updatedById: userId ?? null },
      select: TAG_SELECT,
    });
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: TAG_TABLE,
      recordId: row.id,
      newData: { ...row },
    });
    return { success: true, data: row, message: "Etiket eklendi" };
  },

  /**
   * Düzenleme. ⚠️ `code` BURADA DEĞİŞMEZ — kod rapor/entegrasyon anahtarıdır
   * (`ReasonPreset.update` ile aynı gerekçe: adı düzelten operatör geçmiş
   * kırılımı ikiye bölmesin).
   */
  async updateTag(
    id: string,
    input: { name?: string; hex?: string; sortOrder?: number; isActive?: boolean },
    userId?: string,
  ): Promise<ApiResponse<SackTagDto>> {
    const current = await prisma.sackTag.findUnique({ where: { id }, select: TAG_SELECT });
    if (!current) throw AppError.notFound("Etiket bulunamadı");

    const name = input.name !== undefined ? normalizeName(input.name) : undefined;
    if (name && name !== current.name) {
      const dup = await prisma.sackTag.findFirst({
        where: { name, id: { not: id } },
        select: { id: true },
      });
      if (dup) throw AppError.conflict("Bu adla bir etiket zaten var");
    }

    const row = await prisma.sackTag.update({
      where: { id },
      data: {
        ...(name ? { name } : {}),
        ...(input.hex !== undefined ? { hex: normalizeHex(input.hex) } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedById: userId ?? null,
      },
      select: TAG_SELECT,
    });
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: TAG_TABLE,
      recordId: id,
      oldData: { ...current },
      newData: { ...row },
    });
    return { success: true, data: row, message: "Etiket güncellendi" };
  },

  /**
   * SERT SİLME — yalnız HİÇ KULLANILMAMIŞ etiket için.
   *
   * ⚠️ Kullanımdaki etiketin sert silinmesini DB seddi (FK `onDelete: Restrict`)
   * zaten engeller; buradaki sayım o seddin TÜRKÇE sesidir — sedsiz bırakılsaydı
   * operatör ham Postgres FK mesajı görürdü. Katalogdan çıkarmanın doğru yolu
   * `isActive:false`: atamalar KALIR, rozet soluk çizilir, yeni atamaya kapanır.
   *
   * ⚠️ TEMİZLENMİŞ (sevkte silinen) atama da SAYILIR: o satır stornonun geri
   * getireceği izdir; "görünmüyor" diye silmek stornoyu sessizce boşa çıkarırdı.
   */
  async deleteTag(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const current = await prisma.sackTag.findUnique({ where: { id }, select: TAG_SELECT });
    if (!current) throw AppError.notFound("Etiket bulunamadı");
    const used = await prisma.sackTagAssignment.count({ where: { tagId: id } });
    if (used > 0) {
      throw AppError.conflict(
        `Bu etiket ${used} çuvalda kullanılmış — silinemez. Listeden kaldırmak için "Pasif" yapın.`,
      );
    }
    await prisma.sackTag.delete({ where: { id } });
    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: TAG_TABLE,
      recordId: id,
      oldData: { ...current },
    });
    return { success: true, data: { id }, message: "Etiket silindi" };
  },

  // =========================================================================
  // ATAMA — iz bırak / kaldır
  // =========================================================================

  /** Çuvalın ETKİN izleri (rozet). Tek yüklem: `ACTIVE_TAG_WHERE`. */
  async getSackTags(sackId: string): Promise<ApiResponse<SackTagBadge[]>> {
    const sack = await prisma.sack.findUnique({ where: { id: sackId }, select: { id: true } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    const rows = await prisma.sackTagAssignment.findMany({
      where: { sackId, ...ACTIVE_TAG_WHERE },
      select: { tag: { select: { id: true, code: true, name: true, hex: true, isActive: true } } },
      orderBy: [{ tag: { sortOrder: "asc" } }, { tag: { name: "asc" } }],
    });
    return { success: true, data: rows.map((r) => r.tag) };
  },

  /**
   * TEKİL: çuvalın iz kümesini DEĞİŞTİR (replace).
   *
   * ⚠️⚠️ ÜÇ ŞEY BİLEREK YAPILMAZ — üçü de "eksik" sanılıp eklenmeye açıktır:
   *
   *  1. **`touchWarehouseSackTx` ÇAĞRILMAZ.** O guard ölçüm/içerik invariant'ını
   *     korur (`WHERE shipmentId IS NULL`, aksi 409): sevkiyata atanmış çuvalın
   *     kg'si/içeriği değişmesin diye. İz ne ölçüm ne içeriktir — sevk edilmiş
   *     çuvala da "müşteri şikayet etti" izi bırakılabilmeli (`setSackNotes` /
   *     `Shipment.dispatchNote` ile birebir aynı gerekçe). Eklenirse özellik
   *     sessizce 409'a düşer.
   *  2. **`markSackContentChangedTx` ÇAĞRILMAZ.** BU İŞİN EN PAHALI HATASI:
   *     o fonksiyon `weightKg` + `weightSource` + tartı izini SIFIRLAR. Bağlansaydı
   *     tartılmış çuvalın BRÜT KG'Sİ her etiket hamlesinde sessizce silinirdi —
   *     ve o rakam sevk irsaliyesine ve gümrük belgesine basılıyor. Bekçi
   *     `test_sack_tags` §2 tam bu satırın kilididir.
   *  3. **`labelDirty`ye DOKUNULMAZ.** İz fiziksel çuval etiketine BASILMIYOR
   *     (kullanıcı kararı: o etiket müşteriye gidiyor) → yazma noktası HİÇ
   *     olmamalı. `sackNote` emsalindeki koşullu bayatlık burada bile geçerli
   *     değil, çünkü `SACK_FIELDS` kataloğunda karşılığı YOK.
   *
   * ⚠️ TEMİZLENMİŞ SATIRIN DİRİLİŞİ: `@@unique([sackId, tagId])` yüzünden sevkte
   * temizlenmiş bir satır varken düz `createMany skipDuplicates` yazımı satırı
   * SESSİZCE ATLAR ve iz bir daha GÖRÜNMEZ. Bu yüzden ekleme iki adımlıdır:
   * önce temizlenmişleri dirilt (künye TAZE damgalanır — yeni bir bırakmadır),
   * sonra kalanları yaz.
   *
   * ⚠️ KALDIRMA SOFT DAMGADIR ve YALNIZ ETKİN satıra dokunur: temizlenmiş satır
   * stornonun adresidir (`clearedShipmentId`), ona dokunmak geri almayı sessizce
   * boşa çıkarırdı. Elle kaldırılan satır `clearedShipmentId` NULL ile ayrışır.
   */
  async setSackTags(sackId: string, tagIds: string[], userId?: string): Promise<ApiResponse<SackTagBadge[]>> {
    const sack = await prisma.sack.findUnique({ where: { id: sackId }, select: { id: true } });
    if (!sack) throw AppError.notFound("Çuval bulunamadı");
    const wanted = [...new Set(tagIds)];
    await assertTagsAssignable(wanted);

    const current = await prisma.sackTagAssignment.findMany({
      where: { sackId, ...ACTIVE_TAG_WHERE },
      select: { tagId: true },
    });
    const currentIds = new Set(current.map((r) => r.tagId));
    const toAdd = wanted.filter((t) => !currentIds.has(t));
    const toRemove = [...currentIds].filter((t) => !wanted.includes(t));

    if (toAdd.length || toRemove.length) {
      await prisma.$transaction(async (tx) => {
        await applyTagsTx(tx, [sackId], toAdd, toRemove, false, userId);
      });
    }

    const after = await this.getSackTags(sackId);
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: sackId,
      newData: {
        kind: "SACK_TAGS",
        tags: after.data.map((t) => t.code),
        added: toAdd.length,
        removed: toRemove.length,
      },
    });
    return { success: true, data: after.data, message: "Çuval izleri güncellendi" };
  },

  /**
   * TOPLU: N çuvala aynı hamlede iz bırak / kaldır.
   *
   * ⚠️ SONUÇ PARÇALI (kurşun dağıtımının "toplu sonuç PARÇALI" emsali): sevk
   * EDİLMİŞ çuval ATLANIR, 409 ATILMAZ. Karışık bir seçimde tek satır yüzünden
   * tüm hamleyi düşürmek sahayı tıkar; operatör hangi çuvalın neden atlandığını
   * `skipped[]` ile görür. PLANNED çuval ETİKETLENİR (mal hâlâ binada, "kontrol
   * et" izi hâlâ doğru).
   *
   * ⚠️ TEKİL UÇ İLE ASİMETRİ BİLİNÇLİ: tekil uç (`setSackTags`) sevk edilmiş
   * çuvalı da kabul eder — orada operatör O ÇUVALI açıkça seçmiştir ("müşteri
   * şikayet etti" izi meşru). Toplu uçta seçim listeden gelir ve sevk edilmiş
   * satırlar seçime yanlışlıkla girer.
   *
   * ⚠️ `removeAll` + `remove` BİRLİKTE GELİRSE 400 — sunucu niyeti sessizce
   * seçmez. `add` + `remove` aynı çağrıda SERBEST (yeniden etiketleme tek hamle).
   */
  async bulkTags(
    input: {
      sackIds: string[];
      add?: string[];
      remove?: string[];
      removeAll?: boolean;
      /** Grup kapsamı — bkz. `resolveBulkTagScope`. */
      packingGroupId?: string;
    },
    userId?: string,
  ): Promise<ApiResponse<BulkTagResult>> {
    const removeAll = input.removeAll === true;
    const remove = [...new Set(input.remove ?? [])];
    const add = [...new Set(input.add ?? [])];
    if (removeAll && remove.length) {
      throw AppError.badRequest(
        '"Tüm etiketleri kaldır" ile tek tek kaldırma birlikte gönderilemez — birini seçin',
      );
    }
    if (!removeAll && add.length === 0 && remove.length === 0) {
      throw AppError.badRequest("Uygulanacak etiket seçilmedi");
    }
    const sackIds = await resolveBulkTagScope(input.sackIds, input.packingGroupId);
    if (sackIds.length > MAX_BULK_TAG_SACKS) {
      throw AppError.badRequest(`Tek seferde en fazla ${MAX_BULK_TAG_SACKS} çuval işlenebilir`);
    }
    await assertTagsAssignable(add);

    // Uygunluk süzgeci — TX DIŞINDA okunur, yazım tx İÇİNDE aynı id kümesiyle
    // koşar. Yarışta en kötü ihtimal: sevk edilen bir çuval işlenmiş olur; iz
    // annotation olduğu için bu bir defter/ölçüm hatası DEĞİL.
    const rows = await prisma.sack.findMany({
      where: { id: { in: sackIds } },
      select: { id: true, sackNo: true, shipment: { select: { status: true } } },
    });
    const found = new Map(rows.map((r) => [r.id, r]));
    const skipped: SackTagSkip[] = [];
    const targets: string[] = [];
    for (const id of sackIds) {
      const row = found.get(id);
      if (!row) {
        skipped.push({ sackId: id, reason: "Çuval bulunamadı" });
        continue;
      }
      if (row.shipment?.status === ShipmentStatus.DISPATCHED) {
        skipped.push({ sackId: id, reason: `${row.sackNo} sevk edilmiş — atlandı` });
        continue;
      }
      targets.push(id);
    }

    let added = 0;
    let removed = 0;
    if (targets.length) {
      const res = await prisma.$transaction((tx) =>
        applyTagsTx(tx, targets, add, remove, removeAll, userId),
      );
      added = res.added;
      removed = res.removed;
    }

    // ⚠️ AUDIT ÇAĞRI BAŞINA BİR SATIR (plan kararı). Kalıcı künye zaten
    // `SackTagAssignment.createdById` — audit burada "kim toplu hamle yaptı"
    // sorusunu cevaplar, satır satır defter değildir. `recordId` ilk çuvaldır
    // (alan zorunlu ve tekil); kapsamın tamamı `newData.sackIds`te durur.
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "SACK",
      recordId: (targets[0] ?? sackIds[0]) as string,
      newData: {
        kind: "SACK_TAGS_BULK",
        sackIds: targets,
        addTagIds: add,
        removeTagIds: remove,
        removeAll,
        added,
        removed,
        skipped: skipped.length,
      },
    });

    const parts: string[] = [];
    if (added) parts.push(`${added} iz bırakıldı`);
    if (removed) parts.push(`${removed} iz kaldırıldı`);
    if (skipped.length) parts.push(`${skipped.length} çuval atlandı`);
    return {
      success: true,
      data: { added, removed, skipped },
      message: parts.length ? parts.join(", ") : "Değişiklik yok",
    };
  },
};

/**
 * Yeni ATAMA yapılabilir mi — etiket var ve AKTİF mi?
 *
 * ⚠️ Pasif etiket YENİ atamaya kapalıdır ama MEVCUT ataması durur (rozet soluk).
 * Gizleme bir görünürlük kararıdır, geçmişi silme kararı değil.
 */
async function assertTagsAssignable(tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return;
  const rows = await prisma.sackTag.findMany({
    where: { id: { in: tagIds } },
    select: { id: true, name: true, isActive: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of tagIds) {
    const row = byId.get(id);
    if (!row) throw AppError.badRequest("Etiket bulunamadı — listeyi yenileyin");
    if (!row.isActive) throw AppError.badRequest(`"${row.name}" etiketi pasif — yeni iz bırakılamaz`);
  }
}

/**
 * İZ YAZIMININ TEK MOTORU — tekil ve toplu uç aynı gövdeden geçer.
 *
 * ⚠️ Burada `touchWarehouseSackTx` / `markSackContentChangedTx` / `labelDirty`
 * YOKTUR ve OLMAMALIDIR — gerekçeler `setSackTags` başlığında.
 */
async function applyTagsTx(
  tx: Prisma.TransactionClient,
  sackIds: string[],
  add: string[],
  remove: string[],
  removeAll: boolean,
  userId?: string,
): Promise<{ added: number; removed: number }> {
  // KALDIRMA SOFT DAMGADIR, SİLME DEĞİL (2026-09-14): satır `clearedAt`+`clearedById`
  // alır, `clearedShipmentId` NULL kalır — sevk temizliğinden ayrışır; storno
  // (`restoreSackTagsOnUndoDispatchTx`) adresle aradığı için elle kaldırılanı
  // diriltmez, yeniden bırakma ① dalıyla diriltir. Defter satırı silinmez.
  const clearData = { clearedAt: new Date(), clearedShipmentId: null, clearedById: userId ?? null };
  let removed = 0;
  if (removeAll) {
    removed = (
      await tx.sackTagAssignment.updateMany({ where: { sackId: { in: sackIds }, ...ACTIVE_TAG_WHERE }, data: clearData })
    ).count;
  } else if (remove.length) {
    removed = (
      await tx.sackTagAssignment.updateMany({
        where: { sackId: { in: sackIds }, tagId: { in: remove }, ...ACTIVE_TAG_WHERE },
        data: clearData,
      })
    ).count;
  }

  let added = 0;
  if (add.length) {
    // ① DİRİLİŞ — sevkte ya da elle temizlenmiş satırı yeniden etkin yap. Künye
    //    TAZE damgalanır: bu yeni bir bırakmadır, eski bırakanın adına yazılamaz.
    added += (
      await tx.sackTagAssignment.updateMany({
        where: { sackId: { in: sackIds }, tagId: { in: add }, clearedAt: { not: null } },
        data: { clearedAt: null, clearedShipmentId: null, clearedById: null, createdById: userId ?? null, createdAt: new Date() },
      })
    ).count;
    // ② YENİ SATIRLAR — `skipDuplicates` idempotency: ağ-retry mükerrer satır
    //    açmaz (zaten etkin olan çift sessizce atlanır).
    added += (
      await tx.sackTagAssignment.createMany({
        data: sackIds.flatMap((sackId) =>
          add.map((tagId) => ({ sackId, tagId, createdById: userId ?? null })),
        ),
        skipDuplicates: true,
      })
    ).count;
  }
  return { added, removed };
}

/**
 * SEVKTE TEMİZLİK (§D) — `performDispatchTx` içinden çağrılır.
 *
 * ⚠️ SERT SİLME DEĞİL, SOFT DAMGA: sert silme stornonun kendi sözleşmesini
 * ("mal HİÇ ÇIKMADI") sessizce bozardı — geri alınan sevkiyatta çuval havuza
 * döner, iz yoktur, hata da yoktur. Kullanıcı açısından davranış aynı (iz sevkte
 * kaybolur), fark yalnız stornonun onu geri getirebilmesi.
 *
 * ⚠️ NEDEN DISPATCH, `createShipment` DEĞİL: PLANNED'da çuval hâlâ binada ve
 * "kontrol et / ayır" izi hâlâ doğru; stok da yalnız DISPATCH'te düşüyor.
 */
export async function clearSackTagsOnDispatchTx(
  tx: Prisma.TransactionClient,
  shipmentId: string,
): Promise<number> {
  // ⚠️ Önce sackId kümesi, sonra düz skaler `updateMany`: ilişki üzerinden
  // filtreleyen tek ifade yerine iki adım — kapsam GÖZLE OKUNUR ve sorgu
  // planı öngörülebilir kalır.
  const sacks = await tx.sack.findMany({ where: { shipmentId }, select: { id: true } });
  if (sacks.length === 0) return 0;
  const res = await tx.sackTagAssignment.updateMany({
    where: { sackId: { in: sacks.map((s) => s.id) }, ...ACTIVE_TAG_WHERE },
    data: { clearedAt: new Date(), clearedShipmentId: shipmentId },
  });
  return res.count;
}

/**
 * STORNO — `undoDispatch` içinden çağrılır; sevkte temizlenen izleri geri getirir.
 *
 * ⚠️ ADRES `clearedShipmentId` (RollVariance `sourceRefId` dersi): yalnız
 * `sackId` ile geri almak, sevkten SONRA bırakılıp başka bir sevkte temizlenmiş
 * MEŞRU izleri de diriltirdi. Sevk sonrası bırakılan yeni iz zaten etkindir
 * (`clearedShipmentId` NULL) → bu sorgu ona hiç dokunmaz.
 */
export async function restoreSackTagsOnUndoDispatchTx(
  tx: Prisma.TransactionClient,
  shipmentId: string,
): Promise<number> {
  const res = await tx.sackTagAssignment.updateMany({
    where: { clearedShipmentId: shipmentId },
    data: { clearedAt: null, clearedShipmentId: null },
  });
  return res.count;
}
