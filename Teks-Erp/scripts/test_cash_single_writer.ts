// =============================================================================
// BEKÇİ — KASA BAKİYESİ TEK YAZAR (2026-09-18, kullanıcı kararı; finans "tek kaynak satır")
// =============================================================================
//   §0 AST/metin: `balance: { increment` ve kasa/banka `update(... balance ...)` YALNIZ helpers/cash-ledger.helper.ts'te
//   §1 tahsilat → COLLECTION satırı (paymentId, IN, KH no) · kasa bakiyesi = Σ ACTIVE satır
//   §2 ödeme → PAYMENT satırı · banka bakiyesi = Σ ACTIVE satır
//   §3 ödeme iptali → satır CANCELLED (silinmez), bakiye geri, Σ tutar
//   §4 ödeme satırı Kasa Hareketleri'nden iptal edilemez → 409 CASH_TXN_FROM_PAYMENT
//   §5 masraf + virman aynı helper'dan; virman iptali Σ tutar
//   §6 backfill: satırsız eski ödeme (eski yazar simülasyonu) → dry-run yazmaz · --apply satır açar (status/cancelledAt kopya)
//      · ikinci --apply 0 yeni · bakiye DEĞİŞMEZ · okuyucu formülü (satırsız ödeme + satır) her aşamada bakiyeye eşit
//   NEGATİF SONDALAR (ölçüldü): ① payment.service applyCashTxTx düşer → §1/§2 ❌ · ② okuyucuda NOT EXISTS düşer → §6 çift sayım ❌
// ⚠️ DB'ye YAZAR → hedefDbEngeli() ilk adım. Fikstür `TEST-CSW-<ts>`, finally'de temizlik (defter satırları silinir — fikstür).
// =============================================================================
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CashTxnKind, PaymentDirection, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { paymentService } from "../src/services/payment.service";
import { cashTransactionService } from "../src/services/cash-transaction.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, extra = ""): void => { if (ok) pass++; else fail++; console.log(`  ${ok ? "✓" : "✗ FAIL:"} ${label}${extra ? ` — ${extra}` : ""}`); };
const T = `TEST-CSW-${Date.now().toString(36).toUpperCase()}`;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ids = { customer: "", cari: "", box: "", box2: "", bank: "" };
const paymentIds: string[] = [];

async function sumRows(ref: { cashBoxId?: string; bankAccountId?: string }): Promise<Prisma.Decimal> {
  const rows = await prisma.cashTransaction.findMany({ where: { ...(ref.cashBoxId ? { cashBoxId: ref.cashBoxId } : { bankAccountId: ref.bankAccountId }), status: PaymentStatus.ACTIVE }, select: { direction: true, amount: true } });
  return rows.reduce((a, r) => a.plus(r.direction === PaymentDirection.IN ? r.amount : D(r.amount).negated()), D(0));
}
/** Okuyucu formülü (consistency §23 ile aynı iskelet, çek hariç): Σ satır + Σ SATIRSIZ ödeme. */
async function readerSum(ref: { cashBoxId?: string; bankAccountId?: string }): Promise<Prisma.Decimal> {
  const col = ref.cashBoxId ? Prisma.raw(`"cashBoxId"`) : Prisma.raw(`"bankAccountId"`);
  const id = ref.cashBoxId ?? ref.bankAccountId!;
  const r = await prisma.$queryRaw<Array<{ t: Prisma.Decimal | null }>>`
    SELECT COALESCE((SELECT SUM(CASE WHEN direction='IN' THEN amount ELSE -amount END) FROM cash_transactions WHERE ${col} = ${id}::uuid AND status <> 'CANCELLED'), 0)
         + COALESCE((SELECT SUM(CASE WHEN p.direction='IN' THEN p.amount ELSE -p.amount END) FROM payments p WHERE p.${col} = ${id}::uuid AND p.status <> 'CANCELLED' AND NOT EXISTS (SELECT 1 FROM cash_transactions x WHERE x."paymentId" = p.id)), 0) AS t`;
  return D(r[0]?.t ?? 0);
}
const balanceOf = async (ref: { cashBoxId?: string; bankAccountId?: string }) => D(ref.cashBoxId ? (await prisma.cashBox.findUniqueOrThrow({ where: { id: ref.cashBoxId }, select: { balance: true } })).balance : (await prisma.bankAccount.findUniqueOrThrow({ where: { id: ref.bankAccountId! }, select: { balance: true } })).balance);
const status = (e: unknown) => (e instanceof AppError ? e.statusCode : -1);
const code = (e: unknown) => (e instanceof AppError ? (e.details as { code?: string } | undefined)?.code : undefined);
async function hata(fn: () => Promise<unknown>): Promise<unknown> { try { await fn(); return null; } catch (e) { return e; } }

function astKontrol(): void {
  const root = join(__dirname, "..", "src");
  const ihlal: string[] = [];
  const gez = (dir: string) => { for (const ad of readdirSync(dir)) { const p = join(dir, ad); if (statSync(p).isDirectory()) gez(p); else if (p.endsWith(".ts") && !p.endsWith("cash-ledger.helper.ts")) { const t = readFileSync(p, "utf8"); if (/(cashBox|bankAccount)\.update\([^)]*balance/s.test(t) || /(cashBox|bankAccount)\.update\(\{[\s\S]{0,200}balance:\s*\{\s*(increment|decrement|set)/.test(t)) ihlal.push(p.replace(root + "/", "src/")); } } };
  gez(root);
  const helper = readFileSync(join(root, "services", "helpers", "cash-ledger.helper.ts"), "utf8");
  check("§0a ⭐ kasa/banka bakiye yazımı (`cashBox.update`/`bankAccount.update` + balance) YALNIZ cash-ledger.helper'da", ihlal.length === 0, ihlal.join(", "));
  check("§0b helper gerçekten yazıyor (körlük zemini: iki increment)", (helper.match(/balance: \{ increment: delta \}/g) ?? []).length === 2);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(`DURDURULDU: ${engel}`);
  console.log("\n§0 AST"); astKontrol();
  try {
    ids.customer = (await prisma.customer.create({ data: { code: `${T}-M`, name: `${T} Müşteri`, isCustomerRole: true }, select: { id: true } })).id;
    ids.box = (await prisma.cashBox.create({ data: { code: `${T}-K1`, name: `${T} Kasa`, currency: "TRY" }, select: { id: true } })).id;
    ids.box2 = (await prisma.cashBox.create({ data: { code: `${T}-K2`, name: `${T} Kasa 2`, currency: "TRY" }, select: { id: true } })).id;
    ids.bank = (await prisma.bankAccount.create({ data: { code: `${T}-B`, name: `${T} Banka`, currency: "TRY", bankName: "Test", iban: null }, select: { id: true } })).id;

    console.log("\n§1 tahsilat → COLLECTION satırı + bakiye Σ");
    const t1 = await paymentService.create({ direction: PaymentDirection.IN, method: PaymentMethod.CASH, customerId: ids.customer, currency: "TRY", amount: 1000, cashBoxId: ids.box, paymentDate: new Date(), reference: `${T}-REF` } as never);
    paymentIds.push(t1.data.id);
    const r1 = await prisma.cashTransaction.findUnique({ where: { paymentId: t1.data.id }, select: { id: true, kind: true, direction: true, status: true, amount: true, docNo: true, cashBoxId: true, reference: true } });
    check("⭐ satır var: COLLECTION · IN · ACTIVE · 1000 · kasa · KH no · referans kopya", r1?.kind === CashTxnKind.COLLECTION && r1.direction === PaymentDirection.IN && r1.status === PaymentStatus.ACTIVE && D(r1.amount).equals(1000) && r1.cashBoxId === ids.box && r1.docNo.startsWith("KH") && r1.reference === `${T}-REF`, JSON.stringify(r1));
    check("⭐ kasa bakiyesi = Σ ACTIVE satır = 1000", (await balanceOf({ cashBoxId: ids.box })).equals(1000) && (await sumRows({ cashBoxId: ids.box })).equals(1000));
    check("okuyucu formülü de 1000 (çift sayım yok: ödeme satırlı, terim düşer)", (await readerSum({ cashBoxId: ids.box })).equals(1000));

    console.log("\n§2 ödeme → PAYMENT satırı (banka)");
    const o1 = await paymentService.create({ direction: PaymentDirection.OUT, method: PaymentMethod.BANK_TRANSFER, customerId: ids.customer, currency: "TRY", amount: 250, bankAccountId: ids.bank, paymentDate: new Date() } as never);
    paymentIds.push(o1.data.id);
    const r2 = await prisma.cashTransaction.findUnique({ where: { paymentId: o1.data.id }, select: { kind: true, direction: true, bankAccountId: true } });
    check("⭐ satır PAYMENT · OUT · banka; banka bakiyesi −250 = Σ", r2?.kind === CashTxnKind.PAYMENT && r2.direction === PaymentDirection.OUT && r2.bankAccountId === ids.bank && (await balanceOf({ bankAccountId: ids.bank })).equals(-250) && (await sumRows({ bankAccountId: ids.bank })).equals(-250));

    console.log("\n§3 ödeme iptali → satır CANCELLED, bakiye geri");
    await paymentService.cancel(t1.data.id, "bekçi");
    const r3 = await prisma.cashTransaction.findUnique({ where: { paymentId: t1.data.id }, select: { status: true, cancelledAt: true, cancelReason: true } });
    check("⭐ satır SİLİNMEDİ, CANCELLED + cancelledAt + sebep; kasa 0 = Σ", r3?.status === PaymentStatus.CANCELLED && r3.cancelledAt !== null && r3.cancelReason === "bekçi" && (await balanceOf({ cashBoxId: ids.box })).equals(0) && (await sumRows({ cashBoxId: ids.box })).equals(0));

    console.log("\n§4 ödeme satırı Kasa Hareketleri'nden iptal edilemez");
    const r4 = await prisma.cashTransaction.findUniqueOrThrow({ where: { paymentId: o1.data.id }, select: { id: true } });
    const e4 = await hata(() => cashTransactionService.cancel(r4.id, "yanlış kapı"));
    check("⭐ 409 CASH_TXN_FROM_PAYMENT; satır ACTIVE kaldı; banka −250", status(e4) === 409 && code(e4) === "CASH_TXN_FROM_PAYMENT" && (await prisma.cashTransaction.findUniqueOrThrow({ where: { id: r4.id }, select: { status: true } })).status === PaymentStatus.ACTIVE && (await balanceOf({ bankAccountId: ids.bank })).equals(-250), String(status(e4)));

    console.log("\n§5 masraf + virman aynı helper'dan");
    const gelir = await cashTransactionService.create({ kind: CashTxnKind.INCOME, cashBoxId: ids.box, amount: 500, description: `${T} gelir` });
    const vir = await cashTransactionService.transfer({ fromCashBoxId: ids.box, toCashBoxId: ids.box2, amount: 200, description: `${T} virman` } as never);
    check("gelir 500 → kasa 500; virman 200 → kasa 300, kasa2 200; Σ tutar", (await balanceOf({ cashBoxId: ids.box })).equals(300) && (await balanceOf({ cashBoxId: ids.box2 })).equals(200) && (await sumRows({ cashBoxId: ids.box })).equals(300) && (await sumRows({ cashBoxId: ids.box2 })).equals(200));
    await cashTransactionService.cancel(vir.data.ids[0]!, "bekçi");
    check("virman iptali → kasa 500, kasa2 0; Σ tutar; gelir satırı ACTIVE", (await balanceOf({ cashBoxId: ids.box })).equals(500) && (await balanceOf({ cashBoxId: ids.box2 })).equals(0) && (await sumRows({ cashBoxId: ids.box })).equals(500) && (await prisma.cashTransaction.findUniqueOrThrow({ where: { id: gelir.data.id }, select: { status: true } })).status === PaymentStatus.ACTIVE);

    console.log("\n§6 backfill — eski yazar simülasyonu: satırsız ödeme + bakiye zaten işlenmiş");
    // Eski dünyayı kur (defter satırı SİLİNMEZ — §10b2): ödeme doğrudan yazılır (eski akış: satırsız) ve bakiye eski yazar gibi
    // elle işlenir. Bu, backfill'in gerçek hedefidir: satırsız ama bakiyesi işlenmiş ödeme.
    const cari = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: ids.customer }, select: { id: true } });
    const t2 = { data: await prisma.payment.create({ data: { docNo: `${T}-TH-ESKI`, direction: PaymentDirection.IN, method: PaymentMethod.CASH, cariId: cari.id, currency: "TRY", exchangeRate: 1, amount: 300, amountTry: 300, cashBoxId: ids.box2, paymentDate: new Date(Date.now() - 86_400_000) }, select: { id: true, docNo: true } }) };
    paymentIds.push(t2.data.id);
    await prisma.cashBox.update({ where: { id: ids.box2 }, data: { balance: { increment: 300 } } }); // eski yazar simülasyonu (script, src değil)
    const b0 = await balanceOf({ cashBoxId: ids.box2 });
    check("zemin: satırsız ödeme var, kasa2 bakiyesi 300 (eski yazar), okuyucu formülü 300 (satırsız ödeme terimi)", b0.equals(300) && (await sumRows({ cashBoxId: ids.box2 })).equals(0) && (await readerSum({ cashBoxId: ids.box2 })).equals(300));
    const run = (args: string[]) => execFileSync("npx", ["tsx", join(__dirname, "migrate_cash_ledger_backfill.ts"), ...args], { encoding: "utf8", env: { ...process.env, BEKCI_HEDEF_ONAY: process.env.BEKCI_HEDEF_ONAY ?? "" } });
    const dry = run([]);
    check("dry-run: adayı listeler, satır AÇMAZ, hedef DB adını basar", dry.includes(t2.data.docNo) && dry.includes("KURU KOŞUM") && dry.includes("Hedef veritabanı") && (await prisma.cashTransaction.count({ where: { paymentId: t2.data.id } })) === 0);
    const ap = run(["--apply"]);
    const r6 = await prisma.cashTransaction.findUnique({ where: { paymentId: t2.data.id }, select: { kind: true, status: true, txnDate: true, amount: true, cashBoxId: true } });
    check("⭐ --apply: satır açıldı (COLLECTION, ACTIVE, ödeme tarihi, 300, kasa2); BAKİYE DEĞİŞMEDİ (300); okuyucu 300 (terim düştü, satır geldi)", r6?.kind === CashTxnKind.COLLECTION && r6.status === PaymentStatus.ACTIVE && D(r6.amount).equals(300) && r6.cashBoxId === ids.box2 && (await balanceOf({ cashBoxId: ids.box2 })).equals(b0) && (await readerSum({ cashBoxId: ids.box2 })).equals(300) && ap.includes("defter satırı açıldı"), ap.split("\n").filter((l) => l.includes("açıldı")).join(" | "));
    const ap2 = run(["--apply"]);
    check("⭐ ikinci --apply: 0 yeni satır (idempotent: paymentId @unique), bakiye aynı", (await prisma.cashTransaction.count({ where: { paymentId: t2.data.id } })) === 1 && (await balanceOf({ cashBoxId: ids.box2 })).equals(b0) && /Satırsız tahsilat\/ödeme YOK|0 defter satırı açıldı/.test(ap2));
    await paymentService.cancel(t2.data.id, "bekçi");
    check("backfill'li ödemenin iptali: satır CANCELLED, kasa2 0", (await prisma.cashTransaction.findUniqueOrThrow({ where: { paymentId: t2.data.id }, select: { status: true } })).status === PaymentStatus.CANCELLED && (await balanceOf({ cashBoxId: ids.box2 })).equals(0));
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  if (fail > 0) process.exitCode = 1;
}

async function temizle(): Promise<void> {
  const boxes = [ids.box, ids.box2].filter(Boolean);
  await prisma.cashTransaction.deleteMany({ where: { OR: [{ cashBoxId: { in: boxes } }, ...(ids.bank ? [{ bankAccountId: ids.bank }] : [])] } });
  if (paymentIds.length) {
    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.cariTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: paymentIds } } }).catch(() => undefined);
    await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  }
  if (ids.customer) {
    const cari = await prisma.cariAccount.findFirst({ where: { customerId: ids.customer }, select: { id: true } });
    if (cari) { await prisma.cariTransaction.deleteMany({ where: { cariId: cari.id } }); await prisma.cariBalance.deleteMany({ where: { cariId: cari.id } }); await prisma.cariAccount.delete({ where: { id: cari.id } }).catch(() => undefined); }
  }
  await prisma.cashBox.deleteMany({ where: { id: { in: boxes } } });
  if (ids.bank) await prisma.bankAccount.deleteMany({ where: { id: ids.bank } });
  if (ids.customer) await prisma.customer.deleteMany({ where: { id: ids.customer } });
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
