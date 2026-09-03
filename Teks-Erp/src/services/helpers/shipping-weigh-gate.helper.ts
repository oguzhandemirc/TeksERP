// =============================================================================
// ÇUVAL TARTISI — İKİ KAPI, TEK YER (`weighRequired` + `manualWeightRestricted`)
// =============================================================================
// İkisi de Sevkiyat & Depo ÇEKİRDEK bloğuna aittir: arkalarında modül anahtarı
// YOKTUR → düz okuyucu, resolver YOK (§3.6 tek-resolver kuralı ebeveyni olan
// bayraklar içindir; burada mekanik uygulamak ölü bir `modulAcik` sabiti doğurur).
//
// ⚠️ İKİSİ BİRDEN AÇIK + o yerde kantar TANIMLI DEĞİL = operatör ne tartabilir
// ne elle girebilir (ölü kilit). Panel bunu ENGELLEMEZ (bağımlılık 400'ü
// yazılmadı): kombinasyon bir kurulum kararıdır ve fabrikanın kantarı olup
// olmadığını sunucu bilemez. Reçete/panel metni bunu açıkça söyler.
// =============================================================================
import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { matchesPermission } from "../../middlewares/rbac.middleware";
import { ShipmentDestination } from "@prisma/client";

/** Sevkiyat çuvallarının tartı kontrolü için gereken en dar şekil. */
export type WeighableSack = { sackNo?: string | null; weightKg: Prisma.Decimal | null };

/**
 * "Bu sevkiyatın çuvalları tartılı mı" — `assertExportWeighed`'in genelleşmiş hâli.
 *
 * ⚠️ İHRACAT DALI BAYRAKTAN BAĞIMSIZ. Bayrak yalnız GENİŞLETİR (yurtiçini de
 * kapsama alır), asla GEVŞETMEZ: `destination !== EXPORT` koşulunu bayrağa
 * bağlamak, gümrük/mevzuat kuralını bir ayara bağlamak olurdu (tasarım §11'in
 * "bayraklanmayacaklar" listesi).
 *
 * Bayrak değeri PARAMETRE olarak gelir — çağıran yerde BİR KEZ okunur. İkinci
 * bir okuma noktası açmak, aynı istek içinde iki farklı cevap alma yolunu açardı.
 *
 * Hata makine-okunur `WEIGH_REQUIRED` kodu + TARTISIZ ÇUVAL LİSTESİ taşır:
 * operatörün yapacağı iş "hangi çuvalı tartayım" sorusunun cevabıdır.
 */
export function assertSacksWeighed(
  sacks: WeighableSack[],
  destination: ShipmentDestination,
  weighRequired: boolean,
): void {
  const isExport = destination === ShipmentDestination.EXPORT;
  if (!isExport && !weighRequired) return;
  const unweighed = sacks.filter(
    (s) => s.weightKg == null || !new Prisma.Decimal(s.weightKg).greaterThan(0),
  );
  if (unweighed.length === 0) return;
  const sackNos = unweighed.map((s) => s.sackNo ?? "—");
  const liste = sackNos.slice(0, 8).join(", ") + (sackNos.length > 8 ? " · …" : "");
  throw AppError.badRequest(
    isExport
      ? `Yurtdışı sevkte tüm çuvallar tartılı olmalı — ${unweighed.length} çuval tartısız: ${liste}`
      : `Bu kurulumda sevk öncesi tüm çuvallar tartılmalı — ${unweighed.length} çuval tartısız: ${liste}. ` +
          "Çuvala sonradan top eklendiyse tartı SIFIRLANIR; yeniden tartın.",
    { code: "WEIGH_REQUIRED", sackNos },
  );
}

/**
 * ELLE tartı yazma kapısı (`weightSource = MANUAL`).
 *
 * F221 DESENİ: `permissions` verilmezse enforcement ATLANIR — dahili çağrılar
 * (servis→servis, script, job) kırılmaz; kapı yalnız HTTP yolundan geçen, gerçek
 * bir kimliği olan isteklere uygulanır.
 *
 * ⚠️ YENİ İZİN KODU YOK. 2026-08-01 kurşun-bypass dersi: yeni izin boot
 * uzlaştırmasıyla DB'ye gelir ama KİMSEYE ATANMAZ → bayrak açılır, elle tartı
 * herkeste kapanır ve sebep hiçbir yerde yazmaz. Ayrım MEVCUT izinlerle
 * kurulur: `shipping:write` (panel/sevkiyat sorumlusu) serbest, yalnız
 * `mobile:tarti-paket`/`mobile:sevkiyat` taşıyan tablet operatörü kantara
 * yönlendirilir.
 *
 * ⚠️ İKİ YAZMA YOLU DA BURADAN GEÇER (`weighSack` + `openSack` gövdesindeki
 * `weightKg`). Yalnız birine konsaydı bayrak fail-open olur — ve daha kötüsü, o
 * yoldan yazılan kg `weightSource = MANUAL` olduğu için raporda "elle girildi"
 * sayılır ama hiçbir kapıdan geçmemiş olurdu (izlenebilirlik yalanı).
 */
export function assertManualWeightAllowed(p: {
  restricted: boolean;
  permissions?: string[];
}): void {
  if (!p.restricted) return;
  if (!p.permissions) return; // F221 — dahili çağrı
  if (matchesPermission(p.permissions, "shipping:write")) return;
  throw AppError.forbidden(
    "Bu kurulumda çuval tartısı elle girilemez — kantardan tartın. Kantar yoksa/arızalıysa " +
      "sevkiyat sorumlusuna iletin (elle giriş yetkisi onda).",
    { code: "MANUAL_WEIGHT_RESTRICTED" },
  );
}
