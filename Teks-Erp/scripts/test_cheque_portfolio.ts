// =============================================================================
// BEKÇİ — ÇEK / SENET PORTFÖYÜ (Paket C1)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_cheque_portfolio.ts
//
// NEDEN: Çek, sistemdeki en uzun ömürlü para nesnesidir — haftalarca yaşar,
// dört yola sapar ve HER sapmada iki ayrı defteri (cari + banka/kasa) birden
// oynatır. Buradaki bir hata anında görünmez: cari bakiyesi doğru kalır ama
// banka iki kez artar, ya da karşılıksız çek "ödenmiş" gibi durur ve fark
// ancak mutabakat toplantısında ortaya çıkar.
//
// ÖLÇÜLENLER:
//   §0 KÖRLÜK ZEMİNİ — fixture gerçekten çalışıyor mu (bu bölüm düşerse
//      aşağıdaki hiçbir yeşil bir şey KANITLAMAZ)
//   §1 DEFTER ANI: çek alındığı AN cari alacaklanır (ALACAK satırı + bakiye)
//   §2 Durum↔olay mutabakatı: son olayın `toStatus`'ü başlıkla AYNI
//   §3 ⭐ EŞZAMANLI ÇİFT TAHSİL → TEK banka artışı (atomik claim)
//   §4 Tahsil CARİ defteri İKİNCİ KEZ OYNATMAZ
//   §5 CİRO: ciro edilen cariye BORÇ; çeki veren cariye DOKUNULMAZ
//   §6 ⭐ KARŞILIKSIZ: iki cari birden eski bakiyesine döner
//   §7 Terminal durumdan sonra olay YOK (anlamlı hata)
//   §8 VERİLEN çek: doğuşta BORÇ, ödemede banka −tutar, cari oynamaz
//   §9 İADE ve İPTAL doğuş satırını ters çevirir
//   §10 Yön kapıları: alınan çek "ödenemez", verilen çek "ciro edilemez"
//   §11 Para birimi eşleşmesi (USD çek TL kasaya tahsil edilemez)
//   §12 İdempotency (clientToken) — ikinci istek yeni çek AÇMAZ
//   §13 ⭐ MUTABAKAT: §23/§24 formülü çek olaylarını da sayıyor mu
//   §14 Belge numarası ön eki türe/yöne göre ayrışıyor
//   §15 ⭐ POSTING ÇIPASI (SINIF 1): defter/belge-no/kur/olay DÖRDÜ DE
//       `postingDate`ten — keşide GEÇMİŞ, posting BUGÜN olan çekte satır bugüne
//   §16 DÖNEM KİLİDİ postingDate'i kapılar; GEÇMİŞ KEŞİDE serbest kalır
//       (operatör keşide tarihini yalan yazmaya ZORLANMAZ)
//   §17 ⭐ AYNA-CİRO deadlock REGRESYONU (SINIF 3): iki çift paralel
//       karşılıksız → 40P01 YOK, iki taraf da tam yazılır
//   §18 KAPAMALI ÇEK (SINIF 4): bounce/iade/iptal 409 "kapamayı kaldırın";
//       MEŞRU tahsil 409'a DÜŞMEZ (CAS yalnız para-yok-eden geçişlerde)
//   §19 ⭐ TAHSİL STORNOSU (K-2): para geri + durum geri + tipli olay +
//       ikinci storno 409 + mutabakat formülü COLLECT_CANCEL'ı da sayıyor
//   §19m ⭐ DEPOSIT bankası ≠ COLLECT hesabı: stornoda para TAHSİL hesabından
//       geri çekilir, başlık bankası DEPOSIT olayından geri kurulur
//   §19n ⭐ GERİYE TARİHLİ yeniden tahsil: storno zincirinin çıpası `createdAt`
//       (yazım sırası) — `eventDate` KULLANICI girdisidir; eventDate ile
//       sıralansaydı para YANLIŞ hesaptan geri çekilirdi
//   §19o COLLECT olayı hesapsız/yoksa storno FAIL-CLOSED 409 (körlemesine
//       bakiye oynatılmaz)
//   §20 ⭐ KASA/BANKA DÖNEM KİLİDİ GERÇEK SERVİS YOLUNDAN (K-1 dikişi):
//       collect/pay `eventDate` ile kapılanır (kapalı döneme 409 + tx geri
//       sarılır); cancelCollect çıpası `now` — orijinal tahsil tarihi sonradan
//       kapanan dönemde kalsa da storno BUGÜNE düşer ve GEÇER
//   §21 ⭐ VADE TAKVİMİ (H4): kova sınırı FABRİKA takviminden (gece 00:30
//       vadeli çek "vadesi geçmiş" DEĞİL) · +7. gün sınırı DAHİL, +8. gün
//       değil · statü süzgeci (tahsil/ciro/iptal takvimden ÇIKAR) · para
//       birimleri toplanmaz · kovalar pencereden BAĞIMSIZ, takvim pencereli ·
//       Σ(kova) = canlı çek adedi mutabakatı
//   §22 ⭐ EŞZAMANLI clientToken ÇİFT-GÖNDERİMİ (I2): pencere elle açık tutulan
//       tx ile deterministik (kazananın token'ı unique indekste UNCOMMITTED →
//       ön kontrol göremez, kaybeden indekste bekler) → kaybeden cached yanıt
//       alır; TAM BİR kayıt; eşzamanlı = ardışık replay BAYT-BAYT. NEGATİF
//       SONDA: predicate (`!isClientTokenP2002`) düşürülünce ham "Barkod
//       üretimi ... başarısız" 409'u → kırmızı.
//   §23 DETAY ALAN KÜMESİ (I4): findById include→select — anahtar kümesi
//       sabit; clientToken + çıplak iç FK'ler yanıtta yok; olay satırı
//       anahtarları panel `ChequeEventRow` sözleşmesiyle birebir.
// =============================================================================
import { ChequeStatus, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { chequeService } from "../src/services/cheque.service";
import { D, resolveExchangeRateTx } from "../src/services/helpers/finance.helper";
import { periodDayKey } from "../src/services/helpers/period-guard.helper";
import { dailyCodePrefix } from "../src/utils/code-format";
import { factoryDayStart, factoryYmd } from "../src/constants/time";

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

const TAG = `TEST-CHQ-${Date.now()}`;
const customerIds: string[] = [];
const cariIds: string[] = [];
const cashBoxIds: string[] = [];
const bankIds: string[] = [];
const chequeIds: string[] = [];
const rateIds: string[] = [];

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

/** §22 yarış sondası — pencereyi elle açık tutmak için (goods_receipt_invoice §10 emsali). */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e?: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const bankBalance = async (id: string) =>
  D((await prisma.bankAccount.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);
const boxBalance = async (id: string) =>
  D((await prisma.cashBox.findUniqueOrThrow({ where: { id }, select: { balance: true } })).balance);
const cariBalance = async (cariId: string, currency: "TRY" | "USD" = "TRY") => {
  const row = await prisma.cariBalance.findUnique({
    where: { cariId_currency: { cariId, currency } },
    select: { balance: true },
  });
  return row ? D(row.balance) : D(0);
};
const statusOf = async (id: string) =>
  (await prisma.cheque.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

/** Bir çekin son olayı — durum↔olay mutabakatının okuma ucu. */
async function lastEvent(chequeId: string) {
  const rows = await prisma.chequeEvent.findMany({
    where: { chequeId },
    orderBy: [{ eventDate: "asc" }, { createdAt: "asc" }],
    select: { type: true, fromStatus: true, toStatus: true },
  });
  return { all: rows, last: rows[rows.length - 1] ?? null };
}

async function makeCari(suffix: string): Promise<string> {
  const customer = await prisma.customer.create({
    data: { code: `${TAG}-${suffix}`, name: `${TAG} ${suffix}` },
    select: { id: true },
  });
  customerIds.push(customer.id);
  const cari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: customer.id },
    select: { id: true },
  });
  cariIds.push(cari.id);
  return cari.id;
}

/** Çek oluşturur ve temizlik listesine ekler. */
async function newCheque(input: Parameters<typeof chequeService.create>[0]): Promise<string> {
  const res = await chequeService.create(input);
  chequeIds.push(res.data.id);
  return res.data.id;
}

async function main(): Promise<void> {
  console.log("=== Çek/senet portföy bekçisi ===\n");

  const musteri = await makeCari("MUS");
  const tedarikci = await makeCari("TED");
  const bank = await prisma.bankAccount.create({
    data: { code: `${TAG}-BN`, name: `${TAG} Banka`, currency: "TRY" },
    select: { id: true },
  });
  bankIds.push(bank.id);
  const box = await prisma.cashBox.create({
    data: { code: `${TAG}-KS`, name: `${TAG} Kasa`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxIds.push(box.id);

  // ── §0 KÖRLÜK ZEMİNİ ────────────────────────────────────────────────────
  // Aşağıdaki tüm kontroller "fixture gerçekten hareket üretti" varsayımına
  // dayanıyor. Bu bölüm düşerse (ör. servis sessizce hiçbir şey yazmıyorsa)
  // kalan yeşiller hiçbir şey KANITLAMAZ ve bekçi kördür.
  const c1 = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 10000,
    dueDate: new Date(Date.now() + 30 * 86400000),
    serialNo: "0001",
    drawerName: "Keşideci A.Ş.",
  });
  const zeminEvents = await prisma.chequeEvent.count({ where: { chequeId: c1 } });
  const zeminTxns = await prisma.cariTransaction.count({ where: { chequeId: c1 } });
  check("§0a KÖRLÜK ZEMİNİ: doğuş olay defterine satır yazdı", zeminEvents === 1, `olay=${zeminEvents}`);
  check("§0b KÖRLÜK ZEMİNİ: doğuş cari deftere satır yazdı", zeminTxns === 1, `satır=${zeminTxns}`);
  check(
    "§0c KÖRLÜK ZEMİNİ: fixture bakiyesi SIFIR DEĞİL (aksi halde 'fark yok' vakumen doğru olurdu)",
    !(await cariBalance(musteri)).isZero(),
    `bakiye=${await cariBalance(musteri)}`,
  );

  // ── §1 DEFTER ANI ───────────────────────────────────────────────────────
  const receiveTxn = await prisma.cariTransaction.findFirstOrThrow({
    where: { chequeId: c1, sourceType: "CHEQUE_RECEIVE" },
    select: { debit: true, credit: true, cariId: true },
  });
  check(
    "§1a ⭐ Alınan çek ALINDIĞI AN cariyi ALACAKLANDIRIR (credit)",
    D(receiveTxn.credit).equals(10000) && D(receiveTxn.debit).isZero(),
    `borç=${receiveTxn.debit} alacak=${receiveTxn.credit}`,
  );
  check("§1b Satır çeki VEREN cariye yazıldı", receiveTxn.cariId === musteri);
  check(
    "§1c Bakiye borcun azaldığını gösteriyor (negatif = biz borçluyuz)",
    (await cariBalance(musteri)).equals(-10000),
    `bakiye=${await cariBalance(musteri)}`,
  );
  check("§1d Doğuş durumu PORTFOLIO", (await statusOf(c1)) === ChequeStatus.PORTFOLIO);

  // ── §2 DURUM ↔ OLAY MUTABAKATI ──────────────────────────────────────────
  await chequeService.deposit(c1, { bankAccountId: bank.id });
  {
    const { last } = await lastEvent(c1);
    check(
      "§2a Bankaya verme olayı yazıldı ve başlıkla MUTABIK",
      last?.type === "DEPOSIT" && last?.toStatus === ChequeStatus.AT_BANK && (await statusOf(c1)) === ChequeStatus.AT_BANK,
      `olay=${last?.type} → ${last?.toStatus}`,
    );
    check(
      "§2b `fromStatus` tüketilen durumu kayda geçirdi",
      last?.fromStatus === ChequeStatus.PORTFOLIO,
      `from=${last?.fromStatus}`,
    );
  }
  check(
    "§2c ⭐ Bankaya verme PARA HAREKETİ ÜRETMEDİ (çek henüz tahsil değil)",
    (await bankBalance(bank.id)).isZero(),
    `banka=${await bankBalance(bank.id)}`,
  );

  // ── §3 EŞZAMANLI ÇİFT TAHSİL ────────────────────────────────────────────
  // ⚠️ `Promise.allSettled` MEŞRU: burada beş ayrı transaction var, tek tx
  // client'ı paylaşan bir paralellik değil (perf kuralı 11 onu kapsar).
  // "Düzeltip" sıralı hale getirirsen bekçi sessizce ölür — ölçtüğü tek şey
  // atomik claim'in eşzamanlı iki isteği ayırt etmesidir.
  const cariBefore = await cariBalance(musteri);
  const results = await Promise.allSettled([
    chequeService.collect(c1, { bankAccountId: bank.id }),
    chequeService.collect(c1, { bankAccountId: bank.id }),
    chequeService.collect(c1, { bankAccountId: bank.id }),
  ]);
  const ok = results.filter((r) => r.status === "fulfilled").length;
  const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  check("§3a ⭐ Üç eşzamanlı tahsilden YALNIZ BİRİ geçti", ok === 1, `başarılı=${ok}`);
  check(
    "§3b Reddedilenler anlamlı çakışma mesajı verdi",
    rejected.length === 2 && rejected.every((r) => /güncellendi|tahsil|zaten/i.test((r.reason as Error).message)),
    rejected[0] ? (rejected[0].reason as Error).message.slice(0, 60) : "",
  );
  check(
    "§3c ⭐ Banka bakiyesi TEK KEZ arttı",
    (await bankBalance(bank.id)).equals(10000),
    `banka=${await bankBalance(bank.id)}`,
  );
  check(
    "§3d Olay defterinde TEK tahsil satırı var",
    (await prisma.chequeEvent.count({ where: { chequeId: c1, type: "COLLECT" } })) === 1,
  );

  // ── §4 TAHSİL CARİYİ İKİNCİ KEZ OYNATMAZ ────────────────────────────────
  check(
    "§4 ⭐ Tahsil CARİ defterine satır YAZMADI (borç çek alınırken kapandı)",
    (await cariBalance(musteri)).equals(cariBefore),
    `önce=${cariBefore} sonra=${await cariBalance(musteri)}`,
  );

  // ── §5 CİRO ─────────────────────────────────────────────────────────────
  const c2 = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 4000,
    dueDate: new Date(Date.now() + 45 * 86400000),
  });
  const musteriBeforeEndorse = await cariBalance(musteri);
  const tedarikciBeforeEndorse = await cariBalance(tedarikci);
  await chequeService.endorse(c2, { toCariId: tedarikci });
  check(
    "§5a Ciro edilen cariye BORÇ yazıldı (ona borcumuz azaldı)",
    (await cariBalance(tedarikci)).equals(tedarikciBeforeEndorse.plus(4000)),
    `tedarikçi=${await cariBalance(tedarikci)}`,
  );
  check(
    "§5b ⭐ Çeki VEREN cariye DOKUNULMADI (aynı çek iki kez tahsil edilmiş görünmesin)",
    (await cariBalance(musteri)).equals(musteriBeforeEndorse),
    `müşteri=${await cariBalance(musteri)}`,
  );
  const c2row = await prisma.cheque.findUniqueOrThrow({
    where: { id: c2 },
    select: { status: true, endorsedToCariId: true },
  });
  check(
    "§5c Durum ENDORSED ve ciro carisi başlıkta saklandı",
    c2row.status === ChequeStatus.ENDORSED && c2row.endorsedToCariId === tedarikci,
  );
  const selfErr = await expectError(() => chequeService.endorse(c2, { toCariId: musteri }));
  check("§5d Terminal olmayan kontrol: ciro edilmiş çek tekrar ciro edilemez", /ciro edildi/i.test(selfErr), selfErr.slice(0, 60));

  // ── §6 KARŞILIKSIZ ──────────────────────────────────────────────────────
  await chequeService.bounce(c2, { notes: "banka karşılıksız damgası" });
  check(
    "§6a ⭐ Çeki veren cariye BORÇ geri döndü (bakiye ciro ÖNCESİNE eşit)",
    (await cariBalance(musteri)).equals(musteriBeforeEndorse.plus(4000)),
    `müşteri=${await cariBalance(musteri)}`,
  );
  check(
    "§6b ⭐ CİRO edilen cariye ters ALACAK yazıldı (bakiye ciro ÖNCESİNE döndü)",
    (await cariBalance(tedarikci)).equals(tedarikciBeforeEndorse),
    `tedarikçi=${await cariBalance(tedarikci)}`,
  );
  check(
    "§6c Karşılıksız İKİ defter satırı yazdı (iki cari)",
    (await prisma.cariTransaction.count({ where: { chequeId: c2, sourceType: "CHEQUE_BOUNCE" } })) === 2,
  );
  check(
    "§6d Karşılıksız PARA HAREKETİ ÜRETMEDİ",
    (await bankBalance(bank.id)).equals(10000),
    `banka=${await bankBalance(bank.id)}`,
  );
  {
    const { last } = await lastEvent(c2);
    check(
      "§6e Olay defteri karşılıksızı ENDORSED'dan geldiği bilgisiyle yazdı",
      last?.type === "BOUNCE" && last?.fromStatus === ChequeStatus.ENDORSED && last?.toStatus === ChequeStatus.BOUNCED,
      `${last?.fromStatus} → ${last?.toStatus}`,
    );
  }

  // ── §7 TERMİNAL SONRASI OLAY YOK ────────────────────────────────────────
  const termErr = await expectError(() => chequeService.collect(c1, { bankAccountId: bank.id }));
  check("§7a Tahsil edilmiş çek tekrar tahsil edilemez", /tahsil edildi/i.test(termErr), termErr.slice(0, 70));
  const bouncedErr = await expectError(() => chequeService.bounce(c2, {}));
  check("§7b Karşılıksız çek ikinci kez karşılıksız yapılamaz", /karşılıksız/i.test(bouncedErr), bouncedErr.slice(0, 70));
  // c1: RECEIVE → DEPOSIT → COLLECT · c2: RECEIVE → ENDORSE → BOUNCE.
  // Reddedilen istekler (iki çakışan tahsil + terminal denemeleri) hiçbir satır
  // eklememeli — hata fırlatılan tx geri sarılmıyorsa sayı burada büyür.
  check(
    "§7c ⭐ Reddedilen istekler defteri KİRLETMEDİ",
    (await prisma.chequeEvent.count({ where: { chequeId: c1 } })) === 3 &&
      (await prisma.chequeEvent.count({ where: { chequeId: c2 } })) === 3,
    `c1=${await prisma.chequeEvent.count({ where: { chequeId: c1 } })} c2=${await prisma.chequeEvent.count({ where: { chequeId: c2 } })}`,
  );

  // ── §8 VERİLEN ÇEK ──────────────────────────────────────────────────────
  const tedBeforeIssue = await cariBalance(tedarikci);
  const c3 = await newCheque({
    kind: "ISSUED",
    cariId: tedarikci,
    amount: 2500,
    dueDate: new Date(Date.now() + 15 * 86400000),
  });
  check(
    "§8a Verilen çek doğuşta BORÇ yazdı (borcumuz azaldı)",
    (await cariBalance(tedarikci)).equals(tedBeforeIssue.plus(2500)),
    `tedarikçi=${await cariBalance(tedarikci)}`,
  );
  check("§8b Doğuş durumu ISSUED", (await statusOf(c3)) === ChequeStatus.ISSUED);
  const tedBeforePay = await cariBalance(tedarikci);
  await chequeService.pay(c3, { bankAccountId: bank.id });
  check(
    "§8c Ödeme bankadan DÜŞTÜ",
    (await bankBalance(bank.id)).equals(7500),
    `banka=${await bankBalance(bank.id)}`,
  );
  check(
    "§8d ⭐ Ödeme CARİYİ İKİNCİ KEZ OYNATMADI",
    (await cariBalance(tedarikci)).equals(tedBeforePay),
    `tedarikçi=${await cariBalance(tedarikci)}`,
  );

  // ── §9 İADE ve İPTAL ────────────────────────────────────────────────────
  const musBeforeReturn = await cariBalance(musteri);
  const c4 = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 750,
    dueDate: new Date(Date.now() + 10 * 86400000),
  });
  await chequeService.returnToDrawer(c4, { notes: "müşteri nakit ödedi" });
  check(
    "§9a İADE doğuş satırını ters çevirdi (bakiye başa döndü)",
    (await cariBalance(musteri)).equals(musBeforeReturn),
    `müşteri=${await cariBalance(musteri)}`,
  );
  check("§9b İade durumu RETURNED", (await statusOf(c4)) === ChequeStatus.RETURNED);

  const musBeforeCancel = await cariBalance(musteri);
  const c5 = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 999,
    dueDate: new Date(Date.now() + 5 * 86400000),
  });
  await chequeService.cancel(c5, "yanlış tutar girildi");
  check(
    "§9c İPTAL doğuş satırını ters çevirdi",
    (await cariBalance(musteri)).equals(musBeforeCancel),
    `müşteri=${await cariBalance(musteri)}`,
  );
  const c5row = await prisma.cheque.findUniqueOrThrow({
    where: { id: c5 },
    select: { status: true, cancelReason: true, cancelledAt: true },
  });
  check(
    "§9d ⭐ Kayıt SİLİNMEDİ; sebep ve zaman damgası saklandı",
    c5row.status === ChequeStatus.CANCELLED && c5row.cancelReason === "yanlış tutar girildi" && c5row.cancelledAt !== null,
  );
  const cancelEndorsedErr = await expectError(() => chequeService.cancel(c2, "olmaz"));
  check(
    "§9e Karşılıksız/terminal çek iptal edilemez",
    /karşılıksız|kapanmış/i.test(cancelEndorsedErr),
    cancelEndorsedErr.slice(0, 70),
  );

  // ── §10 YÖN KAPILARI ────────────────────────────────────────────────────
  const c6 = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 1200,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  const wrongPay = await expectError(() => chequeService.pay(c6, { bankAccountId: bank.id }));
  check("§10a ALINAN çek 'ödeme' yoluna giremez", /verdiğimiz/i.test(wrongPay), wrongPay.slice(0, 70));
  const c7 = await newCheque({
    kind: "ISSUED",
    cariId: tedarikci,
    amount: 300,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  const wrongEndorse = await expectError(() => chequeService.endorse(c7, { toCariId: musteri }));
  check("§10b VERİLEN çek ciro edilemez", /aldığımız/i.test(wrongEndorse), wrongEndorse.slice(0, 70));

  // ── §11 PARA BİRİMİ EŞLEŞMESİ ───────────────────────────────────────────
  const usdCheque = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    currency: "USD",
    exchangeRate: 34,
    amount: 100,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  const curErr = await expectError(() => chequeService.collect(usdCheque, { cashBoxId: box.id }));
  check("§11a USD çek TL kasaya tahsil EDİLEMEZ", /TRY hesabıdır|para birim/i.test(curErr), curErr.slice(0, 80));
  const usdTxn = await prisma.cariTransaction.findFirstOrThrow({
    where: { chequeId: usdCheque, sourceType: "CHEQUE_RECEIVE" },
    select: { currency: true, amountTry: true, exchangeRate: true },
  });
  check(
    "§11b Kur DAMGALANDI ve TL karşılığı hesaplandı",
    usdTxn.currency === "USD" && D(usdTxn.amountTry).equals(3400) && D(usdTxn.exchangeRate).equals(34),
    `TL=${usdTxn.amountTry} kur=${usdTxn.exchangeRate}`,
  );

  // ── §12 İDEMPOTENCY ─────────────────────────────────────────────────────
  const token = crypto.randomUUID();
  const first = await chequeService.create({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 60,
    dueDate: new Date(Date.now() + 7 * 86400000),
    clientToken: token,
  });
  chequeIds.push(first.data.id);
  const balAfterFirst = await cariBalance(musteri);
  const second = await chequeService.create({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 60,
    dueDate: new Date(Date.now() + 7 * 86400000),
    clientToken: token,
  });
  check("§12a Aynı token İKİNCİ çek açmadı", first.data.id === second.data.id, first.data.docNo);
  check(
    "§12b Bakiye TEK kez oynadı",
    (await cariBalance(musteri)).equals(balAfterFirst),
    `bakiye=${await cariBalance(musteri)}`,
  );

  // ── §13 MUTABAKAT (test_consistency §23/§24 formülü) ─────────────────────
  // ⚠️ Bu bölüm, ürün kodundaki bakiye yazımını DEĞİL bekçinin FORMÜLÜNÜ ölçer.
  // Formül çek olaylarını saymazsa banka bakiyesi "drift" görünür ve ilk çek
  // tahsilatında §24 kırmızıya döner — genişletme unutulamaz.
  // ⚠️ COLLECT_CANCEL formülde NEGATİF sayılır (K-2): tahsil stornosu parayı
  // geri çeker; formül onu görmezse İLK stornoda bekçi "drift" raporlar.
  // §19k bu satırı storno SONRASI yeniden koşarak yükü taşıtır.
  const bankDriftRows = () => prisma.$queryRaw<Array<{ hesap: string; fark: Prisma.Decimal }>>`
    SELECT a.id::text AS hesap, a.balance - COALESCE(p.toplam, 0) AS fark
    FROM bank_accounts a
    LEFT JOIN (
      SELECT "bankAccountId", SUM(t) AS toplam FROM (
        SELECT "bankAccountId", SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) AS t
          FROM payments WHERE status <> 'CANCELLED' AND "bankAccountId" IS NOT NULL GROUP BY "bankAccountId"
        UNION ALL
        SELECT "bankAccountId", SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END) AS t
          FROM cash_transactions WHERE status <> 'CANCELLED' AND "bankAccountId" IS NOT NULL GROUP BY "bankAccountId"
        UNION ALL
        SELECT e."bankAccountId", SUM(CASE WHEN e.type = 'COLLECT' THEN ch.amount ELSE -ch.amount END) AS t
          FROM cheque_events e JOIN cheques ch ON ch.id = e."chequeId"
          WHERE e.type IN ('COLLECT', 'PAY', 'COLLECT_CANCEL') AND e."bankAccountId" IS NOT NULL GROUP BY e."bankAccountId"
      ) u GROUP BY "bankAccountId"
    ) p ON p."bankAccountId" = a.id
    WHERE a.id = ${bank.id}::uuid AND a.balance <> COALESCE(p.toplam, 0)`;
  const drift = await bankDriftRows();
  check("§13a ⭐ Banka bakiyesi ÜÇ YAZARLI formülle mutabık", drift.length === 0, `sapma=${drift.length}`);

  const cariDrift = await prisma.$queryRaw<Array<{ c: string }>>`
    SELECT b."cariId"::text AS c FROM cari_balances b
    LEFT JOIN (SELECT "cariId", currency, SUM(debit)-SUM(credit) AS t
                 FROM cari_transactions GROUP BY "cariId", currency) x
      ON x."cariId"=b."cariId" AND x.currency=b.currency
    WHERE b."cariId" = ANY(${cariIds}::uuid[]) AND b.balance <> COALESCE(x.t, 0)`;
  check("§13b ⭐ Cari bakiyeleri DEFTERDEN türüyor", cariDrift.length === 0, `sapma=${cariDrift.length}`);

  // Durum↔olay mutabakatının TOPLU hâli: her çekin son olayı başlığıyla aynı mı?
  const statusDrift = await prisma.$queryRaw<Array<{ docno: string; basik: string; olay: string }>>`
    SELECT c."docNo" AS docno, c.status::text AS basik, e."toStatus"::text AS olay
    FROM cheques c
    JOIN LATERAL (
      SELECT "toStatus" FROM cheque_events x
      WHERE x."chequeId" = c.id ORDER BY x."eventDate" DESC, x."createdAt" DESC LIMIT 1
    ) e ON true
    WHERE c.id = ANY(${chequeIds}::uuid[]) AND c.status <> e."toStatus"`;
  check("§13c ⭐ Her çekin SON olayı başlık durumuyla MUTABIK", statusDrift.length === 0, `sapma=${statusDrift.length}`);

  const eventless = await prisma.cheque.count({
    where: { id: { in: chequeIds }, events: { none: {} } },
  });
  check("§13d Olay defteri OLMAYAN çek yok (başlık tek başına doğmaz)", eventless === 0, `olaysız=${eventless}`);

  // ── §14 BELGE NUMARASI ──────────────────────────────────────────────────
  const docNos = await prisma.cheque.findMany({
    where: { id: { in: chequeIds } },
    select: { docNo: true, kind: true, docType: true },
  });
  const alinan = docNos.filter((d) => d.kind === "RECEIVED" && d.docType === "CHEQUE");
  const verilen = docNos.filter((d) => d.kind === "ISSUED" && d.docType === "CHEQUE");
  check(
    "§14a Alınan çekler CKA ön ekli",
    alinan.length > 0 && alinan.every((d) => d.docNo.startsWith("CKA")),
    alinan[0]?.docNo,
  );
  check(
    "§14b Verilen çekler CKV ön ekli (aynı sayaçta karışmıyor)",
    verilen.length > 0 && verilen.every((d) => d.docNo.startsWith("CKV")),
    verilen[0]?.docNo,
  );
  const senet = await newCheque({
    kind: "RECEIVED",
    docType: "PROMISSORY_NOTE",
    cariId: musteri,
    amount: 500,
    dueDate: new Date(Date.now() + 60 * 86400000),
  });
  const senetNo = (await prisma.cheque.findUniqueOrThrow({ where: { id: senet }, select: { docNo: true } })).docNo;
  check("§14c Senet SNA ön ekli (aynı modül, ayrı sayaç)", senetNo.startsWith("SNA"), senetNo);

  // ── §15 POSTING TARİHİ ÇIPASI (SINIF 1) ─────────────────────────────────
  // Keşide GEÇMİŞ, posting BUGÜN olan çekte dört tüketici (kur · belge no ·
  // defter txnDate · doğuş olayı) İŞLEM tarihinden okumalı. Kur beklentileri
  // MUTLAK değer değil, `resolveExchangeRateTx`'in kendisiyle kurulur: paylaşımlı
  // dev DB'de GBP kuru zaten olabilir; helper-bazlı beklenti ortam verisinden
  // etkilenmez, ıraksama olmazsa da §15-zemin AÇIKÇA kırmızı verir (sessiz
  // vakum-yeşili yerine).
  const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const ensureRate = async (day: Date, rate: string) => {
    try {
      const row = await prisma.exchangeRate.create({
        data: { currency: "GBP", rateDate: day, rate: new Prisma.Decimal(rate) },
        select: { id: true },
      });
      rateIds.push(row.id);
    } catch {
      // P2002 — o güne GBP kuru zaten var (paylaşımlı dev DB): DOKUNMA, silme
      // listesine de ALMA. Beklentiler helper'dan kurulduğu için sorun değil.
    }
  };
  const issueOld = new Date(Date.now() - 33 * 86400000);
  await ensureRate(utcDay(issueOld), "31.1234");
  await ensureRate(utcDay(new Date(Date.now() - 86400000)), "39.5678");
  const rateAtPosting = await resolveExchangeRateTx(prisma, "GBP", new Date());
  const rateAtIssue = await resolveExchangeRateTx(prisma, "GBP", issueOld);
  check(
    "§15-zemin KÖRLÜK: kur fixture'ı ıraksadı (posting kuru ≠ keşide kuru)",
    rateAtPosting != null && rateAtIssue != null && !rateAtPosting.equals(rateAtIssue),
    `posting=${rateAtPosting} keşide=${rateAtIssue}`,
  );

  const cPost = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    currency: "GBP",
    amount: 100,
    issueDate: issueOld,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  const cPostRow = await prisma.cheque.findUniqueOrThrow({
    where: { id: cPost },
    select: { docNo: true, exchangeRate: true, amountTry: true, postingDate: true, issueDate: true },
  });
  check(
    "§15a ⭐ KUR posting gününden damgalandı (keşide gününden DEĞİL)",
    rateAtPosting != null && rateAtIssue != null &&
      D(cPostRow.exchangeRate).equals(rateAtPosting) && !D(cPostRow.exchangeRate).equals(rateAtIssue),
    `damga=${cPostRow.exchangeRate}`,
  );
  check(
    "§15b TL karşılığı posting kurundan hesaplandı",
    rateAtPosting != null &&
      D(cPostRow.amountTry).equals(D(100).mul(rateAtPosting).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
    `TL=${cPostRow.amountTry}`,
  );
  check(
    "§15c ⭐ Belge no GGAAYY'si BUGÜNÜN (keşide gününün DEĞİL)",
    cPostRow.docNo.startsWith(dailyCodePrefix("CKA", new Date())) &&
      !cPostRow.docNo.startsWith(dailyCodePrefix("CKA", issueOld)),
    cPostRow.docNo,
  );
  const cPostTxn = await prisma.cariTransaction.findFirstOrThrow({
    where: { chequeId: cPost, sourceType: "CHEQUE_RECEIVE" },
    select: { txnDate: true },
  });
  const cPostEvent = await prisma.chequeEvent.findFirstOrThrow({
    where: { chequeId: cPost, type: "RECEIVE" },
    select: { eventDate: true },
  });
  const nearNow = (d: Date) => Math.abs(d.getTime() - Date.now()) < 5 * 60_000;
  check("§15d ⭐ Defter satırı BUGÜNE düştü (gönderilmiş eski ekstre DEĞİŞMEZ)", nearNow(cPostTxn.txnDate));
  check("§15e Doğuş olayının tarihi de posting", nearNow(cPostEvent.eventDate));
  check(
    "§15f Keşide tarihi KAYBOLMADI (kâğıdın hukuki verisi — TTK 796)",
    Math.abs(cPostRow.issueDate.getTime() - issueOld.getTime()) < 1000,
  );

  // Açık posting tarihi: "işlem tarihi kullanıcınındır" — dün girilen çek
  // dünün defterine ve dünün belge sayacına düşer.
  const postY = new Date(Date.now() - 86400000);
  const cYesterday = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 500,
    dueDate: new Date(Date.now() + 20 * 86400000),
    postingDate: postY,
  });
  const cYRow = await prisma.cheque.findUniqueOrThrow({
    where: { id: cYesterday },
    select: { docNo: true },
  });
  const cYTxn = await prisma.cariTransaction.findFirstOrThrow({
    where: { chequeId: cYesterday, sourceType: "CHEQUE_RECEIVE" },
    select: { txnDate: true },
  });
  check(
    "§15g Açık postingDate belge sayacını O GÜNE anahtarlar",
    cYRow.docNo.startsWith(dailyCodePrefix("CKA", postY)),
    cYRow.docNo,
  );
  check("§15h Defter satırı verilen işlem ANINI birebir taşır", cYTxn.txnDate.getTime() === postY.getTime());

  // ── §16 DÖNEM KİLİDİ postingDate'İ KAPILAR ──────────────────────────────
  // Kapalı döneme POSTING → 409; ama aynı cariye GEÇMİŞ KEŞİDELİ çek girmek
  // serbesttir (posting bugüne düşer). Eski davranışta operatör meşru tahsilatı
  // girmek için keşide tarihini YALAN yazmaya zorlanıyordu — veri tahrifine
  // iten kilit tam da buydu.
  const kapaliCariId = await makeCari("KPL");
  // Kapanış satırı doğrudan yazılır (kapanış servisi başka paketin dosyası);
  // temizlik `cariPeriodClose.deleteMany({ cariId })` ile yapılır.
  await prisma.cariPeriodClose.create({
    data: {
      cariId: kapaliCariId,
      currency: "TRY",
      periodEnd: periodDayKey(new Date(Date.now() - 10 * 86400000)),
      closingBalance: 0,
      txnCount: 0,
    },
    select: { id: true },
  });
  const closedErr = await expectError(() =>
    chequeService.create({
      kind: "RECEIVED",
      cariId: kapaliCariId,
      amount: 1000,
      dueDate: new Date(Date.now() + 20 * 86400000),
      postingDate: new Date(Date.now() - 15 * 86400000),
    }),
  );
  check("§16a ⭐ Kapalı döneme POSTING 409 (yol gösteren mesajla)", /KAPALI döneme/i.test(closedErr), closedErr.slice(0, 80));
  check(
    "§16b Reddedilen giriş ÇEK SATIRI BIRAKMADI (tx geri sarıldı)",
    (await prisma.cheque.count({ where: { cariId: kapaliCariId } })) === 0,
  );
  const cOldIssue = await newCheque({
    kind: "RECEIVED",
    cariId: kapaliCariId,
    amount: 1000,
    issueDate: new Date(Date.now() - 15 * 86400000),
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  const cOldIssueTxn = await prisma.cariTransaction.findFirstOrThrow({
    where: { chequeId: cOldIssue, sourceType: "CHEQUE_RECEIVE" },
    select: { txnDate: true },
  });
  check(
    "§16c ⭐ Aynı carinin GEÇMİŞ KEŞİDELİ çeki SERBEST — satır bugüne düşer, keşide yalanına gerek yok",
    nearNow(cOldIssueTxn.txnDate),
    `txnDate=${cOldIssueTxn.txnDate.toISOString()}`,
  );

  // ── §17 AYNA-CİRO DEADLOCK REGRESYONU (SINIF 3) ─────────────────────────
  // A'nın çeki B'ye, B'ninki A'ya ciro edilmiş; ikisi AYNI ANDA karşılıksız.
  // Eski kod iki dönem kilidini veri sırasıyla (drawer→endorsee) alıyordu →
  // ayna çiftte ters sıra → PG 40P01 → operatöre anlamsız 500. `bounce` artık
  // `assertPeriodsOpenTx` ile kilitleri DETERMİNİSTİK sırada ÖNDEN alır.
  // ⚠️ `Promise.allSettled` MEŞRU (§3 ile aynı gerekçe): iki AYRI transaction.
  const musBefore17 = await cariBalance(musteri);
  const tedBefore17 = await cariBalance(tedarikci);
  const BOUNCE_ROUNDS = 4;
  const bounceFailures: string[] = [];
  for (let r = 0; r < BOUNCE_ROUNDS; r++) {
    const cx = await newCheque({
      kind: "RECEIVED",
      cariId: musteri,
      amount: 111,
      dueDate: new Date(Date.now() + 20 * 86400000),
    });
    const cy = await newCheque({
      kind: "RECEIVED",
      cariId: tedarikci,
      amount: 222,
      dueDate: new Date(Date.now() + 20 * 86400000),
    });
    await chequeService.endorse(cx, { toCariId: tedarikci });
    await chequeService.endorse(cy, { toCariId: musteri });
    const pair = await Promise.allSettled([chequeService.bounce(cx, {}), chequeService.bounce(cy, {})]);
    for (const p of pair) {
      if (p.status === "rejected") bounceFailures.push((p.reason as Error).message.slice(0, 100));
    }
  }
  check(
    `§17a ⭐ ${BOUNCE_ROUNDS} ayna-ciro çifti paralel karşılıksızda HİÇ hata yok (deadlock/500 dahil)`,
    bounceFailures.length === 0,
    bounceFailures[0] ?? "",
  );
  check(
    "§17b İki cari de tur sonunda başlangıç bakiyesine döndü (çift yazım TAM)",
    (await cariBalance(musteri)).equals(musBefore17) && (await cariBalance(tedarikci)).equals(tedBefore17),
    `müşteri=${await cariBalance(musteri)} tedarikçi=${await cariBalance(tedarikci)}`,
  );

  // ── §18 KAPAMALI ÇEK (SINIF 4) ──────────────────────────────────────────
  // Para-yok-eden üç geçiş (karşılıksız · iade · iptal) kapamalı çekte 409
  // "kapamayı kaldırın" der; MEŞRU tahsil ise 409'a DÜŞMEZ. Kapama sayacı
  // DOĞRUDAN yazılır — PaymentAllocation motoru başka paketin dosyası; burada
  // ölçülen, geçiş tarafının kapıyı görmesidir. Üç katman birden korur
  // (hızlı-yol assert · claim WHERE allocatedTotal=0 · DB CHECK) — negatif
  // sondada ilk ikisi körleştirilince mesaj kaybolup DB CHECK ham hatası
  // kaldığı için bu bölüm YİNE kırmızı verir.
  const cAlloc = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 1000,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  await prisma.cheque.update({ where: { id: cAlloc }, data: { allocatedTotal: 250 } });
  const allocBounceErr = await expectError(() => chequeService.bounce(cAlloc, {}));
  const allocReturnErr = await expectError(() => chequeService.returnToDrawer(cAlloc, {}));
  const allocCancelErr = await expectError(() => chequeService.cancel(cAlloc, "x"));
  check("§18a Kapamalı çekte KARŞILIKSIZ 409 'kapamayı kaldırın'", /kapamayı kaldırın/i.test(allocBounceErr), allocBounceErr.slice(0, 90));
  check("§18b Kapamalı çekte İADE 409 'kapamayı kaldırın'", /kapamayı kaldırın/i.test(allocReturnErr), allocReturnErr.slice(0, 90));
  check("§18c Kapamalı çekte İPTAL 409 'kapamayı kaldırın'", /kapamayı kaldırın/i.test(allocCancelErr), allocCancelErr.slice(0, 90));
  check(
    "§18d Reddedilen üç deneme durumu ve defteri KİRLETMEDİ",
    (await statusOf(cAlloc)) === ChequeStatus.PORTFOLIO &&
      (await prisma.cariTransaction.count({ where: { chequeId: cAlloc } })) === 1 &&
      (await prisma.chequeEvent.count({ where: { chequeId: cAlloc } })) === 1,
  );
  await chequeService.collect(cAlloc, { cashBoxId: box.id });
  check(
    "§18e ⭐ Kapamalı çekin MEŞRU tahsili 409'a DÜŞMEDİ (CAS yalnız para-yok-eden geçişlerde)",
    (await statusOf(cAlloc)) === ChequeStatus.COLLECTED,
  );

  // ── §19 TAHSİL STORNOSU (K-2) ───────────────────────────────────────────
  const boxAfterCollect = await boxBalance(box.id);
  const noReasonErr = await expectError(() => chequeService.cancelCollect(cAlloc, "   "));
  check("§19a Sebepsiz storno 400 (para hareketi sebepsiz geri alınmaz)", /sebep zorunlu/i.test(noReasonErr), noReasonErr.slice(0, 80));
  await chequeService.cancelCollect(cAlloc, "yanlış çek okutuldu");
  check(
    "§19b ⭐ Para AYNI hesaptan (kasa) GERİ çekildi",
    (await boxBalance(box.id)).equals(boxAfterCollect.minus(1000)),
    `kasa=${await boxBalance(box.id)}`,
  );
  check("§19c ⭐ Durum COLLECT'in tükettiği duruma döndü (PORTFOLIO)", (await statusOf(cAlloc)) === ChequeStatus.PORTFOLIO);
  const stornoEvent = await prisma.chequeEvent.findFirstOrThrow({
    where: { chequeId: cAlloc, type: "COLLECT_CANCEL" },
    select: { fromStatus: true, toStatus: true, notes: true, cashBoxId: true, bankAccountId: true },
  });
  check(
    "§19d Tipli olay yazıldı: COLLECT_CANCEL + sebep + hesap",
    stornoEvent.fromStatus === ChequeStatus.COLLECTED &&
      stornoEvent.toStatus === ChequeStatus.PORTFOLIO &&
      stornoEvent.notes === "yanlış çek okutuldu" &&
      stornoEvent.cashBoxId === box.id,
  );
  check(
    "§19e Kapamaya DOKUNULMADI (storno çekin varlığını yok etmez)",
    D((await prisma.cheque.findUniqueOrThrow({ where: { id: cAlloc }, select: { allocatedTotal: true } })).allocatedTotal).equals(250),
  );
  check(
    "§19f Cari deftere satır YAZILMADI (COLLECT yazmıyordu, tersi de yazmaz)",
    (await prisma.cariTransaction.count({ where: { chequeId: cAlloc } })) === 1,
  );
  const secondStornoErr = await expectError(() => chequeService.cancelCollect(cAlloc, "tekrar"));
  check("§19g İkinci storno 409 (para İKİ KEZ geri çekilmez)", /portföyde/i.test(secondStornoErr), secondStornoErr.slice(0, 80));

  // AT_BANK yolu: bankadan tahsil edilen çek stornoda BANKAYA (AT_BANK) döner.
  const cBank = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 600,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  await chequeService.deposit(cBank, { bankAccountId: bank.id });
  await chequeService.collect(cBank, { bankAccountId: bank.id });
  const bankAfterCollect = await bankBalance(bank.id);
  await chequeService.cancelCollect(cBank, "banka dekontu başka çekin");
  const cBankRow = await prisma.cheque.findUniqueOrThrow({
    where: { id: cBank },
    select: { status: true, bankAccountId: true },
  });
  check(
    "§19h AT_BANK'tan tahsil edilen çek stornoda AT_BANK'a döner (banka başlıkta)",
    cBankRow.status === ChequeStatus.AT_BANK && cBankRow.bankAccountId === bank.id,
  );
  check(
    "§19i Banka bakiyesi geri düştü",
    (await bankBalance(bank.id)).equals(bankAfterCollect.minus(600)),
    `banka=${await bankBalance(bank.id)}`,
  );
  await chequeService.collect(cBank, { bankAccountId: bank.id });
  check(
    "§19j ⭐ Storno sonrası YENİDEN TAHSİL serbest (doğru dekont geldi)",
    (await statusOf(cBank)) === ChequeStatus.COLLECTED &&
      (await bankBalance(bank.id)).equals(bankAfterCollect),
  );
  // Mutabakat formülü storno SONRASI da tutmalı — COLLECT_CANCEL formülden
  // düşürülürse tam burada kırmızı verir (formül genişletmesinin yükü).
  const driftAfterStorno = await bankDriftRows();
  check("§19k ⭐ MUTABAKAT storno sonrası da tutuyor (formül COLLECT_CANCEL'ı sayıyor)", driftAfterStorno.length === 0, `sapma=${driftAfterStorno.length}`);
  const guideErr = await expectError(() => chequeService.bounce(cBank, {}));
  check(
    "§19l COLLECTED çeke başka olay denenince mesaj STORNO yolunu gösterir (çıkmaz 409 yasak)",
    /Tahsilatı Geri Al/.test(guideErr),
    guideErr.slice(0, 110),
  );

  // ── §19m DEPOSIT BANKASI ≠ COLLECT HESABI ───────────────────────────────
  // Çek bank1'e tahsile verildi ama para bank2'ye girdi (banka farklı hesaba
  // geçirmiş olabilir — servis yorumundaki senaryo). Storno parayı TAHSİL
  // hesabından (bank2) geri çekmeli; AT_BANK'a dönüşte başlık bankası ise
  // DEPOSIT olayından (bank1) geri kurulmalı. İkisi aynı hesap olsaydı bu
  // ayrım hiç ölçülmezdi (§19h ikisini de aynı bankayla kuruyor).
  const bank2 = await prisma.bankAccount.create({
    data: { code: `${TAG}-BN2`, name: `${TAG} Banka 2`, currency: "TRY" },
    select: { id: true },
  });
  bankIds.push(bank2.id);
  const cSplit = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 800,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  await chequeService.deposit(cSplit, { bankAccountId: bank.id });
  await chequeService.collect(cSplit, { bankAccountId: bank2.id });
  const b1BeforeSplitStorno = await bankBalance(bank.id);
  const b2BeforeSplitStorno = await bankBalance(bank2.id);
  await chequeService.cancelCollect(cSplit, "dekont başka hesabın");
  check(
    "§19m1 ⭐ Para TAHSİL hesabından (bank2) geri çekildi; DEPOSIT bankasına DOKUNULMADI",
    (await bankBalance(bank2.id)).equals(b2BeforeSplitStorno.minus(800)) &&
      (await bankBalance(bank.id)).equals(b1BeforeSplitStorno),
    `bank1=${await bankBalance(bank.id)} bank2=${await bankBalance(bank2.id)}`,
  );
  const cSplitRow = await prisma.cheque.findUniqueOrThrow({
    where: { id: cSplit },
    select: { status: true, bankAccountId: true },
  });
  check(
    "§19m2 ⭐ Başlık bankası DEPOSIT olayından geri kuruldu (tahsil hesabından DEĞİL)",
    cSplitRow.status === ChequeStatus.AT_BANK && cSplitRow.bankAccountId === bank.id,
    `başlık=${cSplitRow.bankAccountId === bank.id ? "bank1 (deposit)" : "YANLIŞ"}`,
  );

  // ── §19n GERİYE TARİHLİ YENİDEN TAHSİL — storno çıpası `createdAt` ──────
  // Zincir: kasaya tahsil (eventDate BUGÜN) → storno → bank2'ye tahsil
  // (eventDate DÜN — dekont dün kesilmiş, bugün giriliyor; meşru) → storno.
  // Son storno parayı bank2'den çekmeli. Arama `eventDate desc` ile yapılsaydı
  // "en yeni COLLECT" diye BUGÜN tarihli İLK tahsil (kasa) bulunur ve para
  // KASADAN geri çekilirdi — hata yok, log yok, iki hesap birden sessizce
  // yanlış. (Negatif sonda: orderBy eventDate'e çevrilince kırmızı — ölçüldü.)
  const cBack = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 400,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  await chequeService.collect(cBack, { cashBoxId: box.id });
  await chequeService.cancelCollect(cBack, "yanlış hesap seçildi");
  await chequeService.collect(cBack, {
    bankAccountId: bank2.id,
    eventDate: new Date(Date.now() - 86400000),
  });
  const boxBeforeBackStorno = await boxBalance(box.id);
  const b2BeforeBackStorno = await bankBalance(bank2.id);
  await chequeService.cancelCollect(cBack, "o dekont da başka çekin");
  check(
    "§19n ⭐ Storno EN SON YAZILAN tahsili buldu (createdAt) — para bank2'den geri, kasa OYNAMADI",
    (await bankBalance(bank2.id)).equals(b2BeforeBackStorno.minus(400)) &&
      (await boxBalance(box.id)).equals(boxBeforeBackStorno),
    `kasa=${await boxBalance(box.id)} bank2=${await bankBalance(bank2.id)}`,
  );

  // ── §19o COLLECT OLAYI YOKSA STORNO FAIL-CLOSED ─────────────────────────
  // Başlık COLLECTED ama olay defterinde COLLECT satırı yok (veri tuhaflığı /
  // elle müdahale). Parayı NEREDEN geri çekeceğini bilmeyen storno körlemesine
  // bir bakiye OYNATMAMALI — anlamlı 409 ile durmalı.
  const cGhost = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 120,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  await prisma.cheque.update({ where: { id: cGhost }, data: { status: ChequeStatus.COLLECTED } });
  const ghostErr = await expectError(() => chequeService.cancelCollect(cGhost, "sebep"));
  check(
    "§19o Hesap kaydı olmayan COLLECTED'da storno 409 (körlemesine bakiye oynatılmaz)",
    /hesap kaydı bulunamadı/i.test(ghostErr),
    ghostErr.slice(0, 100),
  );
  // Zorlanmış durumu geri al — durum↔olay invariant'ı fixture'da da korunsun.
  await prisma.cheque.update({ where: { id: cGhost }, data: { status: ChequeStatus.PORTFOLIO } });

  // ── §20 KASA/BANKA DÖNEM KİLİDİ — GERÇEK SERVİS YOLUNDAN (K-1 dikişi) ───
  // `test_cash_period_close` olayları DOĞRUDAN tabloya yazarak formülü ölçer;
  // burada ölçülen DİKİŞİN KENDİSİ: collect/pay gerçekten `eventDate` ile
  // guard'ı çağırıyor mu, cancelCollect gerçekten `now` ile mi? Taze kasa
  // kullanılır — önceki bölümlerin hesaplarına kapanış bulaştırmamak için.
  const box2 = await prisma.cashBox.create({
    data: { code: `${TAG}-KS2`, name: `${TAG} Kasa 2`, currency: "TRY" },
    select: { id: true },
  });
  cashBoxIds.push(box2.id);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000);
  const close1 = await prisma.cashPeriodClose.create({
    data: { cashBoxId: box2.id, periodEnd: periodDayKey(daysAgo(5)), closingBalance: 0, txnCount: 0 },
    select: { id: true },
  });
  const cP1 = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 900,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  const closedCashErr = await expectError(() =>
    chequeService.collect(cP1, { cashBoxId: box2.id, eventDate: daysAgo(10) }),
  );
  check(
    "§20a ⭐ Kapalı kasa dönemine GERİYE TARİHLİ tahsil 409 (guard eventDate'i kapılar)",
    /KAPALI dönemine/i.test(closedCashErr),
    closedCashErr.slice(0, 90),
  );
  check(
    "§20b Reddedilen tahsil İZ BIRAKMADI (durum + kasa + olay; tx geri sarıldı)",
    (await statusOf(cP1)) === ChequeStatus.PORTFOLIO &&
      (await boxBalance(box2.id)).isZero() &&
      (await prisma.chequeEvent.count({ where: { chequeId: cP1 } })) === 1,
  );
  await chequeService.collect(cP1, { cashBoxId: box2.id, eventDate: daysAgo(3) });
  check(
    "§20c Açık güne (kapanış sonrası) geriye tarihli tahsil SERBEST",
    (await boxBalance(box2.id)).equals(900),
    `kasa2=${await boxBalance(box2.id)}`,
  );
  // Kapanış İLERİ çekilir: tahsilin KENDİ tarihi (3 gün önce) artık kapalı
  // dönemde. Storno çıpası `now` olduğu için yine GEÇMELİ — ters satır bugüne
  // düşer, kapalı sayfa değişmez (storno sözleşmesi). Çıpa orijinal eventDate
  // olsaydı burada 409 yenirdi ve yanlış tahsil sonsuza dek düzeltilemezdi.
  await prisma.cashPeriodClose.delete({ where: { id: close1.id } });
  await prisma.cashPeriodClose.create({
    data: { cashBoxId: box2.id, periodEnd: periodDayKey(daysAgo(2)), closingBalance: 900, txnCount: 1 },
    select: { id: true },
  });
  await chequeService.cancelCollect(cP1, "yanlış çek okutuldu");
  check(
    "§20d ⭐ Orijinal tahsil tarihi KAPANAN dönemde kalsa da storno GEÇER (çıpa `now`)",
    (await statusOf(cP1)) === ChequeStatus.PORTFOLIO && (await boxBalance(box2.id)).isZero(),
    `durum=${await statusOf(cP1)} kasa2=${await boxBalance(box2.id)}`,
  );
  const cP2 = await newCheque({
    kind: "ISSUED",
    cariId: tedarikci,
    amount: 350,
    dueDate: new Date(Date.now() + 20 * 86400000),
  });
  const closedPayErr = await expectError(() =>
    chequeService.pay(cP2, { cashBoxId: box2.id, eventDate: daysAgo(10) }),
  );
  check(
    "§20e Kapalı kasa dönemine GERİYE TARİHLİ ödeme (pay) de 409 — durum ISSUED kaldı",
    /KAPALI dönemine/i.test(closedPayErr) && (await statusOf(cP2)) === ChequeStatus.ISSUED,
    closedPayErr.slice(0, 90),
  );

  // ── §21 VADE TAKVİMİ (H4) ───────────────────────────────────────────────
  // ⚠️ TÜM KONTROLLER **DELTA** ÖLÇER. `dueSummary` portföyün TAMAMINI toplar
  // (cari süzgeci YOK) ve dev/CI veritabanında başka çekler bulunabilir; mutlak
  // sayı beklemek testi ortamın verisine bağlardı (CLAUDE.md "ortamdaki veriye
  // BAĞIMLI OLMA"). Önce taban alınır, sonra fark ölçülür.
  const dueBank = await prisma.bankAccount.create({
    data: { code: `${TAG}-BN3`, name: `${TAG} Vade Banka`, currency: "TRY" },
    select: { id: true },
  });
  bankIds.push(dueBank.id);

  /** Kova/para/yön kırılımından TEK satırın (adet, tutar) değeri. */
  const bucketOf = (
    s: Awaited<ReturnType<typeof chequeService.dueSummary>>["data"],
    bucket: string,
    kind: "RECEIVED" | "ISSUED",
    currency = "TRY",
  ) => {
    const row = s.buckets.find((b) => b.bucket === bucket && b.kind === kind && b.currency === currency);
    return { count: row?.count ?? 0, amount: D(row?.amount ?? 0) };
  };
  const totalCount = (s: Awaited<ReturnType<typeof chequeService.dueSummary>>["data"]) =>
    s.buckets.reduce((n, b) => n + b.count, 0);
  const snap = async (p?: { from?: Date; to?: Date }) => (await chequeService.dueSummary(p ?? {})).data;

  const base = await snap();

  // Vade çıpaları FABRİKA takvim gününden kurulur — `new Date()` + gün eklemek
  // saat dilimini örtük bırakırdı ve gece koşan bir CI'da sınır kontrolleri
  // (D probu) anlamını yitirirdi.
  const todayStart = factoryDayStart();
  const dayPlus = (n: number, hourMs = 12 * 3_600_000) =>
    new Date(todayStart.getTime() + n * 86_400_000 + hourMs);

  const dA = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 100, dueDate: dayPlus(-3) });
  const dB = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 200, dueDate: dayPlus(7) });
  const dC = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 300, dueDate: dayPlus(8) });
  // ⭐ GECE SINIRI PROBU: bugünün fabrika günü 00:30'u. Bu an UTC'de DÜNE düşer
  // (Istanbul UTC+3 → dün 21:30Z). Kova sınırı UTC'de kesilseydi bu çek
  // "vadesi GEÇMİŞ" olurdu; fabrika takviminde BUGÜNDÜR → SOON.
  const dD = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    amount: 400,
    dueDate: new Date(todayStart.getTime() + 30 * 60_000),
  });
  const dE = await newCheque({
    kind: "RECEIVED",
    cariId: musteri,
    currency: "USD",
    exchangeRate: 34,
    amount: 50,
    dueDate: dayPlus(2),
  });
  const dF = await newCheque({ kind: "ISSUED", cariId: tedarikci, amount: 500, dueDate: dayPlus(3) });
  const dJ = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 900, dueDate: dayPlus(200) });
  void dA;
  void dC;

  const s1 = await snap();

  check(
    "§21a KÖRLÜK ZEMİNİ: yeni çekler kovalara GİRDİ (aksi halde aşağıdaki her fark vakumen 0 olurdu)",
    totalCount(s1) - totalCount(base) === 7,
    `delta=${totalCount(s1) - totalCount(base)}`,
  );
  check(
    "§21b VADESİ GEÇMİŞ kovası: yalnız dünkü çek (adet +1, tutar +100)",
    bucketOf(s1, "OVERDUE", "RECEIVED").count - bucketOf(base, "OVERDUE", "RECEIVED").count === 1 &&
      bucketOf(s1, "OVERDUE", "RECEIVED").amount.minus(bucketOf(base, "OVERDUE", "RECEIVED").amount).equals(100),
    `adet=${bucketOf(s1, "OVERDUE", "RECEIVED").count - bucketOf(base, "OVERDUE", "RECEIVED").count}`,
  );
  check(
    "§21c ⭐ SINIR GÜNÜ: +7. gün YAKLAŞAN kovasında, +8. gün DEĞİL (eşik panelin `dueTone` ile birebir)",
    bucketOf(s1, "SOON", "RECEIVED").count - bucketOf(base, "SOON", "RECEIVED").count === 2 &&
      bucketOf(s1, "SOON", "RECEIVED").amount.minus(bucketOf(base, "SOON", "RECEIVED").amount).equals(600),
    `TRY yaklaşan delta adet=${bucketOf(s1, "SOON", "RECEIVED").count - bucketOf(base, "SOON", "RECEIVED").count} tutar=${bucketOf(s1, "SOON", "RECEIVED").amount.minus(bucketOf(base, "SOON", "RECEIVED").amount)}`,
  );
  check(
    "§21d ⭐ GECE SINIRI: bugün 00:30 vadeli çek YAKLAŞAN'dır, vadesi geçmiş DEĞİL (UTC kesim onu düne atardı)",
    bucketOf(s1, "OVERDUE", "RECEIVED").count - bucketOf(base, "OVERDUE", "RECEIVED").count === 1,
    `vadesi geçmiş delta=${bucketOf(s1, "OVERDUE", "RECEIVED").count - bucketOf(base, "OVERDUE", "RECEIVED").count} (2 ise gün sınırı UTC'de kesiliyor)`,
  );
  check(
    "§21e +8. gün çeki BU AY ya da SONRASI kovasında — hangisi olduğu koşum gününe bağlıdır, ikisinin TOPLAMI +2 (o çek + 200 günlük)",
    bucketOf(s1, "MONTH", "RECEIVED").count +
      bucketOf(s1, "LATER", "RECEIVED").count -
      bucketOf(base, "MONTH", "RECEIVED").count -
      bucketOf(base, "LATER", "RECEIVED").count ===
      2,
  );
  check(
    "§21f PARA BİRİMLERİ TOPLANMAZ: USD çek KENDİ satırında (TL tutarına karışmadı)",
    bucketOf(s1, "SOON", "RECEIVED", "USD").count - bucketOf(base, "SOON", "RECEIVED", "USD").count === 1 &&
      bucketOf(s1, "SOON", "RECEIVED", "USD").amount
        .minus(bucketOf(base, "SOON", "RECEIVED", "USD").amount)
        .equals(50),
  );
  check(
    "§21g YÖN AYRIMI: verdiğimiz çek ISSUED satırında (ödenecek), aldığımızla toplanmadı",
    bucketOf(s1, "SOON", "ISSUED").count - bucketOf(base, "SOON", "ISSUED").count === 1 &&
      bucketOf(s1, "SOON", "ISSUED").amount.minus(bucketOf(base, "SOON", "ISSUED").amount).equals(500),
  );

  // ── §21h STATÜ SÜZGECİ — ASIL NEGATİF SONDA ────────────────────────────
  // Üç çek CANLI doğar, sayılır; sonra üçü de para-beklentisini yok eden bir
  // duruma geçer. Kova sayısı DÜŞMEK ZORUNDA. Süzgeç gevşerse (ör. COLLECTED
  // takvime girerse) sayı düşmez ve bu kontrol kırmızı verir.
  const dG = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 11, dueDate: dayPlus(5) });
  const dH = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 22, dueDate: dayPlus(5) });
  const dI = await newCheque({ kind: "RECEIVED", cariId: musteri, amount: 33, dueDate: dayPlus(5) });
  const s2 = await snap();
  check(
    "§21h KÖRLÜK ZEMİNİ: üç canlı çek YAKLAŞAN kovasına girdi (+3 / +66)",
    bucketOf(s2, "SOON", "RECEIVED").count - bucketOf(s1, "SOON", "RECEIVED").count === 3 &&
      bucketOf(s2, "SOON", "RECEIVED").amount.minus(bucketOf(s1, "SOON", "RECEIVED").amount).equals(66),
  );
  await chequeService.collect(dG, { bankAccountId: dueBank.id });
  await chequeService.endorse(dH, { toCariId: tedarikci });
  await chequeService.cancel(dI, "vade takvimi kapsam sondası");
  const s3 = await snap();
  check(
    "§21i ⭐ TAHSİL EDİLMİŞ · CİRO EDİLMİŞ · İPTAL EDİLMİŞ çekler takvimden ÇIKTI (−3 / −66)",
    bucketOf(s3, "SOON", "RECEIVED").count === bucketOf(s1, "SOON", "RECEIVED").count &&
      bucketOf(s3, "SOON", "RECEIVED").amount.equals(bucketOf(s1, "SOON", "RECEIVED").amount),
    `adet=${bucketOf(s3, "SOON", "RECEIVED").count} (beklenen ${bucketOf(s1, "SOON", "RECEIVED").count}) tutar=${bucketOf(s3, "SOON", "RECEIVED").amount}`,
  );
  check(
    "§21j Kapsam yanıtta AÇIKÇA yazılı — ENDORSED canlı listede YOK (sessiz dışlama yok)",
    s3.liveStatuses.RECEIVED.includes(ChequeStatus.PORTFOLIO) &&
      s3.liveStatuses.RECEIVED.includes(ChequeStatus.AT_BANK) &&
      !s3.liveStatuses.RECEIVED.includes(ChequeStatus.ENDORSED) &&
      s3.notes.some((n) => /ciro/i.test(n)),
    JSON.stringify(s3.liveStatuses),
  );

  // ── §21k MUTABAKAT — kova toplamı canlı çek adedine EŞİT ────────────────
  const liveCount = await prisma.cheque.count({
    where: {
      OR: [
        { kind: "RECEIVED", status: { in: [ChequeStatus.PORTFOLIO, ChequeStatus.AT_BANK] } },
        { kind: "ISSUED", status: ChequeStatus.ISSUED },
      ],
    },
  });
  check(
    "§21k ⭐ MUTABAKAT: Σ(kova adetleri) = canlı çek adedi (hiçbir çek iki kovaya düşmez, hiçbiri kaybolmaz)",
    totalCount(s3) === liveCount,
    `kova=${totalCount(s3)} canlı=${liveCount}`,
  );

  // ── §21l İKİ ZAMAN ANLAYIŞI: takvim PENCERELİ, kovalar DEĞİL ────────────
  const dueDayJ = factoryYmd(dayPlus(200));
  const inWindow = (s: Awaited<ReturnType<typeof chequeService.dueSummary>>["data"], ymdKey: string) =>
    s.weeks.some((w) => w.start <= ymdKey && ymdKey <= w.end);
  const wide = await snap({ from: todayStart, to: dayPlus(365) });
  check(
    "§21l ⭐ 200 gün sonrasına vadeli çek VARSAYILAN pencerede takvime GİRMEZ ama kovada DURUR (pencere kovaları etkilemez)",
    !inWindow(s3, dueDayJ) && bucketOf(s3, "LATER", "RECEIVED").count > 0,
    `takvimde=${inWindow(s3, dueDayJ)}`,
  );
  check(
    "§21m Pencere genişletilince AYNI çek takvime girer (süzme sunucuda, istemcide değil)",
    inWindow(wide, dueDayJ) && totalCount(wide) === totalCount(s3),
    `geniş takvimde=${inWindow(wide, dueDayJ)} kova toplamı aynı=${totalCount(wide) === totalCount(s3)}`,
  );
  void dJ;

  // ── §21n HAFTA PAZARTESİ BAŞLAR ────────────────────────────────────────
  const dueDayB = factoryYmd(dayPlus(7));
  const weekOfB = wide.weeks.find((w) => w.start <= dueDayB && dueDayB <= w.end && w.currency === "TRY");
  const weekStartDow = weekOfB
    ? new Date(`${weekOfB.start}T00:00:00Z`).getUTCDay()
    : -1;
  check(
    "§21n Hafta PAZARTESİ başlar ve 7 gün sürer (pazar başlasaydı pazartesi vadeli çek geçen haftaya yazılırdı)",
    Boolean(weekOfB) &&
      weekStartDow === 1 &&
      new Date(`${weekOfB?.end}T00:00:00Z`).getTime() -
        new Date(`${weekOfB?.start}T00:00:00Z`).getTime() ===
        6 * 86_400_000,
    `başlangıç=${weekOfB?.start} (gün=${weekStartDow}) bitiş=${weekOfB?.end}`,
  );
  check(
    "§21o Aylık satır ayın SON gününü doğru bulur (28/29/30/31 — sabit 30 yazılmamış)",
    wide.months.every((m) => {
      const end = new Date(`${m.end}T00:00:00Z`);
      const next = new Date(end.getTime() + 86_400_000);
      return m.start === `${m.key}-01` && next.getUTCDate() === 1;
    }),
    `ay satırı=${wide.months.length}`,
  );
  // Haftalık ve aylık kırılım AYNI günlerden türer — ikisi ayrı sorgudan
  // beslenseydi bu eşitlik ilk sapmada bozulurdu (üç rakam, üç kaynak sınıfı).
  const weekSum = wide.weeks.reduce((n, w) => n + w.count, 0);
  const monthSum = wide.months.reduce((n, m) => n + m.count, 0);
  check(
    "§21p Takvim TEK KAYNAKTAN türetiliyor: haftalık toplam = aylık toplam",
    weekSum === monthSum && weekSum > 0,
    `hafta=${weekSum} ay=${monthSum}`,
  );

  // ── §22 ⭐ EŞZAMANLI clientToken ÇİFT-GÖNDERİMİ (I2) ────────────────────
  // §12 ARDIŞIK replay'i ölçüyor (ön kontrol yolu); burası TOCTOU penceresini
  // ölçer. Pencere zamanlamayla DEĞİL elle açık tutulan tx ile kurulur (yarış
  // bekçisi kuralı): kazananın satırı unique indekse UNCOMMITTED yazılıdır →
  // kaybedenin ön kontrolü göremez, INSERT'i indeks kilidinde bekler; gate
  // commit → P2002 → catch cached yanıta çevirir (PO deseni).
  {
    const rplToken = crypto.randomUUID();
    const rplLock = deferred<{ id: string; docNo: string }>();
    const rplGate = deferred<void>();
    const now = new Date();
    const rplTx = prisma.$transaction(
      async (tx) => {
        const winner = await tx.cheque.create({
          data: {
            docNo: `${TAG}-RPL1`,
            kind: "RECEIVED",
            status: ChequeStatus.PORTFOLIO,
            cariId: musteri,
            amount: new Prisma.Decimal(60),
            amountTry: new Prisma.Decimal(60),
            issueDate: now,
            postingDate: now,
            dueDate: new Date(now.getTime() + 7 * 86400000),
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
    // unhandled rejection süreci Sonuç satırı basılmadan öldürür (CLAUDE.md eki ②).
    void rplTx.catch(() => {});
    const winner = await rplLock.promise;
    chequeIds.push(winner.id);

    const balBefore = await cariBalance(musteri);
    let loserSettled = false;
    const loserP = chequeService
      .create({
        kind: "RECEIVED",
        cariId: musteri,
        amount: 60,
        dueDate: new Date(now.getTime() + 7 * 86400000),
        clientToken: rplToken,
      })
      .finally(() => {
        loserSettled = true;
      });
    void loserP.catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    check("§22a ⭐ kaybeden UNIQUE indekste BEKLEDİ (ön kontrol kazananı görmedi → pencere gerçek)", !loserSettled);
    rplGate.resolve();
    await rplTx;
    const loserRes = await loserP;
    check(
      "§22b ⭐ kaybeden BAŞARILI ve KAZANANIN kaydını aldı (ham hata yok, mükerrer yok)",
      loserRes.success === true && loserRes.data.id === winner.id && loserRes.data.docNo === winner.docNo,
      `docNo=${loserRes.data?.docNo}`,
    );
    const seqRes = await chequeService.create({
      kind: "RECEIVED",
      cariId: musteri,
      amount: 60,
      dueDate: new Date(now.getTime() + 7 * 86400000),
      clientToken: rplToken,
    });
    check(
      "§22c ⭐ eşzamanlı replay yanıtı ardışık replay ile BAYT-BAYT aynı",
      JSON.stringify(loserRes) === JSON.stringify(seqRes),
      `eşzamanlı=${JSON.stringify(loserRes)}`,
    );
    check(
      "§22d token'lı TAM BİR kayıt",
      (await prisma.cheque.count({ where: { clientToken: rplToken } })) === 1,
    );
    check(
      "§22e kaybedenin tx'i GERİ SARILDI: cari bakiyesi oynamadı (defter yarım yazılmadı)",
      (await cariBalance(musteri)).equals(balBefore),
      `bakiye=${await cariBalance(musteri)}`,
    );
  }

  // ── §23 DETAY ALAN KÜMESİ (I4: include → select) ────────────────────────
  // Panel `ChequeDetail`/`ChequeEventRow` sözleşmesi buradan sabitlenir — alan
  // düşürme sessizdir (ekran boş basar, hata vermez). Olaylı gerçek örnek: c1.
  {
    const det = await chequeService.findById(chequeIds[0] as string);
    const data = det.data as unknown as Record<string, unknown>;
    const EXPECTED_KEYS = [
      "allocatedTotal", "amount", "amountTry", "bankAccount", "bankName", "branchName",
      "cancelReason", "cancelledAt", "cari", "createdAt", "currency", "docNo", "docType",
      "drawerName", "dueDate", "endorsedToCari", "events", "exchangeRate", "id",
      "issueDate", "kind", "notes", "postingDate", "serialNo", "status", "updatedAt",
    ];
    check(
      "§23a ⭐ detay anahtar kümesi SABİT",
      JSON.stringify(Object.keys(data).sort()) === JSON.stringify(EXPECTED_KEYS),
      `fark=${Object.keys(data).filter((k) => !EXPECTED_KEYS.includes(k)).join(",") || "-"} eksik=${EXPECTED_KEYS.filter((k) => !(k in data)).join(",") || "-"}`,
    );
    check("§23b ⭐ clientToken yanıtta GEZMİYOR", !("clientToken" in data));
    const bareFks = ["cariId", "endorsedToCariId", "bankAccountId", "cancelledById", "createdById"];
    check(
      "§23c çıplak iç FK'ler yok (cari/banka ilişkinin kendi id'siyle taşınır)",
      bareFks.every((k) => !(k in data)),
      bareFks.filter((k) => k in data).join(",") || "-",
    );
    const events = data.events as Array<Record<string, unknown>>;
    check(
      "§23d olay satırı anahtarları panel ChequeEventRow ile birebir",
      events.length > 0 &&
        JSON.stringify(Object.keys(events[0] as object).sort()) ===
          JSON.stringify(["bankAccount", "cashBox", "counterCari", "eventDate", "fromStatus", "id", "notes", "toStatus", "type"]),
      events[0] ? Object.keys(events[0]).join(",") : "(olay yok)",
    );
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // ⚠️ TEMİZLİK SIRASI FK'ye BAĞLI: olay + defter satırları çeke, çek cariye
    // RESTRICT ile bağlı. Ters sırada silmek FK ihlaliyle düşer ve fixture
    // ortamda kalır.
    // ⚠️ ÇEK KÜMESİ cariIds ÜZERİNDEN DE toplanır: negatif-yol kontrolleri
    // (`expectError` içindeki create) hata BEKLER ve id kaydetmez — guard bir
    // gün regrese olup create BAŞARILI olursa o çek `chequeIds`te olmaz, FK
    // Restrict cari silmeyi düşürür ve tüm temizlik zinciri yarıda kalırdı
    // (negatif sondada birebir yaşandı, 2026-08-14).
    const strayCheques =
      cariIds.length > 0
        ? await prisma.cheque.findMany({ where: { cariId: { in: cariIds } }, select: { id: true } })
        : [];
    const allChequeIds = [...new Set([...chequeIds, ...strayCheques.map((c) => c.id)])];
    if (allChequeIds.length > 0) {
      await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: allChequeIds } } });
      await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: allChequeIds } } });
      await prisma.cheque.deleteMany({ where: { id: { in: allChequeIds } } });
    }
    if (cariIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariPeriodClose.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    }
    // Yalnız BİZİM yarattığımız kur satırları silinir (P2002 ile atlananlar
    // ortamın verisidir — dokunulmaz).
    if (rateIds.length > 0) await prisma.exchangeRate.deleteMany({ where: { id: { in: rateIds } } });
    // §20 kapanış satırları hesaba RESTRICT ile bağlı — hesaplardan ÖNCE silinir.
    if (cashBoxIds.length > 0)
      await prisma.cashPeriodClose.deleteMany({ where: { cashBoxId: { in: cashBoxIds } } });
    if (bankIds.length > 0)
      await prisma.cashPeriodClose.deleteMany({ where: { bankAccountId: { in: bankIds } } });
    if (cashBoxIds.length > 0) await prisma.cashBox.deleteMany({ where: { id: { in: cashBoxIds } } });
    if (bankIds.length > 0) await prisma.bankAccount.deleteMany({ where: { id: { in: bankIds } } });
    if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
