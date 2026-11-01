// =============================================================================
// BEKÇİ — PATRON BULUTU FATURA PROJEKSİYONU: BİRLEŞMİŞ CARİNİN FATURASI (D4-K3dk2)
// =============================================================================
// Fikstür: aynı kartın iki hesabı (K3d emsali) — kaynak = eski fason bacağı (TRY: vadesi geçmiş 1000 − 300 kapama,
// vadesi gelmemiş 500), hedef = kart hesabı (kendi TRY faturası 700, vadesi gelmemiş).
//   §1 birleşme ÖNCESİ: tel satırı ham kolondan kurulan satırla bayt-aynı (cariHesapId = satırın cariId'si,
//      açık = grandTotal − paidTotal) — birleşmesiz fabrikada çıktı değişmez
//   §2 ⭐ birleşme SONRASI: kaynağın onaylı faturaları hedef cariHesapId altında; vadesi geçmiş kalem açık 700 +
//      vadesiGecti, vadesi gelmemiş 500 değil; hedefin kendi faturası bayt-aynı; faturanın cariId'si DEĞİŞMEDİ
//   §3 ⭐ tutarlılık: hedef altındaki vadesi geçmiş faturaların açık toplamı = cari-hesap `gecikmis` (TRY)
//   §4 ⭐ (yeniden birleştirip) hedefe tahsilat (sanal FIFO) → aktarılan faturanın açığı düşer, gecikmişle yine eşit
//   §5 değişiklik kaynağı: hedefin tahsilatı ve kaynağın hesap satırı (mergedIntoId) aktarılan faturayı kirletir;
//      katalog sürümü 2 (TAM gönderim eski satırları düzeltir)
//   §6 geri alma → fatura kaynak altında, açık = grandTotal − paidTotal
//   §7 ⭐ zincir A→B→C (savunma; engeller bugün üretmez): fatura son hedef altında, açık/vade C'nin gecikmişiyle aynı; lookup geçişli
//   §8 virman vadesi geçişi SQL'i: bacak vadesini kapsayan pencere faturayı + hedef cariyi döndürür
// ⭐ NEGATİF SONDA: bkz. BEKCI-HARITASI satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik `finally`de.
// =============================================================================
import { Currency, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { invoiceService } from "../src/services/invoice.service";
import { paymentService } from "../src/services/payment.service";
import { paymentAllocationService } from "../src/services/payment-allocation.service";
import { applyCariMerge } from "../src/services/helpers/cari-merge.helper";
import { revertCariMerge } from "../src/services/helpers/cari-merge-revert.helper";
import { RECORD_PROJECTIONS } from "../src/cloud-sync/projections";
import { buildRecords } from "../src/cloud-sync/record-builder";
import { mapToRoots } from "../src/cloud-sync/change-scan";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-BFB-${process.pid}`;
const DAY = 86_400_000;
const ago = (d: number): Date => new Date(Date.now() - d * DAY);
const ids = { customers: [] as string[], subs: [] as string[], invoices: [] as string[], payments: [] as string[], cashBox: "" };
type Row = Record<string, unknown>;

const FATURA = RECORD_PROJECTIONS.find((p) => p.name === "fatura")!;
const CARI = RECORD_PROJECTIONS.find((p) => p.name === "cari-hesap")!;
/** Kolonu ham kaynaktan okuyan ikiz (bugünkü davranış): birleşmesiz satırda tel bayt-aynı olmalı. */
const FATURA_RAW = { ...FATURA, columns: FATURA.columns.map(({ resolvedBy: _r, ...c }) => c) };

async function sales(party: { customerId?: string; subcontractorId?: string }, amount: number, issueDate: Date, dueDate: Date | null): Promise<string> {
  const d = await invoiceService.createDraft({
    type: "SALES", ...party, currency: "TRY" as Currency, exchangeRate: null, issueDate, dueDate,
    lines: [{ description: "Bekçi kalemi", qty: 1, unit: "m", unitPrice: amount }],
  } as Parameters<typeof invoiceService.createDraft>[0]);
  ids.invoices.push(d.data.id);
  await invoiceService.confirm(d.data.id);
  return d.data.id;
}
async function wire(p: typeof FATURA, rootIds: string[]): Promise<Map<string, string>> {
  const b = await buildRecords(p, rootIds, Date.now());
  const merged = new Map<string, Row>();
  for (const [sub, rows] of b.rows) for (const r of rows) merged.set(String(r.id), { ...(merged.get(String(r.id)) ?? {}), [sub]: r });
  return new Map([...merged].map(([id, r]) => [id, JSON.stringify(r)]));
}
const part = (json: string | undefined, sub: string): Row => ((JSON.parse(json ?? "{}") as Record<string, Row>)[sub] ?? {});
async function overdueOf(cariId: string): Promise<string> {
  const w = await wire(CARI, [cariId]);
  const g = (part(w.get(cariId), "cari-hesap.finans").gecikmis ?? []) as Array<{ doviz: string; tutar: string }>;
  return new Prisma.Decimal(g.find((x) => x.doviz === "TRY")?.tutar ?? 0).toFixed(2);
}
/** Hedef altındaki (cariHesapId) vadesi geçmiş faturaların açık toplamı. */
function overdueSum(w: Map<string, string>, cariId: string): string {
  let s = new Prisma.Decimal(0);
  for (const j of w.values()) {
    const root = part(j, "fatura");
    if (root.cariHesapId === cariId && root.vadesiGecti === true) s = s.plus(new Prisma.Decimal(String(part(j, "fatura.finans").acikTutar)));
  }
  return s.toFixed(2);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== Bulut fatura projeksiyonu: birleşmiş cari bekçisi ===\n");
  await ensureTestAdmin();
  ids.cashBox = (await prisma.cashBox.create({ data: { code: `${TAG}-KS`, name: `${TAG} Kasa`, currency: "TRY" }, select: { id: true } })).id;
  try {
    const card = (await prisma.customer.create({ data: { code: `${TAG}-K`, name: `${TAG} kart` }, select: { id: true } })).id;
    ids.customers.push(card);
    const sub = (await prisma.subcontractor.create({ data: { code: `${TAG}-F`, name: `${TAG} fason` }, select: { id: true } })).id;
    ids.subs.push(sub);
    const overdue = await sales({ subcontractorId: sub }, 1000, ago(45), ago(15));
    const notDue = await sales({ subcontractorId: sub }, 500, ago(5), new Date(Date.now() + 25 * DAY));
    const pay = await paymentService.create({ direction: "IN", method: "CASH", subcontractorId: sub, amount: 300, cashBoxId: ids.cashBox, paymentDate: ago(12) } as Parameters<typeof paymentService.create>[0]);
    ids.payments.push(pay.data.id);
    const paid = await prisma.invoice.findUniqueOrThrow({ where: { id: overdue }, select: { paidTotal: true } });
    if (new Prisma.Decimal(paid.paidTotal).isZero()) await paymentAllocationService.allocate({ invoiceId: overdue, paymentId: pay.data.id, amount: 300 });
    const source = (await prisma.cariAccount.findUniqueOrThrow({ where: { subcontractorId: sub }, select: { id: true } })).id;
    await prisma.subcontractor.update({ where: { id: sub }, data: { customerId: card } });
    const target = (await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: card }, select: { id: true } })).id;
    const own = await sales({ customerId: card }, 700, ago(3), new Date(Date.now() + 10 * DAY));
    const all = [overdue, notDue, own];

    // §1
    const before = await wire(FATURA, all);
    const raw = await wire(FATURA_RAW, all);
    check("§1a birleşmesiz: tel satırı ham kolonlu ikizle BAYT-AYNI", all.every((id) => before.get(id) === raw.get(id) && !!before.get(id)), "tel satırı");
    check("§1b birleşmesiz: kaynak faturası kaynak altında, açık 700 + vadesi geçti",
      part(before.get(overdue), "fatura").cariHesapId === source && part(before.get(overdue), "fatura.finans").acikTutar === "700" && part(before.get(overdue), "fatura").vadesiGecti === true);

    // §2
    await applyCariMerge(source, target);
    const after = await wire(FATURA, all);
    const o = after.get(overdue);
    const n = after.get(notDue);
    check("§2a ⭐ kaynağın faturaları HEDEF cariHesapId altında", part(o, "fatura").cariHesapId === target && part(n, "fatura").cariHesapId === target, `${part(o, "fatura").cariHesapId} / hedef ${target}`);
    check("§2b ⭐ vadesi geçmiş aktarılan kalem: açık 700, vadesiGecti", part(o, "fatura.finans").acikTutar === "700" && part(o, "fatura").vadesiGecti === true, String(part(o, "fatura.finans").acikTutar));
    check("§2c vadesi gelmemiş aktarılan kalem: açık 500, vadesiGecti değil", part(n, "fatura.finans").acikTutar === "500" && part(n, "fatura").vadesiGecti === false, String(part(n, "fatura.finans").acikTutar));
    check("§2d hedefin kendi (birleşmesiz) faturası bayt-aynı", after.get(own) === before.get(own));
    const inv = await prisma.invoice.findMany({ where: { id: { in: [overdue, notDue] } }, select: { cariId: true } });
    check("§2e defter 'ne oldu' değişmedi: faturanın cariId'si kaynakta", inv.every((i) => i.cariId === source));

    // §3
    const g1 = await overdueOf(target);
    check("§3 ⭐ hedef altındaki vadesi geçmiş fatura açığı = cari-hesap gecikmişi", g1 !== "0.00" && overdueSum(after, target) === g1, `${overdueSum(after, target)} ↔ ${g1}`);

    // §5
    const src = (t: string) => FATURA.sources.find((s) => s.table === t)!;
    const byPay = await mapToRoots(src("payments").root, [target]);
    const byAcc = await mapToRoots(src("cari_accounts").root, [source]);
    const byLeg = await mapToRoots(src("cari_transactions").root, [target]);
    check("§5a hedefin tahsilatı / virman bacağı aktarılan faturayı kirletir", [overdue, notDue].every((id) => byPay.includes(id) && byLeg.includes(id)), `${byPay.length}/${byLeg.length}`);
    check("§5b kaynağın hesap satırı (mergedIntoId) faturalarını kirletir", [overdue, notDue].every((id) => byAcc.includes(id)));
    check("§5c fatura katalog sürümü 2 (TAM gönderim)", FATURA.catalogVersion === 2);

    // §6
    await revertCariMerge(source, "bekçi geri alma");
    const back = await wire(FATURA, all);
    check("§6 geri alma → kaynak altında, açık = grandTotal − paidTotal (700)",
      part(back.get(overdue), "fatura").cariHesapId === source && part(back.get(overdue), "fatura.finans").acikTutar === "700", String(part(back.get(overdue), "fatura.finans").acikTutar));
    await applyCariMerge(source, target);

    // §4
    const pay2 = await paymentService.create({ direction: "IN", method: "CASH", customerId: card, amount: 400, cashBoxId: ids.cashBox, paymentDate: new Date() } as Parameters<typeof paymentService.create>[0]);
    ids.payments.push(pay2.data.id);
    const later = await wire(FATURA, all);
    const g2 = await overdueOf(target);
    check("§4a ⭐ hedefe tahsilat sanal FIFO ile aktarılan vadesi geçmiş kalemi düşürür (700 → 300)", part(later.get(overdue), "fatura.finans").acikTutar === "300", String(part(later.get(overdue), "fatura.finans").acikTutar));
    check("§4b ⭐ düşen açık gecikmişle yine eşit", overdueSum(later, target) === g2 && g2 === "300.00", `${overdueSum(later, target)} ↔ ${g2}`);

    // §8 virman vadesi geçişi: bacağın dueDate'ini kapsayan pencere aktarılan faturayı ve hedef cariyi döndürür
    const crossing = async (p: typeof FATURA, from: Date, to: Date): Promise<string[]> => {
      const c = p.crossings?.find((x) => x.name === "virman-vadesi");
      if (!c) return [];
      const r = await prisma.$queryRawUnsafe<Array<{ root_id: string }>>(c.sql, from, to);
      return r.map((x) => x.root_id);
    };
    const leg = await prisma.cariTransaction.findFirstOrThrow({ where: { cariId: target, sourceType: "CARI_TRANSFER", invoiceId: overdue }, select: { dueDate: true } });
    const due = (leg.dueDate as Date).getTime();
    const win = [new Date(due - DAY), new Date(due + 1)] as const;
    const xInv = await crossing(FATURA, ...win);
    const xCari = await crossing(CARI, ...win);
    check("§8a virman vadesi geçişi: aktarılan vadesi geçmiş fatura döner", xInv.includes(overdue) && !xInv.includes(notDue), `${xInv.length}`);
    check("§8b virman vadesi geçişi: hedef cari (gecikmiş yeniden gönderilir) döner", xCari.includes(target));
    check("§8c pencere dışı: dönmez", !(await crossing(FATURA, new Date(due + 1), new Date(due + DAY))).includes(overdue));

    // §7 ⭐ zincir A→B→C: bugünkü engellerle (hesap başına tek fason bağı, kart hesabı kaynak olamaz) üretilemez;
    // projeksiyonun geçişli çözümü savunmadır → A→C gerçek birleşmeyle kurulur, ara B elle zincire sokulur.
    const card2 = (await prisma.customer.create({ data: { code: `${TAG}-K2`, name: `${TAG} kart 2` }, select: { id: true } })).id;
    ids.customers.push(card2);
    const subA = (await prisma.subcontractor.create({ data: { code: `${TAG}-FA`, name: `${TAG} fason A` }, select: { id: true } })).id;
    const subB = (await prisma.subcontractor.create({ data: { code: `${TAG}-FB`, name: `${TAG} fason B` }, select: { id: true } })).id;
    ids.subs.push(subA, subB);
    const chainInv = await sales({ subcontractorId: subA }, 800, ago(40), ago(10));
    await prisma.subcontractor.update({ where: { id: subA }, data: { customerId: card2 } });
    const accA = (await prisma.cariAccount.findUniqueOrThrow({ where: { subcontractorId: subA }, select: { id: true } })).id;
    const accC = (await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: card2 }, select: { id: true } })).id;
    await applyCariMerge(accA, accC);
    const accB = (await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: subB, isActive: false, mergedIntoId: accC }, select: { id: true } })).id;
    await prisma.cariAccount.update({ where: { id: accA }, data: { mergedIntoId: accB } });
    const ch = await wire(FATURA, [chainInv]);
    const gC = await overdueOf(accC);
    check("§7a ⭐ zincir: fatura SON hedef (C) altında", part(ch.get(chainInv), "fatura").cariHesapId === accC, String(part(ch.get(chainInv), "fatura").cariHesapId));
    check("§7b ⭐ zincir: açık 800 + vadesi geçti = C gecikmişi", part(ch.get(chainInv), "fatura.finans").acikTutar === "800" && part(ch.get(chainInv), "fatura").vadesiGecti === true && overdueSum(ch, accC) === gC,
      `${String(part(ch.get(chainInv), "fatura.finans").acikTutar)} ↔ ${gC}`);
    const byPayC = await mapToRoots(src("payments").root, [accC]);
    const byAccC = await mapToRoots(src("cari_accounts").root, [accC]);
    check("§7c zincir: C'nin tahsilatı ve hesap satırı A'nın faturasını kirletir (lookup geçişli)", byPayC.includes(chainInv) && byAccC.includes(chainInv));

  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(): Promise<void> {
  const accs = await prisma.cariAccount.findMany({ where: { OR: [{ customerId: { in: ids.customers } }, { subcontractorId: { in: ids.subs } }] }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds }, reversesTxnId: { not: null } } });
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.paymentAllocation.deleteMany({ where: { invoiceId: { in: ids.invoices } } });
  await prisma.cashTransaction.deleteMany({ where: { cashBoxId: ids.cashBox } });
  await prisma.payment.deleteMany({ where: { id: { in: ids.payments } } });
  await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: ids.invoices } } });
  await prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } });
  await prisma.cariPeriodClose.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.updateMany({ where: { id: { in: accIds } }, data: { mergedIntoId: null } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  if (ids.cashBox) await prisma.cashBox.deleteMany({ where: { id: ids.cashBox } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...accIds, ...ids.invoices, ...ids.payments] } } });
}

main()
  .catch((e) => {
    console.error("HATA", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
