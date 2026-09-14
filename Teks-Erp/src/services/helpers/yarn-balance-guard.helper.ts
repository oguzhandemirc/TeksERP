// =============================================================================
// EKSİ İPLİK BAKİYESİ ENGELİ — kg stoğu eksiye DÜŞEMEZ (opt-in)
// =============================================================================
// Sektör karşılığı: SAP B1 "Block Negative Inventory" / Logo stok eksi bakiye
// kontrolü. Bayrak: `yarn.blockNegativeBalanceEnabled` (varsayılan KAPALI —
// açılmadıkça TEK BİR ek sorgu bile koşmaz, bkz. "sıfır-maliyet" notu).
//
// ⚠️ BU GUARD `yarn.service`'in DEFTER FELSEFESİNİ DEĞİŞTİRMEZ, ÜSTÜNE OPT-IN
// BİR KAPI KOYAR. O dosyanın başlığındaki kural aynen geçerlidir: "bakiye
// negatif olabilir ve bu bilinçlidir — sayım girilmeden çıkış yapılırsa
// envanter GERÇEKTEN eksidir ve GÖRÜNMELİDİR". Fabrikaların çoğu için doğru
// cevap hâlâ "YAZ ve UYAR"dır; bu guard, açılış/devir bakiyelerini disiplinle
// giren ve "eksi stok hiç oluşmasın" diyen kurulumlar içindir. Bayrak
// KAPALIYKEN davranış BAYT-BAYT bugünküdür (bekçinin ilk kontrolü budur).
//
// ── KAPSAM: YALNIZ `kind = OUT` ─────────────────────────────────────────────
// Dört hareket türünün ikisi bakiyeyi zaten ARTIRIR (`IN`, `ADJUST_IN`) → soru
// bile doğmaz. Kalan iki düşüren türden yalnız `OUT` kapılanır:
//
//   • `OUT`        → İLERİ çıkış (sarfiyat, sevk, fatura düşümü). KAPILANIR.
//   • `ADJUST_OUT` → SAYIM DÜZELTMESİ ve BELGE STORNOSU. **MUAF.**
//
// ⚠️ `ADJUST_OUT` MUAFİYETİ BU DOSYANIN EN ÖNEMLİ SATIRIDIR ve bekçinin ASIL
// negatif sondasıdır (kasa emsalindeki "ters yollar muaf" kuralının ikizi).
// İki gerekçe, ikisi de bağımsız olarak yeterli:
//   ① SAYIM: "deftere 500 kg yazılmış, depoda 300 kg var" düzeltmesi tam da
//      bakiyeyi AŞAĞI çeken kayıttır. Onu "bakiye yetmiyor" diye reddetmek,
//      sayımın düzeltmek için var olduğu hatayı kalıcılaştırır — guard, kendi
//      panzehirini yasaklamış olur.
//   ② STORNO: `reverseGoodsReceiptYarnTx` yanlış girilmiş mal kabulünü
//      `ADJUST_OUT` ile kapatır. Mal fişten SONRA sarf edilmiş olabilir; iptali
//      reddetmek defteri değil YALNIZ EKRANI düzeltirdi ve fiş sonsuza dek
//      iptal edilemez kalırdı. Kayıt gerçeği ekran kuralından önce gelir.
// Bu yüzden muafiyet "henüz yazılmadı" değil, "yazılMAYACAK"tır: guard bir gün
// `ADJUST_OUT`a genişletilirse `test_yarn_stock` §10 KIRMIZI verir.
//
// ── NEDEN `applyYarnMovementTx` İÇİNDE, ÇAĞIRAN BAZLI DEĞİL ─────────────────
// `yarn.service` başlığındaki TEK YAZAR kuralı: `YarnStock.balanceKg`'a yalnız
// `applyYarnMovementTx` dokunur ve yeni her yüzey (fatura, üretim sarfiyatı,
// transfer) onu ÇAĞIRIR. Guard'ı çağıranlara serpiştirmek, o kuralın verdiği
// tek yapısal garantiyi çöpe atardı: yarın eklenen beşinci çağıran guard'ı
// yazmayı unutur ve eksi bakiye TAM ONDAN sızardı — hata da log da çıkmadan.
// Kapıyı yazarın kendisine koymak, "yeni çağıran guard'sız DOĞAMAZ" demektir.
// Yön bilgisi zaten elimizde: `kind` parametresi.
//
// ── NEDEN ATOMİK (TOCTOU) ───────────────────────────────────────────────────
// Bakiye yazımı `INSERT … ON CONFLICT DO UPDATE` ile DB tarafında toplanıyor,
// yani düz okumayla YARIŞA AÇIK: aynı kalem/depodan iki paralel çekim aynı
// bakiyeyi okur, ikisi de "yeter" der, ikisi de yazar → bakiye yine eksiye
// düşer ve guard SÜS olur. Çözüm: bakiye `SELECT … FOR UPDATE` ile satır
// kilitlenerek okunur; kilit commit'e kadar tutulduğu için ikinci tx guard'da
// BEKLER, commit sonrası GÜNCEL bakiyeyi görür ve 409 alır.
//
// ⚠️ KASA EMSALİNDEN AYRILAN NOKTA — burada FOR UPDATE **derinlik savunması
// DEĞİL, TEK serileştiricidir.** Kasada aynı hesabın yazarlarını kasa-dönem
// guard'ının advisory kilidi (8028) zaten sıraya diziyordu; iplik defterinde
// ÖYLE BİR KİLİT YOK. Bu satır düşerse çifte-harcama penceresi GERÇEKTEN
// açılır ve `test_yarn_stock` §11 kırmızı verir. Silme.
//
// ⚠️ SATIR YOKSA BAKİYE 0'DIR — SESSİZCE GEÇİLMEZ (kasa guard'ının tersi).
// `assertCashBalanceCoversTx` satır bulamazsa `return` eder, çünkü kasa kaydı
// çağıranın kendi kontrolünde zaten doğrulanmıştır ve yokluğu bir VERİ hatası
// olur. Burada ise `YarnStock` satırının yokluğu tamamen MEŞRUDUR ve tam olarak
// guard'ın yakalaması gereken durumu anlatır: "bu kalemden bu depoya hiç giriş
// yazılmamış". Sessiz geçmek, guard'ı en çok gerektiği yerde kapatırdı.
//
// ⚠️ KİLİT SIRASI (Sınıf 3 — ABBA): tek tx'te BİRDEN ÇOK `OUT` yazan bir
// çağıran (örn. çok satırlı bir faturanın iplik düşümü) bu guard üzerinden
// birden çok satır kilidi alır. Bu kilitler ÇAĞIRANIN gönderdiği sırada
// alınır; iki eşzamanlı belge aynı iki (kalem, depo) çiftini TERS sırada
// işlerse deadlock doğar. Guard bunu kendi başına çözemez (satırları
// sıralamak, çağıranın satır sırasını sessizce değiştirmek olurdu ve o sıra
// belgede görünür). Kural çağırana aittir: **çok satırlı iplik çıkışı yazan
// her yol, satırlarını kanonik `(itemId, warehouseId)` sırasına dizmelidir.**
// İkinci hat zaten kurulu: PG sınıf-40 (40P01/40001) `error.middleware`'de
// 500 değil 409 "tekrar deneyin"e çevriliyor.
// =============================================================================

import { Prisma, YarnMovementKind } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { readYarnBlockNegativeBalanceEnabled } from "../system-setting.service";

export interface YarnOutflowRef {
  itemId: string;
  warehouseId: string;
  /** Hareketin türü — guard yalnız `OUT`u kapılar (muafiyet gerekçesi yukarıda). */
  kind: YarnMovementKind;
  /** POZİTİF kg (yön `kind`ten gelir — `yarn.service` sözleşmesi). */
  qtyKg: Prisma.Decimal;
}

/**
 * TEK YÜKLEM — `applyYarnMovementTx` bunu çağırır; kural iki yerde yaşamaz.
 *
 * Çağıran, bakiyeyi yazacağı TX'İN İÇİNDE ve HER İKİ yazımdan (hareket satırı +
 * bakiye) ÖNCE çağırır. Tx dışında çağırmak koruma sağlamaz — `FOR UPDATE`
 * kilidi tx ömürlüdür.
 *
 * ⚠️ SIFIR-MALİYET SIRASI (load-bearing): önce `kind` elenir, SONRA bayrak
 * okunur. Mal kabul fişi N iplik satırını `IN` ile yazar ve döngü içinde
 * `applyYarnMovementTx` çağırır; bayrağı önce okusaydık her `IN` satırı için
 * bir `systemSetting` sorgusu doğardı — bayrak KAPALIYKEN bile. Bu sırayla
 * `IN`/`ADJUST_*` yolları TEK ek sorgu bile koşmaz.
 *
 * Bayrak okuma BİLEREK cache'siz (enforcement reader sözleşmesi —
 * `readTamburOverQuantityEnabled` emsali): panelden kapatılan bayrak bir
 * sonraki işlemde anında etkisizleşmeli (acil kapatma yolu).
 */
export async function assertYarnBalanceCoversTx(
  tx: Prisma.TransactionClient,
  ref: YarnOutflowRef,
): Promise<void> {
  // Kapılanan küme: OUT ve WARP_ISSUE (levente sarım da bir ÇIKIŞTIR); ADJUST_OUT + tersler + girişler muaf.
  if (ref.kind !== YarnMovementKind.OUT && ref.kind !== YarnMovementKind.WARP_ISSUE) return;
  const enabled = await readYarnBlockNegativeBalanceEnabled(tx);
  if (!enabled) return;

  // FOR UPDATE — gerekçe dosya başlığında. Satır YOKSA bakiye 0 kabul edilir
  // (yine dosya başlığında: yokluk meşrudur ve guard'ın yakalaması gereken
  // durumun ta kendisidir).
  const rows = await tx.$queryRaw<Array<{ balanceKg: string | number | Prisma.Decimal }>>`
    SELECT "balanceKg" FROM "yarn_stocks"
    WHERE "itemId" = ${ref.itemId}::uuid AND "warehouseId" = ${ref.warehouseId}::uuid
    FOR UPDATE
  `;
  const balance = rows[0] ? new Prisma.Decimal(String(rows[0].balanceKg)) : new Prisma.Decimal(0);
  if (!balance.minus(ref.qtyKg).isNegative()) return;

  // ⚠️ Adlar YALNIZ RED YOLUNDA okunur: mutlu yol (bakiye yeterli) tek ek sorgu
  // ile biter. Guard'ın maliyeti, engellemediği işlemde görünmemeli.
  // ⚠️ SIRALI await — `tx.*` ile `Promise.all` YASAK (pg adapter tek bağlantıyı
  // seri çalıştırır; ESLint de yakalar).
  const item = await tx.item.findUnique({ where: { id: ref.itemId }, select: { name: true, code: true } });
  const warehouse = await tx.warehouse.findUnique({ where: { id: ref.warehouseId }, select: { name: true } });
  const itemLabel = item ? `${item.name} (${item.code})` : "Kalem";
  const whLabel = warehouse?.name ?? "Depo";

  // Mesaj SOMUT: kalem + depo + mevcut kg + istenen kg + en olası kök neden
  // (depo gerçekte doluyken sistemde boş görünmesi = açılış/sayım girilmemiş)
  // + ayarın ADI ve NEREDEN kapatılacağı. "Yetersiz stok." tek başına, doğru
  // olduğu hâlde operatöre hiçbir çıkış yolu göstermez.
  throw AppError.conflict(
    `"${itemLabel}" kaleminin "${whLabel}" deposundaki bakiyesi eksiye düşecek: ` +
      `mevcut ${balance.toFixed(3)} kg, istenen çıkış ${ref.qtyKg.toFixed(3)} kg. ` +
      `Eksi iplik bakiyesi engeli açık — depoda gerçekte mal varsa açılış/sayım kaydı eksik olabilir: ` +
      `İplik Stok Hareketleri'nden giriş (ya da sayım düzeltmesi) yazın, tutarı düzeltin ` +
      `ya da bu kuralı Genel Ayarlar > Depo & Satın Alma > "İplik stoğu eksi bakiyeye düşemesin" ile kapatın.`,
  );
}
