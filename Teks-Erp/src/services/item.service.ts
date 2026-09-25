// =============================================================================
// TeksERP - Item (Stok Kartı) Service
// =============================================================================
// Tek tip Item: ürün artık tek kayıttır (örn. "Patos"). Renk ve özellik
// kimliğin parçası DEĞİL — sipariş/iş emri/rulo seviyesinde taşınır. Üründe
// sadece "izin verilen renk/özellik listesi" tutulur (M:N).
//
// allowedColorIds / allowedPropertyIds:
//   - Boş = tüm aktif Color / FabricProperty serbest
//   - Dolu = sipariş/WO planlamada bu listeden seçilebilir
// =============================================================================

import prisma from "../lib/prisma";
import { Request } from "express";
import { parseQueryParams, readIdCondition } from "../utils/query-parser";
import { ItemLifecycleStatus, ItemUnit } from "@prisma/client";
import { AuditService } from "./audit.service";
import { BaseService } from "./base.service";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { validateName, validateCode } from "../lib/string-validators";
import {
  normalizeItemName,
  foldNameForCompare,
} from "./helpers/name-normalize.helper";
import { nextSeriesNo } from "./number-series.service";
import { codeCountsForCounter } from "./helpers/series-format.helper";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { assertTargetablePropertyIds } from "./helpers/targetable-property.helper";
import {
  ITEM_LIFECYCLE_LABEL,
  countItemLiveRefs,
  listItemLiveRefs,
  totalLiveRefs,
  transitionItemLifecycle,
  transitionItemLifecycleTx,
  type ItemLifecycleTransitionResult,
} from "./helpers/item-lifecycle.helper";
import { itemBirthLifecycleData } from "./helpers/item-lifecycle-data.helper";
import {
  decideCodeUniqueness,
  lockCodeScopeTx,
  type CodeCandidate,
  type CodeUniquenessTexts,
} from "./helpers/code-unique.helper";
import { assertItemUsable } from "./helpers/item-usage.helper";

export interface ItemCreateInput {
  /** Boş/verilmezse backend `STK-NNNNNN` üretir; doluysa manuel kod kabul edilir. */
  code?: string | null;
  name: string;
  itemType: string;
  unit?: string;
  isActive?: boolean;
  /**
   * İplik inceliği (denye) — `Decimal(10,4)`. METİN taşınır: Decimal kolona JS
   * float yazmak yasak (kök kural). Boş/`null` = değer yok; yalnız YARN'da
   * anlamlıdır ve çözgü kartı açmanın ön koşuludur.
   */
  linearDensityDen?: string | number | null;
  /** KUMAŞ → varsayılan ÇÖZGÜ KARTI (E4, 2026-09-18): dokuma işi ve levent planı ön-dolum kaynağı; yalnız FABRIC. */
  warpSpecId?: string | null;
  allowedColorIds?: string[];
  allowedPropertyIds?: string[];
}

/** Stok kodu: `STK-` + 6 hane global artan sıra (tarihsiz — ürün kartı belge değil). */
const ITEM_CODE_PREFIX = "STK-";
const ITEM_CODE_DIGITS = 6;
/** Item.code DB kolonu VarChar(32) — paylaşımlı CODE_MAX_LEN (50) yerine bununla sınırla,
 * yoksa 33-50 karakterlik kod validator'dan geçip DB'de P2000'e düşer. */
const ITEM_CODE_MAX_LEN = 32;
/** Item.name DB kolonu VarChar(100) — paylaşımlı NAME_MAX_LEN (200) ile aynı P2000 tuzağı. */
const ITEM_NAME_MAX_LEN = 100;

/**
 * Kod tekilliği metinleri + kilit kapsamı (§18, 2026-08-15).
 *
 * SAHA VAKASI: canlıda `SANTUK` (ad: BORANCIK) ile `santuk` (ad: ŞANTUK) aynı
 * kodu taşıyor — İKİ FARKLI ÜRÜN. Ad-mükerrer guard'ı bunu YAKALAYAMAZ (adlar
 * gerçekten farklı), kod guard'ı da yakalamıyordu çünkü `findFirst({ code })`
 * TAM EŞLEŞME arıyordu. Bu sistemde kod KİMLİKTİR (etikete basılır, belgede
 * görünür) → harf büyüklüğü kimlik farkı sayılmaz. Ayrıntı + kapsam + tarihsel
 * kayıt politikası: `helpers/code-unique.helper.ts` dosya başlığı.
 *
 * ⚠️ `activeExactLead` metni bilinçli olarak KORUNDU ("Bu kod ile aktif ürün
 * zaten var") — Swagger sözleşmesi ve `scripts/test_item_code_autogen.ts` §C2
 * o cümleye bakıyor; yeni bilgi cümlenin ARKASINA eklenir.
 */
const ITEM_CODE_TEXTS: CodeUniquenessTexts = {
  activeExactLead: "Bu kod ile aktif ürün zaten var",
  entityLabel: "ürün",
};
const ITEM_CODE_LOCK_SCOPE = "item";
/** Yaşam döngüsü kolonları — genel PATCH gövdesinden yazılamaz (tek yazar). */
const LIFECYCLE_COLUMNS = ["lifecycleStatus", "lifecycleChangedAt", "lifecycleChangedById", "lifecycleReason"] as const;
/** Kod çakışması araması: tüm ürünler tek select ile çekilir, katlama JS'te yapılır
 *  (assertNameNotDuplicate emsali — `items` master tablosu birkaç yüz satır). */
const ITEM_CODE_CANDIDATE_SELECT = {
  id: true,
  code: true,
  name: true,
  isActive: true,
} as const;

/**
 * Sıradaki stok kodu: `STK-000001` gibi. OZL/MUS gündelik-kod deseninin tarihsiz
 * hali — tek global sayaç, kaynak items tablosunun kendisi (MAX+1). collation-güvenli
 * sorgu (gte + startsWith); `STK-` ile başlayıp sayısal parse edilemeyen manuel
 * kodlar max hesabında atlanır (nextDailySeq sözleşmesi). Eşzamanlı çakışma (P2002)
 * çağırandaki withBarcodeRetry ile taze max okunarak telafi edilir.
 */
/**
 * Kod çakışmasını çözer: aktif eş → 409 fırlatır, pasif eş → diriltilecek kayıt,
 * eş yok → `null`. `decideCodeUniqueness`in Item'a özel ince sarmalayıcısı —
 * aynı karar hem tx ÖNCESİ (ucuz 409) hem tx İÇİNDE (kilit altında, nihai)
 * verilsin ve iki yer ayrışmasın diye tek fonksiyon.
 */
function resolveReactivateTarget(
  code: string,
  candidates: CodeCandidate[],
): CodeCandidate | null {
  const decision = decideCodeUniqueness(code, candidates, ITEM_CODE_TEXTS);
  return decision.kind === "REACTIVATE" ? decision.target : null;
}

async function nextItemCode(): Promise<string> {
  // Tarihsiz seri (`dateSegment: NONE`) — sayaç HİÇ sıfırlanmaz, kapsam ön ekin kendisi.
  // ⚠️ TEK TARİH — bugün `NONE` olduğu için tarih koda GİRMİYOR, ama seri artık
  // VERİ: biri panelden tarih segmenti açarsa iki `new Date()` gece yarısı ayrışır.
  // ⚠️ C0 KAPSAMI: sayaç yalnız BU BİÇİM yürürlüğe girdikten sonra doğan kodlara
  // bakar; `nextSeriesNo` kapsamı, tek tarihi ve çakışma atlamasını taşır.
  // ⚠️ SÜZGEÇ BİÇİMDEN TÜRER, ELLE YAZILMAZ (K27, 2026-09-23): eski hâli
  // `/^STK-\d{1,12}$/` idi ve ön ek panelden değişince BÜTÜN satırları eledi —
  // sayaç 1'den başladı, ikinci ürün P2002'ye çarptı, fabrika ürün açamadı.
  // Yüklem artık `nextSeriesNo`un ÇÖZDÜĞÜ biçimden gelir (ikinci okuma yok).
  return nextSeriesNo("item", async (prefix, fmt) =>
    prisma.item
      .findMany({
        where: { code: { gte: prefix, startsWith: prefix } },
        select: { code: true, createdAt: true },
      })
      .then((rows) =>
        rows
          .filter((r) => codeCountsForCounter(fmt, r.code))
          .map((r) => ({ code: r.code, createdAt: r.createdAt }))), new Date());
}

/** E4: `warpSpecId` yalnız KUMAŞ kartında ve aktif bir çözgü kartını göstermeli (400); `null` temizler, `undefined` dokunmaz. */
async function assertWarpSpecAssignable(itemType: string | undefined, warpSpecId: string | null | undefined): Promise<void> {
  if (warpSpecId === undefined || warpSpecId === null) return;
  if (itemType !== undefined && itemType !== "FABRIC") throw AppError.badRequest("Çözgü kartı yalnız KUMAŞ kartına bağlanır", { code: "ITEM_WARP_SPEC_FABRIC_ONLY" });
  const n = await prisma.warpSpec.count({ where: { id: warpSpecId, isActive: true } });
  if (n === 0) throw AppError.badRequest("Çözgü kartı bulunamadı ya da pasif", { code: "WARP_SPEC_NOT_FOUND" });
}

export class ItemService extends BaseService {
  /**
   * İLİŞKİ SÜZGECİ (ürün seçici modalı, 2026-09-17): `filter[allowedColorId]` = "bu rengi ALABİLECEĞİM
   * ürünler" — izinli listesi BOŞ olan ürün her rengi alır (`none`), doluysa listede olmalı (`some`).
   * `filter[allowedPropertyId]` aynı kalıp. `safeFilters` bu anahtarları skaler süzgeçte düşürür (kolon
   * değil), o yüzden ham `filters`tan `readIdCondition` ile okunur (CSV de string'dir). Boş/yok = süzgeç yok.
   * `buildListWhere` tek nokta: offset · cursor · özet aynı where'i görür.
   */
  protected extraWhere(req: Request): Record<string, unknown> | undefined {
    const { filters } = parseQueryParams(req);
    const conds: Record<string, unknown>[] = [];
    const colorCond = readIdCondition(filters.allowedColorId);
    if (colorCond) conds.push({ OR: [{ allowedColors: { none: {} } }, { allowedColors: { some: { colorId: colorCond } } }] });
    const propCond = readIdCondition(filters.allowedPropertyId);
    if (propCond) conds.push({ OR: [{ allowedProperties: { none: {} } }, { allowedProperties: { some: { propertyId: propCond } } }] });
    if (conds.length === 0) return undefined;
    return conds.length === 1 ? conds[0] : { AND: conds };
  }

  /**
   * Item create — sade CRUD. allowedColors/allowedProperties M:N replace.
   *
   * `opts.pendingReview`: yalnız iç çağrı (quickCreateFabric) verir — public
   * gövdeden GELMEZ. GÜVENLİK İNVARİANTI: bu metot Prisma `data`'yı aşağıda
   * ALANLARI AÇIKÇA sayarak kurar (super.create'e delege ETMEZ) — böylece
   * `POST /items` gövdesine sızdırılan bir `pendingReview:true` sessizce düşer.
   * super.create'e refactor edilirse pendingReview public gövdeden set edilebilir
   * olur; bu davranışı bozma.
   */
  async create(
    data: Record<string, unknown>,
    userId?: string,
    opts?: { pendingReview?: boolean },
  ): Promise<ApiResponse<unknown>> {
    const input = data as unknown as ItemCreateInput;
    await assertWarpSpecAssignable(input.itemType, input.warpSpecId);

    // Stok kodu hibrit: boş bırakıldıysa backend STK-NNNNNN üretir; kullanıcı
    // girdiyse manuel kod aynen kabul edilir (trim + regex + max 32).
    const rawCode = typeof input.code === "string" ? input.code.trim() : input.code;
    const isAutoCode = rawCode === undefined || rawCode === null || rawCode === "";
    let manualCode: string | null = null;
    if (!isAutoCode) {
      const validatedCode = validateCode(rawCode, {
        label: "Ürün kodu",
        required: true,
        maxLen: ITEM_CODE_MAX_LEN,
      });
      if (typeof validatedCode === "string") manualCode = validatedCode;
      // STK- öneki otomatik sayaca rezerve — manuel STK- kodu hem karışıklık
      // hem (16+ haneli sayısalda) sayaç zehirlenmesi yaratır.
      if (manualCode && /^stk-/i.test(manualCode)) {
        throw AppError.badRequest(
          "Ürün kodu STK- ile başlayamaz — bu önek otomatik stok kodlarına ayrılmıştır (boş bırakın, sistem üretsin)",
        );
      }
    }
    const validatedName = validateName(input.name, {
      label: "Ürün ismi",
      required: true,
      maxLen: ITEM_NAME_MAX_LEN,
    });
    if (typeof validatedName === "string") input.name = validatedName;
    // Saha #13: ürün adları HEPSİ BÜYÜK (tr) — filtre/arama tutarlılığı.
    if (typeof input.name === "string") {
      input.name = normalizeItemName(input.name);
    }

    const allowedColorIds = [...new Set(input.allowedColorIds ?? [])];
    const allowedPropertyIds = [...new Set(input.allowedPropertyIds ?? [])];

    // Kod çakışması / reactivate kontrolü (yalnız manuel kod) — HARF-DUYARSIZ
    // (§18). Aktif eş → 409 (Swagger sözleşmesi + F43: duplicate = 409 Conflict);
    // pasif eş → diriltme. Otomatik kod her zaman taze üretilir, mevcutla
    // eşleşemez → tarama hiç koşmaz.
    //
    // Bu ön kontrol UCUZ 409 + ad-guard'ının excludeId'si içindir; NİHAİ KARAR
    // tx içinde, advisory kilidin ARDINDAN yeniden verilir (aşağı).
    const existing = manualCode
      ? resolveReactivateTarget(
          manualCode,
          await prisma.item.findMany({ select: ITEM_CODE_CANDIDATE_SELECT }),
        )
      : null;

    // Ad-mükerrer koruması — create super.create'e girmeyen custom yol olduğundan
    // BaseService kancası burada elle çağrılır; reactivate'te diriltilen kaydın
    // kendi adı hariç tutulur (`resolveReactivateTarget` yalnız PASİF eş döner —
    // aktif eşte zaten 409 fırlatmış olurdu).
    await this.assertNameNotDuplicate(data, existing ? existing.id : undefined);

    if (allowedColorIds.length > 0) {
      const colors = await prisma.color.findMany({
        where: { id: { in: allowedColorIds } },
        select: { id: true, name: true, isActive: true },
      });
      if (colors.length !== allowedColorIds.length) {
        throw AppError.badRequest("Bazı renkler bulunamadı");
      }
      const inactive = colors.find((c) => !c.isActive);
      if (inactive) {
        throw AppError.badRequest(`'${inactive.name}' rengi pasif`);
      }
    }

    if (allowedPropertyIds.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: allowedPropertyIds } },
        select: { id: true, name: true, isActive: true },
      });
      if (props.length !== allowedPropertyIds.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı");
      }
      const inactive = props.find((p) => !p.isActive);
      if (inactive) {
        throw AppError.badRequest(`'${inactive.name}' özelliği pasif`);
      }
      // SEÇİM tipli özellik izinli-listeye giremez — update yolundaki guard ile aynı.
      await assertTargetablePropertyIds(allowedPropertyIds, "ürün izinli özelliği");
    }

    // Otomatik kodda sequence okuma retry kapsamı İÇİNDE — P2002'de taze max
    // okunur. Manuel kod P2002'si retry edilmez (hep aynı değeri yazar), error
    // middleware'i anlamlı 409'a çevirir.
    const result = await withBarcodeRetry(
      async () => {
        const code = manualCode ?? (await nextItemCode());
        return prisma.$transaction(async (tx) => {
          // ⚠️ KİLİT tx'in İLK ifadesi ve KOD TARAMASINDAN ÖNCE (§18). Tam-eşleşme
          // yarışını `items_code_key` kapatıyor; KATLANMIŞ tekillikte DB'de
          // karşılık YOK (bilinçli — 9 tarihsel satır sedi patlatırdı), yani
          // eşzamanlı `sefa2` + `SEFA2` guard'ı ikisi de geçerdi. Kilit sonraya
          // alınırsa hiçbir şey kazanılmaz (KK1 tuzağında birebir yaşandı).
          // Otomatik kodda tarama zaten koşmuyor → kilit de alınmaz.
          let target: CodeCandidate | null = null;
          if (manualCode) {
            await lockCodeScopeTx(tx, ITEM_CODE_LOCK_SCOPE, manualCode);
            target = resolveReactivateTarget(
              manualCode,
              await tx.item.findMany({ select: ITEM_CODE_CANDIDATE_SELECT }),
            );
          }
          if (target) {
            // Diriltme bir DURUM GEÇİŞİDİR (Pasif → Aktif) ve tek yazardan geçer: atomik
            // claim + eşzamanlı ikinci istek hedefi zaten ACTIVE görür → 409.
            const tr = await transitionItemLifecycleTx(tx, {
              itemId: target.id,
              to: ItemLifecycleStatus.ACTIVE,
              reason: "Aynı kodla yeniden oluşturuldu",
              userId,
            });
            if (tr.idempotent) {
              throw AppError.conflict("Bu kod ile aktif ürün zaten var");
            }
            // Reactivate: M:N'leri replace + güncel veri.
            // ⚠️ `code` YAZILMAZ ve YAZILMASINA GEREK YOK — `decideCodeUniqueness`
            // yalnız TAM EŞLEŞMELİ pasif kaydı diriltir (harf farkı 409'dur), yani
            // hedefin kodu gönderilen kodla zaten birebir aynıdır.
            await tx.itemAllowedColor.deleteMany({ where: { itemId: target.id } });
            await tx.itemAllowedProperty.deleteMany({ where: { itemId: target.id } });
            const revived = await tx.item.update({
              where: { id: target.id },
              data: {
                name: input.name.trim(),
                unit: (input.unit ?? "MT") as ItemUnit,
                // Diriltme de yeni gövdeyi uygular (create ile aynı sözleşme).
                ...(input.linearDensityDen !== undefined
                  ? { linearDensityDen: input.linearDensityDen }
                  : {}),
                ...(input.warpSpecId !== undefined ? { warpSpecId: input.warpSpecId } : {}),
                allowedColors:
                  allowedColorIds.length > 0
                    ? { create: allowedColorIds.map((colorId) => ({ colorId })) }
                    : undefined,
                allowedProperties:
                  allowedPropertyIds.length > 0
                    ? { create: allowedPropertyIds.map((propertyId) => ({ propertyId })) }
                    : undefined,
              },
              include: {
                allowedColors: { include: { color: true } },
                allowedProperties: { include: { property: true } },
              },
            });
            return { record: revived, revivedFrom: target };
          }
          const fresh = await tx.item.create({
            data: {
              code,
              name: input.name.trim(),
              itemType: input.itemType as never,
              unit: (input.unit ?? "MT") as ItemUnit,
              // Doğuş durumu tek kaynaktan (`isActive` durumdan türer — CHECK).
              ...itemBirthLifecycleData(input.isActive),
              // Denye YALNIZ gönderildiğinde yazılır: `undefined` kolonu olduğu
              // gibi bırakır, `null` bilinçli temizlemedir (metin → Decimal).
              ...(input.linearDensityDen !== undefined
                ? { linearDensityDen: input.linearDensityDen }
                : {}),
              ...(input.warpSpecId !== undefined ? { warpSpecId: input.warpSpecId } : {}),
              // Yalnız iç quick-create (saha KK1) opt'u işaretler; public gövde etkisiz.
              ...(opts?.pendingReview ? { pendingReview: true } : {}),
              allowedColors:
                allowedColorIds.length > 0
                  ? { create: allowedColorIds.map((colorId) => ({ colorId })) }
                  : undefined,
              allowedProperties:
                allowedPropertyIds.length > 0
                  ? { create: allowedPropertyIds.map((propertyId) => ({ propertyId })) }
                  : undefined,
            },
            include: {
              allowedColors: { include: { color: true } },
              allowedProperties: { include: { property: true } },
            },
          });
          return { record: fresh, revivedFrom: null as CodeCandidate | null };
        });
      },
      undefined,
      () => isAutoCode,
    );

    // Diriltme kararının SAHİBİ tx içindeki (kilit altındaki) taze karardır;
    // audit/mesaj da ondan okunur — ön kontrol ile ayrışırsa yanıt yalan söylerdi.
    const created = result.record;
    const revivedFrom = result.revivedFrom;

    await AuditService.log({
      userId,
      action: revivedFrom ? "UPDATE" : "CREATE",
      tableName: this.config.tableName,
      recordId: created.id,
      newData: {
        code: created.code,
        name: created.name,
        itemType: created.itemType,
        allowedColorIds,
        allowedPropertyIds,
        ...(revivedFrom ? { reactivated: true } : {}),
        ...(opts?.pendingReview ? { pendingReview: true } : {}),
      },
    });

    return {
      success: true,
      data: created,
      message: revivedFrom ? "Pasif ürün yeniden aktive edildi" : "Ürün oluşturuldu",
    };
  }

  /**
   * Saha (mobil KK1) "yeni desen" hızlı oluşturma — YALNIZ ad.
   * itemType FABRIC'e zorlanır; kod (STK-NNNNNN) otomatik, birim MT (create
   * default'u), isActive true, izinli renk/özellik boş. `pendingReview:true`
   * ile işaretlenir (admin gözden geçirir). Tüm doğrulama (ad zorunlu/max,
   * TR-büyük harf normalize, ad-mükerrer 409) + kod üretimi + audit create()'ten
   * yeniden kullanılır. `mobile:kk1-desen` yetkisi route'ta zorlanır.
   */
  async quickCreateFabric(
    name: string,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return this.create({ name, itemType: "FABRIC" }, userId, {
      pendingReview: true,
    });
  }

  /**
   * Item update — code/itemType değişmez. name, unit ve allowed listeler (replace
   * semantiği) güncellenebilir; `isActive` yaşam döngüsü yazıcısına gider.
   */
  async update(
    id: string,
    rawData: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    // `isActive` genel güncellemenin skaler geçişinden ÇIKAR (BaseController'da yeni
    // skaler = yazılabilir alan kuralı): false = "Pasif'e geç" (kapılı), true = "Aktif'e dön".
    const { isActive, ...data } = (rawData ?? {}) as Record<string, unknown>;
    if (isActive !== undefined) {
      if (typeof isActive !== "boolean") throw AppError.badRequest("'isActive' true/false olmalı");
      const res = await this.transitionLifecycle(
        id,
        isActive ? ItemLifecycleStatus.ACTIVE : ItemLifecycleStatus.ARCHIVED,
        null,
        userId,
      );
      if (Object.keys(data).length === 0) return res;
    }
    const FORBIDDEN = ["code", "itemType"];
    for (const k of FORBIDDEN) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        throw AppError.badRequest(
          `'${k}' alanı güncellenemez. Yeni bir ürün tanımlayın.`,
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, "warpSpecId")) {
      const cur = await prisma.item.findUnique({ where: { id }, select: { itemType: true } });
      await assertWarpSpecAssignable(cur?.itemType, data.warpSpecId as string | null | undefined);
    }

    // name güncelleniyorsa length + trim kontrolü
    if (data.name !== undefined) {
      const validated = validateName(data.name, {
        label: "Ürün ismi",
        required: true,
        maxLen: ITEM_NAME_MAX_LEN,
      });
      if (typeof validated === "string") data.name = validated;
      // Saha #13: ürün adları HEPSİ BÜYÜK (tr).
      if (typeof data.name === "string") {
        data.name = normalizeItemName(data.name);
      }
    }

    const allowedColorIds = data.allowedColorIds as string[] | undefined;
    const allowedPropertyIds = data.allowedPropertyIds as string[] | undefined;
    // M-4/F208: bu dal super.update'i (dolayısıyla sanitizeWriteData'yı) atladığı
    // için restData'yı burada aynı beyaz listeden geçir — ham gövdeden gelen nested
    // ilişki-write'ları (ör. {"rolls":{"deleteMany":{}}}) doğrudan Prisma'ya
    // geçmesin, yalnız gerçek scalar kolonlar (name/unit/isActive) kalsın.
    const restData = this.sanitizeWriteData({ ...data });
    delete restData.allowedColorIds;
    delete restData.allowedPropertyIds;

    const hasListReplace =
      allowedColorIds !== undefined || allowedPropertyIds !== undefined;
    if (!hasListReplace) {
      return super.update(id, restData, userId);
    }

    // Ad-mükerrer koruması: bu dal super.update'i atladığından base kancası elle —
    // yalnız ad gerçekten değişiyorsa (tarihsel mükerrer kayıt düzenlenebilir kalsın).
    if (typeof restData.name === "string") {
      const current = await prisma.item.findUnique({
        where: { id },
        select: { name: true },
      });
      // Kayıt yoksa kontrol atlanır — tx'teki update not-found ile düşsün.
      if (
        current &&
        foldNameForCompare(restData.name) !== foldNameForCompare(current.name)
      ) {
        await this.assertNameNotDuplicate(restData, id);
      }
    }

    // M-23: replace edilen listeler create() ile AYNI doğrulamadan geçer —
    // pasif/var-olmayan renk veya özellik izinli listeye sokulamaz (eskiden
    // doğrulamasızdı; var olmayan id ham P2003'e düşüyordu).
    if (allowedColorIds !== undefined && allowedColorIds.length > 0) {
      const colors = await prisma.color.findMany({
        where: { id: { in: allowedColorIds } },
        select: { id: true, name: true, isActive: true },
      });
      if (colors.length !== allowedColorIds.length) {
        throw AppError.badRequest("Bazı renkler bulunamadı");
      }
      const inactiveColor = colors.find((c) => !c.isActive);
      if (inactiveColor) {
        throw AppError.badRequest(`'${inactiveColor.name}' rengi pasif`);
      }
    }
    if (allowedPropertyIds !== undefined && allowedPropertyIds.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: allowedPropertyIds } },
        select: { id: true, name: true, isActive: true },
      });
      if (props.length !== allowedPropertyIds.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı");
      }
      const inactiveProp = props.find((p) => !p.isActive);
      if (inactiveProp) {
        throw AppError.badRequest(`'${inactiveProp.name}' özelliği pasif`);
      }
      // SEÇİM tipli özellik ürün izinli-listesine giremez (denetim Q2): o liste
      // hedef seçicilerin evrenidir ve SEÇİM oralara zaten çıkamaz — listede
      // durması yalnız kafa karıştırır, allowed-parite kontrollerini bozar.
      await assertTargetablePropertyIds(allowedPropertyIds, "ürün izinli özelliği");
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (allowedColorIds !== undefined) {
        await tx.itemAllowedColor.deleteMany({ where: { itemId: id } });
        if (allowedColorIds.length > 0) {
          await tx.itemAllowedColor.createMany({
            data: allowedColorIds.map((colorId) => ({ itemId: id, colorId })),
          });
        }
      }
      if (allowedPropertyIds !== undefined) {
        await tx.itemAllowedProperty.deleteMany({ where: { itemId: id } });
        if (allowedPropertyIds.length > 0) {
          await tx.itemAllowedProperty.createMany({
            data: allowedPropertyIds.map((propertyId) => ({ itemId: id, propertyId })),
          });
        }
      }
      return tx.item.update({
        where: { id },
        data: restData as Record<string, unknown>,
        include: {
          allowedColors: { include: { color: true } },
          allowedProperties: { include: { property: true } },
        },
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      newData: {
        ...restData,
        ...(allowedColorIds !== undefined ? { allowedColorIds } : {}),
        ...(allowedPropertyIds !== undefined ? { allowedPropertyIds } : {}),
      },
    });

    return { success: true, data: updated, message: "Kayıt güncellendi" };
  }

  /**
   * Tek bir rengi ürünün izinli listesine ekle. Mevcutsa idempotent (zaten dahil).
   * UI'da "Listeden Dahil Et" akışı için — tüm allowedColorIds göndermek yerine
   * tek satır insert, race condition riski yok.
   */
  async addAllowedColor(
    itemId: string,
    colorId: string,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    // İzinli renk karta yeni TANIM ekler (B) — "Tükenene kadar"/Pasif kartta kapalı.
    await assertItemUsable(prisma, itemId, "DEFINITION");
    const [color, existing] = await Promise.all([
      prisma.color.findUnique({
        where: { id: colorId },
        select: { id: true, name: true, isActive: true },
      }),
      prisma.itemAllowedColor.findUnique({
        where: { itemId_colorId: { itemId, colorId } },
        include: { color: true },
      }),
    ]);

    if (!color) {
      throw AppError.notFound("Renk bulunamadı");
    }
    if (!color.isActive) {
      throw AppError.badRequest(`'${color.name}' rengi pasif`);
    }

    if (existing) {
      return { success: true, data: existing, message: "Renk zaten dahil" };
    }

    // F214: upsert — eşzamanlı çift-istekte P2002 yerine mevcut satır idempotent döner.
    const created = await prisma.itemAllowedColor.upsert({
      where: { itemId_colorId: { itemId, colorId } },
      create: { itemId, colorId },
      update: {},
      include: { color: true },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: itemId,
      newData: { allowedColorAdded: colorId },
    });

    return { success: true, data: created, message: "Renk dahil edildi" };
  }

  /**
   * Tek bir özelliği ürünün izinli listesine ekle. Mevcutsa idempotent.
   */
  async addAllowedProperty(
    itemId: string,
    propertyId: string,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    // İzinli özellik karta yeni TANIM ekler (B).
    await assertItemUsable(prisma, itemId, "DEFINITION");
    const [property, existing] = await Promise.all([
      prisma.fabricProperty.findUnique({
        where: { id: propertyId },
        select: { id: true, name: true, isActive: true },
      }),
      prisma.itemAllowedProperty.findUnique({
        where: { itemId_propertyId: { itemId, propertyId } },
        include: { property: true },
      }),
    ]);

    if (!property) {
      throw AppError.notFound("Özellik bulunamadı");
    }
    if (!property.isActive) {
      throw AppError.badRequest(`'${property.name}' özelliği pasif`);
    }

    if (existing) {
      return { success: true, data: existing, message: "Özellik zaten dahil" };
    }

    // F214: upsert — eşzamanlı çift-istekte P2002 yerine mevcut satır idempotent döner.
    const created = await prisma.itemAllowedProperty.upsert({
      where: { itemId_propertyId: { itemId, propertyId } },
      create: { itemId, propertyId },
      update: {},
      include: { property: true },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: itemId,
      newData: { allowedPropertyAdded: propertyId },
    });

    return { success: true, data: created, message: "Özellik dahil edildi" };
  }

  /** Yaşam döngüsü kolonları gövdeden YAZILAMAZ — tek yazar `transitionLifecycle`. */
  protected sanitizeWriteData(data: Record<string, unknown>): Record<string, unknown> {
    const out = super.sanitizeWriteData(data);
    for (const k of LIFECYCLE_COLUMNS) delete out[k];
    return out;
  }

  /** `DELETE /items/:id` = "Pasif'e geç" (kapılı: canlı referans varsa 409 + kayıt listesi). */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    return this.transitionLifecycle(id, ItemLifecycleStatus.ARCHIVED, null, userId);
  }

  /** Durum geçişi — tek yazar + audit. Hedef durumdaki karta ikinci istek yazmadan döner. */
  async transitionLifecycle(
    id: string,
    to: ItemLifecycleStatus,
    reason: string | null,
    userId?: string,
  ): Promise<ApiResponse<unknown> & { idempotent?: boolean }> {
    const result: ItemLifecycleTransitionResult = await transitionItemLifecycle({
      itemId: id,
      to,
      reason,
      userId: userId ?? null,
    });
    const item = await prisma.item.findUnique({
      where: { id },
      ...(this.config.defaultInclude ? { include: this.config.defaultInclude } : {}),
    });
    return {
      success: true,
      data: item,
      idempotent: result.idempotent,
      message: result.idempotent
        ? `Kart zaten '${ITEM_LIFECYCLE_LABEL[to]}' durumunda`
        : `Kart '${ITEM_LIFECYCLE_LABEL[to]}' durumuna alındı`,
    };
  }

  /**
   * Geçiş önizlemesi — canlı referansları TEK TEK döner (yıkıcı işlem kuralı). Arşivde
   * `canTransition` = canlı referans 0. Benzer adlı AKTİF kartlar yalnız BİLGİDİR (D4:
   * birleştirme asla otomatik değildir).
   */
  async lifecyclePreview(id: string, to: ItemLifecycleStatus): Promise<ApiResponse<unknown>> {
    const item = await prisma.item.findUnique({
      where: { id },
      select: { id: true, code: true, name: true, lifecycleStatus: true, mergedIntoId: true },
    });
    if (!item) throw AppError.notFound("Ürün bulunamadı");
    const references = await listItemLiveRefs(prisma, id);
    const liveTotal = totalLiveRefs(references);
    const similar = (await this.findSimilarNames(item.name, { excludeId: id, limit: 5 }))
      .filter((s) => s.isActive && !s.mergedIntoName);
    const canTransition =
      item.mergedIntoId === null &&
      item.lifecycleStatus !== to &&
      (to !== ItemLifecycleStatus.ARCHIVED || liveTotal === 0);
    return {
      success: true,
      data: {
        item: { ...item, lifecycleLabel: ITEM_LIFECYCLE_LABEL[item.lifecycleStatus] },
        to,
        toLabel: ITEM_LIFECYCLE_LABEL[to],
        canTransition,
        liveTotal,
        references,
        similarActive: similar.map((s) => ({ id: s.id, code: s.code, name: s.name, score: s.score })),
      },
    };
  }

  /** Kartın kalan canlı referans sayısı (liste rozeti "Tükenene kadar · N top kaldı" / "Pasife hazır"). */
  async liveRefCounts(id: string) {
    return countItemLiveRefs(prisma, id);
  }

  /**
   * KALICI SİLME guard'ı (A5, 2026-07-31 denetimi): `work_orders.targetItemId`
   * FK'sı ON DELETE SET NULL → generic hardDelete'in P2003 yakalayıcısı bu
   * bağı GÖREMEZ ve WO'nun "ne üretiyorduk" izi sessizce null'lanırdı. Roll/
   * OrderLine gibi Restrict bağlar P2003 ile zaten bloklanır (super yakalar);
   * yalnız SetNull bağ burada EXPLICIT sayılır (customer.service Sack emsali).
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    const existing = await prisma.item.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return { success: false, data: null, message: "Kumaş bulunamadı" };

    const woCount = await prisma.workOrder.count({ where: { targetItemId: id } });
    if (woCount > 0) {
      throw AppError.conflict(
        `Bu kumaşı hedefleyen ${woCount} iş emri var — kalıcı silinemez. Kumaşı pasife alın.`,
      );
    }
    return super.hardDelete(id, userId);
  }
}
