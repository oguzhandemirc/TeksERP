// =============================================================================
// BEKÇİ — FATURA KAPAMA (`PaymentAllocation`, Paket C2)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_payment_allocation.ts
//
// NEDEN: Kapama ÜÇ denormalize sayaç üzerinde yaşıyor (`Invoice.paidTotal`,
// `Payment.allocatedTotal`, `Cheque.allocatedTotal`) ve bu sayaçlar "hangi
// fatura hâlâ açık" sorusunun TEK kaynağı. Sayaçlar defterden bağımsız
// hareket ettiği için sapmaları CARİ BAKİYE ÖRTER: bakiye doğru kalır, yalnız
// yaşlandırma raporu yanlış olur — yani hata ay sonunda değil, müşteriyle
// oturulan gün ortaya çıkar.
//
// ⚠️ Bu bekçi kırmızıya dönerse doğru tepki testi gevşetmek DEĞİL.
//
// ÖLÇÜLENLER:
//   §0  KÖRLÜK ZEMİNİ — mutlu yol gerçekten çalışıyor (yoksa her şey "yeşil")
//   §1  KISMİ kapama: iki sayaç birlikte oynar, fatura AÇIK kalır
//   §2  ÇOKLU kapama: aynı fatura+kaynak birden çok satırla kapanır (unique YOK)
//   §3  ⭐ AŞIRI KAPAMA → 409 ve sayaçlar OYNAMAZ (ham UPDATE'in tavan koşulu)
//   §4  KAYNAK tarafı aşımı → 409 (`allocatedTotal <= amount`)
//   §5  ⭐ EŞZAMANLI KAPAMA YARIŞI: 5 paralel × 300 → grandTotal AŞILMAZ
//   §6  ALLOCATION DEFTERE SATIR YAZMAZ (bakiye ve satır sayısı sabit)
//   §7  STORNO ÇÖZÜLMESİ — yardımcının KENDİSİ (§7a-e) + ⭐ ÇAĞRILDIĞI (§7f,
//       gerçek `paymentService.cancel` / `invoiceService.cancel` üzerinden)
//   §8  BİLİNÇLİ DAR KURALLAR (cari · kur · yön · taslak · iptal · iade · karşılıksız çek)
//   §9  ROTA TARAMASI: her uç izin guard'ı taşıyor + bayrak kapısına mount edilmiş
//   §10 FIFO ÖNERİSİ: vade sıralı, deterministik, saf fonksiyon
//   §11 DEALLOCATE (elle düzeltme) — sayaçlar düşer, negatife inmez
//   §12 ⭐ SINIF 4 (2026-08-14): terminal çek süzgeci ATOMİK — kilit-altı
//       yeniden değerlendirme deterministik sondayla + count-0 TANISI (ÜÇ
//       kaynağın üçünde de: çek §12a · tahsilat §12k · fatura §12m — tavan
//       mesajı yanlış dalda konuşmaz)
//   §13 ⭐ EŞZAMANLILIK: allocate ‖ bounce yarışı (5 tur) — tam olarak BİR
//       taraf kazanır, kaybeden 409'a eşlenir, BOUNCED+kapama birlikte ASLA
//   §14 SINIF 3: virman ayna-çift yarışı (deadlock yok / 500 asla) + kanonik
//       kilit sırası kaynak taraması + iptal bacağı işlevsel
//   §15 GÜVENLİK AĞI: error.middleware sınıf-40 → 409 (iki kılık + P2010'un
//       META alt-kılığı) + 23514 finans mesajları + YANLIŞ POZİTİF korumaları
//   §15r ⭐ EŞZAMANLI clientToken ÇİFT-GÖNDERİMİ (I2, payment.create): pencere
//       elle açık tutulan tx ile deterministik (kazananın token'ı unique
//       indekste UNCOMMITTED → ön kontrol göremez, kaybeden indekste bekler) →
//       kaybeden cached yanıt alır; TAM BİR kayıt; eşzamanlı = ardışık replay
//       BAYT-BAYT. NEGATİF SONDA: predicate (`!isClientTokenP2002`) düşürülünce
//       token P2002'si 5 tur boşa retry edilir → ham "Barkod üretimi ...
//       başarısız" 409'u → kırmızı.
//   §17 ⭐ OTOMATİK FIFO KAPAMA (J1 dalga 2, `finance.autoAllocateOnPaymentEnabled`):
//       ① KAPALI PARİTE (mesaj bayt-bayt + sıfır satır) · ② modül şalteri üstte
//       · ③ FIFO sırası + tam/kısmi · ④ artan tutar AVANS olarak açıkta · ⑤ farklı
//       para birimi ve iade faturası ATLANIR · ⑥ ⭐ kapama patlasa da TAHSİLAT
//       AYAKTA (sonda ile deterministik) · ⑦ üretilen tahsis elle SİLİNEBİLİR
//       · ⑧ replay kancayı ikinci kez çalıştırmaz
//   §16 MUTABAKAT: SUM(allocation) === üç sayacın hepsi (TÜM DB) — HER ZAMAN
//       EN SON koşar ki §12-§14'ün yarış artıkları da terazide tartılsın
//       (⚠️ §17 ondan ÖNCE yazıldı ve bu bilinçli: otomatik kapamanın satırları
//        da aynı teraziden geçmeli)
//
// NEGATİF SONDA — HEPSİ GERÇEKTEN KOŞULDU, sonuçlar ÖLÇÜLEN hâlleriyle
// yazılmıştır (tahmin edilen değil; ilk dördün tabanı 82/82 yeşil):
//   ① `bumpInvoicePaid`'ten `AND "paidTotal" + $a <= "grandTotal"` silindi
//      → 80/2: §3a + §3e kırmızı.
//      ⚠️ ÖNEMLİ VE SEZGİYE AYKIRI: §5 (yarış) ve §16 (mutabakat) YEŞİL KALDI.
//      Sebep kusur değil TASARIM: aşımı ikinci katman — DB CHECK'i
//      `invoices_paid_total_range` — yakaladı, tx geri sardı ve yarışta yine
//      tam 3 kapama geçti. Yani §5'in ölçtüğü şey "uygulama koşulu" değil
//      "iki katmanın BİRLİKTE tuttuğu"dur; ham UPDATE koşulunun TEK ölçen
//      kontrolleri §3a/§3e'dir. Bu ayrımı bilmeden §3'ü zayıflatan biri,
//      uygulama katmanının anlamlı 409'unu kaybedip yerine çıplak bir
//      constraint hatası koyduğunu fark etmez. (CHECK de kaldırılırsa §5 ve
//      §16 kırmızıya döner — ikinci katmanın gerçekten yük taşıdığının kanıtı.)
//   ② `allocateOneTx`'teki `src.cariId !== inv.cariId` kontrolü silindi
//      → 81/1: §8a kırmızı (başka carinin parasıyla kapama sessizce geçti).
//   ③ `releaseRowsTx`'teki `dropInvoicePaid` çağrısı silindi
//      → 78/4: §7b2 · §7b4 · §7d4 · §16a kırmızı. En değerli sonda: storno
//      satırları siliyor ama sayacı düşürmüyor → "kapalı görünen ama parası
//      yok olmuş fatura" tam olarak bu şekilde doğar ve §16a onu adıyla
//      raporladı (SF…09: 600≠0, SF…11: 900≠0, SF…08: 800≠0).
//   ④ `allocateBulk`'un tek `$transaction` sarmalayıcısı kaldırılıp her bacak
//      ayrı tx yapıldı → §8m + §8n kırmızı (ilk bacak kalıcı yazıldı).
// 2026-08-14 SAĞLAMLIK PAKETİ sondaları — BEŞİ DE GERÇEKTEN KOŞULDU, dosyalar
// her sondadan sonra shasum ile birebir geri yüklendi (taban 119/119 yeşil):
//   ⑤ `bumpChequeAllocated`'tan status süzgeci (`AND NOT ("status" = ANY…)`)
//      silindi → 117/2: §12a + §12i kırmızı. Kilit-altı sondada bump BOUNCED
//      çeke yazmaya kalktı, DB CHECK'i `cheques_terminal_not_allocated` 23514
//      fırlattı ve mesaj anlamlı 409 olmaktan çıktı (ikinci katmanın yük
//      taşıdığının kanıtı — §12b/§12c tx geri sarıldığı için yeşil kaldı,
//      ayrım ①'dekiyle aynı).
//   ⑥ `allocateOneTx`'teki `explainChequeBumpZeroTx` çağrısı silindi → 118/1:
//      §12a kırmızı — kaybeden allocate YANLIŞ dalda konuştu ("kapamaya kalan
//      tutar 500 TRY — 300 yazılamaz" tavan mesajı; oysa kalan tutar değil
//      paranın KENDİSİ yoktu).
//   ⑦ `cash-transaction.transfer`'ın kanonik `legs.sort`'u kaldırılıp eski
//      from→to sırasına döndürüldü → 118/1: §14f kırmızı (kullanım=2, kaynak
//      taraması). ⚠️ Davranış sondaları (§14a-c) ÖLÇÜLDÜ VE YEŞİL KALDI —
//      deadlock penceresi olasılıksaldır ve oluşsa bile §15'in ağı 409'a
//      eşlerdi; sıralamanın bekçisi bu yüzden kaynak taramasıdır, yarış değil.
//   ⑧ error.middleware'den sınıf-40 dalı silindi → 116/3: §15a ("500 Sunucu
//      hatası oluştu.") + §15b + §15c ("500 Sunucu yapılandırma hatası") —
//      düzeltme öncesi iki arıza şekli de birebir geri geldi.
//   ⑨ `CHECK_CONSTRAINT_MESSAGES`'tan `cheques_terminal_not_allocated` satırı
//      silindi → 118/1: §15f kırmızı ("Veri bütünlüğü kuralı engelledi
//      (cheques_terminal_not_allocated)" — operatör Türkçe sebep yerine çıplak
//      constraint adını görür).
// 2026-08-14 KAPAMA DENETİMİ sondaları — ÜÇÜ DE GERÇEKTEN KOŞULDU, dosyalar
// shasum ile birebir geri yüklendi (taban 125/125 yeşil):
//   ⑩ `allocateOneTx`'teki `explainPaymentBumpZeroTx` çağrısı silindi → 124/1:
//      §12k kırmızı — kaybeden allocate YANLIŞ dalda konuştu ("kapamaya kalan
//      tutar 500 TRY" tavan mesajı; oysa tahsilat o sırada İPTAL edilmişti).
//   ⑪ `explainInvoiceBumpZeroTx` çağrısı silindi → 124/1: §12m kırmızı (aynı
//      sınıf, fatura ikizi — "kapatılabilecek tutar 500 TRY" yalanı geri geldi).
//   ⑫ error.middleware'in İKİ extract fonksiyonundan `meta.driverAdapterError`
//      blokları silindi → 123/2: §15j + §15k kırmızı (ikisi de 500 "Sunucu
//      yapılandırma hatası"na düştü). ⚠️ §15c YEŞİL KALDI ve bu ölçümün kendisi
//      kanıttır: mesaj-kalıbı fallback'i o kılığı taşıyor, meta yolunun TEK
//      bekçisi §15j/§15k — "fazlalık" sanıp silme.
// ⚠️ SONDA FİXTURE DERSİ (⑪'in ilk koşumu): gate tx'i `cancelledAt` YAZMADAN
// CANCELLED'a çekiyordu → DB CHECK'i `invoices_status_stamps` gate tx'ini
// reddetti ve henüz await edilmemiş promise SAHİPSİZ rejection olarak Node 22'yi
// Sonuç/temizlik basılmadan ÖLDÜRDÜ (❌ bile yok — en sessiz kırmızı). Gate
// tx'lerine bu yüzden no-op `.catch` bağlı ve damga alanları tam yazılır.
// =============================================================================
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NextFunction, Request, Response } from "express";
import { Prisma, PaymentDirection, ChequeKind, ChequeStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { chequeService } from "../src/services/cheque.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { errorHandler } from "../src/middlewares/error.middleware";
import {
  paymentAllocationService,
  releaseAllocationsForPaymentTx,
  releaseAllocationsForInvoiceTx,
  releaseAllocationsForChequeTx,
  suggestFifo,
  CHEQUE_NO_MONEY_STATUSES,
} from "../src/services/payment-allocation.service";
import { D, D0 } from "../src/services/helpers/finance.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TAG = `TEST-ALLOC-${Date.now()}`;
const invoiceIds: string[] = [];
const paymentIds: string[] = [];
const chequeIds: string[] = [];
const cariIds: string[] = [];
const customerIds: string[] = [];
const subcontractorIds: string[] = [];
let cashBoxId: string | null = null;
/** §14 virman kasaları — cleanup kasa hareketlerini de silmek zorunda. */
const cashBoxIds: string[] = [];

// ── §17 BAYRAK FOTOĞRAFI ────────────────────────────────────────────────────
// ⚠️ Paylaşımlı dev DB: bekçi bayrakları KENDİ değerlerine geri döndürmek
// zorunda, yoksa bir sonraki testin (ya da geliştiricinin) davranışı sessizce
// değişir. Fotoğraf `finally`de geri yüklenir — satır YOKSA silinir, VARSA eski
// değeriyle yazılır (ikisi farklı: kayıtsız = "hiç dokunulmamış").
const AUTO_FLAG_KEY = SETTING_KEYS.FINANCE_AUTO_ALLOCATE_ON_PAYMENT_ENABLED;
const FINANCE_FLAG_KEY = SETTING_KEYS.FINANCE_ENABLED;
const flagSnapshot = new Map<string, Prisma.JsonValue | undefined>();

/** Ayarı yazar; ilk yazımdan ÖNCE mevcut hâlini fotoğraflar. */
async function setSetting(key: string, value: boolean): Promise<void> {
  if (!flagSnapshot.has(key)) {
    const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    flagSnapshot.set(key, row ? row.value : undefined);
  }
  // Doğrudan ayar yazımı BİLİNÇLİ: enforcement reader cache'siz olduğu için
  // anında etkilidir; HTTP/route sözleşmesini `test_feature_flag_contract` ölçer.
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function restoreSettings(): Promise<void> {
  for (const [key, value] of flagSnapshot) {
    if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.update({ where: { key }, data: { value: value ?? Prisma.JsonNull } });
  }
}

/** Hata mesajını çıkaran küçük yardımcı — try/catch gürültüsünü azaltır. */
async function err(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** §15r yarış sondası — pencereyi elle açık tutmak için (goods_receipt_invoice §10 emsali). */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e?: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Bir hatayı GERÇEK `errorHandler` üzerinden HTTP sözleşmesine eşler (§13-§15).
 *
 * Servis katmanı testinde middleware devrede değildir; "operatör 500 mü 409 mu
 * görür" sorusunun tek doğru ölçümü, hatayı middleware'in kendisinden
 * geçirmektir. `res` sahte ama `errorHandler` senkron yazar → çağrı dönünce
 * status/body okunabilir (audit `void` ile arkada akar, sonucu etkilemez).
 */
function mapThroughErrorHandler(e: unknown): { status: number; message: string } {
  const out = { status: 0, message: "" };
  const res = {
    headersSent: false,
    setHeader: () => undefined,
    status(code: number) {
      out.status = code;
      return this;
    },
    json(body: { message?: string }) {
      out.message = body?.message ?? "";
      return this;
    },
  };
  const req = { method: "POST", originalUrl: "/bekci-sondasi", ip: "127.0.0.1", user: undefined };
  errorHandler(
    e as Error,
    req as unknown as Request,
    res as unknown as Response,
    (() => undefined) as NextFunction,
  );
  return out;
}

async function invoiceCounters(id: string): Promise<{ grand: Prisma.Decimal; paid: Prisma.Decimal }> {
  const r = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    select: { grandTotal: true, paidTotal: true },
  });
  return { grand: D(r.grandTotal), paid: D(r.paidTotal) };
}

async function paymentAllocated(id: string): Promise<Prisma.Decimal> {
  const r = await prisma.payment.findUniqueOrThrow({ where: { id }, select: { allocatedTotal: true } });
  return D(r.allocatedTotal);
}

async function chequeAllocated(id: string): Promise<Prisma.Decimal> {
  const r = await prisma.cheque.findUniqueOrThrow({ where: { id }, select: { allocatedTotal: true } });
  return D(r.allocatedTotal);
}

/**
 * ONAYLI fatura üretir — tutarı satırdan TAM belirlenir (KDV 0 → grandTotal = qty×fiyat).
 * Kur/vergi karmaşası bu bekçinin ölçtüğü şey değil; sade tutar okunabilirliği artırır.
 */
async function makeInvoice(opts: {
  customerId?: string;
  subcontractorId?: string;
  type?: "SALES" | "PURCHASE" | "SALES_RETURN";
  total: number;
  dueDate?: Date | null;
  issueDate?: Date;
  confirm?: boolean;
}): Promise<string> {
  const r = await invoiceService.createDraft({
    type: opts.type ?? "SALES",
    customerId: opts.customerId ?? null,
    subcontractorId: opts.subcontractorId ?? null,
    currency: "TRY",
    issueDate: opts.issueDate,
    dueDate: opts.dueDate ?? null,
    lines: [{ description: `${TAG} satır`, qty: 1, unitPrice: opts.total, vatRate: 0 }],
  });
  invoiceIds.push(r.data.id);
  if (opts.confirm !== false) await invoiceService.confirm(r.data.id);
  return r.data.id;
}

async function makePayment(opts: {
  customerId?: string;
  subcontractorId?: string;
  direction?: "IN" | "OUT";
  amount: number;
}): Promise<string> {
  const r = await paymentService.create({
    direction: opts.direction ?? "IN",
    method: "CASH",
    customerId: opts.customerId ?? null,
    subcontractorId: opts.subcontractorId ?? null,
    currency: "TRY",
    amount: opts.amount,
    cashBoxId,
  });
  paymentIds.push(r.data.id);
  return r.data.id;
}

/**
 * Çeki DOĞRUDAN Prisma ile yaratır.
 *
 * ⚠️ `cheque.service` (C1) PARALEL yazılıyor ve bu bekçi ona bağlanmaz: bağlansa
 * C1'in her ara hâli bu bekçiyi kırardı ve kırmızı, C2'de olmayan bir hatayı
 * işaret ederdi. Ölçtüğümüz şey zaten çekin YAŞAM DÖNGÜSÜ değil, çek SAYACININ
 * kapama tarafından doğru hareket ettirilmesi.
 */
async function makeCheque(opts: {
  cariId: string;
  amount: number;
  kind?: ChequeKind;
  status?: ChequeStatus;
}): Promise<string> {
  const c = await prisma.cheque.create({
    data: {
      docNo: `${TAG}-CK${chequeIds.length + 1}`.slice(0, 32),
      kind: opts.kind ?? ChequeKind.RECEIVED,
      status: opts.status ?? ChequeStatus.PORTFOLIO,
      cariId: opts.cariId,
      currency: "TRY",
      exchangeRate: 1,
      amount: opts.amount,
      amountTry: opts.amount,
      issueDate: new Date(),
      postingDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 86400_000),
    },
    select: { id: true },
  });
  chequeIds.push(c.id);
  return c.id;
}

async function main(): Promise<void> {
  console.log("=== Fatura kapama bekçisi ===\n");

  // ── FİKSTÜR ──────────────────────────────────────────────────────────────
  // Bekçi KENDİ tarafını yaratır: ortamdaki gerçek müşteriye dokunmak, onun
  // bakiyesini test temizliğinde silmek demekti (test_finance_invoice'ta
  // yaşanmış bir hata).
  const customer = await prisma.customer.create({ data: { code: TAG, name: `${TAG} Müşteri` }, select: { id: true } });
  customerIds.push(customer.id);
  const other = await prisma.customer.create({ data: { code: `${TAG}-B`, name: `${TAG} Diğer` }, select: { id: true } });
  customerIds.push(other.id);
  const box = await prisma.cashBox.create({
    data: { code: `${TAG}-KS`.slice(0, 32), name: `${TAG} Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxId = box.id;

  // ── §0 KÖRLÜK ZEMİNİ ─────────────────────────────────────────────────────
  // Bu bölüm olmadan §3/§4/§8'in "409 geldi" kontrolleri, servis tamamen bozuk
  // olsa da (her çağrı fırlatıyor olsa da) YEŞİL kalırdı.
  const inv1 = await makeInvoice({ customerId: customer.id, total: 1000 });
  const cari = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: customer.id }, select: { id: true } });
  cariIds.push(cari.id);
  const pay1 = await makePayment({ customerId: customer.id, amount: 1000 });

  const first = await paymentAllocationService.allocate({ invoiceId: inv1, paymentId: pay1, amount: 300 });
  check("§0a KÖRLÜK ZEMİNİ: kapama yazıldı", Boolean(first.data.id), first.data.id);
  check("§0b Fatura henüz KAPANMADI (kısmi)", first.data.invoiceClosed === false);

  // ── §1 KISMİ KAPAMA ──────────────────────────────────────────────────────
  {
    const c = await invoiceCounters(inv1);
    check("§1a Invoice.paidTotal 300 oldu", c.paid.equals(300), `paidTotal=${c.paid.toString()}`);
    check("§1b Payment.allocatedTotal 300 oldu", (await paymentAllocated(pay1)).equals(300));
    const open = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    const row = open.data.find((r) => r.id === inv1);
    check("§1c Fatura hâlâ AÇIK listede", Boolean(row), row ? `açık=${row.openTotal}` : "yok");
    check("§1d Açık tutar 700", row?.openTotal === "700");
  }

  // ── §2 ÇOKLU KAPAMA ──────────────────────────────────────────────────────
  // ⚠️ `@@unique([invoiceId, paymentId])` BİLİNÇLİ olarak yok (migration notu):
  // aynı tahsilatın aynı faturaya ikinci kısmi kapaması meşru bir düzeltmedir.
  {
    const second = await paymentAllocationService.allocate({ invoiceId: inv1, paymentId: pay1, amount: 700 });
    check("§2a İkinci kapama aynı fatura+kaynak için KABUL edildi", Boolean(second.data.id));
    check("§2b Fatura KAPANDI (türetilmiş, kolon değil)", second.data.invoiceClosed === true);
    const c = await invoiceCounters(inv1);
    check("§2c paidTotal === grandTotal", c.paid.equals(c.grand), `${c.paid.toString()}/${c.grand.toString()}`);
    const rows = await prisma.paymentAllocation.count({ where: { invoiceId: inv1 } });
    check("§2d İki AYRI kapama satırı duruyor", rows === 2, `satır=${rows}`);
    const open = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    check("§2e Kapanan fatura AÇIK listeden düştü", !open.data.some((r) => r.id === inv1));
  }

  // ── §3 AŞIRI KAPAMA ──────────────────────────────────────────────────────
  {
    const before = await invoiceCounters(inv1);
    const pay2 = await makePayment({ customerId: customer.id, amount: 500 });
    const m = await err(() => paymentAllocationService.allocate({ invoiceId: inv1, paymentId: pay2, amount: 1 }));
    // ⚠️ Hata metni TEK SATIRA indirilip basılır: ham Prisma hatası çok satırlıdır
    // ve kırmızı çıktığında ilk 80 karakter yalnız "Invalid `prisma.$executeRaw()`
    // invocation" gösterip ASIL sebebi (hangi CHECK/hangi tutar) gizler.
    check("§3a Kapalı faturaya 1 TL daha → RED", /kapatılabilecek tutar/i.test(m), m.replace(/\s+/g, " ").slice(0, 120));
    const after = await invoiceCounters(inv1);
    check("§3b Reddedilen kapama sayacı OYNATMADI", after.paid.equals(before.paid), `paidTotal=${after.paid.toString()}`);
    check("§3c Reddedilen kapama SATIR yazmadı", (await paymentAllocated(pay2)).isZero());
    check("§3d Kapama satır sayısı değişmedi", (await prisma.paymentAllocation.count({ where: { invoiceId: inv1 } })) === 2);

    // Kısmi aşım: 400'lük açık faturaya 500 yazılamaz (tam sığmayan reddedilir,
    // "sığdığı kadarını yaz" gibi bir sessiz kırpma YOK — kırpma kullanıcının
    // görmediği bir kapama üretirdi).
    const inv2 = await makeInvoice({ customerId: customer.id, total: 400 });
    const m2 = await err(() => paymentAllocationService.allocate({ invoiceId: inv2, paymentId: pay2, amount: 500 }));
    check("§3e Kısmen sığan kapama KIRPILMADAN reddedildi", /kapatılabilecek tutar/i.test(m2), m2.replace(/\s+/g, " ").slice(0, 120));
    check("§3f Kırpma olmadı (paidTotal 0 kaldı)", (await invoiceCounters(inv2)).paid.isZero());
  }

  // ── §4 KAYNAK TARAFI AŞIMI ───────────────────────────────────────────────
  {
    const invA = await makeInvoice({ customerId: customer.id, total: 5000 });
    const payS = await makePayment({ customerId: customer.id, amount: 500 });
    await paymentAllocationService.allocate({ invoiceId: invA, paymentId: payS, amount: 400 });
    const m = await err(() => paymentAllocationService.allocate({ invoiceId: invA, paymentId: payS, amount: 200 }));
    check("§4a Tahsilatın kalanını aşan kapama → RED", /kapamaya kalan tutar/i.test(m), m.slice(0, 80));
    check("§4b Kaynak sayacı 400'de kaldı", (await paymentAllocated(payS)).equals(400));
    // ⚠️ Fatura sayacı da geri sarmalı: fatura UPDATE'i kaynak UPDATE'inden ÖNCE
    // koşuyor; tx rollback etmeseydi fatura 600 kapanmış görünürdü ama parası
    // yalnız 400'dü — sessiz bir 200 TL kaybı.
    check("§4c Fatura sayacı da GERİ SARDI (tek tx)", (await invoiceCounters(invA)).paid.equals(400), `paidTotal=${(await invoiceCounters(invA)).paid.toString()}`);
  }

  // ── §5 EŞZAMANLI KAPAMA YARIŞI ───────────────────────────────────────────
  // ⚠️ `Promise.allSettled` burada MEŞRU: beş AYRI transaction var (perf kuralı
  // 11 tek tx client'ını paylaşmaya ilişkindir). Sıralı hale getirilirse bekçi
  // sessizce ölür — ölçtüğü şey tam olarak eşzamanlılıktır.
  {
    const invR = await makeInvoice({ customerId: customer.id, total: 1000 });
    const payR = await makePayment({ customerId: customer.id, amount: 5000 });
    const race = await Promise.allSettled(
      Array.from({ length: 5 }, () => paymentAllocationService.allocate({ invoiceId: invR, paymentId: payR, amount: 300 })),
    );
    const ok = race.filter((r) => r.status === "fulfilled").length;
    const c = await invoiceCounters(invR);
    check("§5a 1000'lik faturaya 5×300 yarışından TAM 3'ü geçti", ok === 3, `başarılı=${ok}`);
    check("§5b paidTotal grandTotal'ı AŞMADI", c.paid.lte(c.grand), `${c.paid.toString()} <= ${c.grand.toString()}`);
    check("§5c paidTotal geçen kapamalarla BİREBİR", c.paid.equals(D(ok).mul(300)), `paidTotal=${c.paid.toString()}`);
    check("§5d Kaynak sayacı da birebir", (await paymentAllocated(payR)).equals(D(ok).mul(300)));
    check("§5e Satır sayısı geçen kapama sayısıyla eşit", (await prisma.paymentAllocation.count({ where: { invoiceId: invR } })) === ok);
  }

  // ── §6 DEFTERE SATIR YAZMAZ ──────────────────────────────────────────────
  // Bakiye faturanın ONAYINDA ve tahsilatın KAYDINDA zaten oynadı. Kapama
  // üçüncü bir satır yazsaydı aynı para üçüncü kez muhasebeleşirdi.
  {
    const invL = await makeInvoice({ customerId: customer.id, total: 250 });
    const payL = await makePayment({ customerId: customer.id, amount: 250 });
    const txnBefore = await prisma.cariTransaction.count({ where: { cariId: cari.id } });
    const balBefore = D(
      (await prisma.cariBalance.findUniqueOrThrow({ where: { cariId_currency: { cariId: cari.id, currency: "TRY" } }, select: { balance: true } })).balance,
    );
    await paymentAllocationService.allocate({ invoiceId: invL, paymentId: payL, amount: 250 });
    const txnAfter = await prisma.cariTransaction.count({ where: { cariId: cari.id } });
    const balAfter = D(
      (await prisma.cariBalance.findUniqueOrThrow({ where: { cariId_currency: { cariId: cari.id, currency: "TRY" } }, select: { balance: true } })).balance,
    );
    check("§6a Kapama DEFTER SATIRI yazmadı", txnAfter === txnBefore, `${txnBefore} → ${txnAfter}`);
    check("§6b Kapama CARİ BAKİYEYİ oynatmadı", balAfter.equals(balBefore), `${balBefore.toString()} → ${balAfter.toString()}`);
  }

  // ── §7 STORNO ÇÖZÜLMESİ ──────────────────────────────────────────────────
  {
    // §7a ⭐ "ENTEGRASYON ATLANIRSA" KANITI
    // ------------------------------------------------------------------
    // Tahsilatı SERVİSTEN GEÇMEDEN elle CANCELLED'a çekmek, tam olarak
    // "entegrasyon satırı unutulmuş" durumunu üretir. Aşağıdaki iki kontrol o
    // durumun neye benzediğini KAYDA GEÇİRİR: fatura hâlâ kapalı görünür ve
    // açık faturalar listesinde HİÇ çıkmaz — yani alacak tahsil edilmeden
    // gözden kaybolur. Gerekçe, satır bir gün silinmek istendiğinde burada
    // duruyor olsun diye yazılıdır.
    //
    // ⚠️ Bu bölüm çağrının VARLIĞINI ölçmez, YOKLUĞUNUN bedelini ölçer.
    // Varlığı §7f uçtan uca doğrular — ikisi birlikte gerekli.
    const invP = await makeInvoice({ customerId: customer.id, total: 800 });
    const payP = await makePayment({ customerId: customer.id, amount: 800 });
    await paymentAllocationService.allocate({ invoiceId: invP, paymentId: payP, amount: 800 });
    await prisma.payment.update({ where: { id: payP }, data: { status: "CANCELLED", cancelledAt: new Date() } });

    const stale = await invoiceCounters(invP);
    check(
      "§7a1 KANIT: entegrasyon ATLANIRSA iptal edilmiş tahsilat faturayı KAPALI tutar",
      stale.paid.equals(800),
      `paidTotal=${stale.paid.toString()} (iptal edilmiş tahsilata rağmen)`,
    );
    const openStale = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    check(
      "§7a2 KANIT: fatura AÇIK listede GÖRÜNMEZ → yaşlandırma onu hiç saymaz",
      !openStale.data.some((r) => r.id === invP),
      "işte 'kapalı görünen ama parası yok olmuş fatura'",
    );

    // Şimdi entegrasyon satırının yaptığı işi yapalım — düzelmeli.
    const rel = await prisma.$transaction(async (tx) => releaseAllocationsForPaymentTx(tx, payP, { reason: "PAYMENT_CANCEL" }));
    check("§7b1 releaseAllocationsForPaymentTx kapamaları çözdü", rel.count === 1 && rel.total.equals(800), `count=${rel.count} total=${rel.total.toString()}`);
    check("§7b2 Fatura sayacı SIFIRLANDI", (await invoiceCounters(invP)).paid.isZero());
    check("§7b3 Kapama satırları SİLİNDİ", (await prisma.paymentAllocation.count({ where: { paymentId: payP } })) === 0);
    const openFixed = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    check("§7b4 Fatura AÇIK listeye GERİ DÖNDÜ", openFixed.data.some((r) => r.id === invP));

    // §7c FATURA STORNOSU → kaynak SERBEST kalır
    const invI = await makeInvoice({ customerId: customer.id, total: 600 });
    const payI = await makePayment({ customerId: customer.id, amount: 600 });
    await paymentAllocationService.allocate({ invoiceId: invI, paymentId: payI, amount: 600 });
    check("§7c1 Kapama öncesi kaynak bağlı", (await paymentAllocated(payI)).equals(600));
    const relI = await prisma.$transaction(async (tx) => releaseAllocationsForInvoiceTx(tx, invI, { reason: "INVOICE_CANCEL" }));
    check("§7c2 releaseAllocationsForInvoiceTx çözdü", relI.count === 1);
    check("§7c3 Tahsilat SERBEST kaldı (başka faturaya bağlanabilir)", (await paymentAllocated(payI)).isZero());
    const invI2 = await makeInvoice({ customerId: customer.id, total: 600 });
    const reused = await paymentAllocationService.allocate({ invoiceId: invI2, paymentId: payI, amount: 600 });
    check("§7c4 Serbest kalan tahsilat GERÇEKTEN yeniden kullanılabildi", Boolean(reused.data.id));

    // §7d ÇEK — C1'in çağıracağı export
    const chq = await makeCheque({ cariId: cari.id, amount: 900 });
    const invC = await makeInvoice({ customerId: customer.id, total: 900 });
    await paymentAllocationService.allocate({ invoiceId: invC, chequeId: chq, amount: 900 });
    check("§7d1 Çekle kapama yazıldı", (await chequeAllocated(chq)).equals(900));
    check("§7d2 Fatura çekle kapandı", (await invoiceCounters(invC)).paid.equals(900));
    // ⚠️ SÖZLEŞME DEĞİŞTİ (2026-08-14 sağlamlık paketi, Sınıf 4): eski fixture
    // "önce BOUNCED yap, sonra çöz" sırasını kuruyordu — DB CHECK'i
    // (`cheques_terminal_not_allocated`) o durumu artık TEMSİL EDİLEMEZ yapıyor
    // ve bu fixture'ın ham `update`ini yakalayarak İLK işini burada gördü.
    // Yeni sözleşme: kapamalı çek karşılıksız İŞARETLENEMEZ (409 "kapamayı
    // kaldırın") → gerçek sıra ÇÖZ → sonra BOUNCE. Test o sırayı kurar.
    const relC = await prisma.$transaction(async (tx) => releaseAllocationsForChequeTx(tx, chq, { reason: "CHEQUE_BOUNCE" }));
    check("§7d3 releaseAllocationsForChequeTx çözdü", relC.count === 1 && relC.total.equals(900));
    check("§7d4 Fatura yeniden AÇIK", (await invoiceCounters(invC)).paid.isZero());
    check("§7d5 Çek sayacı sıfırlandı", (await chequeAllocated(chq)).isZero());
    // Çözüldükten SONRA terminal geçiş serbest — CHECK artık izin verir.
    await prisma.cheque.update({ where: { id: chq }, data: { status: ChequeStatus.BOUNCED } });
    check(
      "§7d6 Kapama çözüldükten sonra BOUNCED geçişi CHECK'ten geçti",
      (await prisma.cheque.findUniqueOrThrow({ where: { id: chq }, select: { status: true } })).status ===
        ChequeStatus.BOUNCED,
    );
    // ⚠️ CHECK'in kendisi §12d'nin ikizi olarak DB'de: kapamalı çeki ham SQL ile
    // BOUNCED yapmayı deneyen HERHANGİ bir yol (bekçisiz refactor dahil) 23514 alır.

    // Boş küme: idempotent ve sessiz.
    const relEmpty = await prisma.$transaction(async (tx) => releaseAllocationsForChequeTx(tx, chq));
    check("§7e Kapaması olmayan kaynakta çözülme NO-OP", relEmpty.count === 0 && relEmpty.total.isZero());

    // ── §7f UÇTAN UCA: ENTEGRASYON SATIRI GERÇEKTEN BAĞLI MI ────────────────
    // ⚠️ §7a/§7b yardımcının KENDİSİNİ ölçer; bu bölüm onun ÇAĞRILDIĞINI ölçer
    // ve ikisi FARKLI sorulardır. Yardımcı kusursuz çalışsa bile çağrı satırı
    // `payment.service.cancel()` / `invoice.service.cancel()` içinden bir
    // refactor'da düşerse hiçbir şey kırmızı vermez — modülün önlemek için var
    // olduğu "kapalı görünen ama parası yok olmuş fatura" sessizce geri gelir.
    // Bu yüzden storno GERÇEK SERVİSTEN geçirilir, elle CANCELLED yazılmaz.
    const invE = await makeInvoice({ customerId: customer.id, total: 700 });
    const payE = await makePayment({ customerId: customer.id, amount: 700 });
    await paymentAllocationService.allocate({ invoiceId: invE, paymentId: payE, amount: 700 });
    check("§7f1 Ön koşul: fatura kapandı", (await invoiceCounters(invE)).paid.equals(700));
    await paymentService.cancel(payE, "bekçi storno");
    check(
      "§7f2 paymentService.cancel() kapamayı ÇÖZDÜ (entegrasyon satırı bağlı)",
      (await invoiceCounters(invE)).paid.isZero(),
      `paidTotal=${(await invoiceCounters(invE)).paid.toString()}`,
    );
    check("§7f3 Kapama satırı silindi", (await prisma.paymentAllocation.count({ where: { paymentId: payE } })) === 0);
    const openE = await paymentAllocationService.listOpenInvoices({ cariId: cari.id, currency: "TRY", direction: PaymentDirection.IN });
    check("§7f4 Fatura AÇIK listeye döndü (yaşlandırma onu yine sayar)", openE.data.some((r) => r.id === invE));

    // Fatura tarafı: iptal edilen fatura tahsilatı SERBEST bırakmalı.
    const invF = await makeInvoice({ customerId: customer.id, total: 400 });
    const payF = await makePayment({ customerId: customer.id, amount: 400 });
    await paymentAllocationService.allocate({ invoiceId: invF, paymentId: payF, amount: 400 });
    await invoiceService.cancel(invF, "bekçi storno");
    check(
      "§7f5 invoiceService.cancel() tahsilatı SERBEST bıraktı",
      (await paymentAllocated(payF)).isZero(),
      `allocatedTotal=${(await paymentAllocated(payF)).toString()}`,
    );
  }

  // ── §8 BİLİNÇLİ DAR KURALLAR ─────────────────────────────────────────────
  {
    const invX = await makeInvoice({ customerId: customer.id, total: 100 });

    // Farklı cari
    const payOther = await makePayment({ customerId: other.id, amount: 100 });
    const otherCari = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: other.id }, select: { id: true } });
    cariIds.push(otherCari.id);
    const m1 = await err(() => paymentAllocationService.allocate({ invoiceId: invX, paymentId: payOther, amount: 100 }));
    check("§8a Farklı carinin ödemesiyle kapama → RED", /başka bir cariye ait/i.test(m1), m1.slice(0, 70));

    // Yön: ÖDEME (OUT) satış faturasını kapatamaz
    const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} Fason` }, select: { id: true } });
    subcontractorIds.push(sub.id);
    const payOut = await makePayment({ subcontractorId: sub.id, direction: "OUT", amount: 100 });
    const subCari = await prisma.cariAccount.findFirstOrThrow({ where: { subcontractorId: sub.id }, select: { id: true } });
    cariIds.push(subCari.id);
    const invSalesForSub = await makeInvoice({ subcontractorId: sub.id, type: "SALES", total: 100 });
    const m2 = await err(() => paymentAllocationService.allocate({ invoiceId: invSalesForSub, paymentId: payOut, amount: 100 }));
    check("§8b ÖDEME (OUT) satış faturasını kapatamaz", /ÖDEMEDİR/i.test(m2), m2.slice(0, 70));
    // Körlük zemini: aynı ödeme ALIŞ faturasını kapatabilmeli (kural yön ayrımı
    // yapıyor, "her şeyi reddet" değil).
    const invPurchase = await makeInvoice({ subcontractorId: sub.id, type: "PURCHASE", total: 100 });
    const okOut = await paymentAllocationService.allocate({ invoiceId: invPurchase, paymentId: payOut, amount: 100 });
    check("§8c KÖRLÜK ZEMİNİ: aynı ödeme ALIŞ faturasını kapattı", Boolean(okOut.data.id));

    // İade faturası kapsam DIŞI (Faz 3) — ama sebebi söylenerek
    const invRet = await makeInvoice({ customerId: customer.id, type: "SALES_RETURN", total: 50 });
    const payRet = await makePayment({ customerId: customer.id, amount: 50 });
    const m3 = await err(() => paymentAllocationService.allocate({ invoiceId: invRet, paymentId: payRet, amount: 50 }));
    check("§8d İade faturası kapama kapsamı DIŞINDA (sebep söyleniyor)", /TAHSİLATTIR|SATIŞ faturasını/i.test(m3), m3.slice(0, 70));

    // TASLAK fatura
    const invDraft = await makeInvoice({ customerId: customer.id, total: 90, confirm: false });
    const m4 = await err(() => paymentAllocationService.allocate({ invoiceId: invDraft, paymentId: payRet, amount: 50 }));
    check("§8e TASLAK fatura kapatılamaz", /onaylanmamış/i.test(m4), m4.slice(0, 70));

    // İPTAL edilmiş tahsilat
    await prisma.payment.update({ where: { id: payRet }, data: { status: "CANCELLED" } });
    const invY = await makeInvoice({ customerId: customer.id, total: 50 });
    const m5 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, paymentId: payRet, amount: 50 }));
    check("§8f İPTAL edilmiş tahsilatla kapama → RED", /iptal edilmiş/i.test(m5), m5.slice(0, 70));

    // KARŞILIKSIZ çek
    const bad = await makeCheque({ cariId: cari.id, amount: 50, status: ChequeStatus.BOUNCED });
    const m6 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, chequeId: bad, amount: 50 }));
    check("§8g KARŞILIKSIZ çekle kapama → RED", /BOUNCED|kapatılamaz/i.test(m6), m6.slice(0, 70));

    // VERİLEN çek satış faturasını kapatamaz
    const issued = await makeCheque({ cariId: cari.id, amount: 50, kind: ChequeKind.ISSUED, status: ChequeStatus.ISSUED });
    const m7 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, chequeId: issued, amount: 50 }));
    check("§8h VERİLEN çek SATIŞ faturasını kapatamaz", /VERİLEN/i.test(m7), m7.slice(0, 70));

    // XOR: iki kaynak birden / hiçbiri
    const m8 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, paymentId: pay1, chequeId: issued, amount: 10 }));
    check("§8i İki kaynak birden → RED (XOR)", /VEYA çek seçilmeli/i.test(m8), m8.slice(0, 60));
    const m9 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, amount: 10 }));
    check("§8j Kaynaksız kapama → RED (XOR)", /VEYA çek seçilmeli/i.test(m9), m9.slice(0, 60));

    // Sıfır/negatif tutar
    const m10 = await err(() => paymentAllocationService.allocate({ invoiceId: invY, paymentId: pay1, amount: 0 }));
    check("§8k Sıfır tutarlı kapama → RED", /sıfırdan büyük/i.test(m10), m10.slice(0, 60));

    // BULK hepsi-ya-hiç
    const invB1 = await makeInvoice({ customerId: customer.id, total: 100 });
    const invB2 = await makeInvoice({ customerId: customer.id, total: 100 });
    const payB = await makePayment({ customerId: customer.id, amount: 150 });
    const mBulk = await err(() =>
      paymentAllocationService.allocateBulk({
        paymentId: payB,
        items: [
          { invoiceId: invB1, amount: 100 },
          { invoiceId: invB2, amount: 100 },
        ],
      }),
    );
    check("§8l BULK: ikincisi sığmayınca tamamı reddedildi", /kapamaya kalan tutar/i.test(mBulk), mBulk.slice(0, 70));
    check("§8m BULK: İLK satır da yazılmadı (hepsi-ya-hiç)", (await invoiceCounters(invB1)).paid.isZero());
    check("§8n BULK: kaynak sayacı da temiz", (await paymentAllocated(payB)).isZero());
    const okBulk = await paymentAllocationService.allocateBulk({
      paymentId: payB,
      items: [
        { invoiceId: invB1, amount: 100 },
        { invoiceId: invB2, amount: 50 },
      ],
    });
    check("§8o KÖRLÜK ZEMİNİ: sığan BULK dağıtım yazıldı", okBulk.data.count === 2 && okBulk.data.total === "150");
  }

  // ── §9 ROTA TARAMASI ─────────────────────────────────────────────────────
  // `test_finance_flag_off` §4 YALNIZ `finance.routes.ts`'i okur; alt router'ın
  // uçları o taramaya GİRMEZ. Aynı iki güvence burada, kendi dosyası üzerinde
  // ölçülür — yoksa bayrak/izin kapısı alt router'da sessizce eksik kalabilirdi.
  {
    const src = readFileSync(join(__dirname, "..", "src", "routes", "finance-allocation.routes.ts"), "utf8");
    const endpoints = (src.match(/router\.(get|post|patch|delete)\(/g) ?? []).length;
    check("§9a KÖRLÜK ZEMİNİ: taramada uç bulundu", endpoints >= 5, `uç=${endpoints}`);
    const guardless = src
      .split("\n")
      .filter((l) => /router\.(get|post|patch|delete)\(/.test(l) && !/requirePermission\(/.test(l));
    check(
      "§9b Alt router'ın HER ucu izin guard'ı taşıyor",
      guardless.length === 0,
      guardless.length > 0 ? guardless.map((l) => l.trim().slice(0, 50)).join(" | ") : "guard'sız uç yok",
    );
    // Yazan uçlar `finance:payment`, okuyanlar `finance:read` — yeni izin AÇILMADI.
    const newPerm = src.match(/requirePermission\("([^"]+)"\)/g) ?? [];
    const unexpected = newPerm.filter((p) => !/finance:(read|payment)/.test(p));
    check("§9c Yeni izin kodu AÇILMADI (yalnız finance:read / finance:payment)", unexpected.length === 0, unexpected.join(", ") || "temiz");

    // Bayrak kapısı: alt router `app.ts`'e DEĞİL, finance.routes'a mount edilmeli.
    const parent = readFileSync(join(__dirname, "..", "src", "routes", "finance.routes.ts"), "utf8");
    check(
      "§9d Alt router bayrak kapılı ana router'a mount edilmiş",
      /router\.use\(\s*"\/allocations"\s*,/.test(parent),
      "finance.routes.ts → router.use('/allocations', ...)",
    );
    const app = readFileSync(join(__dirname, "..", "src", "app.ts"), "utf8");
    check(
      "§9e `app.ts` kapama router'ını DOĞRUDAN mount ETMİYOR (bayrak kapısı atlanmasın)",
      !/finance-allocation/.test(app),
      "app.ts temiz",
    );
  }

  // ── §10 FIFO ÖNERİSİ ─────────────────────────────────────────────────────
  {
    // Saf fonksiyon önce — dağıtım mantığı DB'siz ölçülür.
    const dist = suggestFifo([D(100), D(200), D(300)], D(250));
    check(
      "§10a suggestFifo en eskiden başlayarak dağıtır",
      dist.map((d) => d.toString()).join("/") === "100/150/0",
      dist.map((d) => d.toString()).join("/"),
    );
    const distOver = suggestFifo([D(100)], D(500));
    check("§10b Fazla tutar taşmaz (açık kadar dağıtılır)", distOver[0]?.equals(100) === true);
    check("§10c Kalan artık ÖNERİLMEZ (sanal kapama uydurulmaz)", suggestFifo([], D(500)).length === 0);

    // Sıralama: vadesi ÖNCE olan üstte, vadesizde keşide tarihi geçerli.
    const fifoCustomer = await prisma.customer.create({ data: { code: `${TAG}-F2`, name: `${TAG} FIFO` }, select: { id: true } });
    customerIds.push(fifoCustomer.id);
    const day = 86400_000;
    const late = await makeInvoice({ customerId: fifoCustomer.id, total: 100, dueDate: new Date(Date.now() + 30 * day) });
    const early = await makeInvoice({ customerId: fifoCustomer.id, total: 200, dueDate: new Date(Date.now() + 5 * day) });
    // Vadesiz ama ÇOK ESKİ keşideli: efektif vade `issueDate`'tir → en üstte
    // olmalı. `dueDate` nulls-last ile sıralansaydı en ALTA düşer ve FIFO
    // önerisi en eski borcu en son öderdi.
    const oldNoDue = await makeInvoice({ customerId: fifoCustomer.id, total: 300, dueDate: null, issueDate: new Date(Date.now() - 100 * day) });
    const fifoCari = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: fifoCustomer.id }, select: { id: true } });
    cariIds.push(fifoCari.id);

    const open = await paymentAllocationService.listOpenInvoices({
      cariId: fifoCari.id,
      currency: "TRY",
      direction: PaymentDirection.IN,
      amount: 350,
    });
    const order = open.data.map((r) => r.id);
    check("§10d Efektif vade sırası: vadesiz-eski → yakın vade → uzak vade", order.join(",") === [oldNoDue, early, late].join(","), order.length === 3 ? "3 fatura doğru sırada" : `sıra=${order.length}`);
    check("§10e Toplam açık doğru", open.totalOpen === "600", open.totalOpen);
    check(
      "§10f FIFO önerisi tutarı sırayla dağıttı (300/50/0)",
      open.data.map((r) => r.suggested).join("/") === "300/50/0",
      open.data.map((r) => r.suggested).join("/"),
    );
    // Determinizm: aynı sorgu iki kez → aynı sıra.
    const again = await paymentAllocationService.listOpenInvoices({ cariId: fifoCari.id, currency: "TRY", direction: PaymentDirection.IN });
    check("§10g Sıra DETERMİNİSTİK (aynı sorgu → aynı sıra)", again.data.map((r) => r.id).join(",") === order.join(","));
    // `amount` verilmezse öneri HİÇ üretilmez — okuma ucu sessizce kapama önermez.
    check("§10h `amount` yokken öneri alanı BASILMAZ", again.data.every((r) => r.suggested === undefined));

    // Serbest tahsilat listesi
    const freePay = await makePayment({ customerId: fifoCustomer.id, amount: 400 });
    await paymentAllocationService.allocate({ invoiceId: oldNoDue, paymentId: freePay, amount: 300 });
    const un = await paymentAllocationService.listUnallocatedPayments({ cariId: fifoCari.id, currency: "TRY", direction: PaymentDirection.IN });
    const freeRow = un.data.find((r) => r.id === freePay);
    check("§10i Serbest tahsilat listesi kalanı doğru gösterdi", freeRow?.freeTotal === "100", freeRow?.freeTotal ?? "yok");
    check("§10j Tamamen bağlanmış tahsilat listede YOK", !un.data.some((r) => r.id === pay1));
  }

  // ── §11 DEALLOCATE (elle düzeltme) ───────────────────────────────────────
  {
    const invD = await makeInvoice({ customerId: customer.id, total: 700 });
    const payD = await makePayment({ customerId: customer.id, amount: 700 });
    const a = await paymentAllocationService.allocate({ invoiceId: invD, paymentId: payD, amount: 700 });
    await paymentAllocationService.deallocate(a.data.id);
    check("§11a Kapama çözüldü — fatura sayacı sıfır", (await invoiceCounters(invD)).paid.isZero());
    check("§11b Kaynak sayacı sıfır", (await paymentAllocated(payD)).isZero());
    check("§11c Satır silindi", (await prisma.paymentAllocation.count({ where: { id: a.data.id } })) === 0);
    const m = await err(() => paymentAllocationService.deallocate(a.data.id));
    check("§11d İkinci çözme → 404 (sayaç İKİNCİ KEZ düşmez)", /bulunamadı/i.test(m), m.slice(0, 60));
  }

  // ── §12 SINIF 4 — TERMİNAL ÇEK SÜZGECİ ATOMİK + count-0 TANISI ──────────
  // (2026-08-14 sağlamlık paketi.) Ön kontrol `loadChequeTx` İYİ MESAJ içindir;
  // gerçek koruma `bumpChequeAllocated`'ın WHERE'indeki durum süzgecidir ve
  // yalnız YARIŞTA yük taşır. Yarış penceresi burada DETERMİNİSTİK üretilir:
  // elle açılan bir tx çeki BOUNCED'a çekip satır kilidini TUTAR; allocate'in
  // ön kontrolü (read-committed, kilitlenmez) hâlâ PORTFOLIO okur, bump ise
  // kilitte bekler; tx commit edince koşul kilit altında YENİDEN değerlendirilir
  // (EvalPlanQual) → 0 satır → taze-okuma tanısı anlamlı 409 basar.
  {
    const chqT = await makeCheque({ cariId: cari.id, amount: 500 });
    const invT = await makeInvoice({ customerId: customer.id, total: 500 });

    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => (releaseGate = r));
    const bounceTx = prisma.$transaction(async (tx) => {
      await tx.cheque.updateMany({
        where: { id: chqT, status: ChequeStatus.PORTFOLIO },
        data: { status: ChequeStatus.BOUNCED },
      });
      await gate; // satır kilidini commit'e kadar tut
    });
    void bounceTx.catch(() => undefined); // erken red = sahipsiz rejection → süreç ölür (bkz. §12m notu)
    await sleep(80); // updateMany kilidi aldı
    const allocP = err(() => paymentAllocationService.allocate({ invoiceId: invT, chequeId: chqT, amount: 300 }));
    await sleep(200); // allocate ön kontrolü geçti, bump kilitte bekliyor
    releaseGate();
    await bounceTx;
    const mT = await allocP;
    check(
      "§12a Kilit-altı yarışta kaybeden allocate ANLAMLI 409 aldı (tavan değil, 'parası yok')",
      /karşılıksız\/iade\/iptal çekle kapama yapılamaz/.test(mT),
      mT.replace(/\s+/g, " ").slice(0, 130),
    );
    check("§12b Fatura sayacı GERİ SARDI (bump'tan önce yazılmıştı)", (await invoiceCounters(invT)).paid.isZero());
    check("§12c Çek sayacına tek kuruş yazılmadı", (await chequeAllocated(chqT)).isZero());
    check(
      "§12d Çek BOUNCED kaldı (sonda tx'i kazandı)",
      (await prisma.cheque.findUniqueOrThrow({ where: { id: chqT }, select: { status: true } })).status ===
        ChequeStatus.BOUNCED,
    );

    // KÖRLÜK ZEMİNİ: tanı dalı TAVAN mesajını yutmamalı — canlı çekte 0'ın
    // sebebi hâlâ tavansa eski mesaj aynen konuşur.
    const chqLive = await makeCheque({ cariId: cari.id, amount: 100 });
    const invLive = await makeInvoice({ customerId: customer.id, total: 300 });
    await paymentAllocationService.allocate({ invoiceId: invLive, chequeId: chqLive, amount: 100 });
    const mCap = await err(() => paymentAllocationService.allocate({ invoiceId: invLive, chequeId: chqLive, amount: 50 }));
    check("§12e KÖRLÜK ZEMİNİ: canlı çekte tavan aşımı hâlâ TAVAN mesajı basıyor", /kapamaya kalan tutar/i.test(mCap), mCap.slice(0, 80));

    // Ön kontrol yüzeyi: BOUNCED'ı §8g ölçtü; RETURNED + CANCELLED de aynı
    // kapıdan reddedilmeli (küme üç üyeli — biri düşerse burası kırmızı).
    const chqRet = await makeCheque({ cariId: cari.id, amount: 40, status: ChequeStatus.RETURNED });
    const chqCan = await makeCheque({ cariId: cari.id, amount: 40, status: ChequeStatus.CANCELLED });
    const mRet = await err(() => paymentAllocationService.allocate({ invoiceId: invLive, chequeId: chqRet, amount: 10 }));
    const mCan = await err(() => paymentAllocationService.allocate({ invoiceId: invLive, chequeId: chqCan, amount: 10 }));
    check("§12f RETURNED çekle kapama → RED", /kapatılamaz/i.test(mRet), mRet.slice(0, 70));
    check("§12g CANCELLED çekle kapama → RED", /kapatılamaz/i.test(mCan), mCan.slice(0, 70));

    // Kaynak taraması: SQL süzgeci ile ön kontrol AYNI sabitten okumalı — elle
    // yazılmış ikinci bir liste, tam da kapatılan "BİREBİR tut" yorum-kuralını
    // geri getirirdi. Küme de üç üyeli kalmalı (COLLECTED sızarsa kırmızı).
    const svcSrc = readFileSync(join(__dirname, "..", "src", "services", "payment-allocation.service.ts"), "utf8");
    const constUses = (svcSrc.match(/CHEQUE_NO_MONEY_STATUSES/g) ?? []).length;
    check("§12h KÖRLÜK ZEMİNİ + tek kaynak: sabit tanım + SQL + ön kontrol (≥3 kullanım)", constUses >= 3, `kullanım=${constUses}`);
    check(
      "§12i SQL süzgeci sabitten besleniyor (elle liste değil)",
      /AND NOT \("status" = ANY\(\$\{\[\.\.\.CHEQUE_NO_MONEY_STATUSES\]\}/.test(svcSrc),
      "bumpChequeAllocated WHERE",
    );
    check(
      "§12j Küme üç üyeli ve COLLECTED içermiyor",
      CHEQUE_NO_MONEY_STATUSES.length === 3 && !CHEQUE_NO_MONEY_STATUSES.includes(ChequeStatus.COLLECTED),
      CHEQUE_NO_MONEY_STATUSES.join(","),
    );

    // §12k-l TAHSİLAT İKİZİ — allocate ‖ payment.cancel yarışı, deterministik:
    // elle açılan tx tahsilatı CANCELLED'a çekip satır kilidini tutar; allocate
    // ön kontrolü hâlâ ACTIVE okur (MVCC), `bumpPaymentAllocated` kilitte
    // bekler; commit sonrası WHERE'deki `status='ACTIVE'` koşulu 0 döndürür →
    // tanı (`explainPaymentBumpZeroTx`) "iptal edildi" demeli. Tavan mesajı
    // burada YALAN olurdu: kalan tutar değil, kaynağın KENDİSİ yok (§12a'nın
    // çekteki gerekçesinin birebir tahsilat ikizi).
    const payK = await makePayment({ customerId: customer.id, amount: 500 });
    const invK = await makeInvoice({ customerId: customer.id, total: 500 });
    let releasePayGate!: () => void;
    const payGate = new Promise<void>((r) => (releasePayGate = r));
    const cancelPayTx = prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { id: payK, status: "ACTIVE" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await payGate; // satır kilidini commit'e kadar tut
    });
    void cancelPayTx.catch(() => undefined); // erken red = sahipsiz rejection → süreç ölür (bkz. §12m notu)
    await sleep(80);
    const allocK = err(() => paymentAllocationService.allocate({ invoiceId: invK, paymentId: payK, amount: 300 }));
    await sleep(200);
    releasePayGate();
    await cancelPayTx;
    const mK = await allocK;
    check(
      "§12k Tahsilat bu sırada iptal edilince kaybeden 'iptal edildi' dedi (tavan mesajı DEĞİL)",
      /bu sırada iptal edildi/.test(mK),
      mK.replace(/\s+/g, " ").slice(0, 120),
    );
    check(
      "§12l Fatura sayacı GERİ SARDI + tahsilat sayacına yazılmadı",
      (await invoiceCounters(invK)).paid.isZero() && (await paymentAllocated(payK)).isZero(),
      `paid=${(await invoiceCounters(invK)).paid.toString()}`,
    );

    // §12m-n FATURA İKİZİ — allocate ‖ invoice.cancel: fatura bump'ı allocate'in
    // İLK yazımı olduğu için pencere oradadır; `status='CONFIRMED'` koşulu 0
    // döndürünce tanı (`explainInvoiceBumpZeroTx`) faturanın iptalini söylemeli.
    const invM = await makeInvoice({ customerId: customer.id, total: 500 });
    const payM = await makePayment({ customerId: customer.id, amount: 500 });
    let releaseInvGate!: () => void;
    const invGate = new Promise<void>((r) => (releaseInvGate = r));
    const cancelInvTx = prisma.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: { id: invM, status: "CONFIRMED" },
        // ⚠️ `cancelledAt` ZORUNLU: DB CHECK'i `invoices_status_stamps`
        // damgasız CANCELLED'ı reddediyor — ilk yazımda eksikti ve sed, sonda
        // fixture'ını yakalayarak İLK işini burada gördü (§7d'nin ikizi).
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      await invGate;
    });
    // Gate tx'i erken reddederse (CHECK/bağlantı) await'e kadar SAHİPSİZ
    // kalır → Node 22 unhandled rejection'ı FATAL sayar ve süreç Sonuç/temizlik
    // basmadan ölür (ilk koşumda ölçüldü). No-op catch süreci ayakta tutar;
    // aşağıdaki `await cancelInvTx` gerçek hatayı yine fırlatır.
    void cancelInvTx.catch(() => undefined);
    await sleep(80);
    const allocM = err(() => paymentAllocationService.allocate({ invoiceId: invM, paymentId: payM, amount: 300 }));
    await sleep(200);
    releaseInvGate();
    await cancelInvTx;
    const mM = await allocM;
    check(
      "§12m Fatura bu sırada iptal edilince kaybeden 'iptal edildi' dedi (tavan mesajı DEĞİL)",
      /bu sırada iptal edildi/.test(mM),
      mM.replace(/\s+/g, " ").slice(0, 120),
    );
    check("§12n Tahsilat sayacına tek kuruş yazılmadı", (await paymentAllocated(payM)).isZero());
  }

  // ── §13 EŞZAMANLILIK: allocate ‖ bounce (5 tur) ─────────────────────────
  // `test_kk1_duplicate_guard` emsali: gerçek yarış, gerçek servisler. Her tur
  // taze çek+fatura ile allocate ve chequeService.bounce AYNI ANDA ateşlenir.
  // Sözleşme: tam olarak BİR taraf kazanır; kaybeden hangi katmana takılırsa
  // takılsın (ön kontrol · atomik süzgeç tanısı · claim · DB CHECK'i) operatöre
  // 409 olarak eşlenir (500 ASLA); BOUNCED + canlı kapama BİRLİKTE var olamaz.
  {
    const rounds: Array<{
      allocOk: boolean;
      bounceOk: boolean;
      loserStatus: number;
      loserMsg: string;
      consistent: boolean;
    }> = [];
    for (let i = 0; i < 5; i++) {
      const chq = await makeCheque({ cariId: cari.id, amount: 400 });
      const inv = await makeInvoice({ customerId: customer.id, total: 400 });
      // ⚠️ Tek turlu eşzamanlı ateşlemede bounce'ın tx'i kısa olduğu için hep o
      // kazanıyordu (ilk koşumda ölçüldü: BBBBB) ve "allocate kazandı → bounce
      // anlamlı 409 aldı" yönü hiç ölçülmüyordu. Tek sayılı turlarda bounce
      // 100 ms geciktirilir ki iki yön de yaşansın; kontroller yine kazanan-
      // agnostiktir (yarış yarıştır, sıra garanti edilmez).
      const bounceDelayed = i % 2 === 1;
      const [a, b] = await Promise.allSettled([
        paymentAllocationService.allocate({ invoiceId: inv, chequeId: chq, amount: 400 }),
        (async () => {
          if (bounceDelayed) await sleep(100);
          return chequeService.bounce(chq, {});
        })(),
      ]);
      const allocOk = a.status === "fulfilled";
      const bounceOk = b.status === "fulfilled";
      const loser = allocOk ? b : a;
      const mapped =
        loser.status === "rejected" ? mapThroughErrorHandler(loser.reason) : { status: -1, message: "" };

      const after = await prisma.cheque.findUniqueOrThrow({
        where: { id: chq },
        select: { status: true, allocatedTotal: true },
      });
      const allocRows = await prisma.paymentAllocation.count({ where: { chequeId: chq } });
      // Tur tutarlılığı: bounce kazandıysa çekte NE satır NE sayaç kalır;
      // allocate kazandıysa çek BOUNCED değildir ve satır+sayaç birebirdir.
      const consistent = bounceOk
        ? after.status === ChequeStatus.BOUNCED && D(after.allocatedTotal).isZero() && allocRows === 0
        : after.status !== ChequeStatus.BOUNCED && D(after.allocatedTotal).equals(400) && allocRows === 1;
      rounds.push({ allocOk, bounceOk, loserStatus: mapped.status, loserMsg: mapped.message, consistent });
    }
    const winners = rounds.map((r) => (r.allocOk ? "A" : r.bounceOk ? "B" : "-")).join("");
    check(
      "§13a Her turda TAM BİR taraf kazandı",
      rounds.every((r) => r.allocOk !== r.bounceOk),
      `kazananlar=${winners}`,
    );
    check(
      "§13b Kaybeden HER turda 409'a eşlendi (500 ASLA)",
      rounds.every((r) => r.loserStatus === 409),
      rounds.map((r) => r.loserStatus).join(","),
    );
    check(
      "§13c Kaybedenin mesajı Türkçe ve yol gösteriyor",
      rounds.every((r) => r.loserMsg.length > 10),
      rounds[0]?.loserMsg.slice(0, 90),
    );
    check("§13d Tur sonu DB tutarlı (BOUNCED ⊕ kapama)", rounds.every((r) => r.consistent), winners);
    check(
      "§13d2 İKİ YÖN DE yaşandı (allocate kazanan tur + bounce kazanan tur)",
      winners.includes("A") && winners.includes("B"),
      `kazananlar=${winners} — tek harf görüyorsan gecikme dengesini (100ms) gözden geçir`,
    );
    // Küresel sed ölçümü: parasız-terminal + canlı kapama HİÇBİR satırda yok.
    const terminalAllocated = await prisma.cheque.count({
      where: { status: { in: [...CHEQUE_NO_MONEY_STATUSES] }, allocatedTotal: { gt: 0 } },
    });
    check("§13e TÜM DB: parasız-terminal çekte canlı kapama tutarı YOK", terminalAllocated === 0, `satır=${terminalAllocated}`);
  }

  // ── §14 SINIF 3: VİRMAN — ayna çift yarışı + kanonik kilit sırası ───────
  {
    const mk = async (suffix: string): Promise<string> => {
      const b = await prisma.cashBox.create({
        data: { code: `${TAG}-${suffix}`.slice(0, 32), name: `${TAG} ${suffix}`, currency: "TRY" },
        select: { id: true },
      });
      cashBoxIds.push(b.id);
      return b.id;
    };
    const boxA = await mk("VA");
    const boxB = await mk("VB");
    await cashTransactionService.create({ kind: "OPENING", amount: 1000, cashBoxId: boxA, exchangeRate: 1 });
    await cashTransactionService.create({ kind: "OPENING", amount: 1000, cashBoxId: boxB, exchangeRate: 1 });

    // Ayna çift: A→B ‖ B→A, 3 tur. Kanonik sıra ile deadlock YAPISAL olarak
    // imkânsız; yine de bir hata sızarsa 500'e değil 409'a eşlenmeli (§15 ağı).
    let fulfilled = 0;
    let netAtoB = 0;
    const mappedFails: number[] = [];
    for (let i = 0; i < 3; i++) {
      const [ab, ba] = await Promise.allSettled([
        cashTransactionService.transfer({ fromCashBoxId: boxA, toCashBoxId: boxB, amount: 10 }),
        cashTransactionService.transfer({ fromCashBoxId: boxB, toCashBoxId: boxA, amount: 10 }),
      ]);
      if (ab.status === "fulfilled") {
        fulfilled++;
        netAtoB += 10;
      } else mappedFails.push(mapThroughErrorHandler(ab.reason).status);
      if (ba.status === "fulfilled") {
        fulfilled++;
        netAtoB -= 10;
      } else mappedFails.push(mapThroughErrorHandler(ba.reason).status);
    }
    check("§14a Ayna çift yarışında hiçbir bacak 500'e eşlenmedi", mappedFails.every((s) => s === 409), `haritalar=${mappedFails.join(",") || "hata yok"}`);
    const balA = D((await prisma.cashBox.findUniqueOrThrow({ where: { id: boxA }, select: { balance: true } })).balance);
    const balB = D((await prisma.cashBox.findUniqueOrThrow({ where: { id: boxB }, select: { balance: true } })).balance);
    check("§14b Para KORUNDU (A+B toplamı sabit)", balA.plus(balB).equals(2000), `${balA.toString()} + ${balB.toString()}`);
    check(
      "§14c Bakiyeler geçen bacaklarla BİREBİR",
      balA.equals(D(1000).minus(netAtoB)) && balB.equals(D(1000).plus(netAtoB)),
      `A=${balA.toString()} B=${balB.toString()} net=${netAtoB} geçen=${fulfilled}/6`,
    );

    // İptal bacağı (kanonik sıraya alınan İKİNCİ yol) işlevsel: virman + iptal
    // → iki bacak birden CANCELLED, bakiyeler geri.
    const tr = await cashTransactionService.transfer({ fromCashBoxId: boxA, toCashBoxId: boxB, amount: 50 });
    const cn = await cashTransactionService.cancel(tr.data.ids[0] as string, "bekçi iptal sondası");
    check("§14d Virman iptali iki bacağı birden aldı ve bakiyeler geri sardı",
      cn.data.ids.length === 2 &&
        D((await prisma.cashBox.findUniqueOrThrow({ where: { id: boxA }, select: { balance: true } })).balance).equals(balA) &&
        D((await prisma.cashBox.findUniqueOrThrow({ where: { id: boxB }, select: { balance: true } })).balance).equals(balB),
    );

    // KAYNAK TARAMASI — sıralamanın asıl bekçisi (⚠️ yarış sondası değil):
    // deadlock penceresi olasılıksaldır ve §15 ağı oluşanı 409'a eşlediği için
    // sıralama satırı silinse davranış testi YEŞİL KALABİLİR. Yapının varlığı
    // bu yüzden mekanik ölçülür: kanonik anahtar tanımlı + virman VE iptal
    // yolu onunla SIRALIYOR.
    const cashSrc = readFileSync(join(__dirname, "..", "src", "services", "cash-transaction.service.ts"), "utf8");
    check("§14e KÖRLÜK ZEMİNİ + kanonik anahtar tanımlı", /function accountLockKey\(/.test(cashSrc), "accountLockKey");
    const sortUses = (cashSrc.match(/compareLockKeys\(/g) ?? []).length;
    check("§14f Virman + iptal İKİSİ DE kanonik sırayla yazıyor (tanım + 2 kullanım ≥ 3)", sortUses >= 3, `kullanım=${sortUses}`);
    // ⚠️ ÇAĞRI biçimi aranır (`.localeCompare(`) — düz kelime araması, kuralı
    // ANLATAN yorumu da yakalayıp sahte kırmızı verir (ilk yazımda ölçüldü).
    check("§14g localeCompare ÇAĞRILMIYOR (locale'e bağlı sıra deterministik değildir)", !/\.localeCompare\(/.test(cashSrc));
  }

  // ── §15 GÜVENLİK AĞI: error.middleware eşlemeleri ───────────────────────
  // Servis testinde middleware devrede değildir; buradaki ölçüm hatayı GERÇEK
  // errorHandler'dan geçirir. İki kılık da (çıplak DriverAdapterError · P2010
  // sarımı) canlıda gözlenen yapılardır — sahte hatalar o yapıları birebir taklit
  // eder, uydurma alan adı kullanmaz.
  {
    // (a) Çıplak DriverAdapterError kılığı: cause.code = 40P01
    const bare40 = Object.assign(new Error("deadlock detected"), {
      cause: { code: "40P01", originalMessage: "deadlock detected" },
    });
    const m1 = mapThroughErrorHandler(bare40);
    check("§15a Çıplak 40P01 → 409 'tekrar deneyin'", m1.status === 409 && /İşlem çakışması/.test(m1.message), `${m1.status} ${m1.message}`);

    // (b) originalCode alanı taşıyan kılık (23514'te canlıda gözlenen yapı)
    const bare40001 = Object.assign(new Error("could not serialize access"), {
      cause: { originalCode: "40001", originalMessage: "could not serialize access due to concurrent update" },
    });
    const m2 = mapThroughErrorHandler(bare40001);
    check("§15b Çıplak 40001 (originalCode) → 409", m2.status === 409 && /tekrar deneyin/.test(m2.message), `${m2.status}`);

    // (c) P2010 sarımı — advisory kilit / $executeRaw yolu (Sınıf 3'ün canlıda
    // ölçülen asıl arıza şekli: eskiden 500 "Sunucu yapılandırma hatası").
    const p2010 = new Prisma.PrismaClientKnownRequestError(
      "Raw query failed. Code: `40P01`. Message: `deadlock detected`",
      { code: "P2010", clientVersion: "7.0.0" },
    );
    const m3 = mapThroughErrorHandler(p2010);
    check("§15c P2010'a sarılı 40P01 → 409 (500 'yapılandırma hatası' DEĞİL)", m3.status === 409 && /İşlem çakışması/.test(m3.message), `${m3.status} ${m3.message}`);

    // (d) YANLIŞ POZİTİF: mesajında '40001' geçen sıradan hata → sınıf-40 DEĞİL.
    const plain = new Error("tutar 40001 TL olamaz");
    const m4 = mapThroughErrorHandler(plain);
    check("§15d Mesajında '40001' geçen düz hata 409'a EŞLENMEDİ (genel regex yasak)", m4.status === 500, `${m4.status}`);

    // (e) YANLIŞ POZİTİF: P2010 ama başka SQLSTATE → sunucu arızası dalında kalır.
    const p2010Other = new Prisma.PrismaClientKnownRequestError(
      "Raw query failed. Code: `23505`. Message: `duplicate key`",
      { code: "P2010", clientVersion: "7.0.0" },
    );
    const m5 = mapThroughErrorHandler(p2010Other);
    check("§15e P2010 + 23505 sınıf-40 dalına GİRMEDİ", m5.status === 500, `${m5.status}`);

    // (f) Finans CHECK sedleri Türkçe konuşur — çift yönlü CAS'ın DB katmanı
    // bir gün tek başına kalırsa operatör constraint adı değil İŞ dili görür.
    const chk = Object.assign(new Error("check violation"), {
      cause: {
        code: "23514",
        originalMessage: 'new row for relation "cheques" violates check constraint "cheques_terminal_not_allocated"',
      },
    });
    const m6 = mapThroughErrorHandler(chk);
    check(
      "§15f cheques_terminal_not_allocated → Türkçe iş mesajı",
      m6.status === 409 && /karşılıksız\/iade\/iptal edilemez/.test(m6.message) && /kapamasını kaldırın/.test(m6.message),
      `${m6.status} ${m6.message.slice(0, 90)}`,
    );
    const chkXor = Object.assign(new Error("check violation"), {
      cause: {
        code: "23514",
        originalMessage: 'new row for relation "cash_period_closes" violates check constraint "cash_period_close_account_xor"',
      },
    });
    const m7 = mapThroughErrorHandler(chkXor);
    check("§15g cash_period_close_account_xor → Türkçe iş mesajı", m7.status === 409 && /kasa VEYA banka/.test(m7.message), `${m7.status} ${m7.message.slice(0, 80)}`);

    // (j)(k) P2010 sarımının META kılığı: $executeRaw yolunda SQLSTATE mesaj
    // metninde DEĞİL `meta.driverAdapterError.cause`ta da gelir. Mesaj kalıbı
    // BİLEREK yok (yalnız "Raw query failed") — bu iki kontrol meta yolunu TEK
    // BAŞINA ölçer; extract fonksiyonlarından meta bloğu silinirse yalnız
    // bunlar kırmızı verir (mesaj-kalıbı fallback'i §15c'yi yeşil tutar,
    // negatif sonda ⑫ ile ölçüldü).
    const p2010Meta = new Prisma.PrismaClientKnownRequestError("Raw query failed", {
      code: "P2010",
      clientVersion: "7.0.0",
      meta: { driverAdapterError: { cause: { code: "40P01", originalMessage: "deadlock detected" } } },
    });
    const m8 = mapThroughErrorHandler(p2010Meta);
    check(
      "§15j P2010 META kılığındaki 40P01 → 409 (mesaj kalıbı olmadan)",
      m8.status === 409 && /İşlem çakışması/.test(m8.message),
      `${m8.status} ${m8.message.slice(0, 60)}`,
    );

    const p2010Chk = new Prisma.PrismaClientKnownRequestError("Raw query failed", {
      code: "P2010",
      clientVersion: "7.0.0",
      meta: {
        driverAdapterError: {
          cause: {
            code: "23514",
            originalMessage: 'new row for relation "payments" violates check constraint "payments_allocated_total_range"',
          },
        },
      },
    });
    const m9 = mapThroughErrorHandler(p2010Chk);
    check(
      "§15k P2010 META kılığındaki 23514 → Türkçe iş mesajı (sayaç seddi 500'e düşmez)",
      m9.status === 409 && /kapama toplamı kendi tutarını aşamaz/.test(m9.message),
      `${m9.status} ${m9.message.slice(0, 80)}`,
    );

    // (h) Harness körlük zemini: gerçek AppError kendi statüsüyle DEĞİŞMEDEN
    // geçer — geçmeseydi §13b/§14a "her şey 409" diye vakumen yeşile dönebilirdi
    // (harness'ın 409'u gerçekten middleware'den geldiğinin kanıtı).
    const real = mapThroughErrorHandler(AppError.conflict("zemin 409"));
    check("§15h KÖRLÜK ZEMİNİ: gerçek AppError statüsünü koruyarak geçti", real.status === 409 && real.message === "zemin 409", `${real.status} ${real.message}`);
    const real404 = mapThroughErrorHandler(AppError.notFound("zemin 404"));
    check("§15i KÖRLÜK ZEMİNİ: 404 da korunuyor (harness her şeyi 409 yapmıyor)", real404.status === 404, `${real404.status}`);
  }

  // ── §15r ⭐ EŞZAMANLI clientToken ÇİFT-GÖNDERİMİ (I2, payment.create) ────
  // Pencere zamanlamayla DEĞİL elle açık tutulan tx ile kurulur (yarış bekçisi
  // kuralı): kazananın satırı unique indekse UNCOMMITTED yazılıdır → kaybedenin
  // ön kontrolü göremez (READ COMMITTED), INSERT'i indeks kilidinde bekler;
  // gate commit → P2002 → predicate propagate → catch cached yanıta çevirir.
  {
    const cariRow = await prisma.cariAccount.findFirstOrThrow({
      where: { customerId: customerIds[0] },
      select: { id: true },
    });
    const boxBefore = D(
      (await prisma.cashBox.findUniqueOrThrow({ where: { id: cashBoxId as string }, select: { balance: true } })).balance,
    );
    const rplToken = crypto.randomUUID();
    const rplLock = deferred<{ id: string; docNo: string }>();
    const rplGate = deferred<void>();
    const rplTx = prisma.$transaction(
      async (tx) => {
        const winner = await tx.payment.create({
          data: {
            docNo: `${TAG}-RPL1`,
            direction: "IN",
            method: "CASH",
            cariId: cariRow.id,
            amount: new Prisma.Decimal(75),
            amountTry: new Prisma.Decimal(75),
            cashBoxId,
            paymentDate: new Date(),
            clientToken: rplToken,
          },
          select: { id: true, docNo: true },
        });
        rplLock.resolve(winner);
        await rplGate.promise;
        return winner;
      },
      { timeout: 20_000 },
    );
    // Gate-tx promise'i await'ten önce reddedebilir — no-op catch olmadan
    // unhandled rejection süreci Sonuç satırı basılmadan öldürür (§12m dersi).
    void rplTx.catch(() => {});
    const winner = await rplLock.promise;
    paymentIds.push(winner.id);

    let loserSettled = false;
    const loserP = paymentService
      .create({
        direction: "IN",
        method: "CASH",
        customerId: customerIds[0],
        amount: 75,
        cashBoxId,
        clientToken: rplToken,
      })
      .finally(() => {
        loserSettled = true;
      });
    void loserP.catch(() => {});
    await sleep(400);
    check("§15r-a ⭐ kaybeden UNIQUE indekste BEKLEDİ (ön kontrol kazananı görmedi → pencere gerçek)", !loserSettled);
    rplGate.resolve();
    await rplTx;
    const loserRes = await loserP;
    check(
      "§15r-b ⭐ kaybeden BAŞARILI ve KAZANANIN kaydını aldı (ham hata yok, mükerrer yok)",
      loserRes.success === true && loserRes.data.id === winner.id && loserRes.data.docNo === winner.docNo,
      `docNo=${loserRes.data?.docNo}`,
    );
    const seqRes = await paymentService.create({
      direction: "IN",
      method: "CASH",
      customerId: customerIds[0],
      amount: 75,
      cashBoxId,
      clientToken: rplToken,
    });
    check(
      "§15r-c ⭐ eşzamanlı replay yanıtı ardışık replay ile BAYT-BAYT aynı",
      JSON.stringify(loserRes) === JSON.stringify(seqRes),
      `eşzamanlı=${JSON.stringify(loserRes)}`,
    );
    check(
      "§15r-d token'lı TAM BİR kayıt",
      (await prisma.payment.count({ where: { clientToken: rplToken } })) === 1,
    );
    const boxAfter = D(
      (await prisma.cashBox.findUniqueOrThrow({ where: { id: cashBoxId as string }, select: { balance: true } })).balance,
    );
    check(
      "§15r-e kaybedenin tx'i GERİ SARILDI: kasa bakiyesi oynamadı",
      boxAfter.equals(boxBefore),
      `önce=${boxBefore} sonra=${boxAfter}`,
    );
  }

  // ── §17 ⭐ OTOMATİK FIFO KAPAMA (finance.autoAllocateOnPaymentEnabled) ────
  // ⚠️ İLK KONTROL PARİTEDİR: bayrak KAPALIYKEN (varsayılan) tahsilat yolunun
  // yanıt mesajı ve kapama satırı sayısı BAYT-BAYT bugünküdür. Bu bölüm kırmızı
  // verirse doğru tepki testi gevşetmek değil — dokunulmamış bir kurulumda
  // davranış değişmiş demektir.
  //
  // ⚠️ "VADESİZ SONA" BİR KURAL DEĞİL, FİKSTÜRÜN SONUCUDUR. Sıra tek formülden
  // gelir: efektif vade = `dueDate ?? issueDate` (§10d aynı formülü ters yönden
  // ölçer — vadesiz ama ÇOK ESKİ keşideli fatura EN ÜSTTE olmalı). Burada
  // vadesiz fatura sona düşüyorsa sebebi keşide tarihinin en yeni olmasıdır.
  // Biri "vadesizi nulls-last yap" diye ikinci bir sıralama yazarsa §10d
  // kırmızı verir — iki bölüm birbirinin bekçisidir, birini "düzeltip" diğerini
  // bırakma.
  {
    const day = 86400_000;
    const now = Date.now();
    const autoCustomer = await prisma.customer.create({
      data: { code: `${TAG}-AU`, name: `${TAG} Oto FIFO` },
      select: { id: true },
    });
    customerIds.push(autoCustomer.id);

    // Vadesi GEÇMİŞ iki fatura + bugün kesilmiş VADESİZ bir fatura.
    const invOld = await makeInvoice({
      customerId: autoCustomer.id,
      total: 300,
      issueDate: new Date(now - 60 * day),
      dueDate: new Date(now - 30 * day),
    });
    const invMid = await makeInvoice({
      customerId: autoCustomer.id,
      total: 400,
      issueDate: new Date(now - 40 * day),
      dueDate: new Date(now - 10 * day),
    });
    const invNoDue = await makeInvoice({
      customerId: autoCustomer.id,
      total: 500,
      issueDate: new Date(now),
      dueDate: null,
    });
    const autoCari = await prisma.cariAccount.findFirstOrThrow({
      where: { customerId: autoCustomer.id },
      select: { id: true },
    });
    cariIds.push(autoCari.id);

    /** Tahsilat kaydeder ve TAM yanıtı döner (mesaj da ölçülüyor). */
    async function pay(amount: number, clientToken?: string): Promise<{ id: string; docNo: string; message: string }> {
      const r = await paymentService.create({
        direction: "IN",
        method: "CASH",
        customerId: autoCustomer.id,
        currency: "TRY",
        amount,
        cashBoxId,
        ...(clientToken ? { clientToken } : {}),
      });
      if (!paymentIds.includes(r.data.id)) paymentIds.push(r.data.id);
      return { id: r.data.id, docNo: r.data.docNo, message: r.message ?? "" };
    }

    const allocCount = (paymentId: string): Promise<number> =>
      prisma.paymentAllocation.count({ where: { paymentId } });

    // ── §17a KAPALI PARİTE (varsayılan) ──────────────────────────────────
    await setSetting(AUTO_FLAG_KEY, false);
    await setSetting(FINANCE_FLAG_KEY, true);
    const offPay = await pay(500);
    check(
      "§17a KAPALI: yanıt mesajı BAYT-BAYT bugünkü (ek cümle yok)",
      offPay.message === `${offPay.docNo} kaydedildi.`,
      offPay.message,
    );
    check("§17a2 KAPALI: hiçbir kapama satırı doğmadı", (await allocCount(offPay.id)) === 0);
    check("§17a3 KAPALI: en eski fatura dokunulmamış", (await invoiceCounters(invOld)).paid.isZero());

    // ── §17b MODÜL ŞALTERİ ÜSTTE ─────────────────────────────────────────
    // Bayrak AÇIK ama `financeEnabled` KAPALI → kanca no-op. Bu kontrol
    // olmadan, ön muhasebeyi hiç kullanmayan bir fabrikada yanlışlıkla açılmış
    // bir bayrak sessizce kapama yazmaya başlardı.
    await setSetting(AUTO_FLAG_KEY, true);
    await setSetting(FINANCE_FLAG_KEY, false);
    const gatedPay = await pay(500);
    check(
      "§17b Modül KAPALIYKEN bayrak açık olsa bile kanca no-op",
      gatedPay.message === `${gatedPay.docNo} kaydedildi.` && (await allocCount(gatedPay.id)) === 0,
      gatedPay.message,
    );

    // ── §17c AÇIK: FIFO sırası + tam/kısmi dağıtım ───────────────────────
    await setSetting(FINANCE_FLAG_KEY, true);
    const fifoPay = await pay(900);
    const fifoRows = await prisma.paymentAllocation.findMany({
      where: { paymentId: fifoPay.id },
      select: { invoiceId: true, amount: true, notes: true },
      orderBy: { createdAt: "asc" },
    });
    check("§17c 900 TL üç faturaya dağıtıldı", fifoRows.length === 3, `satır=${fifoRows.length}`);
    check(
      "§17c2 Sıra efektif vadeye göre: geçmiş vade → geçmiş vade → vadesiz (keşide bugün) SONA",
      fifoRows.map((r) => r.invoiceId).join(",") === [invOld, invMid, invNoDue].join(","),
      fifoRows.length === 3 ? "doğru sırada" : "sıra kurulamadı",
    );
    check(
      "§17c3 Tutarlar: 300 tam / 400 tam / 200 KISMİ",
      fifoRows.map((r) => D(r.amount).toFixed(2)).join("/") === "300.00/400.00/200.00",
      fifoRows.map((r) => D(r.amount).toFixed(2)).join("/"),
    );
    check(
      "§17c4 İlk iki fatura TAM kapandı",
      (await invoiceCounters(invOld)).paid.equals(300) && (await invoiceCounters(invMid)).paid.equals(400),
    );
    const noDueAfter = await invoiceCounters(invNoDue);
    check(
      "§17c5 Üçüncü fatura KISMİ kaldı (500'ün 200'ü kapandı)",
      noDueAfter.paid.equals(200) && noDueAfter.grand.minus(noDueAfter.paid).equals(300),
      `paid=${noDueAfter.paid}`,
    );
    check(
      "§17c6 Yanıt mesajı özeti taşıyor (N faturaya otomatik kapandı)",
      /3 faturaya otomatik kapandı/.test(fifoPay.message),
      fifoPay.message,
    );
    check(
      "§17c7 Tutar tam dağıldığında AVANS cümlesi BASILMAZ",
      !/avans/i.test(fifoPay.message),
      fifoPay.message,
    );
    check(
      "§17c8 Üretilen satır ÖZEL İŞARET taşımaz (notes boş — audit yeterli)",
      fifoRows.every((r) => r.notes === null),
    );

    // ── §17d ARTAN TUTAR AÇIKTA KALIR (AVANS — fatura uydurulmaz) ────────
    const advPay = await pay(1000);
    check(
      "§17d Kalan açık (300) kapandı, fazlası hiçbir faturaya yazılmadı",
      (await paymentAllocated(advPay.id)).equals(300),
      (await paymentAllocated(advPay.id)).toString(),
    );
    check(
      "§17d2 Avans mesajda söyleniyor (700 açıkta)",
      /Kalan 700\.00 TRY avans olarak açıkta/.test(advPay.message),
      advPay.message,
    );
    const cariClosed = await prisma.invoice.aggregate({
      where: { cariId: autoCari.id },
      _sum: { grandTotal: true, paidTotal: true },
    });
    check(
      "§17d3 Cari toplamı: 1200 fatura / 1200 kapama — hayali fatura doğmadı",
      D(cariClosed._sum.grandTotal ?? 0).equals(1200) && D(cariClosed._sum.paidTotal ?? 0).equals(1200),
      `grand=${cariClosed._sum.grandTotal} paid=${cariClosed._sum.paidTotal}`,
    );
    const freeAdv = await paymentAllocationService.listUnallocatedPayments({
      cariId: autoCari.id,
      currency: "TRY",
      direction: PaymentDirection.IN,
    });
    check(
      "§17d4 Avans SERBEST tahsilat listesinde görünür (kaybolmuyor)",
      freeAdv.data.find((r) => r.id === advPay.id)?.freeTotal === "700",
      freeAdv.data.find((r) => r.id === advPay.id)?.freeTotal ?? "yok",
    );

    // ── §17e FARKLI PARA BİRİMİ ATLANIR + İADE FATURASI ATLANIR ──────────
    // Kur farkı kararı otomatikleştirilmez (bayrak JSDoc'unun MUAF satırı);
    // iade faturası ise yön kuralının dışındadır (§8d'nin otomatik ikizi —
    // otomasyon elle kapamadan DAHA GENİŞ davranamaz).
    const fxCustomer = await prisma.customer.create({
      data: { code: `${TAG}-FX`, name: `${TAG} Döviz` },
      select: { id: true },
    });
    customerIds.push(fxCustomer.id);
    const usdDraft = await invoiceService.createDraft({
      type: "SALES",
      customerId: fxCustomer.id,
      currency: "USD",
      exchangeRate: 40,
      lines: [{ description: `${TAG} USD satır`, qty: 1, unitPrice: 500, vatRate: 0 }],
    });
    invoiceIds.push(usdDraft.data.id);
    await invoiceService.confirm(usdDraft.data.id);
    const tryInv = await makeInvoice({ customerId: fxCustomer.id, total: 200 });
    const retInv = await makeInvoice({ customerId: fxCustomer.id, type: "SALES_RETURN", total: 150 });
    const fxCari = await prisma.cariAccount.findFirstOrThrow({
      where: { customerId: fxCustomer.id },
      select: { id: true },
    });
    cariIds.push(fxCari.id);
    const fxPayRes = await paymentService.create({
      direction: "IN",
      method: "CASH",
      customerId: fxCustomer.id,
      currency: "TRY",
      amount: 1000,
      cashBoxId,
    });
    paymentIds.push(fxPayRes.data.id);
    check(
      "§17e USD fatura ATLANDI (kur kararı otomatikleştirilmez)",
      (await invoiceCounters(usdDraft.data.id)).paid.isZero(),
    );
    check("§17e2 İADE faturası ATLANDI (yön kuralı gevşemedi)", (await invoiceCounters(retInv)).paid.isZero());
    check(
      "§17e3 KÖRLÜK ZEMİNİ: aynı carinin TRY faturası kapandı",
      (await invoiceCounters(tryInv)).paid.equals(200),
    );
    check(
      "§17e4 Atlananlar yüzünden tutar KAYBOLMADI — kalan avans açıkta",
      (await paymentAllocated(fxPayRes.data.id)).equals(200),
      (await paymentAllocated(fxPayRes.data.id)).toString(),
    );

    // ── §17f KAPAMA BOZULSA DA TAHSİLAT KAYDI AYAKTA ─────────────────────
    // ⚠️ Bu bölüm sözleşmenin en kritik yarısını ölçer: para el değiştirdi ve
    // kaydı yazılmak ZORUNDA; kapama ikinci bir sorudur. Pencere sonda ile
    // deterministik üretilir — `allocateBulk` geçici olarak fırlatır.
    const brokenCustomer = await prisma.customer.create({
      data: { code: `${TAG}-BR`, name: `${TAG} Bozuk` },
      select: { id: true },
    });
    customerIds.push(brokenCustomer.id);
    const brokenInv = await makeInvoice({ customerId: brokenCustomer.id, total: 250 });
    const brokenCari = await prisma.cariAccount.findFirstOrThrow({
      where: { customerId: brokenCustomer.id },
      select: { id: true },
    });
    cariIds.push(brokenCari.id);

    const svc = paymentAllocationService as unknown as { allocateBulk: unknown };
    const realBulk = svc.allocateBulk;
    svc.allocateBulk = async (): Promise<never> => {
      throw new Error("SONDA: otomatik kapama bilerek düşürüldü");
    };
    // ⚠️ `create` FIRLATIRSA bölüm ÇÖKMEMELİ: hata yakalanır ve ayrı bir
    // kontrole dönüştürülür. Aksi halde "yutma kaldırıldı" sondası ❌ bile
    // basmadan süreci öldürürdü (bu dosyanın başındaki SONDA FİXTURE DERSİ'nin
    // aynısı — en sessiz kırmızı). Ölçüldü: sonda ④ önce tam böyle davrandı.
    let brokenRes: Awaited<ReturnType<typeof paymentService.create>> | null = null;
    let brokenThrow = "";
    try {
      brokenRes = await paymentService.create({
        direction: "IN",
        method: "CASH",
        customerId: brokenCustomer.id,
        currency: "TRY",
        amount: 250,
        cashBoxId,
      });
    } catch (e) {
      brokenThrow = (e as Error).message;
    } finally {
      svc.allocateBulk = realBulk;
    }
    check(
      "§17f ⭐ Kapama patlasa da `create` FIRLATMADI (hata yutuldu)",
      brokenRes !== null,
      brokenThrow || "fırlatmadı",
    );
    // Kayıt, yanıttan BAĞIMSIZ olarak cari üzerinden aranır: tx kanca
    // çalışmadan ÖNCE commit ettiği için satır her hâlükârda vardır ve
    // "fırlattı" senaryosunda da ölçülebilir olmalı.
    const brokenRow = await prisma.payment.findFirst({
      where: { cariId: brokenCari.id },
      select: { id: true, status: true, amount: true },
    });
    if (brokenRow) paymentIds.push(brokenRow.id);
    check(
      "§17f2 ⭐ TAHSİLAT KAYDI yazıldı ve ACTIVE (para kaybolmadı)",
      brokenRow?.status === "ACTIVE" && D(brokenRow.amount).equals(250),
      brokenRow ? `${brokenRow.status}/${brokenRow.amount}` : "kayıt yok",
    );
    check("§17f3 Kapama satırı doğmadı", brokenRow ? (await allocCount(brokenRow.id)) === 0 : false);
    check("§17f4 Fatura dokunulmadı", (await invoiceCounters(brokenInv)).paid.isZero());
    check(
      "§17f5 SESSİZ DEĞİL: mesaj başarısızlığı söylüyor ve yol gösteriyor",
      /Otomatik kapama YAPILAMADI/.test(brokenRes?.message ?? "") &&
        /Fatura Kapama/.test(brokenRes?.message ?? ""),
      brokenRes?.message ?? `(fırlattı: ${brokenThrow})`,
    );

    // ── §17g ÜRETİLEN TAHSİS NORMAL TAHSİSTİR: elle silinebilir ──────────
    const firstAuto = await prisma.paymentAllocation.findFirstOrThrow({
      where: { paymentId: fifoPay.id, invoiceId: invOld },
      select: { id: true },
    });
    const undone = await paymentAllocationService.deallocate(firstAuto.id);
    check("§17g Otomatik kapama elle ÇÖZÜLDÜ ('sistem yaptı' kilidi yok)", undone.data.amount === "300");
    check("§17g2 Fatura yeniden açıldı", (await invoiceCounters(invOld)).paid.isZero());
    check("§17g3 Tahsilat sayacı düştü (900 → 600)", (await paymentAllocated(fifoPay.id)).equals(600));

    // ── §17h REPLAY KANCAYI İKİNCİ KEZ ÇALIŞTIRMAZ (I2 sözleşmesi) ───────
    // Aynı `clientToken` ile ikinci istek cached yanıtla ERKEN döner; kanca
    // yapısal olarak o yola hiç ulaşmaz. Ulaşsaydı hem replay yanıtı ayırt
    // edilir hale gelir hem de aynı tahsilat ikinci kez dağıtılmaya çalışılırdı.
    const rplToken = crypto.randomUUID();
    const rplInv = await makeInvoice({ customerId: autoCustomer.id, total: 100 });
    const first = await pay(100, rplToken);
    const firstCount = await allocCount(first.id);
    const second = await pay(100, rplToken);
    check("§17h Replay AYNI kaydı döndü", second.id === first.id);
    check(
      "§17h2 Replay yanıtı cached sözleşmeyi koruyor (ek özet YOK)",
      second.message === "Kayıt zaten oluşturulmuş.",
      second.message,
    );
    check(
      "§17h3 Kapama İKİNCİ KEZ denenmedi (satır sayısı sabit)",
      (await allocCount(first.id)) === firstCount && firstCount === 1,
      `önce=${firstCount} sonra=${await allocCount(first.id)}`,
    );
    // ⚠️ Körlük zemini bilerek ÇÖZÜLEN fatura üzerinden kurulur: §17g'de elle
    // açılan `invOld` (vadesi 30 gün geçmiş) sıranın BAŞINA geri döner, yeni
    // kesilen `rplInv` (vadesiz, bugün) sonda kalır. İlk yazımda zemin
    // `rplInv`e bakıyordu ve KIRMIZI verdi — test yanlıştı, kod değil: FIFO
    // doğru davranıp parayı en eski borca yazmıştı.
    check(
      "§17h4 KÖRLÜK ZEMİNİ: ilk istek kapama yazdı — ÇÖZÜLEN en eski fatura sıranın BAŞINA döndü",
      (await invoiceCounters(invOld)).paid.equals(100),
      (await invoiceCounters(invOld)).paid.toString(),
    );
    check(
      "§17h5 Bugün kesilen vadesiz fatura sırada BEKLİYOR (FIFO atlamadı)",
      (await invoiceCounters(rplInv)).paid.isZero(),
    );

    // Bayrağı bu bölümden sonra KAPAT — §16 mutabakatı bayraktan bağımsız
    // olmalı ve sonraki bölümler bugünkü varsayılanla koşsun.
    await setSetting(AUTO_FLAG_KEY, false);
  }

  // ── §16 MUTABAKAT (TÜM DB) ───────────────────────────────────────────────
  // Üç sayacın da kapama satırlarıyla birebir olması gerekir. Bu, C2'nin
  // `test_consistency`ye taşınacak çekirdeğidir: sayaçlar defterden bağımsız
  // yaşadığı için sapmalarını başka hiçbir kontrol göremez. ⚠️ HER ZAMAN EN SON
  // koşar — §12-§14'ün yarış/kilit artıkları da bu teraziden geçsin.
  {
    const invDrift = await prisma.$queryRaw<Array<{ docNo: string; stored: string; summed: string }>>`
      SELECT i."docNo", i."paidTotal"::text AS stored, COALESCE(a.total, 0)::text AS summed
        FROM "invoices" i
        LEFT JOIN (SELECT "invoiceId", SUM("amount") AS total FROM "payment_allocations" GROUP BY "invoiceId") a
               ON a."invoiceId" = i."id"
       WHERE i."paidTotal" <> COALESCE(a.total, 0)
    `;
    check(
      "§16a SUM(allocation) === Invoice.paidTotal (tüm faturalar)",
      invDrift.length === 0,
      invDrift.length > 0 ? invDrift.map((d) => `${d.docNo}: ${d.stored}≠${d.summed}`).join(", ") : "sapma yok",
    );
    const payDrift = await prisma.$queryRaw<Array<{ docNo: string; stored: string; summed: string }>>`
      SELECT p."docNo", p."allocatedTotal"::text AS stored, COALESCE(a.total, 0)::text AS summed
        FROM "payments" p
        LEFT JOIN (SELECT "paymentId", SUM("amount") AS total FROM "payment_allocations" WHERE "paymentId" IS NOT NULL GROUP BY "paymentId") a
               ON a."paymentId" = p."id"
       WHERE p."allocatedTotal" <> COALESCE(a.total, 0)
    `;
    check(
      "§16b SUM(allocation) === Payment.allocatedTotal (tüm tahsilatlar)",
      payDrift.length === 0,
      payDrift.length > 0 ? payDrift.map((d) => `${d.docNo}: ${d.stored}≠${d.summed}`).join(", ") : "sapma yok",
    );
    const chqDrift = await prisma.$queryRaw<Array<{ docNo: string; stored: string; summed: string }>>`
      SELECT c."docNo", c."allocatedTotal"::text AS stored, COALESCE(a.total, 0)::text AS summed
        FROM "cheques" c
        LEFT JOIN (SELECT "chequeId", SUM("amount") AS total FROM "payment_allocations" WHERE "chequeId" IS NOT NULL GROUP BY "chequeId") a
               ON a."chequeId" = c."id"
       WHERE c."allocatedTotal" <> COALESCE(a.total, 0)
    `;
    check(
      "§16c SUM(allocation) === Cheque.allocatedTotal (tüm çekler)",
      chqDrift.length === 0,
      chqDrift.length > 0 ? chqDrift.map((d) => `${d.docNo}: ${d.stored}≠${d.summed}`).join(", ") : "sapma yok",
    );
    // Tavan seddi: hiçbir fatura kendi tutarından fazla kapanmış olamaz.
    const over = await prisma.$queryRaw<Array<{ docNo: string }>>`
      SELECT "docNo" FROM "invoices" WHERE "paidTotal" > "grandTotal" OR "paidTotal" < 0
    `;
    check("§16d Hiçbir faturada paidTotal > grandTotal (DB CHECK'in ikinci ölçümü)", over.length === 0, over.map((o) => o.docNo).join(", ") || "temiz");
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // TEMİZLİK SIRASI FK'lara bağlı: allocation → invoice/payment/cheque hepsi
    // RESTRICT. Kapama satırları önce silinmezse fatura silinemez ve bekçi bir
    // sonraki koşuda "TAG zaten var" ile çöker.
    try {
      // Bayrakları fotoğrafına geri döndür — kayıt silinmeden ÖNCE, çünkü
      // aşağıdaki silmeler patlarsa bile ayar ortamda kirli kalmamalı.
      await restoreSettings();
      if (invoiceIds.length > 0) await prisma.paymentAllocation.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      if (paymentIds.length > 0) await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
      if (chequeIds.length > 0) await prisma.paymentAllocation.deleteMany({ where: { chequeId: { in: chequeIds } } });

      if (chequeIds.length > 0) {
        await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: chequeIds } } });
        // §13 bounce'ları çeke bağlı defter satırı yazar (CHEQUE_BOUNCE) —
        // FK Restrict yüzünden çekten ÖNCE silinmek zorunda.
        await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: chequeIds } } });
        await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
      }
      if (invoiceIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        // Donmuş belgelerin FK'sı yok (polimorfik sourceId) → ayrıca silinir,
        // yoksa her koşuda birikirler.
        await prisma.printedDocument.deleteMany({ where: { docType: "INVOICE_INTERNAL", sourceId: { in: invoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      if (paymentIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } });
        await prisma.printedDocument.deleteMany({ where: { docType: "PAYMENT_RECEIPT", sourceId: { in: paymentIds } } });
        await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      }
      if (cariIds.length > 0) {
        await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      }
      // §14 virman kasaları: önce hareketler (FK), sonra kasalar.
      if (cashBoxIds.length > 0) {
        await prisma.cashTransaction.deleteMany({ where: { cashBoxId: { in: cashBoxIds } } });
        await prisma.cashBox.deleteMany({ where: { id: { in: cashBoxIds } } });
      }
      if (cashBoxId) await prisma.cashBox.deleteMany({ where: { id: cashBoxId } });
      if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      if (subcontractorIds.length > 0) await prisma.subcontractor.deleteMany({ where: { id: { in: subcontractorIds } } });
    } catch (e) {
      console.error("⚠️  Temizlik tamamlanamadı:", (e as Error).message);
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
