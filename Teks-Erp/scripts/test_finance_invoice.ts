// =============================================================================
// BEKÇİ — FATURA: onay · storno · yarış · bakiye mutabakatı
// =============================================================================
// Çalıştırma: npx tsx scripts/test_finance_invoice.ts
//
// NEDEN: Cari bakiyesi DENORMALİZE bir alandır ve DB seddi YOKTUR. Tek koruma
// "defter satırı ile bakiye AYNI transaction'da, atomik increment ile yazılır"
// disiplinidir. Bu disiplin sessizce kırılır: hata çıkmaz, log çıkmaz, yalnız
// ay sonunda müşteriyle rakam tutmaz.
//
// ÖLÇÜLENLER:
//   §1 Taslak deftere HİÇBİR ŞEY yazmaz (bakiye değişmez)
//   §2 Onay → tek defter satırı + bakiye tam tutar kadar
//   §3 ⭐ EŞZAMANLI ONAY YARIŞI: 5 paralel confirm → 1 başarılı + 4×409, defterde
//      TEK satır. Atomik claim düşerse bakiye 5 katına çıkar.
//   §4 Onaylı fatura DÜZENLENEMEZ / SİLİNEMEZ
//   §5 STORNO: ters satır yazılır, ORİJİNAL SATIR DURUR, bakiye sıfırlanır
//   §6 Alış faturası TERS yöne yazar (yön tek kaynaktan)
//   §7 "Bir kaynak → tek aktif fatura" (partial unique + anlamlı mesaj)
//   §8 Fiyatsız satırla ONAY reddedilir (taslakta serbest)
//   §9 Kur bulunamazsa 400 — sessizce 1'e DÜŞMEZ
//   §10 MUTABAKAT: SUM(defter) === CariBalance
//   §11 KAYNAK DAMGASI: onay sevkiyata invoiceNo damgalar (DISPATCHED),
//       iptal YALNIZ kendi damgasını temizler, elle işaret ÇAKIŞMA verir
//   §12 ⭐ EŞZAMANLI clientToken ÇİFT-GÖNDERİMİ (I2): pencere elle açık tutulan
//       tx ile DETERMİNİSTİK kurulur (kazananın token'ı unique indekse
//       UNCOMMITTED yazılı → ön kontrol onu GÖREMEZ, kaybeden INSERT indekste
//       BEKLER) → kaybeden P2002'yi cached yanıta çevirir: TAM BİR kayıt +
//       eşzamanlı ve ardışık replay yanıtı BAYT-BAYT aynı. NEGATİF SONDA:
//       withBarcodeRetry predicate'i (`!isClientTokenP2002`) düşürülünce token
//       P2002'si 5 tur boşa retry edilir ve kaybeden "Barkod üretimi ...
//       başarısız" 409'u alır → §12b/§12c/§12d kırmızı.
//   §13 DETAY ALAN KÜMESİ (I4): findById include→select — dönen anahtar kümesi
//       SABİTLENİR; `clientToken` ve çıplak iç FK'ler (cariId/shipmentId/
//       createdById…) yanıtta GEZMEZ. Alan düşürme sessizdir (ekran boş basar,
//       hata vermez) — bu bölüm onu kırmızıya bağlar.
//
// ── J1 DALGA 2: DÖRT FATURA BAYRAĞI (2026-08-15) ────────────────────────────
//   §14 ⭐ BAYRAK KAPALI PARİTESİ — İLK KONTROL. Dördü de kapalıyken bugünkü
//       davranış BAYT-BAYT: ileri tarihli taslak açılır · risk limiti aşan onay
//       geçer · sıfır fiyat AYNI MESAJLA reddedilir · iplik satırı stok
//       hareketi DOĞURMAZ. Parite düşerse geri kalan her şey tartışmasız yanlış.
//   §15 RİSK LİMİTİ (finance.riskLimitBlockEnabled): limit aşımında SATIŞ onayı
//       409 (mesaj somut: limit + bakiye + tutar + "Cari Kartından"), reddedilen
//       onay İZ BIRAKMAZ, bakiye BİRİKİMİ hesaba katılır; MUAF: limitsiz cari ·
//       ALIŞ faturası · İADE · iptal. + ⭐ TOCTOU (2 paralel onay → TAM BİRİ).
//   §16 SIFIR FİYAT (finance.allowZeroPriceLineEnabled): açıkken 0'lı satırla
//       onay geçer ve defter satırı DOĞRU (0 katkılı); NEGATİF fiyat açıkken de
//       reddedilir (pazarlık dışı).
//   §17 İPLİK DÜŞÜMÜ (finance.yarnOutOnInvoiceEnabled): satış onayı YARN
//       satırlarını varsayılan depodan düşer (aynı kalemin iki satırı TEK
//       harekete iner), FABRIC/serbest satır etkilenmez, ALIŞ muaf; iptal ters
//       kayıtla geri yazar ve ⭐ TERS KAYIT BAYRAKTAN BAĞIMSIZDIR (bayrak
//       kapatıldıktan sonra da çalışır — yoksa mal stokta hiç geri gelmezdi);
//       varsayılan depo yoksa FAIL-CLOSED.
//   §18 İLERİ TARİHLİ BELGE (finance.futureDatedDocumentBlockEnabled): kapı
//       TASLAKTADIR; sınır FABRİKA GÜNÜ SONUDUR (bugünün 23:59'u geçer, yarının
//       00:00'ı reddedilir — "saat" değil "gün" kuralı) ve clientToken REPLAY'i
//       muaftır.
//
// NEGATİF SONDALAR (2026-08-15, boz-ölç-geri yükle cp+shasum TEK zincirde):
//   • `assertRiskLimitTx` gövdesi no-op'a çevrilince → §15 kırmızı.
//   • Sıfır-fiyat dalı tek `lte(0)` kontrolüne geri sarılınca → §16a kırmızı.
//   • `reverseInvoiceYarnTx` bayrak koşuluna bağlanınca → §17f kırmızı
//     (bayraktan bağımsızlık sondası — özelliğin en sessiz kaybı).
//   • `assertNotFutureDatedTx` çağrısı `createDraft`ten silinince → §18 kırmızı.
// =============================================================================
import { Prisma, InvoiceStatus, YarnMovementKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { invoiceService } from "../src/services/invoice.service";
import { computeInvoiceTotals, D } from "../src/services/helpers/finance.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { factoryDayStart } from "../src/constants/time";

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

const TAG = `TEST-FIN-${Date.now()}`;
const invoiceIds: string[] = [];
const shipmentIds: string[] = [];
const cariIds: string[] = [];
let cariId: string | null = null;
let customerId: string | null = null;
let subcontractorId: string | null = null;

const LINES = [
  { description: "Perde kumaşı", qty: 100, unitPrice: 25, vatRate: 20 },
  { description: "Fason işçilik", qty: 2, unitPrice: 150, vatRate: 20, discountRate: 10 },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── J1 dalga 2 fixture'ları ───────────────────────────────────────────────────
const itemIds: string[] = [];
const yarnItemIds: string[] = [];
let createdWarehouseId: string | null = null;
/** Fail-closed sondasında geçici olarak `isDefault=false` yapılan depo. */
let unsetDefaultWarehouseId: string | null = null;

const FLAG = {
  risk: SETTING_KEYS.FINANCE_RISK_LIMIT_BLOCK_ENABLED,
  zero: SETTING_KEYS.FINANCE_ALLOW_ZERO_PRICE_LINE_ENABLED,
  future: SETTING_KEYS.FINANCE_FUTURE_DATED_DOCUMENT_BLOCK_ENABLED,
  yarn: SETTING_KEYS.FINANCE_YARN_OUT_ON_INVOICE_ENABLED,
} as const;

/** Bayrağın testten ÖNCEKİ hâli — cleanup birebir geri yükler. */
const priorFlags = new Map<string, { existed: boolean; value: Prisma.JsonValue }>();

/**
 * Ayarı doğrudan yazmak BİLİNÇLİ: enforcement reader cache'siz olduğu için
 * anında etkilidir; HTTP/route/panel sözleşmesini `test_feature_flag_contract`
 * ölçer (dört kapının bekçisi orası, davranışın bekçisi burası).
 */
async function setFlag(key: string, on: boolean): Promise<void> {
  if (!priorFlags.has(key)) {
    const row = await prisma.systemSetting.findUnique({ where: { key }, select: { value: true } });
    priorFlags.set(key, { existed: row != null, value: row?.value ?? null });
  }
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: on }, update: { value: on } });
}

/** Dördünü birden kapat — bölümler birbirinin bayrağını miras almasın. */
async function allFlagsOff(): Promise<void> {
  for (const key of Object.values(FLAG)) await setFlag(key, false);
}

async function errOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

/** Risk limiti olan (ya da olmayan) taze bir müşteri carisi. */
async function makeCari(suffix: string, riskLimit: string | null): Promise<{ customerId: string; cariId: string }> {
  const c = await prisma.customer.create({
    data: { code: `${TAG}-${suffix}`.slice(0, 32), name: `${TAG} ${suffix}` },
    select: { id: true },
  });
  const cari = await prisma.cariAccount.create({
    data: { kind: "CUSTOMER", customerId: c.id, riskLimit: riskLimit ? new Prisma.Decimal(riskLimit) : null },
    select: { id: true },
  });
  extraCustomerIds.push(c.id);
  cariIds.push(cari.id);
  return { customerId: c.id, cariId: cari.id };
}

const extraCustomerIds: string[] = [];

async function balanceOfCari(id: string): Promise<Prisma.Decimal> {
  const b = await prisma.cariBalance.findUnique({
    where: { cariId_currency: { cariId: id, currency: "TRY" } },
    select: { balance: true },
  });
  return D(b?.balance ?? 0);
}

async function yarnBalance(itemId: string, warehouseId: string): Promise<Prisma.Decimal> {
  const s = await prisma.yarnStock.findUnique({
    where: { itemId_warehouseId: { itemId, warehouseId } },
    select: { balanceKg: true },
  });
  return D(s?.balanceKg ?? 0);
}

/** §12 yarış sondası — pencereyi elle açık tutmak için (goods_receipt_invoice §10 emsali). */
function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e?: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function balanceOf(currency: "TRY" | "USD" = "TRY"): Promise<Prisma.Decimal> {
  if (!cariId) return new Prisma.Decimal(0);
  const b = await prisma.cariBalance.findUnique({
    where: { cariId_currency: { cariId, currency } },
    select: { balance: true },
  });
  return D(b?.balance ?? 0);
}

async function main(): Promise<void> {
  console.log("=== Fatura bekçisi ===\n");

  // Bekçi KENDİ tarafını yaratır — ortamdaki müşteriye dokunmak, o müşterinin
  // GERÇEK bakiyesini test temizliğinde silmek demekti (yaşandı: İSABELLA'nın
  // demo bakiyesi silindi, §22 mutabakat bekçisi drift raporladı).
  const customer = await prisma.customer.create({
    data: { code: TAG, name: `${TAG} Müşteri` },
    select: { id: true },
  });
  customerId = customer.id;

  const totals = computeInvoiceTotals(LINES);
  console.log(`   (beklenen tutar: ${totals.grandTotal.toString()} TRY)\n`);

  // ── §1 TASLAK DEFTERE YAZMAZ ────────────────────────────────────────────
  const draft = await invoiceService.createDraft({ type: "SALES", customerId, currency: "TRY", lines: LINES });
  invoiceIds.push(draft.data.id);
  if (!cariId) {
    const c = await prisma.cariAccount.findFirstOrThrow({ where: { customerId }, select: { id: true } });
    cariId = c.id;
    cariIds.push(c.id);
  }
  check("§1a Taslak oluştu ve belge no aldı", /^SF\d{10}$/.test(draft.data.docNo), draft.data.docNo);
  const txnAfterDraft = await prisma.cariTransaction.count({ where: { invoiceId: draft.data.id } });
  check("§1b Taslak defter satırı YAZMADI", txnAfterDraft === 0, `satır=${txnAfterDraft}`);
  check("§1c Taslak bakiyeyi DEĞİŞTİRMEDİ", (await balanceOf()).isZero(), `bakiye=${(await balanceOf()).toString()}`);

  // ── §3 EŞZAMANLI ONAY YARIŞI (§2'yi de kapsar) ──────────────────────────
  // ⚠️ `Promise.allSettled` burada MEŞRU: beş AYRI transaction var (perf kuralı
  // 11 tek tx client'ını paylaşmaya ilişkindir). "Düzeltip" sıralı hale
  // getirirsen bekçi sessizce ölür — ölçtüğü şey tam olarak eşzamanlılıktır.
  const race = await Promise.allSettled(
    Array.from({ length: 5 }, () => invoiceService.confirm(draft.data.id)),
  );
  const ok = race.filter((r) => r.status === "fulfilled").length;
  const conflicts = race.filter(
    (r) => r.status === "rejected" && /zaten onayl/i.test(String((r.reason as Error).message)),
  ).length;
  check("§3a 5 eşzamanlı onaydan YALNIZ BİRİ geçti", ok === 1, `başarılı=${ok}`);
  check("§3b Diğer 4'ü 409 aldı", conflicts === 4, `çakışma=${conflicts}`);

  const txns = await prisma.cariTransaction.findMany({
    where: { invoiceId: draft.data.id, sourceType: "INVOICE" },
    select: { debit: true, credit: true },
  });
  check("§2a Defterde TEK satır", txns.length === 1, `satır=${txns.length}`);
  check("§2b Satış faturası BORÇ yazdı", txns[0] ? D(txns[0].debit).equals(totals.grandTotal) : false, `borç=${txns[0]?.debit}`);
  check("§2c Alacak kolonu boş", txns[0] ? D(txns[0].credit).isZero() : false);
  const afterConfirm = await balanceOf();
  check("§2d Bakiye TAM tutar kadar arttı", afterConfirm.equals(totals.grandTotal), `bakiye=${afterConfirm.toString()}`);

  // ── §4 ONAYLI FATURA DOKUNULMAZ ─────────────────────────────────────────
  let editErr = "";
  try {
    await invoiceService.updateDraft(draft.data.id, { notes: "değişiklik" });
  } catch (e) {
    editErr = (e as Error).message;
  }
  check("§4a Onaylı fatura DÜZENLENEMEZ", /onaylanmış/i.test(editErr), editErr.slice(0, 60));
  let delErr = "";
  try {
    await invoiceService.deleteDraft(draft.data.id);
  } catch (e) {
    delErr = (e as Error).message;
  }
  check("§4b Onaylı fatura SİLİNEMEZ", /taslak değil/i.test(delErr), delErr.slice(0, 60));

  // ── §7 BİR KAYNAK → TEK AKTİF FATURA ────────────────────────────────────
  const shipment = await prisma.shipment.create({
    data: { shipmentNo: `${TAG}-S1`, customerId },
    select: { id: true },
  });
  shipmentIds.push(shipment.id);
  {
    const first = await invoiceService.createDraft({
      type: "SALES",
      customerId,
      lines: [LINES[0] as never],
      shipmentId: shipment.id,
    });
    invoiceIds.push(first.data.id);
    let dupErr = "";
    try {
      await invoiceService.createDraft({
        type: "SALES",
        customerId,
        lines: [LINES[0] as never],
        shipmentId: shipment.id,
      });
    } catch (e) {
      dupErr = (e as Error).message;
    }
    check("§7a İkinci fatura REDDEDİLDİ", /zaten bir fatura var/i.test(dupErr), dupErr.slice(0, 70));
    check("§7b Mesaj mevcut belgeyi ADIYLA söylüyor", dupErr.includes(first.data.docNo));
    // İptal edilen fatura yeni fatura kesilmesini ENGELLEMEMELİ (storno'nun amacı).
    await invoiceService.cancel(first.data.id, "bekçi");
    const afterCancel = await invoiceService.createDraft({
      type: "SALES",
      customerId,
      lines: [LINES[0] as never],
      shipmentId: shipment.id,
    });
    invoiceIds.push(afterCancel.data.id);
    check("§7c İptalden SONRA yeni fatura kesilebiliyor", Boolean(afterCancel.data.id));
    await invoiceService.cancel(afterCancel.data.id, "bekçi temizlik");
  }

  // ── §8 FİYATSIZ SATIRLA ONAY ────────────────────────────────────────────
  const zeroDraft = await invoiceService.createDraft({
    type: "SALES",
    customerId,
    lines: [{ description: "Fiyatı sonra girilecek", qty: 10, unitPrice: 0 }],
  });
  invoiceIds.push(zeroDraft.data.id);
  check("§8a Fiyatsız satır TASLAKTA serbest", Boolean(zeroDraft.data.id));
  let zeroErr = "";
  try {
    await invoiceService.confirm(zeroDraft.data.id);
  } catch (e) {
    zeroErr = (e as Error).message;
  }
  check("§8b Fiyatsız satırla ONAY reddedildi", /fiyat/i.test(zeroErr), zeroErr.slice(0, 70));
  check("§8c Reddedilen fatura TASLAK kaldı", await isStatus(zeroDraft.data.id, "DRAFT"));

  // ── §9 KUR BULUNAMAZSA 400 ──────────────────────────────────────────────
  // ⚠️ Sessizce 1'e düşmek 1000 USD'lik faturayı 1000 TL yazardı — bakiye ~30
  // kat yanlış, hata da log da çıkmadan.
  await prisma.exchangeRate.deleteMany({ where: { currency: "USD" } });
  let rateErr = "";
  try {
    await invoiceService.createDraft({ type: "SALES", customerId, currency: "USD", lines: LINES });
  } catch (e) {
    rateErr = (e as Error).message;
  }
  check("§9a Kursuz döviz faturası REDDEDİLDİ", /kur bulunamadı/i.test(rateErr), rateErr.slice(0, 70));
  // Kur girilince geçmeli (körlük zemini: §9a "hiçbir fatura açılamıyor" ile de yeşil kalırdı).
  await prisma.exchangeRate.create({
    data: { rateDate: new Date(), currency: "USD", rate: new Prisma.Decimal("34.5") },
  });
  const usd = await invoiceService.createDraft({ type: "SALES", customerId, currency: "USD", lines: LINES });
  invoiceIds.push(usd.data.id);
  const usdRow = await prisma.invoice.findUniqueOrThrow({
    where: { id: usd.data.id },
    select: { exchangeRate: true, grandTotalTry: true, grandTotal: true },
  });
  check("§9b KÖRLÜK ZEMİNİ: kur girilince fatura açılıyor", D(usdRow.exchangeRate).equals(D("34.5")));
  check(
    "§9c TL karşılığı kurla damgalandı",
    D(usdRow.grandTotalTry).equals(D(usdRow.grandTotal).mul(D("34.5")).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)),
    `${usdRow.grandTotal} × 34.5 = ${usdRow.grandTotalTry}`,
  );

  // ── §6 ALIŞ FATURASI TERS YÖN ───────────────────────────────────────────
  const sub = await prisma.subcontractor.create({
    data: { code: `${TAG}-F`, name: `${TAG} Fason` },
    select: { id: true },
  });
  subcontractorId = sub.id;
  {
    const purchase = await invoiceService.createDraft({
      type: "PURCHASE",
      subcontractorId: sub.id,
      lines: [{ description: "Boya hizmeti", qty: 500, unitPrice: 3, vatRate: 20 }],
    });
    invoiceIds.push(purchase.data.id);
    await invoiceService.confirm(purchase.data.id);
    const pTxn = await prisma.cariTransaction.findFirstOrThrow({
      where: { invoiceId: purchase.data.id, sourceType: "INVOICE" },
      select: { debit: true, credit: true, cariId: true },
    });
    check("§6a Alış faturası ALACAK yazdı (biz borçluyuz)", D(pTxn.credit).gt(0) && D(pTxn.debit).isZero());
    const subBal = await prisma.cariBalance.findUniqueOrThrow({
      where: { cariId_currency: { cariId: pTxn.cariId, currency: "TRY" } },
      select: { balance: true },
    });
    check("§6b Fason bakiyesi NEGATİF (bizim borcumuz)", D(subBal.balance).lt(0), `bakiye=${subBal.balance}`);
    await invoiceService.cancel(purchase.data.id, "bekçi temizlik");
    const subBal2 = await prisma.cariBalance.findUniqueOrThrow({
      where: { cariId_currency: { cariId: pTxn.cariId, currency: "TRY" } },
      select: { balance: true },
    });
    check("§6c Storno fason bakiyesini SIFIRLADI", D(subBal2.balance).isZero(), `bakiye=${subBal2.balance}`);
    cariIds.push(pTxn.cariId);
  }

  // ── §5 STORNO ───────────────────────────────────────────────────────────
  await invoiceService.cancel(draft.data.id, "yanlış müşteriye kesildi");
  const allTxns = await prisma.cariTransaction.findMany({
    where: { invoiceId: draft.data.id },
    select: { sourceType: true, debit: true, credit: true },
    orderBy: { createdAt: "asc" },
  });
  check("§5a Defterde İKİ satır (fatura + storno)", allTxns.length === 2, `satır=${allTxns.length}`);
  check(
    "§5b ORİJİNAL satır DURUYOR (silinmedi)",
    allTxns[0]?.sourceType === "INVOICE" && D(allTxns[0].debit).equals(totals.grandTotal),
  );
  check(
    "§5c Storno TERS yönde",
    allTxns[1]?.sourceType === "INVOICE_CANCEL" && D(allTxns[1].credit).equals(totals.grandTotal),
  );
  const afterStorno = await balanceOf();
  check("§5d Bakiye sıfırlandı", afterStorno.isZero(), `bakiye=${afterStorno.toString()}`);
  check("§5e Fatura CANCELLED", await isStatus(draft.data.id, "CANCELLED"));

  // İptal edilmiş fatura ikinci kez iptal EDİLEMEZ (atomik claim).
  let reCancel = "";
  try {
    await invoiceService.cancel(draft.data.id, "tekrar");
  } catch (e) {
    reCancel = (e as Error).message;
  }
  check("§5f İkinci iptal 409", /zaten iptal/i.test(reCancel), reCancel.slice(0, 60));

  // ── §11 KAYNAK DAMGASI ──────────────────────────────────────────────────
  // "İki faturalandı gerçeği" birleşmeli: Shipment.invoiceNo dış-program izi
  // olarak doğdu; iç fatura onayı da aynı alanı damgalar, yoksa muhasebe
  // ekranı "faturalanmadı" derken içeride onaylı fatura durur ve storno
  // guard'ı (faturalı sevk geri alınamaz) devreye girmezdi.
  const dispatched = await prisma.shipment.create({
    data: { shipmentNo: `${TAG}-S2`, customerId, status: "DISPATCHED", dispatchedAt: new Date() },
    select: { id: true },
  });
  shipmentIds.push(dispatched.id);
  const stampInv = await invoiceService.createDraft({
    type: "SALES",
    customerId,
    lines: [LINES[0] as never],
    shipmentId: dispatched.id,
  });
  invoiceIds.push(stampInv.data.id);
  await invoiceService.confirm(stampInv.data.id);
  const stamped = await prisma.shipment.findUniqueOrThrow({
    where: { id: dispatched.id },
    select: { invoiceNo: true, invoicedAt: true },
  });
  check("§11a Onay sevkiyata invoiceNo DAMGALADI", stamped.invoiceNo === stampInv.data.docNo, `invoiceNo=${stamped.invoiceNo}`);
  check("§11b Damga tarihi de yazıldı (yarım durum yok)", stamped.invoicedAt !== null);

  await invoiceService.cancel(stampInv.data.id, "bekçi");
  const cleared = await prisma.shipment.findUniqueOrThrow({
    where: { id: dispatched.id },
    select: { invoiceNo: true, invoicedAt: true },
  });
  check("§11c İptal damgayı TEMİZLEDİ (tarihle birlikte)", cleared.invoiceNo === null && cleared.invoicedAt === null);

  // Elle (dış program) işareti varken iç fatura onayı ÇAKIŞMA vermeli —
  // sessizce üstüne yazmak dış muhasebedeki izi yok ederdi.
  await prisma.shipment.update({ where: { id: dispatched.id }, data: { invoiceNo: "DIS-PROG-42" } });
  const conflictInv = await invoiceService.createDraft({
    type: "SALES",
    customerId,
    lines: [LINES[0] as never],
    shipmentId: dispatched.id,
  });
  invoiceIds.push(conflictInv.data.id);
  let stampErr = "";
  try {
    await invoiceService.confirm(conflictInv.data.id);
  } catch (e) {
    stampErr = (e as Error).message;
  }
  check("§11d Elle işaretliyken onay 409 (belge no'suyla)", /DIS-PROG-42/.test(stampErr), stampErr.slice(0, 80));
  check("§11e Çakışan onay fatura durumunu YARIM BIRAKMADI (taslak/iptal değil ama defter boş)",
    (await prisma.cariTransaction.count({ where: { invoiceId: conflictInv.data.id } })) === 0);
  await prisma.shipment.update({ where: { id: dispatched.id }, data: { invoiceNo: null } });

  // ── §12 ⭐ EŞZAMANLI clientToken ÇİFT-GÖNDERİMİ (I2) ────────────────────
  // Ardışık replay'i §7 dolaylı kapsıyor; burası TOCTOU penceresini ölçer: iki
  // paralel istek ikisi de "token yok" görür, ikisi de INSERT eder. Pencere
  // zamanlamayla DEĞİL, elle açık tutulan tx ile kurulur (yarış bekçisi kuralı):
  // kazananın satırı unique indekse UNCOMMITTED yazılıdır → kaybedenin ön
  // kontrolü onu GÖREMEZ (READ COMMITTED), kaybedenin INSERT'i indeks kilidinde
  // BEKLER; gate commit edilince P2002 düşer ve catch cached yanıta çevirir.
  {
    const rplToken = crypto.randomUUID();
    const rplLock = deferred<{ id: string; docNo: string }>();
    const rplGate = deferred();
    const rplTx = prisma.$transaction(
      async (tx) => {
        // "Kazanan uçuşta": gerçek create'in yazdığı satırın asgarisi — token
        // unique indekse girer ama COMMIT edilmez.
        //
        // ⚠️ SATIR DA YAZILIR (2026-09-01): `createDraft` artık AYNI TOKEN /
        // FARKLI GÖVDE'yi 409 ile reddediyor (`assertInvoiceReplay`) ve faturada
        // kimliğin taşıyıcısı SATIRLARDIR (taslakta toplamlar 0 — onayda
        // damgalanıyor). Satırsız bir kazanan, kaybedenin gövdesiyle GERÇEKTEN
        // farklıdır; fixture o hâlde "aynı mantıksal istek"i temsil etmeyi
        // bırakır ve §12 kendi kurgusunu ölçer. Satır kaybedeninkiyle BİREBİR:
        // LINES[0] → 100 × 25, KDV %20.
        const winner = await tx.invoice.create({
          data: {
            docNo: `${TAG}-RPL1`,
            type: "SALES",
            status: "DRAFT",
            cariId: cariId as string,
            issueDate: new Date(),
            clientToken: rplToken,
            lines: {
              create: [
                {
                  lineNo: 1,
                  description: LINES[0]!.description,
                  qty: LINES[0]!.qty,
                  unitPrice: LINES[0]!.unitPrice,
                  lineTotal: 2500,
                  vatAmount: 500,
                },
              ],
            },
          },
          select: { id: true, docNo: true },
        });
        rplLock.resolve(winner);
        await rplGate.promise;
        return winner;
      },
      { timeout: 20_000 },
    );
    // Gate-tx promise'i await'ten ÖNCE reddedebilir — no-op catch olmadan
    // unhandled rejection süreci Sonuç satırı basılmadan öldürür (CLAUDE.md
    // 2026-08-14 eki ②; test_payment_allocation §12m'de canlı ölçüldü).
    void rplTx.catch(() => {});
    const winner = await rplLock.promise;
    invoiceIds.push(winner.id);

    let loserSettled = false;
    const loserP = invoiceService
      .createDraft({ type: "SALES", customerId, lines: [LINES[0] as never], clientToken: rplToken })
      .finally(() => {
        loserSettled = true;
      });
    void loserP.catch(() => {});
    await sleep(400);
    check(
      "§12a ⭐ kaybeden UNIQUE indekste BEKLEDİ (ön kontrol kazananı görmedi → pencere gerçek)",
      !loserSettled,
    );
    rplGate.resolve();
    await rplTx;
    const loserRes = await loserP;
    check(
      "§12b ⭐ kaybeden BAŞARILI ve KAZANANIN kaydını aldı (mükerrer değil, ham hata değil)",
      loserRes.success === true && loserRes.data.id === winner.id && loserRes.data.docNo === winner.docNo,
      `id=${loserRes.data?.id === winner.id} docNo=${loserRes.data?.docNo}`,
    );
    check(
      "§12c veri anahtarları normal create ile AYNI ({id,docNo} — sözleşme bozulmaz)",
      JSON.stringify(Object.keys(loserRes.data).sort()) === JSON.stringify(["docNo", "id"]),
      Object.keys(loserRes.data).join(","),
    );
    // Ardışık replay (ön kontrol yolu) ile BAYT-BAYT aynı mı? Farklı şekil,
    // replay'i ayırt edilebilir yapar ve istemci sözleşmesini bozar.
    const seqRes = await invoiceService.createDraft({
      type: "SALES",
      customerId,
      lines: [LINES[0] as never],
      clientToken: rplToken,
    });
    check(
      "§12d ⭐ eşzamanlı replay yanıtı ardışık replay ile BAYT-BAYT aynı",
      JSON.stringify(loserRes) === JSON.stringify(seqRes),
      `eşzamanlı=${JSON.stringify(loserRes)} ardışık=${JSON.stringify(seqRes)}`,
    );
    const rplCount = await prisma.invoice.count({ where: { clientToken: rplToken } });
    check("§12e token'lı TAM BİR kayıt (kaybedenin tx'i geri sarıldı)", rplCount === 1, `adet=${rplCount}`);
  }

  // ── §13 DETAY ALAN KÜMESİ (I4: include → select) ────────────────────────
  // Panel alan kaybını GÖREMEZ (boş hücre basar, hata vermez) — küme burada
  // sabitlenir. `usd` faturası satır + cari taşıyan gerçek bir detay örneğidir.
  {
    const det = await invoiceService.findById(usd.data.id);
    const data = det.data as Record<string, unknown>;
    const EXPECTED_KEYS = [
      "cancelReason", "cancelledAt", "cari", "confirmedAt", "createdAt", "currency",
      "directShipment", "discountTotal", "docNo", "dueDate", "exchangeRate", "externalNo",
      "goodsReceipt", "grandTotal", "grandTotalTry", "id", "issueDate", "lines", "notes",
      "paidTotal", "returnGroupId", "shipment", "status", "subcontractorReceipt",
      "subtotal", "type", "updatedAt", "vatTotal", "withholdingTotal",
    ];
    check(
      "§13a ⭐ detay anahtar kümesi SABİT (alan düşürme/ekleme bekçisiz geçemez)",
      JSON.stringify(Object.keys(data).sort()) === JSON.stringify(EXPECTED_KEYS),
      `fark=${Object.keys(data).filter((k) => !EXPECTED_KEYS.includes(k)).join(",") || "-"} eksik=${EXPECTED_KEYS.filter((k) => !(k in data)).join(",") || "-"}`,
    );
    check("§13b ⭐ clientToken yanıtta GEZMİYOR (idempotency iç anahtarı)", !("clientToken" in data));
    // ⚠️ `returnGroupId` bu listede DEĞİL (2026-08-15): kaynak bağlarının insanca
    // adlı ilişkileri DETAIL_SELECT'e eklendi (shipment/directShipment/
    // subcontractorReceipt) ama iade grubunun İLİŞKİSİ YOKTUR — grup lideri bir
    // RollReturn id'sidir, ayrı model değil. Tek taşıyıcı skalerdir ve detay
    // ekranı "İade grubu" satırını ondan basar. Diğer çıplak FK'ler yasak kalır.
    const bareFks = ["cariId", "shipmentId", "directShipmentId", "subcontractorReceiptId", "goodsReceiptId", "confirmedById", "cancelledById", "createdById"];
    check(
      "§13c çıplak iç FK'ler yanıtta yok (kaynak bağı ilişkinin kendi id'siyle taşınır)",
      bareFks.every((k) => !(k in data)),
      bareFks.filter((k) => k in data).join(",") || "-",
    );
    check(
      "§13c2 kaynak ilişkileri İNSANCA ADIYLA mevcut (shipment/directShipment/subcontractorReceipt anahtarları)",
      "shipment" in data && "directShipment" in data && "subcontractorReceipt" in data,
    );
    const line0 = (data.lines as Array<Record<string, unknown>>)[0];
    check(
      "§13d satır anahtarları sabit (invoiceId/itemId çıplak FK'leri yok; item ilişki olarak var)",
      Boolean(line0) &&
        JSON.stringify(Object.keys(line0 as object).sort()) ===
          JSON.stringify(["description", "discountRate", "id", "item", "lineNo", "lineTotal", "qty", "unit", "unitPrice", "vatAmount", "vatRate", "withholdingRate"]),
      line0 ? Object.keys(line0).join(",") : "(satır yok)",
    );
    const cariDet = data.cari as { taxOffice?: unknown; customer?: { taxNumber?: unknown } | null };
    check(
      "§13e detay carisi listeden ZENGİN (taxOffice + customer.taxNumber)",
      cariDet != null && "taxOffice" in cariDet && cariDet.customer != null && "taxNumber" in cariDet.customer,
    );
  }

  // ── §10 MUTABAKAT ───────────────────────────────────────────────────────
  // Bu, `test_consistency`nin muhasebe bölümünün çekirdeği: bakiye denormalize
  // ve DB seddi yok; tek koruma bu eşitliğin ölçülmesi.
  const drift = await prisma.$queryRaw<Array<{ cariId: string; currency: string; ledger: string; stored: string }>>`
    SELECT b."cariId"::text AS "cariId", b.currency::text AS currency,
           COALESCE(t.total, 0)::text AS ledger, b.balance::text AS stored
      FROM cari_balances b
      LEFT JOIN (
        SELECT "cariId", currency, SUM(debit) - SUM(credit) AS total
          FROM cari_transactions GROUP BY "cariId", currency
      ) t ON t."cariId" = b."cariId" AND t.currency = b.currency
     WHERE b.balance <> COALESCE(t.total, 0)
  `;
  check(
    "§10 SUM(defter) === CariBalance (tüm cariler)",
    drift.length === 0,
    drift.length > 0 ? `SAPMA: ${drift.map((d) => `${d.currency} ${d.stored}≠${d.ledger}`).join(", ")}` : "sapma yok",
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

async function isStatus(id: string, status: InvoiceStatus): Promise<boolean> {
  const r = await prisma.invoice.findUnique({ where: { id }, select: { status: true } });
  return r?.status === status;
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    // Temizlik: defter satırları FK ile faturaya bağlı (RESTRICT) → önce onlar.
    if (invoiceIds.length > 0) {
      await prisma.cariTransaction.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    }
    // ⚠️ Kur satırını yalnız KENDİ yazdıysak silmek isterdik ama bu bekçi §9'da
    // USD kurlarını zaten deleteMany ile temizleyip kendi değerini yazıyor —
    // izole ticaret DB'sinde kabul edilmiş bedel; paylaşılan dev DB'sine taşınırsa
    // burada tarih-etiketli satır kullan.
    await prisma.exchangeRate.deleteMany({ where: { currency: "USD" } });
    if (cariIds.length > 0) {
      await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
    }
    if (shipmentIds.length > 0) await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId, code: { startsWith: "TEST-FIN-" } } });
    if (subcontractorId) await prisma.subcontractor.deleteMany({ where: { id: subcontractorId, code: { startsWith: "TEST-FIN-" } } });
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
