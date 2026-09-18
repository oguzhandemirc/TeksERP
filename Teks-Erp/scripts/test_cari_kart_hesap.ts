// =============================================================================
// BEKÇİ — CARİ KART ↔ HESAP BİRLEŞİMİ Z-A (karar A: terimler hesapta, hesap kartla 1:1 doğar) — 2026-09-18
// =============================================================================
//   §0 statik — `customer.service` finans grafına STATİK bağlanmaz (köprü dinamik import) · `paymentTermDays`
//      okuyucuları KAPALI küme (kartta kolon yok, tek kaynak `CariAccount`) · `POST /finance/cari` 400 kodu
//   §1 DOĞUŞ: finans AÇIK → kart yaratımında hesap DOĞAR (1 hesap, `kind` CUSTOMER, `createdAt` kartla aynı tx penceresi);
//      fason profilli kart da; finans KAPALI → hesap YAZILMAZ (bugünkü davranış bayt bayt)
//   §2 GÖÇ `migrate_cari_accounts_backfill`: ölçüm hesapsız aktif kartı listeler, pasifi saymaz; `--apply` hesap açar;
//      ikinci koşum 0 (idempotent); dry-run yazmaz; `_test` dışı hedefe `--apply` `--canli-onay`sız ⛔ (çıkış 2, DB'ye
//      dokunmadan); finans kapalıyken `--apply` ⛔
//   §3 LİSTE: `filter[hasActivity]=true` boş hesabı dışlar, hareketli hesabı içerir; süzgeçsiz hepsi; `filter[customerId]`
//   §4 KART → HESAP tek yol: `resolveCariAccountByCustomerTx` + `GET /finance/cari/by-customer/:id` 200 (terimler);
//      hesapsız kart 404 `CARI_ACCOUNT_MISSING` (YARATMAZ); eski fason bacağına bağlı hesap karttan çözülür
//   §5 KART FORMU "Finans" (HTTP): `finance` alt nesnesi `finance:write`siz 403 PERMISSION_DENIED(required finance:write);
//      modül kapalı 403 MODULE_DISABLED; yetkili → terimler hesaba yazılır (POST + PATCH), yanıt `cariAccountId`;
//      GET `finance:read` OPT-IN: yetkisiz DTO'da alan YOK, yetkili `finance{...}` + `cariAccountId`; Zod bilinmeyen alan 400
//   §6 `POST /finance/cari` → 400 CARI_ACCOUNT_BORN_WITH_CARD (elle hesap açma yolu kapandı)
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-18): ① `bornCariAccountTx` sabit null → §1a/§1b/§1c ❌ (sonrası zincirleme çöker — kırmızı yine kırmızı) · ② `takeFinanceSub` izin kapısı
//    kaldırıldı → §5a ❌ · ③ `resolveCariAccountByCustomerTx` fason bacağı (`subcontractor: { customerId }`) düşürüldü → §4c ❌
//    · ④ backfill `yazmaEngeli` `_test` kapısı kaldırıldı → §2e ❌.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. `finance.enabled` fotoğrafa döner; temizlik yalnız `temizle`.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { CariTxnSource, Currency, Prisma } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { cocukOrtami, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { cariService } from "../src/services/cari.service";
import { resolveCariAccountByCustomerTx } from "../src/services/helpers/finance.helper";
import { backfillOlc, backfillUygula } from "./migrate_cari_accounts_backfill";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
async function beklenenHata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
}
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");
const ROOT = path.resolve(__dirname, "..");
const TAG = `TEST-CKH-${process.pid}`;
const FIN = SETTING_KEYS.FINANCE_ENABLED;
type Resp = { status: number; body: { message?: string; details?: Record<string, unknown>; data?: Record<string, unknown> } };

function statik(): void {
  console.log("── §0 Statik ──");
  const cs = readFileSync(path.join(ROOT, "src/services/customer.service.ts"), "utf8");
  check("§0a customer.service finans grafına STATİK bağlanmaz (finance.helper / cari.service importu yok; köprü dinamik)", !/from "\.\/helpers\/finance\.helper"/.test(cs) && !/from "\.\/cari\.service"/.test(cs) && /customer-finance-bridge\.helper/.test(cs));
  const bridge = readFileSync(path.join(ROOT, "src/services/helpers/customer-finance-bridge.helper.ts"), "utf8");
  check("§0b köprü: hesap doğuşu `readFinanceEnabled(tx)` kapısının ARKASINDA ve `ensureCariAccountTx` dinamik import", /if \(!\(await readFinanceEnabled\(tx\)\)\) return null;/.test(bridge) && /await import\("\.\/finance\.helper"\)/.test(bridge));
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
  const customerModel = schema.slice(schema.indexOf("model Customer {"), schema.indexOf("\n}", schema.indexOf("model Customer {")));
  check("§0c terimler TEK kaynak: `Customer` modelinde paymentTermDays/defaultCurrency/taxOffice/riskLimit YOK (B yolu reddi)", !/paymentTermDays|defaultCurrency|riskLimit|taxOffice/.test(customerModel));
  const okuyucular = spawnSync("grep", ["-rl", "paymentTermDays", path.join(ROOT, "src")], { encoding: "utf8" }).stdout.trim().split("\n").map((f) => path.relative(ROOT, f)).sort();
  const beklenen = ["src/routes/customer.routes.ts", "src/routes/finance.routes.ts", "src/services/cari.service.ts", "src/services/helpers/customer-finance-bridge.helper.ts", "src/services/helpers/finance.helper.ts", "src/services/helpers/shipment-auto-draft.helper.ts", "src/services/invoice.service.ts", "src/services/reports/finance-aging.report.ts"];
  check("§0d `paymentTermDays` okuyan dosya kümesi KAPALI (yeni okuyucu = beyan)", JSON.stringify(okuyucular) === JSON.stringify(beklenen), okuyucular.join(","));
  const fr = readFileSync(path.join(ROOT, "src/routes/finance.routes.ts"), "utf8");
  check("§0e `POST /finance/cari` 400 CARI_ACCOUNT_BORN_WITH_CARD (şema yine doğrulanır)", /cariCreateSchema\.parse\(req\.body\);\s*\n\s*throw AppError\.badRequest\([\s\S]{0,400}?CARI_ACCOUNT_BORN_WITH_CARD/.test(fr));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== CARİ KART ↔ HESAP BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: FIN }, select: { key: true, value: true } });
  const setFin = (v: boolean) => prisma.systemSetting.upsert({ where: { key: FIN }, create: { key: FIN, value: v }, update: { value: v } });
  const admin = await ensureTestAdmin();
  const ids = { customers: [] as string[], users: [] as string[], subs: [] as string[] };
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token: string | null, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let parsed: Resp["body"] = {};
    try { parsed = (await r.json()) as Resp["body"]; } catch { /* boş gövde */ }
    return { status: r.status, body: parsed };
  };
  const login = async (u: string, p: string): Promise<string> => {
    const r = await call("POST", "/api/auth/login", null, { username: u, password: p });
    const t = (r.body as { data?: { token?: string } }).data?.token;
    if (!t) throw new Error(`login başarısız: ${u} (${r.status})`);
    return t;
  };
  const kartAc = (ek: Record<string, unknown> = {}) => customerService.create({ name: `${TAG} ${Math.random().toString(36).slice(2, 7)}`, isCustomerRole: true, ...ek }, admin.id) as Promise<{ data: { id: string; cariAccountId?: string | null } }>;
  const hesap = (customerId: string) => prisma.cariAccount.findMany({ where: { customerId }, select: { id: true, kind: true, createdAt: true, paymentTermDays: true, defaultCurrency: true, taxOffice: true } });

  try {
    console.log("\n── §1 Doğuş ──");
    await setFin(true);
    const k1 = await kartAc();
    ids.customers.push(k1.data.id);
    const h1 = await hesap(k1.data.id);
    const kart1 = await prisma.customer.findUniqueOrThrow({ where: { id: k1.data.id }, select: { createdAt: true } });
    check("§1a ⭐ finans AÇIK: kart yaratılınca hesap DOĞDU — tek hesap, kind CUSTOMER, yanıt `cariAccountId`", h1.length === 1 && h1[0]!.kind === "CUSTOMER" && k1.data.cariAccountId === h1[0]!.id);
    check("§1b hesap kartla aynı tx penceresinde (createdAt farkı < 2 s), terimler varsayılan (vade null, TRY)", h1.length === 1 && Math.abs(h1[0]!.createdAt.getTime() - kart1.createdAt.getTime()) < 2000 && h1[0]!.paymentTermDays === null && h1[0]!.defaultCurrency === "TRY");
    const k2 = await kartAc({ isSupplierRole: true, subcontractorRole: true });
    ids.customers.push(k2.data.id);
    const prof = await prisma.subcontractor.findUnique({ where: { customerId: k2.data.id }, select: { id: true } });
    if (prof) ids.subs.push(prof.id);
    check("§1c fason profilli kart: profil + hesap aynı tx'te (hesap 1)", !!prof && (await hesap(k2.data.id)).length === 1);
    await setFin(false);
    const k3 = await kartAc();
    ids.customers.push(k3.data.id);
    check("§1d ⭐ finans KAPALI: kart doğar, hesap YAZILMAZ (bugünkü davranış), yanıt cariAccountId null", (await hesap(k3.data.id)).length === 0 && k3.data.cariAccountId === null);

    console.log("\n── §2 Göç ──");
    const k4 = await kartAc();
    ids.customers.push(k4.data.id);
    await prisma.customer.update({ where: { id: k4.data.id }, data: { isActive: false } });
    await setFin(true);
    const o1 = await backfillOlc();
    check("§2a ölçüm: hesapsız AKTİF kart listede (k3), PASİF (k4) listede DEĞİL ama sayıldı", o1.hesapsizAktif.some((k) => k.id === k3.data.id) && !o1.hesapsizAktif.some((k) => k.id === k4.data.id) && o1.hesapsizPasif >= 1);
    check("§2b ölçüm yazmaz (dry-run zemini): k3 hâlâ hesapsız", (await hesap(k3.data.id)).length === 0);
    const acilan = await backfillUygula(o1.hesapsizAktif.filter((k) => k.id === k3.data.id));
    check("§2c `--apply`: k3'e hesap açıldı (tek kapı `ensureCariAccountTx`)", acilan === 1 && (await hesap(k3.data.id)).length === 1);
    const o2 = await backfillOlc();
    check("§2d idempotent: ikinci ölçümde k3 yok; k4 pasif yine dokunulmadı", !o2.hesapsizAktif.some((k) => k.id === k3.data.id) && (await hesap(k4.data.id)).length === 0);
    const sahte = spawnSync(process.execPath, [path.join(ROOT, "node_modules/.bin/tsx"), path.join(ROOT, "scripts/migrate_cari_accounts_backfill.ts"), "--apply"], { encoding: "utf8", env: cocukOrtami({ DATABASE_URL: "postgresql://bekci@127.0.0.1:1/tekserp_sahte_canli?schema=public" }), timeout: 60_000 });
    check("§2e ⭐ `_test` dışı hedef + `--apply` `--canli-onay`sız → ⛔ çıkış 2 (DB'ye bağlanmadan)", sahte.status === 2 && /--canli-onay/.test(sahte.stdout), `${sahte.status} ${sahte.stdout.trim().slice(0, 120)}`);
    const kapali = spawnSync(process.execPath, [path.join(ROOT, "node_modules/.bin/tsx"), path.join(ROOT, "scripts/migrate_cari_accounts_backfill.ts")], { encoding: "utf8", env: cocukOrtami({}), timeout: 120_000 });
    check("§2f dry-run çıkış 0, 'hiçbir şey yazılmadı' der, hedef DB adını basar", kapali.status === 0 && /hiçbir şey yazılmadı/.test(kapali.stdout) && /hedef tekserp_/.test(kapali.stdout), `${kapali.status}`);

    console.log("\n── §3 Liste süzgeci ──");
    const acc1 = (await hesap(k1.data.id))[0]!;
    await prisma.cariTransaction.create({ data: { cariId: acc1.id, currency: Currency.TRY, txnDate: new Date(), debit: 10, sourceType: CariTxnSource.ADJUSTMENT, description: `${TAG} hareket` } });
    const hareketli = await cariService.list({ hasActivity: true, customerId: { in: [k1.data.id, k2.data.id] }, pageSize: 50 });
    const hepsi = await cariService.list({ customerId: { in: [k1.data.id, k2.data.id] }, pageSize: 50 });
    check("§3a `hasActivity` → yalnız hareketli (k1); süzgeçsiz ikisi de (eski panel aynen); `customerId` süzgeci", hareketli.data.length === 1 && hareketli.data[0]!.id === acc1.id && hepsi.data.length === 2, `${hareketli.data.length}/${hepsi.data.length}`);

    console.log("\n── §4 Kart → hesap tek yol ──");
    check("§4a resolve: k1 → hesabı", (await resolveCariAccountByCustomerTx(prisma, k1.data.id))?.id === acc1.id);
    const by = await cariService.findByCustomer(k1.data.id);
    check("§4b by-customer 200: terimler + roller taşır", by.data.id === acc1.id && "paymentTermDays" in by.data && by.data.roles?.isCustomerRole === true);
    const k5 = await kartAc({ isSupplierRole: true });
    ids.customers.push(k5.data.id);
    await prisma.cariAccount.deleteMany({ where: { customerId: k5.data.id } });
    const sub5 = await prisma.subcontractor.create({ data: { code: `${TAG}-SUB5`, name: `${TAG} eski fason`, customerId: k5.data.id }, select: { id: true } });
    ids.subs.push(sub5.id);
    const legacy = await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: sub5.id }, select: { id: true } });
    check("§4c ⭐ eski fason bacağına bağlı hesap KARTTAN çözülür (profil.customerId üstünden)", (await resolveCariAccountByCustomerTx(prisma, k5.data.id))?.id === legacy.id && (await cariService.findByCustomer(k5.data.id)).data.id === legacy.id);
    await setFin(false);
    const k6 = await kartAc();
    ids.customers.push(k6.data.id);
    await setFin(true);
    const e4d = await beklenenHata(() => cariService.findByCustomer(k6.data.id));
    check("§4d hesapsız kart → 404 CARI_ACCOUNT_MISSING, YARATMAZ", e4d?.statusCode === 404 && kod(e4d) === "CARI_ACCOUNT_MISSING" && (await hesap(k6.data.id)).length === 0);

    console.log("\n── §5 Kart formu Finans (HTTP) ──");
    const adminTok = await login(admin.username, admin.password);
    const opUser = await prisma.user.create({ data: { username: `${TAG}-op`.toLowerCase(), fullName: `${TAG} operasyon`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
    ids.users.push(opUser.id);
    const perms = await prisma.permission.findMany({ where: { code: { in: ["customer:read", "customer:write"] } }, select: { id: true } });
    await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: opUser.id, permissionId: p.id })) });
    const opTok = await login(`${TAG}-op`.toLowerCase(), "test123456");
    const r5a = await call("PATCH", `/api/customers/${k1.data.id}`, opTok, { finance: { paymentTermDays: 30 } });
    check("§5a ⭐ `finance` alt nesnesi finance:write'sız → 403 PERMISSION_DENIED required finance:write; vade YAZILMADI", r5a.status === 403 && r5a.body.details?.code === "PERMISSION_DENIED" && r5a.body.details?.required === "finance:write" && (await hesap(k1.data.id))[0]!.paymentTermDays === null, `${r5a.status} ${JSON.stringify(r5a.body.details)}`);
    const r5b = await call("PATCH", `/api/customers/${k1.data.id}`, opTok, { notes: `${TAG} not` });
    check("§5b aynı kullanıcı `finance`siz PATCH → 200 (kart formunun geri kalanı değişmez)", r5b.status === 200);
    await setFin(false);
    const r5c = await call("PATCH", `/api/customers/${k1.data.id}`, adminTok, { finance: { paymentTermDays: 30 } });
    check("§5c modül KAPALI → 403 MODULE_DISABLED modul finance", r5c.status === 403 && r5c.body.details?.code === "MODULE_DISABLED" && r5c.body.details?.modul === "finance");
    await setFin(true);
    const r5d = await call("PATCH", `/api/customers/${k1.data.id}`, adminTok, { finance: { paymentTermDays: 45, defaultCurrency: "USD", taxOffice: "Kadıköy", riskLimit: "1500.50" } });
    const h5 = (await hesap(k1.data.id))[0]!;
    check("§5d ⭐ yetkili PATCH: terimler HESABA yazıldı (45 gün · USD · Kadıköy), yanıt cariAccountId", r5d.status === 200 && r5d.body.data?.cariAccountId === acc1.id && h5.paymentTermDays === 45 && h5.defaultCurrency === "USD" && h5.taxOffice === "Kadıköy", `${r5d.status} ${JSON.stringify(h5)}`);
    const r5e = await call("POST", "/api/customers", adminTok, { name: `${TAG} post-finans`, isCustomerRole: true, finance: { paymentTermDays: 15 } });
    const k7 = r5e.body.data?.id as string | undefined;
    if (k7) ids.customers.push(k7);
    check("§5e POST kart + `finance`: kart, hesap ve vade 15 tek kaydette", r5e.status === 201 && !!k7 && (await hesap(k7!))[0]?.paymentTermDays === 15, `${r5e.status}`);
    const g5f = await call("GET", `/api/customers/${k1.data.id}`, opTok);
    const g5g = await call("GET", `/api/customers/${k1.data.id}`, adminTok);
    check("§5f GET opt-in: finance:read YOKSA DTO'da `finance`/`cariAccountId` YOK", g5f.status === 200 && !("finance" in (g5f.body.data ?? {})) && !("cariAccountId" in (g5f.body.data ?? {})));
    check("§5g GET finance:read VARSA `finance{paymentTermDays 45, USD}` + `cariAccountId`", g5g.status === 200 && (g5g.body.data?.finance as { paymentTermDays?: number; defaultCurrency?: string } | undefined)?.paymentTermDays === 45 && g5g.body.data?.cariAccountId === acc1.id);
    const r5h = await call("PATCH", `/api/customers/${k1.data.id}`, adminTok, { finance: { paymentTermDays: 45, bilinmeyen: 1 } });
    check("§5h Zod strict: bilinmeyen alan 400 (sessiz düşüş yok)", r5h.status === 400);

    console.log("\n── §6 Elle hesap açma kapandı ──");
    const r6 = await call("POST", "/api/finance/cari", adminTok, { customerId: k6.data.id });
    check("§6a POST /finance/cari → 400 CARI_ACCOUNT_BORN_WITH_CARD; hesap doğmadı", r6.status === 400 && r6.body.details?.code === "CARI_ACCOUNT_BORN_WITH_CARD" && (await hesap(k6.data.id)).length === 0, `${r6.status}`);
  } finally {
    server.close();
    await temizle(ids, foto);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(ids: { customers: string[]; users: string[]; subs: string[] }, foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  const accs = await prisma.cariAccount.findMany({ where: { OR: [{ customerId: { in: ids.customers } }, { subcontractorId: { in: ids.subs } }] }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariAccount.deleteMany({ where: { id: { in: accIds } } });
  await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids.customers } } });
  for (const u of ids.users) {
    await prisma.userPermission.deleteMany({ where: { userId: u } });
    await prisma.session.deleteMany({ where: { userId: u } }).catch(() => undefined);
    await prisma.systemLog.deleteMany({ where: { userId: u } });
    await prisma.user.delete({ where: { id: u } }).catch(() => undefined);
  }
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...ids.customers, ...accIds, ...ids.subs] } } });
  const eski = foto.find((f) => f.key === FIN);
  if (eski) await prisma.systemSetting.upsert({ where: { key: FIN }, create: { key: FIN, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
  else await prisma.systemSetting.deleteMany({ where: { key: FIN } });
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
