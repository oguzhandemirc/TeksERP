// =============================================================================
// SEVKİYAT KAPSAMA KAPISI — İKİNCİ EKSEN (`shipping.orderCoverage`)
// =============================================================================
// NEDEN AYRI BİR BAYRAK, neden `shipping.orderRequirement`ı 5 değere çıkarmak DEĞİL:
// iki soru DİK (ortogonal).
//
//   orderRequirement → "sipariş SEÇİLDİ mi"   (NİYET)
//   orderCoverage    → "mal deftere YAZILDI mı" (SONUÇ)
//
// Bunlar bir merdivenin iki basamağı değil, iki ayrı eksendir. Tek doğrusal enum
// "bağ sıkılığı arttıkça kapsama sıkılığı da artar" diye YANLIŞ bir sözleşme
// kurardı ve bugün meşru olan düzen ("sipariş seçilsin ama fazla mal serbest
// kalsın") ifade edilemez hâle gelirdi.
//
// ⚠️ ÖLÇÜM (fabrika yedeği, 2026-09-05) — bu bayrağın VAROLUŞ GEREKÇESİ:
// 89 sevk edilmiş sevkiyatın 88'inde sipariş ZATEN seçilmişti. Yani
// `orderRequirement = block` açık olsaydı 89'dan yalnız 1'ini reddederdi.
// Buna karşılık 42 sevkiyatta (11.384,7 m) çuval içeriği sipariş defterine tam
// yazılmamıştı. Var olan merdiven yanlış yarımı ölçüyor: 5'i hiç tahsissiz,
// 37'si kısmi. Boşluklu çuvallardaki 975 topun 805'i seçili siparişin bir
// kalemiyle specMatch UYUMLU — yani yazılabilirdi.
//
// ÜÇ REJİM:
//   off   → VARSAYILAN ve BUGÜNKÜ DAVRANIŞ. Kapsama sessiz; önizlemedeki
//           "yazılamayan ~N m" uyarısı yerinde kalır (o ayrı bir yüzey).
//   warn  → kurulum YANITI da `warnings[]` taşır. Neden önemli: bugün o uyarı
//           YALNIZ önizlemede var ve tablet Paketleme `orderIds: undefined`
//           gönderdiği için o dal hiç koşmuyor — sahadaki asıl yol uyarıyı hiç
//           görmüyordu.
//   block → KURULUM 409'a düşer (`ORDER_COVERAGE`). Kaçış `orderless: true`
//           beyanıdır — numune/fazla mal sevki meşru bir iştir.
//
// ⚠️ KAPI YALNIZ KURULUMDA — SEVK ANINA (`dispatchShipment`) KONMAZ ve bu
// bilinçli. Sevk anında `throw` etmek, malı bina içinde KİLİTLER: mal fiziksel
// olarak çıkmaya hazırdır, kamyon kapıdadır. Aynı gerekçe `orderRequirement`
// için de yazılı (`shipment-order-requirement.helper.ts` § "KAPI YALNIZ
// KURULUMDA"). Sevk anında hesaplanan tahsissiz metraj audit izine yazılmaya
// devam eder (`tahsissizMetraj`), yani görünürlük kaybolmaz.
//
// ⚠️ TOLERANS bir ÖLÇÜM DEĞERİ DEĞİL, KAYAN NOKTA PAYIDIR. Metraj `Decimal`den
// `number`a çevrildiği için 0 yerine 0.0004 gibi artıklar çıkabiliyor; eşik
// önizlemedeki `> 0.001` ile BİREBİR aynı tutulur ki iki yüzey aynı sevkiyat
// için farklı hüküm vermesin.
// =============================================================================
import { AppError } from "../../utils/app-error";
import {
  readShippingOrderCoverage,
  type ShippingOrderCoverage,
} from "../system-setting.service";

/** Önizlemedeki eşikle BİREBİR aynı — iki yüzey aynı hükmü versin. */
export const KAPSAMA_TOLERANS_M = 0.001;

/** Rejimi oku. ÖNBELLEKSİZ: bayrak aynı zamanda acil geri dönüş anahtarıdır. */
export async function resolveOrderCoverage(): Promise<ShippingOrderCoverage> {
  return readShippingOrderCoverage();
}

/**
 * Kapsama hükmü. `null` döner = söylenecek bir şey yok.
 *
 * @param rejim          `resolveOrderCoverage()` sonucu
 * @param tahsissizMetre çuvalda olup hiçbir sipariş satırına yazılamayan metraj
 * @param opts.orderIds  seçili sipariş kümesi — BOŞSA kapsama sorusu anlamsızdır
 *                       (o hâli `orderRequirement` ölçer, çift uyarı üretmeyelim)
 * @param opts.orderless kullanıcı "siparişsiz/fazla mal" beyanı yaptı mı
 */
export function assertCoverageAllowed(
  rejim: ShippingOrderCoverage,
  tahsissizMetre: number,
  opts: { orderIds: string[]; orderless?: boolean },
): string | null {
  // Sipariş hiç seçilmediyse bu eksen susar — o soruyu `orderRequirement` cevaplar.
  if (opts.orderIds.length === 0) return null;
  if (tahsissizMetre <= KAPSAMA_TOLERANS_M) return null;
  if (rejim === "off") return null;

  const yuvarlak = Math.round(tahsissizMetre);
  const metin =
    `Seçili siparişlere yazılamayan ~${yuvarlak} m mal var (fazla ya da spec'i tutmayan). ` +
    `Bu metraj sipariş defterine İŞLENMEZ; sipariş "Açık" kalır.`;

  if (rejim === "block") {
    // Beyan MUAF: `block`ın amacı KAZARA yazılmayan malı durdurmaktır, bilinçli
    // fazla/numune sevkini değil — `orderRequirement` ile aynı kaçış kapısı.
    if (opts.orderless) return null;
    throw AppError.conflict(metin + " Devam etmek için 'Siparişsiz/fazla mal' kutusunu işaretleyin.", {
      code: "ORDER_COVERAGE",
      tahsissizMetre: yuvarlak,
    });
  }

  // warn
  return opts.orderless ? null : metin;
}
