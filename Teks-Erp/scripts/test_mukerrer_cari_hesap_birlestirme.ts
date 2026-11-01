// =============================================================================
// BEKÇİ — MÜKERRER KARTIN CARİ HESABI (2026-11-01, Gülkesim provası: iki DRN kartı)
// =============================================================================
// İki müşteri kartının İKİSİNDE de cari hesap varken ana veri birleştirmesi ENGELLEMEZ: birleşen kartın hesabı
// mezar taşında KALIR (KEEP_ON_SOURCE; `customerId @unique` taşımaya izin vermez), kimliği mezar taşı üzerinden
// kalan karta çözülür; ardından cari birleştirme (K3e) iki hesabı virmanla teke indirir.
//   §1 ön izleme: engel YOK, çakışma KEEP_ON_SOURCE, takip listesi kalan hesabı + hedef hesabı + bakiyeyi söyler
//   §2 ana veri birleştirme (HTTP): hesap mezar taşında kalır, defter satırları ve bakiyeler AYNEN
//   §3 cari aday listesi iki yönden de öbür hesabı önerir (kaynak = mezar taşı hesabı, hedef = kartın hesabı)
//   §4 cari birleştirme (HTTP): tek aktif hesap kalır, döviz başına bakiye toplamı korunur, eski defter satırları
//      değişmez (yalnız CARI_TRANSFER bacakları eklenir); ters yön engelli
//   §5 claim seddi: ön izlemeden sonra kart birleşmesi kalkarsa (geri alma) uygula 409 CARI_MERGE_CONFLICT
//   §6 ana veri geri alma: mezar taşı dirilir, hesabı yerinde kalır
//   §7 LIFO: cari birleştirmeden SONRA ana veri geri alma 409 UNMERGE_BLOCKED (önce cari birleştirme geri alınır)
// ⭐ NEGATİF SONDA: bkz. BEKCI-HARITASI satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik `finally`de.
// =============================================================================
import type { AddressInfo } from "node:net";
import { Currency, Prisma } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { invoiceService } from "../src/services/invoice.service";
import { applyCariMergeTx, planCariMerge } from "../src/services/helpers/cari-merge.helper";
import { MasterDataMergeService } from "../src/services/master-data-merge.service";
import { MasterDataUnmergeService } from "../src/services/master-data-unmerge.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-MCH-${process.pid}`;
const DAY = 86_400_000;
const at = (d: number): Date => new Date(Date.now() + d * DAY);
const ids = { customers: [] as string[], invoices: [] as string[], users: [] as string[] };
type Resp = { status: number; body: { message?: string; details?: Record<string, unknown>; data?: unknown } };

async function sales(customerId: string, amount: number, issue: Date, due: Date | null, currency: Currency = "TRY"): Promise<string> {
  const d = await invoiceService.createDraft({
    type: "SALES", customerId, currency, exchangeRate: currency === "TRY" ? null : 30, issueDate: issue, dueDate: due,
    lines: [{ description: "Bekçi kalemi", qty: 1, unit: "m", unitPrice: amount }],
  } as Parameters<typeof invoiceService.createDraft>[0]);
  ids.invoices.push(d.data.id);
  await invoiceService.confirm(d.data.id);
  return d.data.id;
}

async function card(n: string): Promise<{ id: string; cari: string }> {
  const id = (await prisma.customer.create({ data: { code: `${TAG}-${n}`, name: `${TAG} DRN ${n}` }, select: { id: true } })).id;
  ids.customers.push(id);
  const found = await prisma.cariAccount.findUnique({ where: { customerId: id }, select: { id: true } });
  const cari = found?.id ?? (await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: id }, select: { id: true } })).id;
  return { id, cari };
}

/** Döviz başına bakiye toplamı (sıfırlar atılır). */
async function balanceSum(cariIds: string[]): Promise<string> {
  const rows = await prisma.cariBalance.findMany({ where: { cariId: { in: cariIds } }, select: { currency: true, balance: true } });
  const m = new Map<string, Prisma.Decimal>();
  for (const r of rows) m.set(r.currency, (m.get(r.currency) ?? new Prisma.Decimal(0)).plus(r.balance));
  return JSON.stringify([...m.entries()].filter(([, v]) => !v.isZero()).sort().map(([c, v]) => [c, v.toFixed(2)]));
}
/** Defter satırlarının değişmez fotoğrafı (id + hesap + tutar + kaynak). */
async function ledger(cariIds: string[], excludeTransfer = false): Promise<string> {
  const rows = await prisma.cariTransaction.findMany({
    where: { cariId: { in: cariIds }, ...(excludeTransfer ? { sourceType: { not: "CARI_TRANSFER" } } : {}) },
    select: { id: true, cariId: true, currency: true, debit: true, credit: true, sourceType: true, invoiceId: true, txnDate: true },
    orderBy: { id: "asc" },
  });
  return JSON.stringify(rows.map((r) => [r.id, r.cariId, r.currency, r.debit.toFixed(2), r.credit.toFixed(2), r.sourceType, r.invoiceId, r.txnDate.toISOString()]));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== Mükerrer kartın cari hesabı bekçisi ===\n");
  const KEY = SETTING_KEYS.FINANCE_ENABLED;
  const foto = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: true }, update: { value: true } });
  const admin = await ensureTestAdmin();
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, token: string, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let parsed: Resp["body"] = {};
    try {
      parsed = (await r.json()) as Resp["body"];
    } catch {
      /* boş gövde */
    }
    return { status: r.status, body: parsed };
  };
  const username = `${TAG}-muh`.toLowerCase();
  const u = await prisma.user.create({ data: { username, fullName: `${TAG} muhasebe`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
  ids.users.push(u.id);
  const perms = await prisma.permission.findMany({ where: { code: { in: ["master-data:merge", "customer:write", "customer:read", "finance:read", "finance:cari-merge"] } }, select: { id: true } });
  await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test123456" }) });
  const tok = ((await login.json()) as { data?: { token?: string } }).data?.token ?? "";
  const code = (r: Resp): string => String(r.body.details?.code ?? r.status);

  try {
    // —— Fikstür: demo gibi iki DRN kartı, ikisinde de hareketli cari hesap ——
    const A = await card("A");
    const B = await card("B");
    await sales(A.id, 700, at(-3), at(10));
    await sales(B.id, 1000, at(-40), at(-10));
    await sales(B.id, 250, at(-5), at(20), "USD");
    const both = [A.cari, B.cari];
    const sumBefore = await balanceSum(both);
    const ledgerBefore = await ledger(both);

    // §1 ön izleme
    const pv = await call("POST", "/api/master-data/customer/merge/preview", tok, { survivorId: A.id, sourceIds: [B.id] });
    const p = pv.body.data as { canMerge: boolean; blockers: Array<{ key: string }>; conflicts: Array<{ table: string; policy: string }>; followUps: Array<{ cariId: string; targetCariId: string | null; balances: unknown[] }> } | undefined;
    check("§1a ön izleme 200 + birleştirilebilir (cari çakışması ENGEL değil)", pv.status === 200 && p?.canMerge === true && !p.blockers.some((b) => b.key === "CONFLICT_CARI_ACCOUNTS"), `${pv.status} ${JSON.stringify(p?.blockers)}`);
    const cc = p?.conflicts.find((c) => c.table === "cari_accounts");
    check("§1b ⭐ cari çakışması KEEP_ON_SOURCE olarak listelenir", cc?.policy === "KEEP_ON_SOURCE", JSON.stringify(cc));
    const fu = p?.followUps ?? [];
    check("§1c takip: kalan hesap = B, hedef = A'nın hesabı, bakiye listeli", fu.length === 1 && fu[0].cariId === B.cari && fu[0].targetCariId === A.cari && fu[0].balances.length === 2, JSON.stringify(fu));

    // §2 ana veri birleştirme
    const mg = await call("POST", "/api/master-data/customer/merge", tok, { survivorId: A.id, sourceIds: [B.id], reason: `${TAG} mükerrer DRN kartı`, acknowledgedConflicts: p?.conflicts.length ?? 0 });
    const md = mg.body.data as { followUps?: Array<{ cariId: string; targetCariId: string | null }> } | undefined;
    check("§2a ⭐ birleştirme 200 (eskiden 409 CONFLICT)", mg.status === 200, `${mg.status} ${mg.body.message ?? ""}`);
    check("§2b sonuç takip listesi B → A", md?.followUps?.length === 1 && md.followUps[0].cariId === B.cari && md.followUps[0].targetCariId === A.cari, JSON.stringify(md?.followUps));
    const bAcc = await prisma.cariAccount.findUnique({ where: { id: B.cari }, select: { customerId: true, isActive: true, mergedIntoId: true } });
    const bCard = await prisma.customer.findUnique({ where: { id: B.id }, select: { mergedIntoId: true } });
    check("§2c hesap mezar taşında kaldı (customerId = B, aktif), kart B → A", bAcc?.customerId === B.id && bAcc.isActive && !bAcc.mergedIntoId && bCard?.mergedIntoId === A.id, JSON.stringify({ bAcc, bCard }));
    check("§2d ⭐ defter satırları AYNEN (ana veri birleştirme deftere dokunmaz)", (await ledger(both)) === ledgerBefore);
    check("§2e bakiye toplamı aynı", (await balanceSum(both)) === sumBefore, `${await balanceSum(both)} ↔ ${sumBefore}`);

    // §3 aday listesi
    const ca = await call("GET", `/api/finance/cari/${A.cari}/merge-candidates`, tok);
    const cb = await call("GET", `/api/finance/cari/${B.cari}/merge-candidates`, tok);
    type Cand = { id: string; sourceId: string; targetId: string };
    const fromA = ((ca.body.data as Cand[] | undefined) ?? []).find((c) => c.id === B.cari);
    const fromB = ((cb.body.data as Cand[] | undefined) ?? []).find((c) => c.id === A.cari);
    check("§3a ⭐ A'nın hesabından aday: B hesabı, yön B → A", fromA?.sourceId === B.cari && fromA.targetId === A.cari, `${ca.status} ${JSON.stringify(ca.body.data)}`);
    check("§3b B'nin hesabından aday: A hesabı, yön B → A", fromB?.sourceId === B.cari && fromB.targetId === A.cari, `${cb.status} ${JSON.stringify(cb.body.data)}`);

    // §4 cari birleştirme
    const rev = await call("GET", `/api/finance/cari/merge/preview?sourceId=${A.cari}&targetId=${B.cari}`, tok);
    const revB = (rev.body.data as { blockers?: string[] } | undefined)?.blockers ?? [];
    check("§4a ters yön (kart hesabı → mezar taşı) engelli", rev.status === 200 && revB.length > 0, JSON.stringify(revB));
    const cpv = await call("GET", `/api/finance/cari/merge/preview?sourceId=${B.cari}&targetId=${A.cari}`, tok);
    const cp = cpv.body.data as { blockers: string[]; stamp: string; items: unknown[] } | undefined;
    check("§4b cari ön izleme B → A engelsiz, her açık kalem listeli", cpv.status === 200 && cp?.blockers.length === 0 && cp.items.length === 2, `${cpv.status} ${JSON.stringify(cp?.blockers)} kalem=${cp?.items.length}`);
    const ap = await call("POST", "/api/finance/cari/merge", tok, { sourceId: B.cari, targetId: A.cari, stamp: cp?.stamp, clientToken: crypto.randomUUID() });
    check("§4c uygula 200", ap.status === 200, `${ap.status} ${ap.body.message ?? ""} ${code(ap)}`);
    const active = await prisma.cariAccount.count({ where: { id: { in: both }, isActive: true, mergedIntoId: null } });
    const bAfter = await prisma.cariAccount.findUnique({ where: { id: B.cari }, select: { mergedIntoId: true } });
    check("§4d ⭐ tek aktif hesap kaldı (B → A)", active === 1 && bAfter?.mergedIntoId === A.cari, `aktif=${active}`);
    check("§4e döviz başına bakiye toplamı korundu", (await balanceSum(both)) === sumBefore, `${await balanceSum(both)} ↔ ${sumBefore}`);
    check("§4f B hesabı sıfır, A hesabı toplam", (await balanceSum([B.cari])) === "[]" && (await balanceSum([A.cari])) === sumBefore);
    check("§4g eski defter satırları değişmedi (yalnız virman bacakları eklendi)", (await ledger(both, true)) === ledgerBefore);

    // §5 claim seddi: plan kart birleşmesi varken çıkarıldı, uygulamadan önce kart ayrıldı → 409
    const C = await card("C");
    const D = await card("D");
    await sales(D.id, 300, at(-2), at(15));
    const pv2 = await MasterDataMergeService.preview("customer", C.id, [D.id]);
    await MasterDataMergeService.merge("customer", { survivorId: C.id, sourceIds: [D.id], reason: `${TAG} claim seddi sondası`, acknowledgedConflicts: pv2.conflicts.length, userId: admin.id });
    const plan = await planCariMerge(D.cari, C.cari);
    check("§5a plan engelsiz + mezar taşı bağını taşır", plan.blockers.length === 0 && plan.sourceTombstoneOf === C.id, JSON.stringify(plan.blockers));
    await prisma.customer.update({ where: { id: D.id }, data: { mergedIntoId: null, isActive: true } });
    const raced = await prisma.$transaction((tx) => applyCariMergeTx(tx, plan, null)).then(() => "yazdı", (e: unknown) => (e instanceof AppError ? String(e.details?.code) : String(e)));
    check("§5b ⭐ kart ayrıldıktan sonra uygula → 409 CARI_MERGE_CONFLICT, sıfır yazım", raced === "CARI_MERGE_CONFLICT", raced);
    const dLater = await planCariMerge(D.cari, C.cari);
    check("§5c ayrılmış kartlar: farklı kimlik engeli", dLater.blockers.some((b) => b.includes("aynı karta ait değil")), JSON.stringify(dLater.blockers));
    await prisma.customer.update({ where: { id: D.id }, data: { mergedIntoId: C.id, isActive: false } });

    // §6 ana veri geri alma: mezar taşı dirilir, hesabı yerinde (geri alma deftere hesap taşımadığı için iz yok)
    const op = await prisma.mergeOperation.findFirstOrThrow({ where: { survivorId: C.id, revertedAt: null }, select: { id: true } });
    await MasterDataUnmergeService.revert(op.id, { reason: `${TAG} geri alma sondası`, userId: admin.id });
    const dAcc = await prisma.cariAccount.findUnique({ where: { id: D.cari }, select: { customerId: true, isActive: true } });
    const dCard = await prisma.customer.findUnique({ where: { id: D.id }, select: { mergedIntoId: true } });
    check("§6 geri alma: D kartı dirildi, hesabı D'de aktif", !dCard?.mergedIntoId && dAcc?.customerId === D.id && dAcc.isActive === true, JSON.stringify({ dAcc, dCard }));

    // §7 LIFO: cari birleştirme (§4, B → A) yapıldıktan sonra ana veri geri alma engellenir — yoksa B kartı dirilir,
    // hesabı A'nın hesabına birleşmiş ve donmuş kalır (tek kimlik kuralı delinir).
    const opAB = await prisma.mergeOperation.findFirstOrThrow({ where: { survivorId: A.id, revertedAt: null }, select: { id: true } });
    const blocked = await MasterDataUnmergeService.revert(opAB.id, { reason: `${TAG} LIFO sondası geri alma`, userId: admin.id })
      .then(() => "yazdı", (e: unknown) => (e instanceof AppError ? `${e.statusCode} ${String(e.details?.code)} ${e.message}` : String(e)));
    const bCardAfter = await prisma.customer.findUnique({ where: { id: B.id }, select: { mergedIntoId: true } });
    check("§7 ⭐ cari birleştirme sonrası ana veri geri alma → 409 UNMERGE_BLOCKED (önce cari birleştirme), kart B hâlâ A'da",
      blocked.startsWith("409 UNMERGE_BLOCKED") && blocked.includes("cari birleştirme") && bCardAfter?.mergedIntoId === A.id, blocked);
  } finally {
    server.close();
    await temizle();
    if (foto) await prisma.systemSetting.update({ where: { key: KEY }, data: { value: foto.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key: KEY } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(): Promise<void> {
  const accs = await prisma.cariAccount.findMany({ where: { customerId: { in: ids.customers } }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  const ops = await prisma.mergeOperation.findMany({ where: { survivorId: { in: ids.customers } }, select: { id: true } });
  const opIds = ops.map((o) => o.id);
  await prisma.mergeOperationRef.deleteMany({ where: { operationId: { in: opIds } } });
  await prisma.mergeOperationSource.deleteMany({ where: { operationId: { in: opIds } } });
  await prisma.mergeOperation.deleteMany({ where: { id: { in: opIds } } });
  await prisma.duplicateReview.deleteMany({ where: { OR: [{ aId: { in: ids.customers } }, { bId: { in: ids.customers } }] } });
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds }, reversesTxnId: { not: null } } });
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: ids.invoices } } });
  await prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.updateMany({ where: { id: { in: accIds } }, data: { mergedIntoId: null, isActive: true } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.customer.updateMany({ where: { id: { in: ids.customers } }, data: { mergedIntoId: null } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...accIds, ...ids.invoices, ...ids.customers] } } });
  for (const u of ids.users) {
    await prisma.userPermission.deleteMany({ where: { userId: u } });
    await prisma.session.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { userId: u } });
    await prisma.user.delete({ where: { id: u } }).catch(() => undefined);
  }
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
