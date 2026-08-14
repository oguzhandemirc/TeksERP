// =============================================================================
// EKSİ KASA ENGELİ GUARD'I — kasa (fiziksel nakit) eksi bakiyeye DÜŞEMEZ
// =============================================================================
// Sektör karşılığı: Logo kasa fişi eksi bakiye kontrolü / SAP B1 "block negative
// inventory"nin kasa ikizi. Bayrak: `finance.blockNegativeCashEnabled`
// (varsayılan KAPALI — açılmadıkça tek ayar okuması dışında hiçbir maliyet ve
// hiçbir davranış değişikliği yok).
//
// ── KAPSAM: 4 İLERİ YOL, yalnız KASA ───────────────────────────────────────
//   1. payment.service.create        → OUT + cashBoxId (ödeme kasadan çıkar)
//   2. cash-transaction.service.create → EXPENSE (OUT) + cashBoxId
//   3. cash-transaction.service.transfer → ÇIKAN bacak kasa ise
//   4. cheque.service.pay            → kendi çekimiz kasadan ödendi
//
// ⚠️ BANKA MUAF — kredili mevduat (eksi banka bakiyesi) MEŞRUDUR; banka
// hesabına bu guard'ı takmak gerçek bir ödemeyi sisteme sokulamaz yapardı.
// `bankAccountId` ile gelen çağrı sessizce geçer (no-op).
//
// ⚠️ TERS YOLLAR MUAF — payment.cancel · cashTransaction.cancel ·
// cheque.cancelCollect (K-2) bakiyeyi eksiye DÜŞÜREBİLİR ve düşürebilmelidir:
// yanlış tahsilatın stornosu "kasada yeterli para yok" diye reddedilirse
// düzeltilemez bir kayıt doğar (para gerçeği ekran kuralından önce gelir —
// cancelCollect'in pasif-hesap muafiyetiyle aynı ilke). Bu muafiyet
// `test_cash_negative_guard` §4'te NEGATİF SONDA ile kilitlidir: guard bir
// ters yola eklenirse bekçi kırmızı verir.
//
// ── NEDEN ATOMİK (TOCTOU) ───────────────────────────────────────────────────
// Bakiye yazımı `increment` (dolayısıyla düz okumayla yarışa açık): iki paralel
// çekim aynı bakiyeyi okur, ikisi de "yeter" der, ikisi de yazar → kasa yine
// eksiye düşer ve guard süs olur. Çözüm: bakiye **`SELECT ... FOR UPDATE`** ile
// satır kilitlenerek okunur. Sonraki `increment` AYNI tx'te AYNI satıra yazar;
// kilit commit'e kadar tutulduğu için araya ikinci bir çekim giremez — ikinci
// tx guard'da bekler, commit sonrası GÜNCEL bakiyeyi okur ve 409 alır.
// `UPDATE ... WHERE balance >= amount` deseni SEÇİLMEDİ: bakiye yazımı üç
// serviste ortak `increment` yardımcılarından geçiyor; onları koşullu UPDATE'e
// çevirmek bayrak KAPALIYKEN de yazım yolunu değiştirirdi. FOR UPDATE, mevcut
// yazım kodunu bayt-bayt korur ve yalnız bayrak açıkken devreye girer.
//
// ⚠️ KİLİT SIRASI (Sınıf 3 — ABBA): guard, kilidini KORUDUĞU yazımdan hemen
// önce alır. ÇOK hesaplı yazar (virman) guard'ı kanonik `accountLockKey`
// sırasına dizilmiş bacak DÖNGÜSÜNÜN İÇİNDEN çağırmak ZORUNDA — döngü dışında
// erken çağrılırsa ayna virman çifti (A→B ‖ B→A) guard kilitlerini ters sırada
// alıp deadlock üretir. Tek hesaplı yazarlar (ödeme · masraf · çek) serbesttir.
// =============================================================================

import { Prisma } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { readFinanceBlockNegativeCashEnabled } from "../system-setting.service";

export interface CashOutflowRef {
  /** Guard yalnız kasa için çalışır; null/banka → no-op (banka muafiyeti). */
  cashBoxId?: string | null;
  /** Kasadan çıkacak tutar (pozitif, hesabın KENDİ para biriminde). */
  amount: Prisma.Decimal;
}

/**
 * TEK YÜKLEM — dört ileri yol da bunu çağırır; kural iki yerde yaşamaz.
 *
 * Çağıran, bakiyeyi yazacağı TX'İN İÇİNDE ve yazımdan ÖNCE çağırır. Tx dışında
 * çağırmak koruma sağlamaz (FOR UPDATE kilidi tx ömürlüdür).
 *
 * Bayrak okuma BİLEREK cache'siz (enforcement reader sözleşmesi —
 * `readTamburOverQuantityEnabled` emsali): panelden kapatılan bayrak bir
 * sonraki işlemde anında etkisizleşmeli (acil kapatma yolu).
 */
export async function assertCashBalanceCoversTx(
  tx: Prisma.TransactionClient,
  ref: CashOutflowRef,
): Promise<void> {
  if (!ref.cashBoxId) return; // banka ya da hesapsız çağrı — muaf
  const enabled = await readFinanceBlockNegativeCashEnabled(tx);
  if (!enabled) return;

  // FOR UPDATE — gerekçe dosya başlığında. Hesabın varlığı/aktifliği çağıranın
  // kendi `loadAccount` kontrolünde zaten doğrulandı; satır yoksa sessiz geçilir
  // (ikinci bir "kasa bulunamadı" mesajı üretmek çifte hata olurdu — çağıranın
  // kontrolü tx içinde ondan önce koşuyor).
  const rows = await tx.$queryRaw<
    Array<{ name: string; currency: string; balance: string | number | Prisma.Decimal }>
  >`SELECT name, currency, balance FROM cash_boxes WHERE id = ${ref.cashBoxId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) return;

  const balance = new Prisma.Decimal(String(row.balance));
  if (balance.minus(ref.amount).isNegative()) {
    // Mesaj SOMUT: hesap adı + mevcut bakiye + istenen tutar + en olası kök
    // neden (kasa gerçekte doluyken sistemde boş görünmesi = açılış girilmemiş).
    throw AppError.conflict(
      `"${row.name}" kasası eksi bakiyeye düşecek: mevcut bakiye ${balance.toFixed(2)} ${row.currency}, ` +
        `istenen çıkış ${ref.amount.toFixed(2)} ${row.currency}. Eksi kasa engeli açık — ` +
        `kasada gerçekte para varsa açılış/devir bakiyesi girilmemiş olabilir: ` +
        `Kasa Hareketleri > Açılış fişiyle devir bakiyesini girin ya da tutarı düzeltin.`,
    );
  }
}
