// =============================================================================
// BEKÇİ — KDV DÖNEM ÖZETİ RAPORU (H5)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_finance_vat.ts
//
// NEDEN: Bu rapor muhasebecinin beyanname hazırlarken kullandığı rakamları
// üretir — yanlışı hata da log da çıkarmadan dış beyanın içine akar. Beş
// sözleşme maddesi ölçülür (kaynak: TICARET yol haritası H5):
//   §2  Karışık oranlı fatura İKİ oran satırına doğru dağılır (satır
//       seviyesinden toplama — fatura başlığından tek orana yazılamaz)
//   §3  İade kendi satırında GÖRÜNÜR + blok toplamına NEGATİF girer
//   §4  CANCELLED ve DRAFT rapora GİRMEZ
//   §5  Dönem çıpası issueDate (tahakkuk) — pencere dışı fatura girmez,
//       confirmedAt pencere dışında olsa da issueDate içindeyse GİRER
//   §6  ⭐ TL MUTABAKATI: blok TL toplamı, faturaların damgalı `grandTotalTry`
//       toplamına BİREBİR eşit (ikinci yol: DB kolonundan bağımsız toplanır);
//       kuruş kalıntısı düzeltmesi dövizli karışık oranlı belgede tam bu
//       eşitliği taşır — `reconDiff` "0.00"
//   §7  Oran satırlarının toplamı blok/para-birimi toplamına eşit
//   §8  Tevkifat satırdan yeniden türetilir ve fatura başlığındaki
//       `withholdingTotal` ile birebir aynıdır
//
// FIXTURE İZOLASYONU: rapor cari/etiket süzgeci almaz — pencere kirlenirse
// eşitlik kontrolleri şaşar. Bu yüzden fixture ~+340 gün İLERİDE, ±yarım
// günlük dar bir pencereye kurulur (WIP karnesi bekçisinin "geleceğe kur"
// deseninin ters yönü; buradaki metrik yaş değil, gelecek güvenli). issueDate
// gelecekte olsa da onay bugüne yazılır — bu aynı zamanda §5'in çıpa
// kanıtıdır: confirmedAt pencerenin çok dışındadır ama fatura raporda görünür.
//
// KÖRLÜK ZEMİNİ: §1 fixture'ın gerçekten doğduğunu DB'den sayar — aksi halde
// "rakam tutuyor" ile "hiçbir şey ölçülmedi" aynı yeşile çıkar.
//
// NEGATİF SONDALAR (2026-08-14 — boz→ölç→geri yükle TEK zincirde; cp + shasum
// ile birebir geri yükleme kanıtlandı, ölçüm ÇIKIŞ KODUNDAN):
//   ① finance-vat.report.ts kalıntı düzeltmesi kapatıldı (`if (false)`) →
//      3 kontrol kırmızı (§6c USD Σ 102.82 ≠ 102.81 · §6d 50.41,50.41 ·
//      §6e reconDiff satış 0.01), exit 1.
//   ② blok net'i iade TOPLAYARAK bozuldu (minus→plus) → 4 kontrol kırmızı
//      (§3d net 3102.81 · §6a · §6b · §6e reconDiff -1200.00), exit 1.
//   ③ `status: "CONFIRMED"` süzgeci kaldırıldı → 7 kontrol kırmızı (§1c
//      docCount 5 · §4a matrah 15332.00 — 7777 iptal + 5555 taslak sızdı ·
//      §3c/§3d/§4b/§5/§6a), exit 1.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { invoiceService } from "../src/services/invoice.service";
import { getVatSummaryReport, type VatBlock } from "../src/services/reports/finance-vat.report";

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

const TAG = `TEST-VAT-${Date.now()}`;
const DAY = 86_400_000;
// Dar gelecek penceresi: diğer bekçiler `ago()` tarafında yaşar; +340 günün
// ±yarım gününe fixture yazan başka koşum pratikte yok.
const BASE = new Date(Date.now() + 340 * DAY);
const FROM = new Date(BASE.getTime() - 12 * 3_600_000);
const TO = new Date(BASE.getTime() + 12 * 3_600_000);

const customerIds: string[] = [];
const subcontractorIds: string[] = [];
const cariIds: string[] = [];
const invoiceIds: string[] = [];

interface LineIn {
  description: string;
  qty: number;
  unitPrice: number;
  vatRate?: number;
  withholdingRate?: number;
}

async function mkInvoice(opts: {
  type: "SALES" | "PURCHASE" | "SALES_RETURN" | "PURCHASE_RETURN";
  customerId?: string;
  subcontractorId?: string;
  currency?: "TRY" | "USD";
  exchangeRate?: number;
  issueDate: Date;
  lines: LineIn[];
  confirm?: boolean;
}): Promise<string> {
  const d = await invoiceService.createDraft({
    type: opts.type,
    customerId: opts.customerId ?? null,
    subcontractorId: opts.subcontractorId ?? null,
    currency: opts.currency ?? "TRY",
    // TRY'de kur damgası 1 — tablo araması koşmasın (fixture kur satırına bağımlı olmasın).
    exchangeRate: opts.exchangeRate ?? 1,
    issueDate: opts.issueDate,
    lines: opts.lines,
  });
  invoiceIds.push(d.data.id);
  if (opts.confirm !== false) await invoiceService.confirm(d.data.id);
  return d.data.id;
}

const findCur = (b: VatBlock, cur: string) => b.currencies.find((c) => c.currency === cur);

async function main(): Promise<void> {
  console.log("=== KDV dönem özeti bekçisi ===\n");

  // ── FIXTURE ───────────────────────────────────────────────────────────────
  const cust = await prisma.customer.create({
    data: { code: `${TAG}-C`, name: `${TAG} Müşteri` },
    select: { id: true },
  });
  customerIds.push(cust.id);
  const sub = await prisma.subcontractor.create({
    data: { code: `${TAG}-F`, name: `${TAG} Fason` },
    select: { id: true },
  });
  subcontractorIds.push(sub.id);

  // S1 — satış TRY, tek oran.
  await mkInvoice({
    type: "SALES",
    customerId: cust.id,
    issueDate: BASE,
    lines: [{ description: "S1", qty: 1, unitPrice: 2000, vatRate: 20 }],
  });
  // S2 — satış USD, KARIŞIK ORAN + kur damgası 40.004. Değerler bilinçli:
  // grup bazlı TL çeviri toplamı (102.82) damgalı grandTotalTry'den (102.81)
  // 1 kuruş sapar → kalıntı düzeltmesi GERÇEKTEN çalışmak zorunda (sonda ①
  // bu farkı ölçer). El hesabı: 1.26×40.004=50.40504→50.41 (iki grupta da),
  // vat'lar 0.01→0.40 / 0.04→1.60; Σ=102.82; grand 2.57×40.004=102.81028→102.81.
  const s2 = await mkInvoice({
    type: "SALES",
    customerId: cust.id,
    currency: "USD",
    exchangeRate: 40.004,
    issueDate: BASE,
    lines: [
      { description: "S2a", qty: 1, unitPrice: 1.26, vatRate: 1 },
      { description: "S2b", qty: 1, unitPrice: 1.26, vatRate: 3 },
    ],
  });
  // R1 — satış İADESİ TRY.
  await mkInvoice({
    type: "SALES_RETURN",
    customerId: cust.id,
    issueDate: BASE,
    lines: [{ description: "R1", qty: 1, unitPrice: 500, vatRate: 20 }],
  });
  // C1 — onaylanıp İPTAL edilen satış (rapora girmemeli).
  const c1 = await mkInvoice({
    type: "SALES",
    customerId: cust.id,
    issueDate: BASE,
    lines: [{ description: "C1", qty: 1, unitPrice: 7777, vatRate: 20 }],
  });
  await invoiceService.cancel(c1, "bekçi iptali");
  // D1 — TASLAK (hiç onaylanmaz; rapora girmemeli).
  await mkInvoice({
    type: "SALES",
    customerId: cust.id,
    issueDate: BASE,
    lines: [{ description: "D1", qty: 1, unitPrice: 5555, vatRate: 20 }],
    confirm: false,
  });
  // OUT — pencere DIŞI satış (issueDate +10 gün; girmemeli).
  await mkInvoice({
    type: "SALES",
    customerId: cust.id,
    issueDate: new Date(BASE.getTime() + 10 * DAY),
    lines: [{ description: "OUT", qty: 1, unitPrice: 3333, vatRate: 20 }],
  });
  // P1 — alış TRY, TEVKİFATLI (fason: KDV üzerinden %50).
  const p1 = await mkInvoice({
    type: "PURCHASE",
    subcontractorId: sub.id,
    issueDate: BASE,
    lines: [{ description: "P1", qty: 1, unitPrice: 1000, vatRate: 20, withholdingRate: 50 }],
  });
  // P2 — alış İADESİ TRY, tevkifatlı.
  await mkInvoice({
    type: "PURCHASE_RETURN",
    subcontractorId: sub.id,
    issueDate: BASE,
    lines: [{ description: "P2", qty: 1, unitPrice: 200, vatRate: 20, withholdingRate: 50 }],
  });

  // ── §1 KÖRLÜK ZEMİNİ: fixture DB'de gerçekten doğdu mu ────────────────────
  const st = await prisma.invoice.groupBy({
    by: ["status"],
    where: { id: { in: invoiceIds } },
    _count: true,
  });
  const cnt = (s: string) => st.find((r) => r.status === s)?._count ?? 0;
  check("§1a fixture: 6 CONFIRMED", cnt("CONFIRMED") === 6, `CONFIRMED=${cnt("CONFIRMED")}`);
  check("§1b fixture: 1 CANCELLED + 1 DRAFT", cnt("CANCELLED") === 1 && cnt("DRAFT") === 1);

  const rep = await getVatSummaryReport({ range: { from: FROM, to: TO } });
  check("§1c satış bloğu 3 belge (S1+S2+R1)", rep.sales.docCount === 3, `docCount=${rep.sales.docCount}`);
  check("§1d alış bloğu 2 belge (P1+P2)", rep.purchase.docCount === 2, `docCount=${rep.purchase.docCount}`);
  check("§1e rapor notları beyanname uyarısı taşıyor", rep.notes.some((n) => n.includes("BEYANNAMESİ DEĞİLDİR")));

  // ── §2 KARIŞIK ORANLI FATURA İKİ ORAN SATIRINA DAĞILIR ────────────────────
  const usd = findCur(rep.sales, "USD");
  check("§2a USD grubu var", Boolean(usd));
  const fwdUsd = usd?.rows.filter((r) => !r.isReturn) ?? [];
  check(
    "§2b iki oran satırı (1.00 + 3.00) — başlıktan tek orana YAZILMADI",
    fwdUsd.length === 2 && fwdUsd[0]?.vatRate === "1.00" && fwdUsd[1]?.vatRate === "3.00",
    fwdUsd.map((r) => r.vatRate).join(","),
  );
  check(
    "§2c oran satırları kendi paylarını taşıyor (matrah 1.26/1.26, KDV 0.01/0.04)",
    fwdUsd[0]?.base === "1.26" && fwdUsd[1]?.base === "1.26" &&
      fwdUsd[0]?.vat === "0.01" && fwdUsd[1]?.vat === "0.04",
  );
  check(
    "§2d karışık oranlı belge her iki oran satırında da SAYILIR (docCount 1+1)",
    fwdUsd[0]?.docCount === 1 && fwdUsd[1]?.docCount === 1,
  );

  // ── §3 İADE: SATIRI GÖRÜNÜR, TOPLAMDA NEGATİF ─────────────────────────────
  const tr = findCur(rep.sales, "TRY");
  const retRow = tr?.rows.find((r) => r.isReturn);
  check("§3a iade satırı GÖRÜNÜR (gizlenmedi)", retRow?.base === "500.00" && retRow?.vat === "100.00");
  check("§3b iade blok toplamından ayrı da raporlanır", tr?.returns?.grandTry === "600.00");
  check(
    "§3c para birimi net'i ileri − iade (matrah 1500, KDV 300, toplam 1800)",
    tr?.net.base === "1500.00" && tr?.net.vat === "300.00" && tr?.net.grand === "1800.00",
  );
  check(
    "§3d blok TL toplamı iadeyi DÜŞEREK toplar (2502.81 − 600 = 1902.81)",
    rep.sales.totalsTry.forward === "2502.81" &&
      rep.sales.totalsTry.returns === "600.00" &&
      rep.sales.totalsTry.net === "1902.81",
    `net=${rep.sales.totalsTry.net}`,
  );

  // ── §4 CANCELLED + DRAFT GİRMEZ ───────────────────────────────────────────
  const fwdTr = tr?.rows.find((r) => !r.isReturn && r.vatRate === "20.00");
  check(
    "§4a TRY %20 ileri matrahı tam 2000.00 (7777 iptal / 5555 taslak SIZMADI)",
    fwdTr?.base === "2000.00",
    `base=${fwdTr?.base}`,
  );
  check("§4b TRY ileri belge sayısı 1 (yalnız S1)", tr?.forward.docCount === 1);

  // ── §5 DÖNEM ÇIPASI issueDate ─────────────────────────────────────────────
  // OUT faturası (3333) pencere dışında → §4a'daki 2000.00 eşitliği onu da
  // dışlar; burada çıpanın YÖNÜ ölçülür: tüm fixture'ın confirmedAt'i BUGÜN
  // (pencerenin ~340 gün dışında) ama issueDate içeride → rapor DOLU.
  check(
    "§5 confirmedAt pencere dışında, issueDate içeride → fatura RAPORDA (çıpa tahakkuk)",
    rep.sales.docCount === 3 && rep.purchase.docCount === 2,
  );

  // ── §6 ⭐ TL MUTABAKATI: damgalı grandTotalTry ile BİREBİR ────────────────
  // İkinci yol: DB kolonundan bağımsız toplanır (rapor koduna hiç girmeden).
  const dbRows = await prisma.invoice.findMany({
    where: { id: { in: invoiceIds }, status: "CONFIRMED", issueDate: { gte: FROM, lte: TO } },
    select: { type: true, grandTotalTry: true },
  });
  const dbNet = (fwd: string, ret: string) =>
    dbRows
      .reduce(
        (s, r) =>
          r.type === fwd ? s + Number(r.grandTotalTry) : r.type === ret ? s - Number(r.grandTotalTry) : s,
        0,
      )
      .toFixed(2);
  check(
    "§6a satış TL net = Σ damgalı grandTotalTry (DB'den bağımsız yol)",
    rep.sales.totalsTry.net === dbNet("SALES", "SALES_RETURN"),
    `rapor=${rep.sales.totalsTry.net} db=${dbNet("SALES", "SALES_RETURN")}`,
  );
  check(
    "§6b alış TL net = Σ damgalı grandTotalTry",
    rep.purchase.totalsTry.net === dbNet("PURCHASE", "PURCHASE_RETURN"),
    `rapor=${rep.purchase.totalsTry.net} db=${dbNet("PURCHASE", "PURCHASE_RETURN")}`,
  );
  // Kalıntı düzeltmesinin asıl kanıtı: USD oran satırlarının TL toplamı belge
  // damgasına eşit (düzeltmesiz 102.82 çıkar — sonda ①).
  const usdRowsTry = fwdUsd.reduce((s, r) => s + Number(r.totalTry), 0).toFixed(2);
  const s2Try = (
    await prisma.invoice.findUniqueOrThrow({ where: { id: s2 }, select: { grandTotalTry: true } })
  ).grandTotalTry.toFixed(2);
  check("§6c dövizli karışık belgede Σ(oran TL) = grandTotalTry", usdRowsTry === s2Try, `${usdRowsTry} / ${s2Try}`);
  check(
    "§6d kalıntı EN BÜYÜK matrah satırına yazıldı (50.40 + 50.41)",
    fwdUsd[0]?.baseTry === "50.40" && fwdUsd[1]?.baseTry === "50.41",
    fwdUsd.map((r) => r.baseTry).join(","),
  );
  check(
    "§6e reconDiff iki blokta da 0.00",
    rep.sales.totalsTry.reconDiff === "0.00" && rep.purchase.totalsTry.reconDiff === "0.00",
    `satış=${rep.sales.totalsTry.reconDiff} alış=${rep.purchase.totalsTry.reconDiff}`,
  );

  // ── §7 ORAN SATIRI TOPLAMI = BLOK TOPLAMI ─────────────────────────────────
  for (const [name, block] of [["satış", rep.sales], ["alış", rep.purchase]] as const) {
    for (const cur of block.currencies) {
      const sum = (rows: typeof cur.rows, f: (r: (typeof cur.rows)[number]) => string) =>
        rows.reduce((s, r) => s + Number(f(r)), 0).toFixed(2);
      const fwd = cur.rows.filter((r) => !r.isReturn);
      const ret = cur.rows.filter((r) => r.isReturn);
      check(
        `§7 ${name}/${cur.currency}: Σ(oran satırı) = ara toplam (matrah+KDV+tevkifat)`,
        sum(fwd, (r) => r.base) === cur.forward.base &&
          sum(fwd, (r) => r.vat) === cur.forward.vat &&
          sum(fwd, (r) => r.withholding) === cur.forward.withholding &&
          (cur.returns === null ||
            (sum(ret, (r) => r.base) === cur.returns.base && sum(ret, (r) => r.vat) === cur.returns.vat)),
      );
    }
  }

  // ── §8 TEVKİFAT: SATIRDAN TÜRETİM = FATURA BAŞLIĞI ────────────────────────
  const pTr = findCur(rep.purchase, "TRY");
  const pFwd = pTr?.rows.find((r) => !r.isReturn);
  const p1Header = (
    await prisma.invoice.findUniqueOrThrow({ where: { id: p1 }, select: { withholdingTotal: true } })
  ).withholdingTotal.toFixed(2);
  check(
    "§8a alış %20 satırı tevkifat taşıyor ve başlıkla birebir (100.00)",
    pFwd?.withholding === "100.00" && p1Header === "100.00",
    `satır=${pFwd?.withholding} başlık=${p1Header}`,
  );
  check(
    "§8b tevkifat net'i ödenecek toplamı düşürür (net grand 880.00 = 800+160−80)",
    pTr?.net.grand === "880.00" && rep.purchase.totalsTry.netWithholding === "80.00",
    `grand=${pTr?.net.grand}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    try {
      // Orta yerde çökmüş koşumu da toparla: bağlı kayıtlar cari üzerinden
      // yeniden çözülür (test_finance_reports temizlik deseni).
      const foundCaris = await prisma.cariAccount.findMany({
        where: { OR: [{ customerId: { in: customerIds } }, { subcontractorId: { in: subcontractorIds } }] },
        select: { id: true },
      });
      for (const c of foundCaris) if (!cariIds.includes(c.id)) cariIds.push(c.id);
      if (cariIds.length) {
        for (const r of await prisma.invoice.findMany({ where: { cariId: { in: cariIds } }, select: { id: true } })) {
          if (!invoiceIds.includes(r.id)) invoiceIds.push(r.id);
        }
        await prisma.cariTransaction.deleteMany({ where: { cariId: { in: cariIds } } });
      }
      if (invoiceIds.length) {
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      if (cariIds.length) {
        await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      }
      if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      if (subcontractorIds.length) await prisma.subcontractor.deleteMany({ where: { id: { in: subcontractorIds } } });
    } catch (e) {
      console.error("⚠️ Temizlik hatası:", (e as Error).message);
    }
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
