// =============================================================================
// İLERİ TARİHLİ MALİ BELGE GUARD'I — belge tarihi fabrika gününü GEÇEMEZ
// =============================================================================
// Bayrak: `finance.futureDatedDocumentBlockEnabled` (varsayılan KAPALI — açılana
// kadar tek ayar okuması dışında hiçbir maliyet ve hiçbir davranış değişikliği
// yok). Sektör karşılığı: Logo/Mikro "ileri tarihli fiş" kontrolü, SAP
// "posting date in future" kilidi.
//
// ── NEDEN KURAL GEREKLİ ─────────────────────────────────────────────────────
// Yanlış girilen tarih (2026 yerine 2062, ay/gün ters) sessizce geçer: belge
// numarası o tarihten türer, defter satırı o tarihe düşer, dönem raporu bugün
// olmayan bir tutar gösterir. Hata da log da çıkmaz; ay sonunda "bu rakam
// nereden geldi" sorusu kalır.
//
// ── SINIR: FABRİKA GÜNÜ SONU, UTC GÜN SONU DEĞİL ────────────────────────────
// `factoryDayStart` ailesi tek kaynaktır (CLAUDE.md → "Fabrika günü"): UTC'de
// kesilen gün, yerel 00:00–03:00 arasındaki her kaydı bir ÖNCEKİ güne yazar ve
// tam tersi yönde saat 21:00'den sonra girilen BUGÜNKÜ belge "yarın" sayılırdı
// — yani guard, kullanıcının bugün girdiği doğru belgeyi reddederdi.
//
// ── MUAF (Sınıf 1, bilinçli) ────────────────────────────────────────────────
// ÇEKİN KEŞİDE ve VADE tarihi: ileri tarihli çek işin normalidir ve bu guard'ı
// oraya takmak özelliği kullanılamaz kılardı. `cheque.service` bu dosyayı
// ÇAĞIRMAZ; çağırmaya kalkan biri önce bu satırı çürütmeli.
//
// ── TEK KAYNAK OLMA GEREKÇESİ ───────────────────────────────────────────────
// Kural üç yüzeyde aynıdır (fatura `issueDate` · tahsilat/ödeme `paymentDate` ·
// kasa `txnDate`). Üç serviste ayrı ayrı yazılsaydı biri gün sınırını `new
// Date()` ile ölçer (saat bazlı, yani "bugün 14:00'te girilen 18:00'lik belge"
// reddedilir), biri UTC'de keser, üçüncüsü bayrağı cache'li okurdu. Bugün
// yalnız `invoice.service` çağırıyor; ödeme/kasa bacaklarının bağlanması ayrı
// bir sahiplik kararıdır (dikiş).
// =============================================================================

import type { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { factoryDayStart } from "../../constants/time";
import { readFinanceFutureDatedDocumentBlockEnabled } from "../system-setting.service";

/** Verilen an, FABRİKA takvim gününün İLERİSİNDE mi? (saf — bayrak okumaz) */
export function isFutureFactoryDay(date: Date, now: Date = new Date()): boolean {
  const todayStart = factoryDayStart(now);
  // +36 saat, bugünün başlangıcından yarın öğlene düşer → `factoryDayStart` onu
  // YARININ 00:00'ına indirger. Düz `+24 saat` DST'li bir saat diliminde gün
  // sınırını 1 saat kaydırabilirdi (Türkiye kalıcı UTC+3 ama yardımcılar
  // bilinçli olarak DST'ye dayanıklı yazıldı — bkz. constants/time.ts).
  const tomorrowStart = factoryDayStart(new Date(todayStart.getTime() + 36 * 3_600_000));
  return date.getTime() >= tomorrowStart.getTime();
}

/** Türkçe gün etiketi — mesajda hangi tarihin sorun olduğu OKUNABİLİR yazılır. */
function trDay(d: Date): string {
  return d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" });
}

export interface FutureDateRef {
  /** Kontrol edilecek belge tarihi. */
  date: Date;
  /** Mesajda geçecek alan adı — örn. "Fatura tarihi", "Tahsilat tarihi". */
  label: string;
  /** Ayarın panelde göründüğü yer (mesajın "nereden kapatılır" ayağı). */
  settingPath?: string;
}

/**
 * Bayrak açıkken ileri tarihli belgeyi 400 ile reddeder.
 *
 * Bayrak okuma BİLEREK cache'siz (enforcement reader sözleşmesi —
 * `assertCashBalanceCoversTx` emsali): panelden kapatılan bayrak bir SONRAKİ
 * işlemde anında etkisizleşmeli (acil kapatma yolu). `tx` opsiyoneldir; yazım
 * yapmadığı için tx dışından da çağrılabilir (fatura taslağı bunu tx AÇMADAN
 * önce çağırır — reddedilecek istek için transaction açmanın anlamı yok).
 */
export async function assertNotFutureDatedTx(
  tx: Pick<Prisma.TransactionClient, "systemSetting"> | undefined,
  ref: FutureDateRef,
): Promise<void> {
  const enabled = await readFinanceFutureDatedDocumentBlockEnabled(tx);
  if (!enabled) return;
  if (!isFutureFactoryDay(ref.date)) return;

  const where = ref.settingPath ?? 'Ayarlar > Muhasebe > "İleri tarihli mali belge tarihini engelle"';
  throw AppError.badRequest(
    `${ref.label} ileri tarihli olamaz: ${trDay(ref.date)} girilmiş, bugün ${trDay(new Date())}. ` +
      `İleri tarihli belge engeli açık — tarihi bugüne (ya da geçmişe) çekin; ` +
      `ileri tarihli belge gerçekten gerekiyorsa ${where} ayarını kapatın.`,
  );
}
