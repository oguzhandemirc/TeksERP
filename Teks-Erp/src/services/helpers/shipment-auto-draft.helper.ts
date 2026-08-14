// =============================================================================
// SEVK SONRASI KANCA — OTOMATİK SATIŞ FATURASI TASLAĞI
// =============================================================================
// Bayrak: `finance.autoDraftFromShipmentEnabled` (varsayılan KAPALI → bugünkü
// davranış BAYT-BAYT korunur: tek ek sorgu bile koşmaz, çünkü ilk kapı
// `financeEnabled`, ikincisi bu bayraktır ve ikisi de kapalıyken hiçbir şey
// yapılmaz).
//
// ⚠️ BU DOSYA NEDEN `shipping.service`İN İÇİNDE DEĞİL — İKİ YAPISAL SEBEP:
//  ① `shipping.routes` bir FABRİKA router'ıdır ve rejim kapısı TAŞIYAMAZ
//     (fabrikada sevkiyat `finance.enabled`a bağlanamaz). `invoice.service`i
//     shipping'e STATİK import etmek, `test_finance_regime_gate`in türetilmiş
//     kapsamında shipping + return router'larını "ticarete dokunuyor" yapar —
//     ve bekçi HAKLIDIR: statik kenar, modül yüklenince gerçekten kurulur.
//     Kanca bu yüzden buradan `await import(...)` ile YÜKLENİR (aşağıdaki
//     wrapper'a bak): fabrika sürecinde bayrak kapalıyken bu modül hiç
//     yüklenmez, statik graf da temiz kalır. Bu bir "bekçiden kaçış" değil
//     GERÇEĞİN kendisidir — davranış çift bayrak kapısıyla (financeEnabled →
//     autoDraft) korunuyor ve kendi bekçisi var (`test_auto_draft_shipment`,
//     §4 modül şalteri dahil).
//  ② `invoice.service` ↔ `shipping.service` arasında statik çift yön, modül-init
//     sırasını sessizce kırabilirdi (invoice tarafının böyle bir importu bugün
//     yok ama yarın doğabilir). Dinamik yükleme bu döngü sınıfını kökten kapatır.
//
// ÜRETİLEN ŞEY TASLAKTIR (`InvoiceStatus.DRAFT`) — onay HER ZAMAN elle kalır.
// Bayrak "fatura kes" demez, "muhasebeci ürün/metraj dökümünü ikinci kez elle
// yazmasın" der; panelin `ShipmentInvoiceDraft` diyaloğunun yaptığı işin
// sunucu tarafındaki eşleniğidir (aynı kırılım, aynı satır anlayışı).
//
// ⚠️ SEVK ASLA TASLAK YÜZÜNDEN DÜŞMEZ. Kanca sevk TX'inin İÇİNDE DEĞİL,
// ondan SONRA ayrı bir adımda koşar ve tüm hataları yutar (warn log + yanıt
// mesajına kısa not). Gerekçe operasyoneldir: mal kamyonda, kapıda; muhasebe
// otomasyonunun bir kur satırı eksik diye çıkışı durdurması kabul edilemez.
// Aynı sebeple tx İÇİNE de alınamaz — `createDraft` kendi transaction'ını
// açar (iç içe tx) ve orada patlayan bir hata sevk tx'ini geri sarardı.
//
// ⚠️ DIRECT SEVKLER (fasondan doğrudan sevk / `DirectShipment`) KAPSAM DIŞI
// ve bu bilinçlidir: o dünyada karşı taraf müşteri değil FASONCUdur, belge
// zinciri ayrıdır (`SUBCONTRACTOR_DIRECT_SHIP`) ve fatura tipi de satış
// olmayabilir. `Invoice.directShipmentId` bağı ile kendi partial unique'i
// duruyor — orası ayrı bir karar (ve ayrı bir bayrak) ister.
// =============================================================================

import { Currency, InvoiceStatus, InvoiceType, PriceKind, Prisma, ShipmentStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { invoiceService } from "./../invoice.service";
import { resolveItemPricesFor } from "./../item-price.service";
import {
  readFinanceAutoDraftFromShipmentEnabled,
  readFinanceDefaultVatRate,
  readFinanceEnabled,
} from "./../system-setting.service";
import { D0 } from "./allocation.helper";
import { SACK_ABSENT_STATUSES } from "./sack-invariants.helper";

/**
 * Sevk edilmiş bir sevkiyattan SATIŞ faturası taslağı satırları.
 *
 * ⚠️ SATIR = ÜRÜN KIRILIMI, TOP DEĞİL (`ShipmentInvoiceDraft` emsali): fatura
 * kalemi ticari birimdir; 40 topu 40 satır yazmak faturayı okunmaz yapar ve
 * müşteri de öyle beklemez. Top dökümü zaten irsaliyede / çeki listesinde.
 *
 * ⚠️ AÇIKLAMA METNİ `collectShipmentDocContent`'in ürün özetiyle BİREBİR
 * AYNI biçimde kurulur (`[ürün, renk, "Ncm."].filter(Boolean).join(" ")`) —
 * muhasebeci faturayı sevk fişinin yanına koyup satır satır karşılaştırıyor;
 * iki yüzeyin aynı malı farklı adlandırması "eksik/fazla mı" sorusunu
 * doğurur. Biçim orada değişirse BURASI DA değişmeli (bekçide kilitli).
 *
 * ⚠️ NEDEN FİŞTEN (`getDispatchReport`) OKUNMUYOR: o yüzey donmuş
 * snapshot'tan besleniyor ve `products[]` yalnız METİN taşıyor — `itemId`
 * YOK, yani fiyat çözülemez ve satır kalem kartına bağlanamaz. Sınıf 5 (tek
 * kaynak satır kuralı) gereği doğru çözüm ürün özetini `itemId` taşıyan ortak
 * bir assembler'a çıkarmaktır; o, donmuş belge şeklini de değiştirdiği için
 * ayrı bir karardır (dikiş ihtiyacı olarak raporlandı). O gün geldiğinde
 * BURASI o assembler'ı çağırmalı, ikinci bir gruplama yaşamamalı.
 *
 * ⚠️ İADE GERİ-EKLEMESİ (brüt kuralı, 2026-08-05) BURADA YOK ve gerekmiyor:
 * kanca sevkten milisaniyeler sonra koşar, iade ise `roll.status = SHIPPED`
 * isteyen AYRI bir kullanıcı işlemidir — bu pencerede `RollReturn` doğamaz.
 * Kanca ileride "sonradan da çalışabilen" bir yere taşınırsa brüt kuralı
 * (iptal edilmemiş `RollReturn` satırlarının `prevSackId` ile geri eklenmesi)
 * ZORUNLU hale gelir.
 *
 * ⚠️ MİKTARIN BİRİMİ DEFTERİN BİRİMİDİR ("m"), kalem kartının `unit`'i DEĞİL:
 * kırılım `Roll.currentQty` (metre) topluyor. Kartta "MT"/"KG" yazıyor diye
 * o etiketi basmak, deftere metre yazıp faturaya kg bastırmak olurdu — aynı
 * gerekçe `createDraftFromGoodsReceipt`'in iplik satırındaki sabit "kg"da da
 * yazılı.
 */
async function collectShipmentInvoiceDraftLines(
  shipmentId: string,
  customerId: string,
  currency: Currency,
): Promise<Array<{ itemId: string; description: string; qty: Prisma.Decimal; unit: string; unitPrice: Prisma.Decimal; vatRate: number }>> {
  // Hayalet toplar DIŞARIDA — resmi belgenin (`collectShipmentDocContent`)
  // kullandığı kümenin AYNISI. `SHIPPED` bu kümede YOK, yani sevk edilmiş
  // toplar sayılır (sack-invariants.helper başlığı).
  const rolls = await prisma.roll.findMany({
    where: { shipmentId, status: { notIn: SACK_ABSENT_STATUSES } },
    select: {
      itemId: true,
      currentQty: true,
      width: true,
      item: { select: { name: true } },
      color: { select: { name: true } },
    },
  });
  if (rolls.length === 0) return [];

  // Gruplama anahtarı `itemId` + görünen ad. Ad TEK BAŞINA anahtar olamaz:
  // fiyat kalem KARTINDAN çözülüyor ve aynı ada sahip iki farklı kart tek
  // satırda toplanırsa ortalama bir fiyat uydurmak zorunda kalırdık (aynı
  // kural `createDraftFromGoodsReceipt`'in fiyat-dahil anahtarında da var).
  const groups = new Map<string, { itemId: string; description: string; qty: Prisma.Decimal }>();
  for (const r of rolls) {
    const widthStr = r.width != null ? `${Number(r.width)}cm.` : "";
    const description = [r.item.name, r.color?.name ?? "", widthStr].filter(Boolean).join(" ");
    const key = `${r.itemId}|${description}`;
    const existing = groups.get(key);
    if (existing) existing.qty = existing.qty.plus(r.currentQty);
    else groups.set(key, { itemId: r.itemId, description, qty: D0().plus(r.currentQty) });
  }

  // FİYAT — D2 çözüm zinciri (müşteri istisnası > kart varsayılanı). TEK
  // sorgu (perf kuralı 9). Çözülemeyen kalem `0` ile geçer ve bu BİLİNÇLİ:
  // `confirm` sıfır fiyatlı satırı zaten REDDEDİYOR, yani muhasebeci taslağı
  // onaylamaya çalıştığında uyarıyı görür. Buradan uydurma bir fiyat üretmek
  // o tek uyarıyı susturur ve cari defteri sessizce yanlışlardı — aynı karar
  // `createDraftFromGoodsReceipt`'te de yazılı.
  // ⚠️ Fiyat KALEM bazlıdır: `ItemPrice` renk/en taşımaz, dolayısıyla aynı
  // kalemin farklı renk/en varyantları aynı fiyatı alır. Renk bazlı fiyat
  // gerekirse çözüm burada `find` yazmak değil `ItemPrice` modelini
  // genişletmektir.
  const priceMap = await resolveItemPricesFor({
    itemIds: [...new Set([...groups.values()].map((g) => g.itemId))],
    kind: PriceKind.SALE,
    currency,
    customerId,
  });

  // KDV oranı firma parametresinden — panel fatura formunun yeni satırı ve
  // mal kabul taslağı da AYNI ayardan okur (oran üç yerde ayrı sürüklenmez).
  const vatRate = await readFinanceDefaultVatRate();

  return [...groups.values()].map((g) => ({
    itemId: g.itemId,
    description: g.description,
    qty: g.qty,
    unit: "m",
    unitPrice: priceMap.get(g.itemId)?.price ?? D0(),
    vatRate,
  }));
}

/**
 * SEVK ONAYI SONRASI OTOMATİK TASLAK — üç dispatch yolunun ORTAK kancası.
 *
 * Çağıranlar (`shipping.service` wrapper'ı üzerinden): `dispatchShipment`
 * (sevk onayı açıkken) · `createShipment` ve `createShipmentFromRolls` (onay
 * kapalıyken aynı adımda sevk edilir). Üçü de ayrı ayrı yazılsaydı biri
 * güncellenip diğeri unutulurdu ve fark en sinsi yerde çıkardı: "çuvaldan
 * sevkte taslak doğuyor, hızlı sevkte doğmuyor".
 *
 * Dönüş: kullanıcıya gösterilecek KISA not (ya da `null` — kanca hiç
 * çalışmadıysa mesaj bugünküyle bayt-bayt aynı kalır).
 *
 * ⚠️ ÇİFT ÜRETİM YAPISAL OLARAK KAPALI, bu kod onu YEDEKLEMEZ: DB'de
 * `invoices_one_active_per_shipment` partial unique'i (WHERE shipmentId IS
 * NOT NULL AND status <> 'CANCELLED') ve `createDraft`'in `assertSourceFree`
 * kontrolü zaten "bir sevkiyat → en çok BİR aktif fatura" diyor. Buradaki ön
 * kontrol yalnız gereksiz iş ve gereksiz uyarı log'unu keser; yarışı kapatan
 * o değil DB seddidir ve yarışın kaybedeni 409'a düşer, o da YUTULUR (kanca
 * idempotenttir — ikinci dispatch/replay ikinci taslak ÜRETMEZ).
 */
export async function autoDraftInvoiceAfterDispatch(
  shipmentId: string,
  userId?: string,
): Promise<string | null> {
  try {
    // ① REJİM KAPILARI — modül şalteri ÜSTTE. `financeEnabled` kapalıyken
    // bayrak açık olsa bile kanca no-op'tur (bayrağın JSDoc sözleşmesi).
    if (!(await readFinanceEnabled())) return null;
    if (!(await readFinanceAutoDraftFromShipmentEnabled())) return null;

    const sh = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: { id: true, shipmentNo: true, customerId: true, status: true, dispatchedAt: true },
    });
    // Sevk edilmemişse taslak üretilmez: taslak "mal çıktı" olayını belgeler.
    if (!sh || sh.status !== ShipmentStatus.DISPATCHED) return null;
    // Şema `customerId`yi NOT NULL tutuyor; kontrol yine de duruyor çünkü
    // sözleşme "müşterisi varken" diyor ve müşterisiz bir cari kurulamaz.
    if (!sh.customerId) return null;

    const existing = await prisma.invoice.findFirst({
      where: { shipmentId: sh.id, status: { not: InvoiceStatus.CANCELLED } },
      select: { id: true },
    });
    if (existing) return null;

    // Para birimi cari kartının ön-dolum tercihinden okunur (`CariAccount.
    // defaultCurrency` şema notu: "fatura/tahsilat formlarının ön-doldurduğu
    // para birimi"). Cari henüz yoksa TRY — `createDraft`in varsayılanıyla
    // aynı. ⚠️ TRY'yi sabitlemek ihracat müşterisinde faturayı yanlış para
    // biriminde doğururdu; kartı okumak da fiyat çözümünü AYNI para birimine
    // bağlar (farklı para birimindeki `ItemPrice` satırı eşleşmez, fiyat 0
    // kalır ve onay seddi devreye girer — sessiz yanlış değil, görünür eksik).
    const cari = await prisma.cariAccount.findUnique({
      where: { customerId: sh.customerId },
      select: { defaultCurrency: true },
    });
    const currency = cari?.defaultCurrency ?? Currency.TRY;

    const lines = await collectShipmentInvoiceDraftLines(sh.id, sh.customerId, currency);
    if (lines.length === 0) return null;

    const res = await invoiceService.createDraft(
      {
        type: InvoiceType.SALES,
        customerId: sh.customerId,
        currency,
        // Tahakkuk tarihi = malın çıktığı an. `new Date()` yazmak, gece
        // yarısını geçen bir sevkte faturayı ertesi güne atardı.
        issueDate: sh.dispatchedAt ?? new Date(),
        notes: `${sh.shipmentNo} sevkiyatından üretildi.`,
        shipmentId: sh.id,
        lines,
      },
      userId,
    );
    return `${res.data.docNo} fatura taslağı oluşturuldu`;
  } catch (err) {
    // ② HATA YUTULUR — sevk zaten COMMIT oldu, geri sarılacak bir şey yok.
    // 409 = yarışın kaybedeni ya da tekrar (idempotent kanca): BEKLENEN
    // durum, log'u da gürültü olur. Diğer her şey gerçek bir aksaklıktır ve
    // warn'lanır; kullanıcıya elle çıkış yolu SÖYLENİR (sessiz kalmak,
    // muhasebecinin taslağı bekleyip hiç gelmediğini fark etmemesi demekti).
    const status = err instanceof AppError ? err.statusCode : 0;
    if (status === 409) return null;
    console.warn(
      `[auto-draft] Sevkiyat ${shipmentId} için fatura taslağı üretilemedi:`,
      err instanceof Error ? err.message : err,
    );
    return "otomatik fatura taslağı üretilemedi — Muhasebe > Faturalar'dan elle oluşturun";
  }
}
