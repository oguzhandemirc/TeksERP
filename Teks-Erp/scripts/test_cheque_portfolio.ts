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
// =============================================================================
import { ChequeStatus, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { chequeService } from "../src/services/cheque.service";
import { D } from "../src/services/helpers/finance.helper";

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

async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
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
  const drift = await prisma.$queryRaw<Array<{ hesap: string; fark: Prisma.Decimal }>>`
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
          WHERE e.type IN ('COLLECT', 'PAY') AND e."bankAccountId" IS NOT NULL GROUP BY e."bankAccountId"
      ) u GROUP BY "bankAccountId"
    ) p ON p."bankAccountId" = a.id
    WHERE a.id = ${bank.id}::uuid AND a.balance <> COALESCE(p.toplam, 0)`;
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
    if (chequeIds.length > 0) {
      await prisma.chequeEvent.deleteMany({ where: { chequeId: { in: chequeIds } } });
      await prisma.cariTransaction.deleteMany({ where: { chequeId: { in: chequeIds } } });
      await prisma.cheque.deleteMany({ where: { id: { in: chequeIds } } });
    }
    if (cariIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    }
    if (cashBoxIds.length > 0) await prisma.cashBox.deleteMany({ where: { id: { in: cashBoxIds } } });
    if (bankIds.length > 0) await prisma.bankAccount.deleteMany({ where: { id: { in: bankIds } } });
    if (customerIds.length > 0) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
