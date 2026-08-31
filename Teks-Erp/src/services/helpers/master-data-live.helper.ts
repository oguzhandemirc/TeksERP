// =============================================================================
// ANA VERİ CANLI MI — yazma anında, KİLİT ALTINDA (BULGU-T3-007)
// =============================================================================
// `Roll.itemId` / `Roll.colorId` **CANLI** bir ana veri satırını göstermelidir.
// "Canlı" = var · `isActive` · `mergedIntoId IS NULL` (mezar taşı değil).
//
// SORUN: bu kontrol yazma yollarında transaction'ın DIŞINDA yapılıyordu. Ölçülen
// yarış (repro `audit_repro_S-1-03`, 4 kırmızı):
//
//   T1 KK1 (tablet): `item.findUnique` → aktif ✓, mezar taşı değil ✓  (tx DIŞI)
//   T2 Panel:        birleştirme başlar, `pg_advisory_xact_lock(8027)` alınır
//   T3 Panel:        `UPDATE rolls SET itemId=SURVIVOR WHERE itemId=LOSER`
//   T4 Panel:        `UPDATE items SET mergedIntoId=SURVIVOR, isActive=false`
//   T5 Panel:        COMMIT — "38 top taşındı"
//   T6-T8 KK1:       tx açılır, barkod alınır, `INSERT rolls (itemId=LOSER)`
//
// Sonuç: 39. top MEZAR TAŞI kumaşa bakar. Top canlıdır, barkodludur, envanter
// toplamına girer — ama ürün filtresinde, Ürün Dengesi'nde ve sipariş
// karşılamada HİÇ GÖRÜNMEZ (o yüzeyler `mergedIntoId IS NULL` süzer).
// Birleştirmenin taşıma turu (T3) o satırı GÖREMEZDİ: henüz yoktu.
//
// ⚠️ BU YENİ BİR KISIT DEĞİL. Pasif ürünle giriş ZATEN reddediliyordu
// (`inventory.service`: "Ürün var VE aktif olmalı"). Değişen tek şey, aynı
// kuralın kilit altında TEKRARLANMASI — yani sahada yapılabilen hiçbir şey
// yapılamaz hâle gelmiyor, yalnız dar bir pencerede sessizce kaybolan top artık
// net bir hatayla karşılanıyor.
//
// Desen yeni icat DEĞİL: `subcontractor.service`in parti (`Batch`) mezar taşı
// kontrolü (K17) birebir aynı şeyi yapıyor — orada da ön-guard tx dışında koşar
// ve tx içinde tekrarlanır.
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { MERGE_LOCK_KEY, MERGE_LOCK_NS } from "../master-data-merge.service";

/** `prisma` ya da bir `$transaction` istemcisi. */
type Istemci = Prisma.TransactionClient;

export interface CanliAnaVeriRefs {
  itemId?: string | null;
  colorId?: string | null;
}

/**
 * Birleştirme ile SERİLEŞTİR — PAYLAŞIMLI advisory kilit.
 *
 * ⚠️ TEK BAŞINA TAZE OKUMA YETMEZ, ÖLÇÜLDÜ: `assertMasterDataLiveTx` eklendikten
 * sonra repro'nun §1'i (deterministik mezar taşı) YEŞİLE döndü ama §2'si
 * (eşzamanlı birleştirme) 12 turun 3'ünde HÂLÂ kırmızıydı. Sebebi basit ve
 * öğretici: yazma tx'i açıldığında birleştirme henüz COMMIT ETMEMİŞTİR, yani
 * taze okuma da onu göremez. Görülemeyen bir şeye karşı kontrol yazılamaz —
 * iki işlemin BİRBİRİNİ BEKLEMESİ gerekir.
 *
 * Birleştirme `pg_advisory_xact_lock(8027, 1)` ile EXCLUSIVE alır. Yazma yolları
 * aynı anahtarı SHARED alır:
 *   • yazıcılar birbirini ENGELLEMEZ (paylaşımlı ↔ paylaşımlı uyumlu) → KK1
 *     hacmi etkilenmez,
 *   • birleştirme uçuştaki yazıcıları BEKLER (taşıma turu artık hayalet satır
 *     bırakmaz),
 *   • birleştirme koşarken gelen yazıcı BEKLER, sonra taze okumada mezar taşını
 *     GÖRÜR ve 409 ITEM_MERGED alır — operatöre survivor adı söylenir.
 *
 * Bedeli bilinçli: birleştirme ayda bir yapılan, saniyeler süren bir işlem;
 * o sırada bir KK1 girişi kısa süre bekler. Karşılığında hiçbir top sessizce
 * kaybolmaz.
 */
export async function lockAgainstMergeTx(tx: Istemci): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(${MERGE_LOCK_NS}::int, ${MERGE_LOCK_KEY}::int)`;
}

/**
 * Kilit altında taze doğrulama. Yazmadan HEMEN ÖNCE çağrılır.
 *
 * ⚠️ `null`/`undefined` referans ATLANIR — renk opsiyoneldir ve "renk verilmedi"
 * bir hata değildir. Kontrol yalnız GÖNDERİLEN referansa uygulanır.
 *
 * ⚠️ Mesaj SURVIVOR'ın adını taşır: operatör "bulunamadı" değil "bu kumaş X ile
 * birleştirildi, X'i seçin" okumalı — aksi hâlde aynı hatayı tekrar dener.
 */
export async function assertMasterDataLiveTx(
  tx: Istemci,
  refs: CanliAnaVeriRefs,
): Promise<void> {
  if (refs.itemId) {
    const item = await tx.item.findUnique({
      where: { id: refs.itemId },
      select: {
        name: true,
        isActive: true,
        mergedIntoId: true,
        mergedInto: { select: { name: true } },
      },
    });
    if (!item) throw AppError.notFound("Kumaş bulunamadı");
    if (item.mergedIntoId) {
      throw AppError.conflict(
        `"${item.name}" kumaşı, "${item.mergedInto?.name ?? "başka bir kayıt"}" ile ` +
          "birleştirildi. Kaydı o kumaşla yeniden girin.",
        { code: "ITEM_MERGED", survivorName: item.mergedInto?.name ?? null },
      );
    }
    if (!item.isActive) {
      throw AppError.conflict(
        `"${item.name}" kumaşı pasif duruma alındı — bu kumaşla yeni kayıt açılamaz.`,
        { code: "ITEM_INACTIVE" },
      );
    }
  }

  if (refs.colorId) {
    const color = await tx.color.findUnique({
      where: { id: refs.colorId },
      select: {
        name: true,
        isActive: true,
        mergedIntoId: true,
        mergedInto: { select: { name: true } },
      },
    });
    if (!color) throw AppError.notFound("Renk bulunamadı");
    if (color.mergedIntoId) {
      throw AppError.conflict(
        `"${color.name}" rengi, "${color.mergedInto?.name ?? "başka bir kayıt"}" ile ` +
          "birleştirildi. Kaydı o renkle yeniden girin.",
        { code: "COLOR_MERGED", survivorName: color.mergedInto?.name ?? null },
      );
    }
    if (!color.isActive) {
      throw AppError.conflict(
        `"${color.name}" rengi pasif duruma alındı — bu renkle yeni kayıt açılamaz.`,
        { code: "COLOR_INACTIVE" },
      );
    }
  }
}
