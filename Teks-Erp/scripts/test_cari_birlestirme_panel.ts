// =============================================================================
// BEKÇİ — CARİ BİRLEŞTİRME PANEL UÇLARI (D4-K3e, kullanıcı kararı 2026-11-01)
// =============================================================================
// Çekirdek `helpers/cari-merge.helper` (betik `fix_cari_cift_hesap` ile ortak); burada HTTP yüzeyi ölçülür:
//   §1 ön izleme kaynağın HER açık kalemini listeler (fatura başına satır, döviz başına bakiye), damga verir, yazmaz;
//      aday listesi aynı kartın öbür hesabını önerilen yönle döner
//   §2 uygula (HTTP) ↔ betik yolu (`applyCariMerge` çıplak çağrı) aynı fikstürde AYNI defter satırlarını yazar
//   §3 aynı clientToken → replay (yazım yok) · başka çift + aynı token → 409 CLIENT_TOKEN_COLLISION ·
//      geri alınmış birleşmenin replay'i → 409 CARI_MERGE_REVERTED (4. durum)
//   §4 ön izlemeden sonra kayıt değişti → 409 CARI_MERGE_STALE, sıfır yazım
//   §5 `finance:cari-merge`siz aday/ön izleme/uygula → 403
//   §6 kendisine başka hesap birleşmiş hesap kaynak olamaz → ön izlemede engel + uygula 409 CARI_MERGE_BLOCKED;
//      kaynak = hedef → engel
// ⭐ NEGATİF SONDA: bkz. BEKCI-HARITASI satırı.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; temizlik `finally`de.
// =============================================================================
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Currency, Prisma } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { invoiceService } from "../src/services/invoice.service";
import { applyCariMerge } from "../src/services/helpers/cari-merge.helper";
import { revertCariMerge } from "../src/services/helpers/cari-merge-revert.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
const TAG = `TEST-CBP-${process.pid}`;
const DAY = 86_400_000;
// Tek zaman tabanı: iki fikstürün vadeleri milisaniyesine eşit olsun (defter karşılaştırması).
const T0 = Date.now();
const at = (d: number): Date => new Date(T0 + d * DAY);
const ids = { customers: [] as string[], subs: [] as string[], invoices: [] as string[], users: [] as string[] };
type Resp = { status: number; body: { message?: string; details?: Record<string, unknown>; data?: unknown } };
interface Pair { card: string; sub: string; source: string; target: string; invoices: string[] }

async function sales(party: { customerId?: string; subcontractorId?: string }, amount: number, issue: Date, due: Date | null, currency: Currency = "TRY"): Promise<string> {
  const d = await invoiceService.createDraft({
    type: "SALES", ...party, currency, exchangeRate: currency === "TRY" ? null : 30, issueDate: issue, dueDate: due,
    lines: [{ description: "Bekçi kalemi", qty: 1, unit: "m", unitPrice: amount }],
  } as Parameters<typeof invoiceService.createDraft>[0]);
  ids.invoices.push(d.data.id);
  await invoiceService.confirm(d.data.id);
  return d.data.id;
}

/** K3a öncesi çift: kaynak eski fason bacağı (faturalar ona), hedef kartın kendi hesabı. `withDebt` = açık kalemli. */
async function pair(n: number, withDebt: boolean): Promise<Pair> {
  const card = (await prisma.customer.create({ data: { code: `${TAG}-K${n}`, name: `${TAG} kart ${n}` }, select: { id: true } })).id;
  ids.customers.push(card);
  const sub = (await prisma.subcontractor.create({ data: { code: `${TAG}-F${n}`, name: `${TAG} fason ${n}` }, select: { id: true } })).id;
  ids.subs.push(sub);
  const invoices: string[] = [];
  if (withDebt) {
    invoices.push(await sales({ subcontractorId: sub }, 1000, at(-45), at(-15)));
    invoices.push(await sales({ subcontractorId: sub }, 500, at(-5), at(25)));
    invoices.push(await sales({ subcontractorId: sub }, 200, at(-10), at(-2), "USD"));
  }
  const src = await prisma.cariAccount.findUnique({ where: { subcontractorId: sub }, select: { id: true } });
  const source = src?.id ?? (await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: sub }, select: { id: true } })).id;
  await prisma.subcontractor.update({ where: { id: sub }, data: { customerId: card } });
  const target = (await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: card }, select: { id: true } })).id;
  if (withDebt) await sales({ customerId: card }, 700, at(-3), at(10));
  return { card, sub, source, target, invoices };
}

/** Virman bacakları — kimlik/zaman/aktör dışı her alan; hesap → S/T, fatura → fikstür sırası, etiket → yer tutucu. */
async function normalizedLegs(p: Pair): Promise<string> {
  const legs = await prisma.cariTransaction.findMany({
    where: { cariId: { in: [p.source, p.target] }, sourceType: "CARI_TRANSFER" },
    select: { cariId: true, currency: true, debit: true, credit: true, amountTry: true, exchangeRate: true, invoiceId: true, dueDate: true, description: true, reversesTxnId: true },
  });
  const docs = await prisma.invoice.findMany({ where: { id: { in: p.invoices } }, select: { id: true, docNo: true } });
  const labels = await prisma.cariAccount.findMany({ where: { id: { in: [p.source, p.target] } }, select: { id: true, customer: { select: { code: true, name: true } }, subcontractor: { select: { code: true, name: true } } } });
  const norm = (s: string | null): string => {
    let out = s ?? "";
    for (const l of labels) {
      const q = l.customer ?? l.subcontractor;
      if (q) out = out.split(`${q.code} ${q.name}`).join(l.id === p.source ? "<S>" : "<T>");
    }
    for (const d of docs) if (d.docNo) out = out.split(d.docNo).join(`<F${p.invoices.indexOf(d.id)}>`);
    return out;
  };
  const rows = legs.map((l) => JSON.stringify([l.cariId === p.source ? "S" : "T", l.currency, l.debit.toFixed(2), l.credit.toFixed(2), l.amountTry.toFixed(2), l.exchangeRate.toString(), l.invoiceId ? p.invoices.indexOf(l.invoiceId) : null, l.dueDate?.toISOString() ?? null, norm(l.description), l.reversesTxnId != null]));
  return rows.sort().join("\n");
}
const balances = async (cariId: string): Promise<string> => {
  const rows = await prisma.cariBalance.findMany({ where: { cariId }, select: { currency: true, balance: true }, orderBy: { currency: "asc" } });
  return JSON.stringify(rows.filter((r) => !new Prisma.Decimal(r.balance).isZero()).map((r) => [r.currency, new Prisma.Decimal(r.balance).toFixed(2)]));
};
const transferCount = (p: Pair): Promise<number> => prisma.cariTransaction.count({ where: { cariId: { in: [p.source, p.target] }, sourceType: "CARI_TRANSFER" } });

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== Cari birleştirme panel uçları bekçisi ===\n");
  const KEY = SETTING_KEYS.FINANCE_ENABLED;
  const foto = await prisma.systemSetting.findUnique({ where: { key: KEY }, select: { value: true } });
  await prisma.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: true }, update: { value: true } });
  await ensureTestAdmin();
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
  const user = async (ek: string, perms: string[]): Promise<string> => {
    const username = `${TAG}-${ek}`.toLowerCase();
    const u = await prisma.user.create({ data: { username, fullName: `${TAG} ${ek}`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
    ids.users.push(u.id);
    const rows = await prisma.permission.findMany({ where: { code: { in: perms } }, select: { id: true } });
    if (rows.length) await prisma.userPermission.createMany({ data: rows.map((p) => ({ userId: u.id, permissionId: p.id })) });
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password: "test123456" }) });
    const t = ((await r.json()) as { data?: { token?: string } }).data?.token;
    if (!t) throw new Error(`login başarısız: ${username}`);
    return t;
  };
  const code = (r: Resp): string => String(r.body.details?.code ?? r.status);
  const previewOf = (p: Pick<Pair, "source" | "target">, token: string) => call("GET", `/api/finance/cari/merge/preview?sourceId=${p.source}&targetId=${p.target}`, token);

  try {
    const acc = await user("muhasebe", ["finance:read", "finance:cari-merge"]);
    const reader = await user("okur", ["finance:read", "finance:write"]);
    const A = await pair(1, true);
    const B = await pair(2, true);
    const C = await pair(3, true);
    const Dp = await pair(4, false);

    console.log("── §1 ön izleme + adaylar ──");
    const n0 = await transferCount(B);
    const r1 = await previewOf(B, acc);
    const pv = r1.body.data as { items: Array<{ invoiceId: string | null; currency: string; signedAmount: string; dueDate: string | null }>; balances: Array<{ currency: string; source: string }>; blockers: string[]; stamp: string } | undefined;
    const listed = new Set((pv?.items ?? []).map((i) => i.invoiceId));
    check("§1a ön izleme 200, engel yok", r1.status === 200 && pv?.blockers.length === 0, `${r1.status} ${JSON.stringify(pv?.blockers ?? r1.body.message)}`);
    check("§1b ⭐ kaynağın HER açık faturası ayrı satır (3 fatura · 3 satır)", B.invoices.every((i) => listed.has(i)) && pv?.items.length === 3, `${pv?.items.length}`);
    check("§1c döviz başına bakiye (TRY 1500 · USD 200) + vade satırda", JSON.stringify(pv?.balances.map((b) => [b.currency, b.source])) === JSON.stringify([["TRY", "1500.00"], ["USD", "200.00"]]) && (pv?.items ?? []).every((i) => i.dueDate != null), JSON.stringify(pv?.balances));
    check("§1d damga 32 hex ve ön izleme yazmaz", /^[0-9a-f]{32}$/.test(pv?.stamp ?? "") && (await transferCount(B)) === n0);
    const rc = await call("GET", `/api/finance/cari/${B.target}/merge-candidates`, acc);
    const cands = (rc.body.data as Array<{ id: string; sourceId: string; targetId: string }> | undefined) ?? [];
    const fromSource = ((await call("GET", `/api/finance/cari/${B.source}/merge-candidates`, acc)).body.data as Array<{ id: string; sourceId: string; targetId: string }> | undefined) ?? [];
    check("§1e adaylar: kart hesabından eski bacak, eski bacaktan kart hesabı — yön ikisinde de bacak → kart", cands.some((c) => c.id === B.source && c.sourceId === B.source && c.targetId === B.target) && fromSource.some((c) => c.id === B.target && c.sourceId === B.source && c.targetId === B.target), `${rc.status} ${cands.length}/${fromSource.length}`);

    console.log("\n── §2 HTTP ↔ betik yolu aynı defter ──");
    const tokenB = randomUUID();
    await applyCariMerge(A.source, A.target); // betiğin çağrı biçimi (`fix_cari_cift_hesap.ciftUygula`)
    const r2 = await call("POST", "/api/finance/cari/merge", acc, { sourceId: B.source, targetId: B.target, stamp: pv?.stamp, clientToken: tokenB });
    const res2 = r2.body.data as { alreadyMerged: boolean; legs: number; transferGroupId: string } | undefined;
    check("§2a uygula 200, 6 bacak, grup = clientToken", r2.status === 200 && res2?.alreadyMerged === false && res2.legs === 6 && res2.transferGroupId === tokenB, `${r2.status} ${r2.body.message ?? ""} ${JSON.stringify(res2)}`);
    const legsA = await normalizedLegs(A);
    const legsB = await normalizedLegs(B);
    check("§2b ⭐ iki yolun virman bacakları bayt-eşit (hesap/tutar/kur/vade/fatura/açıklama)", legsA.length > 0 && legsA === legsB, legsA === legsB ? "" : `\nA:\n${legsA}\nB:\n${legsB}`);
    check("§2c iki yolda kaynak sıfır, hedef bakiyeleri eşit", (await balances(A.source)) === "[]" && (await balances(B.source)) === "[]" && (await balances(A.target)) === (await balances(B.target)), `${await balances(A.target)} ↔ ${await balances(B.target)}`);

    console.log("\n── §3 clientToken replay ──");
    const n3 = await transferCount(B);
    const r3 = await call("POST", "/api/finance/cari/merge", acc, { sourceId: B.source, targetId: B.target, stamp: pv?.stamp, clientToken: tokenB });
    check("§3a ⭐ aynı token → 200 (replay ya da durum üzerinden idempotent), yeni bacak yok", r3.status === 200 && (r3.body.data as { alreadyMerged?: boolean } | undefined)?.alreadyMerged === true && (await transferCount(B)) === n3, `${r3.status} ${code(r3)} ${n3}→${await transferCount(B)}`);
    const pvC = (await previewOf(C, acc)).body.data as { stamp: string } | undefined;
    const r3b = await call("POST", "/api/finance/cari/merge", acc, { sourceId: C.source, targetId: C.target, stamp: pvC?.stamp, clientToken: tokenB });
    check("§3b aynı token + başka çift → 409 CLIENT_TOKEN_COLLISION, C'ye yazım yok", r3b.status === 409 && code(r3b) === "CLIENT_TOKEN_COLLISION" && (await transferCount(C)) === 0, `${r3b.status} ${code(r3b)}`);

    console.log("\n── §4 bayat ön izleme ──");
    await sales({ subcontractorId: C.sub }, 300, at(-1), at(30));
    const r4 = await call("POST", "/api/finance/cari/merge", acc, { sourceId: C.source, targetId: C.target, stamp: pvC?.stamp, clientToken: randomUUID() });
    const cAcc = await prisma.cariAccount.findUniqueOrThrow({ where: { id: C.source }, select: { isActive: true, mergedIntoId: true } });
    check("§4 ⭐ ön izlemeden sonra fatura eklendi → 409 CARI_MERGE_STALE, sıfır yazım", r4.status === 409 && code(r4) === "CARI_MERGE_STALE" && cAcc.isActive && !cAcc.mergedIntoId && (await transferCount(C)) === 0, `${r4.status} ${code(r4)}`);

    console.log("\n── §5 izin ──");
    const r5a = await previewOf(C, reader);
    const r5b = await call("POST", "/api/finance/cari/merge", reader, { sourceId: C.source, targetId: C.target, stamp: pvC?.stamp, clientToken: randomUUID() });
    const r5c = await call("GET", `/api/finance/cari/${C.source}/merge-candidates`, reader);
    check("§5 ⭐ finance:cari-merge'siz ön izleme/uygula/aday → 403", r5a.status === 403 && r5b.status === 403 && r5c.status === 403, `${r5a.status} ${r5b.status} ${r5c.status}`);

    console.log("\n── §6 engeller ──");
    const zCard = (await prisma.customer.create({ data: { code: `${TAG}-Z`, name: `${TAG} birleşmiş` }, select: { id: true } })).id;
    ids.customers.push(zCard);
    await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: zCard, isActive: false, mergedIntoId: Dp.source } });
    const r6 = await previewOf(Dp, acc);
    const b6 = (r6.body.data as { blockers?: string[] } | undefined)?.blockers ?? [];
    check("§6a ⭐ kendisine hesap birleşmiş kaynak → ön izlemede engel", r6.status === 200 && b6.some((b) => b.includes("Kaynak hesaba daha önce")), JSON.stringify(b6));
    const r6b = await call("POST", "/api/finance/cari/merge", acc, { sourceId: Dp.source, targetId: Dp.target, stamp: (r6.body.data as { stamp?: string } | undefined)?.stamp, clientToken: randomUUID() });
    const dAcc = await prisma.cariAccount.findUniqueOrThrow({ where: { id: Dp.source }, select: { isActive: true, mergedIntoId: true } });
    check("§6b uygula → 409 CARI_MERGE_BLOCKED, kaynak dokunulmadı", r6b.status === 409 && code(r6b) === "CARI_MERGE_BLOCKED" && dAcc.isActive && !dAcc.mergedIntoId, `${r6b.status} ${code(r6b)}`);
    const r6c = await previewOf({ source: Dp.target, target: Dp.target }, acc);
    check("§6c kaynak = hedef → engel", ((r6c.body.data as { blockers?: string[] } | undefined)?.blockers ?? []).some((b) => b.includes("aynı hesap")), `${r6c.status}`);
    const r6d = await call("GET", "/api/finance/cari/merge/preview?sourceId=yok&targetId=yok", acc);
    check("§6d geçersiz kimlik → 400", r6d.status === 400, `${r6d.status}`);

    console.log("\n── §3c geri alınmış birleşmenin replay'i ──");
    await revertCariMerge(B.source, `${TAG} geri alma`);
    const r3c = await call("POST", "/api/finance/cari/merge", acc, { sourceId: B.source, targetId: B.target, stamp: pv?.stamp, clientToken: tokenB });
    check("§3c ⭐ geri alınmış birleşme + aynı token → 409 CARI_MERGE_REVERTED", r3c.status === 409 && code(r3c) === "CARI_MERGE_REVERTED", `${r3c.status} ${code(r3c)}`);
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
  const accs = await prisma.cariAccount.findMany({ where: { OR: [{ customerId: { in: ids.customers } }, { subcontractorId: { in: ids.subs } }] }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds }, reversesTxnId: { not: null } } });
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: ids.invoices } } });
  await prisma.invoice.deleteMany({ where: { id: { in: ids.invoices } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.updateMany({ where: { id: { in: accIds } }, data: { mergedIntoId: null } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...accIds, ...ids.invoices] } } });
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
