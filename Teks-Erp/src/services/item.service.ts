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
import { ItemUnit } from "@prisma/client";
import { AuditService } from "./audit.service";
import { BaseService } from "./base.service";
import { ApiResponse } from "../types/api.types";
import { AppError } from "../utils/app-error";
import { validateName, validateCode } from "../lib/string-validators";
import {
  normalizeItemName,
  foldNameForCompare,
} from "./helpers/name-normalize.helper";
import { nextDailySeq } from "../utils/code-format";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { assertTargetablePropertyIds } from "./helpers/targetable-property.helper";
import {
  decideCodeUniqueness,
  lockCodeScopeTx,
  type CodeCandidate,
  type CodeUniquenessTexts,
} from "./helpers/code-unique.helper";

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
/** Sayaç taramasında kabul edilen otomatik kod biçimi: en çok 12 hane —
 * parseInt sonucu her zaman Number.MAX_SAFE_INTEGER altında kalır; legacy/elle
 * girilmiş dev sayılı bir STK- kaydı float taşmasıyla max+1 === max yapıp
 * sayacı kilitleyemez. */
const ITEM_CODE_SCAN_RE = /^STK-\d{1,12}$/;

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
  const rows = await prisma.item.findMany({
    where: { code: { gte: ITEM_CODE_PREFIX, startsWith: ITEM_CODE_PREFIX } },
    select: { code: true },
  });
  const seq = nextDailySeq(
    rows.map((r) => r.code).filter((c) => ITEM_CODE_SCAN_RE.test(c)),
    ITEM_CODE_PREFIX,
  );
  return `${ITEM_CODE_PREFIX}${String(seq).padStart(ITEM_CODE_DIGITS, "0")}`;
}

export class ItemService extends BaseService {
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
            // Atomik claim: diriltme yalnız hâlâ pasifse — eşzamanlı ikinci istek
            // count=0 görüp 409 alır (findFirst→if→update check-then-act yasağı).
            const claimed = await tx.item.updateMany({
              where: { id: target.id, isActive: false },
              data: { isActive: true },
            });
            if (claimed.count === 0) {
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
              isActive: input.isActive ?? true,
              // Denye YALNIZ gönderildiğinde yazılır: `undefined` kolonu olduğu
              // gibi bırakır, `null` bilinçli temizlemedir (metin → Decimal).
              ...(input.linearDensityDen !== undefined
                ? { linearDensityDen: input.linearDensityDen }
                : {}),
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
   * Item update — code/itemType değişmez. name, unit, isActive ve allowed
   * listeler (replace semantiği) güncellenebilir.
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const FORBIDDEN = ["code", "itemType"];
    for (const k of FORBIDDEN) {
      if (Object.prototype.hasOwnProperty.call(data, k)) {
        throw AppError.badRequest(
          `'${k}' alanı güncellenemez. Yeni bir ürün tanımlayın.`,
        );
      }
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
    const [item, color, existing] = await Promise.all([
      prisma.item.findUnique({
        where: { id: itemId },
        select: { id: true, isActive: true },
      }),
      prisma.color.findUnique({
        where: { id: colorId },
        select: { id: true, name: true, isActive: true },
      }),
      prisma.itemAllowedColor.findUnique({
        where: { itemId_colorId: { itemId, colorId } },
        include: { color: true },
      }),
    ]);

    if (!item || !item.isActive) {
      throw AppError.notFound("Ürün bulunamadı veya pasif");
    }
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
    const [item, property, existing] = await Promise.all([
      prisma.item.findUnique({
        where: { id: itemId },
        select: { id: true, isActive: true },
      }),
      prisma.fabricProperty.findUnique({
        where: { id: propertyId },
        select: { id: true, name: true, isActive: true },
      }),
      prisma.itemAllowedProperty.findUnique({
        where: { itemId_propertyId: { itemId, propertyId } },
        include: { property: true },
      }),
    ]);

    if (!item || !item.isActive) {
      throw AppError.notFound("Ürün bulunamadı veya pasif");
    }
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
