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
//   §7 KART FORMU hizmet faturası tetiği (H8b, K2b): `finance.serviceBillingTrigger` Finans → Cari diyaloğuyla AYNI yol
//      (`cariService.update`): yazılan tetik sevk/dönem çözücüsünde etkin; GET kart + `by-customer` aynı değeri gösterir;
//      geçersiz değer 400 SERVICE_BILLING_TRIGGER_INVALID Türkçe, yazmaz; audit CARI_ACCOUNT satırı; null = fabrika ayarı;
//      fason hesabında 400 SERVICE_BILLING_TRIGGER_NOT_CUSTOMER korunur
//   §8 (K3a) CARİ TEK KİMLİK: eski fason bacağı hesabı olan kartta yazım hesap sayısını 1 tutar (hesap kartın hesabına
//      çevrilir), okuma aynı hesabı döner; hesapsız kartta ilk yazım tek hesap; eşzamanlı ilk yazım tek hesap; tek fabrika
//      · kart hesabı PASİF + eski bacak aktif → yazım 409 (pasiflik eski bacağa kaçarak aşılmaz) · çevirmenin audit'i
//      commit SONRASI ve aktörlü; geri alınan tx iz bırakmaz
//   §9 onarım `fix_cari_cift_hesap`: dry-run listeler, hareketsiz ikinciyi kapatır, ENGELLİ hareketli çiftte DURUR, engelsiz
//      hareketli çifti virmanla birleştirir (§9h, K3d); pasif kart
//      hesabı + aktif eski bacak ayrı kategori (hareketsiz pasif kart hesabı silinir, eski bacak çevrilir)
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-09-18): ① `bornCariAccountTx` sabit null → §1a/§1b/§1c ❌ (sonrası zincirleme çöker — kırmızı yine kırmızı) · ② `takeFinanceSub` izin kapısı
//    kaldırıldı → §5a ❌ · ③ `resolveCariAccountByCustomerTx` fason bacağı (`subcontractor: { customerId }`) düşürüldü → §4c ❌
//    · ④ backfill `yazmaEngeli` `_test` kapısı kaldırıldı → §2e ❌.
//    · ⑥ (2026-10-29 K2b bitirici) `resolveCariAccountByCustomerTx` orderBy `nulls: "last"` kaldırıldı → §4c2 ❌.
//    · ⑤ (2026-10-29 K2b) `financeSubSchema`dan `serviceBillingTrigger` satırı silindi → §7a–§7e ❌ (strict şema 400).
//    · ⑦ (2026-10-30 K3a) ensure eski `{customerId}` aramasına döndü → §8a–§8c ❌ · ⑧ `skipDuplicates` kapalı → §8e ❌ (1/4)
//    · ⑨ onarımın hareket kapısı düştü → §9a/§9d/§9e/§9f ❌.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. `finance.enabled` fotoğrafa döner; temizlik yalnız `temizle`.
// =============================================================================
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { CariTxnSource, Currency, Prisma } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { cocukOrtami, hedefDbAdi, hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { cariService } from "../src/services/cari.service";
import { ensureCariAccountTx, findCariAccountIdByCustomer, resolveCariAccountByCustomerTx } from "../src/services/helpers/finance.helper";
import { resolveCustomerServiceBillingTrigger } from "../src/services/helpers/service-billing.helper";
import { backfillOlc, backfillUygula } from "./migrate_cari_accounts_backfill";
import { ciftOlc } from "./fix_cari_cift_hesap";
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
  // cloud-sync: patron bulutu projeksiyonu vade gününü hesap kartından SALT OKUR (terim yine tek kaynak).
  // MAL-4 teklif: başlığın KENDİ vade günü (teklife yazılan ticari koşul, kopya değil); cari terimi okumaz.
  // MAL-6 teklif belgesi: aynı teklif başlığı alanını basar (builder · renderer · sözleşme · örnek); cari terimi okumaz.
  const beklenen = ["src/cloud-sync/catalog-facts.ts", "src/cloud-sync/derived.ts", "src/routes/customer.routes.ts", "src/routes/finance.routes.ts", "src/services/cari.service.ts", "src/services/document-render/sales-quote.html.ts", "src/services/document-render/sample-data-commercial.ts", "src/services/document-template/sozlesme/sales-quote.ts", "src/services/helpers/cari-merge.helper.ts", "src/services/helpers/customer-finance-bridge.helper.ts", "src/services/helpers/finance.helper.ts", "src/services/helpers/shipment-auto-draft.helper.ts", "src/services/invoice.service.ts", "src/services/quote-documents.service.ts", "src/services/reports/finance-aging.report.ts", "src/services/sales-quote-transitions.service.ts", "src/services/sales-quote.service.ts"];
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
    // Hedef adı SABİT ÖNEK değil (`tekserp_`), script'in kendi türetmesiyle (`hedefDbAdi`) — CI DB'si `teks_ci` (koşum yeri farkı: yerelde yeşil, CI kırmızı).
    check("§2f dry-run çıkış 0, 'hiçbir şey yazılmadı' der, hedef DB adını basar", kapali.status === 0 && /hiçbir şey yazılmadı/.test(kapali.stdout) && kapali.stdout.includes(`hedef ${hedefDbAdi()}`), `${kapali.status} · ${hedefDbAdi()}`);

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
    // İki hesap birlikte (eski fason bacağı + yeni CUSTOMER): okuma, yazımın gittiği CUSTOMER hesabını seçer (NULLS LAST).
    const cust5 = await prisma.cariAccount.create({ data: { kind: "CUSTOMER", customerId: k5.data.id }, select: { id: true } });
    check("§4c2 ⭐ iki hesap birlikte → CUSTOMER hesabı (customerId dolu) çözülür, eski fason hesabı değil", (await resolveCariAccountByCustomerTx(prisma, k5.data.id))?.id === cust5.id);
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

    console.log("\n── §7 Kart formu hizmet faturası tetiği ──");
    const r7a = await call("PATCH", `/api/customers/${k1.data.id}`, adminTok, { finance: { serviceBillingTrigger: "PER_SHIPMENT" } });
    const eff7a = await resolveCustomerServiceBillingTrigger(k1.data.id, { trigger: "PERIOD_END" });
    check("§7a ⭐ kart formundan yazılan tetik hesaba yazıldı ve çözücüde etkin (fabrika PERIOD_END'i ezer, kaynak CUSTOMER)",
      r7a.status === 200 && eff7a.trigger === "PER_SHIPMENT" && eff7a.source === "CUSTOMER", `${r7a.status} ${JSON.stringify(eff7a)}`);
    const g7b = await call("GET", `/api/customers/${k1.data.id}`, adminTok);
    const by7b = await call("GET", `/api/finance/cari/by-customer/${k1.data.id}`, adminTok);
    check("§7b iki yüzey aynı değeri gösterir: kart GET `finance.serviceBillingTrigger` = Finans → Cari `by-customer`",
      (g7b.body.data?.finance as { serviceBillingTrigger?: string } | undefined)?.serviceBillingTrigger === "PER_SHIPMENT" && by7b.body.data?.serviceBillingTrigger === "PER_SHIPMENT",
      `${JSON.stringify(g7b.body.data?.finance)} · ${by7b.body.data?.serviceBillingTrigger}`);
    const r7c = await call("PATCH", `/api/customers/${k1.data.id}`, adminTok, { finance: { serviceBillingTrigger: "HER_GUN" } });
    const h7c = await prisma.cariAccount.findUniqueOrThrow({ where: { id: acc1.id }, select: { serviceBillingTrigger: true } });
    check("§7c ⭐ geçersiz değer → 400 SERVICE_BILLING_TRIGGER_INVALID, Türkçe mesaj; hesap DEĞİŞMEDİ",
      r7c.status === 400 && r7c.body.details?.code === "SERVICE_BILLING_TRIGGER_INVALID" && /Hizmet faturası tetiği geçersiz/.test(r7c.body.message ?? "") && h7c.serviceBillingTrigger === "PER_SHIPMENT",
      `${r7c.status} ${JSON.stringify(r7c.body.details)} ${r7c.body.message}`);
    // Audit tx dışında best-effort (void) yazılır — kısa yoklama.
    let log7d: Array<{ newData: Prisma.JsonValue }> = [];
    for (let i = 0; i < 20 && log7d.length === 0; i++) {
      log7d = (await prisma.systemLog.findMany({ where: { tableName: "CARI_ACCOUNT", recordId: acc1.id, action: "UPDATE" }, select: { newData: true } }))
        .filter((l) => (l.newData as { serviceBillingTrigger?: string } | null)?.serviceBillingTrigger === "PER_SHIPMENT");
      if (log7d.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    check("§7d kart formu yazımı audit'li (CARI_ACCOUNT UPDATE, yükte serviceBillingTrigger)", log7d.length >= 1, `${log7d.length}`);
    const r7e = await call("PATCH", `/api/customers/${k1.data.id}`, adminTok, { finance: { serviceBillingTrigger: null } });
    const eff7e = await resolveCustomerServiceBillingTrigger(k1.data.id, { trigger: "PERIOD_END" });
    check("§7e null → fabrika ayarı (kaynak FACTORY)", r7e.status === 200 && eff7e.trigger === "PERIOD_END" && eff7e.source === "FACTORY", JSON.stringify(eff7e));
    const sub7 = await prisma.subcontractor.create({ data: { code: `${TAG}-SUB7`, name: `${TAG} fason` }, select: { id: true } });
    ids.subs.push(sub7.id);
    const subAcc = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: null, subcontractorId: sub7.id }));
    const e7f = await beklenenHata(() => cariService.update(subAcc.id, { serviceBillingTrigger: "PER_SHIPMENT" }, admin.id));
    check("§7f fason (müşteri olmayan) hesap → 400 SERVICE_BILLING_TRIGGER_NOT_CUSTOMER korunur", e7f?.statusCode === 400 && kod(e7f) === "SERVICE_BILLING_TRIGGER_NOT_CUSTOMER", kod(e7f));

    console.log("\n── §8 Cari tek kimlik: eski fason bacağı hesabı (K3a) ──");
    const tekKimlik = (customerId: string) => prisma.cariAccount.findMany({ where: { OR: [{ customerId }, { subcontractor: { customerId } }] }, select: { id: true, isActive: true, kind: true, customerId: true, subcontractorId: true, paymentTermDays: true, serviceBillingTrigger: true } });
    const k8 = await kartAc({ isSupplierRole: true });
    ids.customers.push(k8.data.id);
    await prisma.cariAccount.deleteMany({ where: { customerId: k8.data.id } });
    const sub8 = await prisma.subcontractor.create({ data: { code: `${TAG}-SUB8`, name: `${TAG} eski fason 8`, customerId: k8.data.id }, select: { id: true } });
    ids.subs.push(sub8.id);
    const legacy8 = await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: sub8.id }, select: { id: true } });
    const r8a = await call("PATCH", `/api/customers/${k8.data.id}`, adminTok, { finance: { paymentTermDays: 21, serviceBillingTrigger: "PER_SHIPMENT" } });
    const h8a = await tekKimlik(k8.data.id);
    check("§8a ⭐ eski fason bacağı hesabı olan kart → karttan terim/tetik yazımı: kartın hesap sayısı 1 KALIR, yazım o hesaba gider",
      r8a.status === 200 && r8a.body.data?.cariAccountId === legacy8.id && h8a.length === 1 && h8a[0]!.id === legacy8.id && h8a[0]!.paymentTermDays === 21 && h8a[0]!.serviceBillingTrigger === "PER_SHIPMENT"
        // Geçiş artığı yazımda kartın hesabına ÇEVRİLİR (TEK UPDATE): aynı id, kind CUSTOMER, fason bacağı boş.
        && h8a[0]!.kind === "CUSTOMER" && h8a[0]!.customerId === k8.data.id && h8a[0]!.subcontractorId === null,
      `${r8a.status} ${JSON.stringify(h8a)}`);
    const eff8 = await resolveCustomerServiceBillingTrigger(k8.data.id, { trigger: "PERIOD_END" });
    check("§8b okuma AYNI hesabı döner: resolve · by-customer · findCariAccountIdByCustomer · hizmet tetiği çözücüsü",
      (await resolveCariAccountByCustomerTx(prisma, k8.data.id))?.id === legacy8.id && (await cariService.findByCustomer(k8.data.id)).data.id === legacy8.id && (await findCariAccountIdByCustomer(k8.data.id)) === legacy8.id && eff8.trigger === "PER_SHIPMENT" && eff8.source === "CUSTOMER",
      JSON.stringify(eff8));
    const e8c = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { subcontractorId: sub8.id }));
    const e8c2 = await prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: k8.data.id }));
    const e8c3 = await beklenenHata(() => cariService.create({ customerId: k8.data.id }, admin.id));
    check("§8c iki bacaktan `ensureCariAccountTx` aynı hesap (created=false); açık `cariService.create` 409; sayı hâlâ 1",
      e8c.id === legacy8.id && !e8c.created && e8c2.id === legacy8.id && !e8c2.created && e8c3?.statusCode === 409 && (await tekKimlik(k8.data.id)).length === 1);
    await setFin(false);
    const k9 = await kartAc();
    const k10 = await kartAc();
    ids.customers.push(k9.data.id, k10.data.id);
    await setFin(true);
    const acc9 = await cariService.writeTermsForCustomer(k9.data.id, { paymentTermDays: 7 }, admin.id);
    const h9 = await tekKimlik(k9.data.id);
    check("§8d hesapsız kartta ilk yazım TEK hesap açar ve terimi yazar", h9.length === 1 && h9[0]!.id === acc9 && h9[0]!.paymentTermDays === 7, JSON.stringify(h9));
    // Yarış: her tx hesabı açtıktan sonra açık tutulur (pg_sleep) — ikinci INSERT birincinin commit'ini bekler.
    // Her yarışçı AYRI tx (tek tx'te paralellik değil) — sözler önce kurulur, sonra birlikte beklenir.
    const yarisci = () => prisma.$transaction(async (tx) => {
      const r = await ensureCariAccountTx(tx, { customerId: k10.data.id });
      await tx.$executeRawUnsafe("SELECT pg_sleep(0.4)");
      return r;
    }, { timeout: 20_000 });
    const sozler = [yarisci(), yarisci(), yarisci(), yarisci()];
    const yaris = await Promise.allSettled(sozler);
    const ok = yaris.filter((y): y is PromiseFulfilledResult<Awaited<ReturnType<typeof ensureCariAccountTx>>> => y.status === "fulfilled").map((y) => y.value);
    const h10 = await tekKimlik(k10.data.id);
    check("§8e ⭐ eşzamanlı 4 ilk yazım → TEK hesap, dördü de başarılı ve aynı id, yalnız biri `created`",
      ok.length === 4 && new Set(ok.map((o) => o.id)).size === 1 && ok.filter((o) => o.created).length === 1 && h10.length === 1 && h10[0]!.id === ok[0]!.id,
      `${ok.length}/4 · ${yaris.filter((y) => y.status === "rejected").map((y) => String((y as PromiseRejectedResult).reason).slice(0, 80)).join(" | ")} · hesap ${h10.length}`);
    // Kart hesabı PASİF + eski bacak AKTİF (K3a çiftini gören kullanıcı boş kart hesabını pasife almış): çözücü kartın
    // KENDİ hesabını seçer → yazım 409; eski bacak çevrilmez, pasiflik aşılmaz.
    const k8h = await kartAc({ isSupplierRole: true });
    ids.customers.push(k8h.data.id);
    const pasif8h = (await prisma.cariAccount.findUniqueOrThrow({ where: { customerId: k8h.data.id }, select: { id: true } })).id;
    await prisma.cariAccount.update({ where: { id: pasif8h }, data: { isActive: false } });
    const sub8h = await prisma.subcontractor.create({ data: { code: `${TAG}-SUB8H`, name: `${TAG} eski fason 8h`, customerId: k8h.data.id }, select: { id: true } });
    ids.subs.push(sub8h.id);
    const legacy8h = await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: sub8h.id }, select: { id: true } });
    const e8h = await beklenenHata(() => prisma.$transaction((tx) => ensureCariAccountTx(tx, { customerId: k8h.data.id })));
    const h8h = await prisma.cariAccount.findUniqueOrThrow({ where: { id: legacy8h.id }, select: { kind: true, customerId: true } });
    check("§8h ⭐ kart hesabı PASİF + eski bacak aktif → yazım 409 'pasif'; eski bacak ÇEVRİLMEDİ; okuma kartın (pasif) hesabını döner",
      e8h?.statusCode === 409 && /pasif/.test(e8h.message) && h8h.kind === "SUBCONTRACTOR" && h8h.customerId === null && (await resolveCariAccountByCustomerTx(prisma, k8h.data.id))?.id === pasif8h,
      `${e8h?.statusCode} ${JSON.stringify(h8h)}`);
    // Çevirmenin ayak izi commit SONRASI ve aktörlü (ES-11): §8a'nın PATCH'i admin adına yazıldı; geri alınan tx iz bırakmaz.
    const cevirmeLog = (id: string) => prisma.systemLog.findMany({ where: { tableName: "CARI_ACCOUNT", recordId: id, action: "UPDATE" }, select: { userId: true, newData: true } })
      .then((ls) => ls.filter((l) => (l.newData as { kaynak?: string } | null)?.kaynak === "kart-hesabina-cevirme"));
    let log8i: Array<{ userId: string | null }> = [];
    for (let i = 0; i < 20 && log8i.length === 0; i++) {
      log8i = await cevirmeLog(legacy8.id);
      if (log8i.length === 0) await new Promise((r) => setTimeout(r, 100));
    }
    const k8j = await kartAc({ isSupplierRole: true });
    ids.customers.push(k8j.data.id);
    await prisma.cariAccount.deleteMany({ where: { customerId: k8j.data.id } });
    const sub8j = await prisma.subcontractor.create({ data: { code: `${TAG}-SUB8J`, name: `${TAG} eski fason 8j`, customerId: k8j.data.id }, select: { id: true } });
    ids.subs.push(sub8j.id);
    const legacy8j = await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: sub8j.id }, select: { id: true } });
    await beklenenHata(() => prisma.$transaction(async (tx) => {
      await ensureCariAccountTx(tx, { customerId: k8j.data.id });
      throw AppError.badRequest("bekçi: kapı tx'i geri alır");
    }));
    await new Promise((r) => setTimeout(r, 400));
    const h8j = await prisma.cariAccount.findUniqueOrThrow({ where: { id: legacy8j.id }, select: { kind: true } });
    check("§8i ⭐ çevirmenin audit'i commit sonrası ve AKTÖRLÜ (§8a: admin); geri alınan tx'te çevirme de audit de YOK",
      log8i.length === 1 && log8i[0]!.userId === admin.id && h8j.kind === "SUBCONTRACTOR" && (await cevirmeLog(legacy8j.id)).length === 0,
      `${JSON.stringify(log8i)} · ${h8j.kind}`);
    const srcFiles = spawnSync("git", ["ls-files", "src"], { cwd: ROOT, encoding: "utf8" }).stdout.trim().split("\n").filter((f) => f.endsWith(".ts"));
    const yaratanlar: string[] = [];
    const dogrudanOkuyan: string[] = [];
    for (const f of srcFiles) {
      const t = readFileSync(path.join(ROOT, f), "utf8");
      for (const m of t.matchAll(/\.cariAccount\.(create|createMany|createManyAndReturn|upsert)\(/g)) yaratanlar.push(`${f}@${m.index}`);
      // Kart hesabına çevirmenin `customerId @unique` yoklaması (tek çağıranı `ensureCariAccountTx`) muaf.
      // Doğrudan sorgu (findUnique/findFirst/findMany/count, tek/çift tırnak, çok satır) ya da ilişki üzerinden okuma (`cariAccount: {`/`: true`).
      if (/cariAccount\.(findUnique|findFirst|findMany|count)(OrThrow)?\(\{\s*where:\s*\{\s*["']?(customerId|subcontractorId)\b/.test(t) || /\bcariAccount:\s*(\{|true\b)/.test(t)) dogrudanOkuyan.push(f);
    }
    const fh = readFileSync(path.join(ROOT, "src/services/helpers/finance.helper.ts"), "utf8");
    const ensureGovde = fh.slice(fh.indexOf("export async function ensureCariAccountTx("), fh.indexOf("\n}\n", fh.indexOf("export async function ensureCariAccountTx(")));
    check("§8f ⭐ `cariAccount` satırı TEK fabrikada: src'de yaratan çağrı yalnız `ensureCariAccountTx` gövdesinde (1 adet)",
      yaratanlar.length === 1 && yaratanlar[0]!.startsWith("src/services/helpers/finance.helper.ts@") && /\.cariAccount\.createMany\(/.test(ensureGovde), yaratanlar.join(","));
    check("§8g kart → hesap okuması tek çözücüden: src'de `cariAccount.find*/count({ where: { customerId|subcontractorId` ve ilişki seçimi `cariAccount: {…}` YOK; ensure çözücüyü çağırır",
      dogrudanOkuyan.length === 0 && /findCariAccountForCardTx\(tx, card,/.test(ensureGovde), dogrudanOkuyan.join(","));

    console.log("\n── §9 Onarım betiği `fix_cari_cift_hesap` ──");
    const ciftKur = async (n: number): Promise<{ k: string; sub: string; legacy: string; cust: string }> => {
      const k = await kartAc({ isSupplierRole: true });
      ids.customers.push(k.data.id);
      const cust = (await prisma.cariAccount.findUniqueOrThrow({ where: { customerId: k.data.id }, select: { id: true } })).id;
      const sub = await prisma.subcontractor.create({ data: { code: `${TAG}-SUB${n}`, name: `${TAG} eski fason ${n}`, customerId: k.data.id }, select: { id: true } });
      ids.subs.push(sub.id);
      // K3a öncesi çift: eski fason hesabı ÖNCE doğmuş, kart hesabı SONRA (K2b yazımı).
      const legacy = await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: sub.id, createdAt: new Date(Date.now() - 86_400_000) }, select: { id: true } });
      return { k: k.data.id, sub: sub.id, legacy: legacy.id, cust };
    };
    const c11 = await ciftKur(11);
    await prisma.cariAccount.update({ where: { id: c11.cust }, data: { paymentTermDays: 33 } });
    const c12 = await ciftKur(12);
    await prisma.cariTransaction.create({ data: { cariId: c12.cust, currency: Currency.TRY, txnDate: new Date(), debit: 5, sourceType: CariTxnSource.ADJUSTMENT, description: `${TAG} hareket 12` } });
    await prisma.cariBalance.create({ data: { cariId: c12.cust, currency: Currency.TRY, balance: 5 } });
    // K3d: hareketli çift artık virmanla birleşir; DURMASI için ENGEL gerekir — iki hesapta farklı dolu terim.
    await prisma.cariAccount.update({ where: { id: c12.cust }, data: { paymentTermDays: 20 } });
    await prisma.cariAccount.update({ where: { id: c12.legacy }, data: { paymentTermDays: 10 } });
    // K3d: hareketli + engelsiz çift — eski bacakta devir; --apply virmanla kart hesabına birleştirir.
    const c14 = await ciftKur(14);
    await prisma.cariTransaction.create({ data: { cariId: c14.legacy, currency: Currency.TRY, txnDate: new Date(Date.now() - 3_600_000), debit: 7, sourceType: CariTxnSource.ADJUSTMENT, description: `${TAG} hareket 14` } });
    await prisma.cariBalance.create({ data: { cariId: c14.legacy, currency: Currency.TRY, balance: 7 } });
    // İkinci (kart) hesap da hareketli — yoksa hareketsiz ikinci kapatma yolu işler, virman değil.
    await prisma.cariTransaction.create({ data: { cariId: c14.cust, currency: Currency.TRY, txnDate: new Date(Date.now() - 3_600_000), debit: 5, sourceType: CariTxnSource.ADJUSTMENT, description: `${TAG} hareket 14b` } });
    await prisma.cariBalance.create({ data: { cariId: c14.cust, currency: Currency.TRY, balance: 5 } });
    // Pasif kart hesabı + aktif eski bacak (hareketsiz): ayrı kategori, kapatılabilir.
    const c13 = await ciftKur(13);
    await prisma.cariAccount.update({ where: { id: c13.cust }, data: { isActive: false } });
    const o9 = await ciftOlc();
    const p13 = o9.ciftler.find((c) => c.customerId === c13.k);
    const p11 = o9.ciftler.find((c) => c.customerId === c11.k);
    const p12 = o9.ciftler.find((c) => c.customerId === c12.k);
    check("§9a ölçüm iki çifti listeler: ikinci = sonra doğan kart hesabı, hareket/bakiye; hareketsiz çift kapatılabilir + terim taşınır, hareketli çift DURUR",
      !!p11 && !!p12 && p11.ikinci.id === c11.cust && p11.ilk.id === c11.legacy && p11.engel === null && p11.terimTasi.paymentTermDays === 33
        && p12.ikinci.id === c12.cust && p12.ikinci.hareket === 1 && p12.ikinci.bakiye.TRY === "5" && /ENGELLİ/.test(p12.engel ?? "") && /paymentTermDays/.test(p12.engel ?? ""),
      JSON.stringify({ p11: p11 && { e: p11.engel, t: p11.terimTasi }, p12: p12 && { e: p12.engel, h: p12.ikinci.hareket, b: p12.ikinci.bakiye } }));
    const kod11 = (await prisma.customer.findUniqueOrThrow({ where: { id: c11.k }, select: { code: true } })).code;
    const kod12 = (await prisma.customer.findUniqueOrThrow({ where: { id: c12.k }, select: { code: true } })).code;
    const fixKos = (args: string[]) => spawnSync(process.execPath, [path.join(ROOT, "node_modules/.bin/tsx"), path.join(ROOT, "scripts/fix_cari_cift_hesap.ts"), ...args], { encoding: "utf8", env: cocukOrtami({}), timeout: 120_000 });
    const dry = fixKos([]);
    const aktif = async () => (await prisma.cariAccount.findMany({ where: { id: { in: [c11.legacy, c11.cust, c12.legacy, c12.cust] } }, select: { id: true, isActive: true } })).filter((a) => a.isActive).length;
    check("§9b dry-run (varsayılan): çıkış 0, iki kartı listeler, 'hiçbir şey yazılmadı', dört hesap aktif kalır",
      dry.status === 0 && dry.stdout.includes(kod11) && dry.stdout.includes(kod12) && /hiçbir şey yazılmadı/.test(dry.stdout) && (await aktif()) === 4, `${dry.status} ${dry.stderr.slice(0, 200)}`);
    const sahte9 = spawnSync(process.execPath, [path.join(ROOT, "node_modules/.bin/tsx"), path.join(ROOT, "scripts/fix_cari_cift_hesap.ts"), "--apply"], { encoding: "utf8", env: cocukOrtami({ DATABASE_URL: "postgresql://bekci@127.0.0.1:1/tekserp_sahte_canli?schema=public" }), timeout: 60_000 });
    check("§9c `_test` dışı hedef + `--apply` `--canli-onay`sız → ⛔ çıkış 2 (DB'ye bağlanmadan)", sahte9.status === 2 && /--canli-onay/.test(sahte9.stdout), `${sahte9.status}`);
    const app9 = fixKos(["--apply"]);
    const h11 = await prisma.cariAccount.findMany({ where: { id: { in: [c11.legacy, c11.cust] } }, select: { id: true, isActive: true, kind: true, customerId: true, paymentTermDays: true } });
    const h12 = await prisma.cariAccount.findMany({ where: { id: { in: [c12.legacy, c12.cust] } }, select: { id: true, isActive: true } });
    check("§9d ⭐ `--apply`: hareketsiz ikinci KART hesabı kapandı (deftere yazmamış satır silindi), ilk hesap kartın hesabına çevrildi + terim taşındı, okuma onu döner",
      h11.length === 1 && h11[0]!.id === c11.legacy && h11[0]!.isActive && h11[0]!.kind === "CUSTOMER" && h11[0]!.customerId === c11.k && h11[0]!.paymentTermDays === 33
        && (await resolveCariAccountByCustomerTx(prisma, c11.k))?.id === c11.legacy,
      JSON.stringify(h11));
    check("§9e ⭐ hareketli çiftte DURUR: iki hesap da aktif, listede gerekçe, çıkış 3",
      h12.every((a) => a.isActive) && app9.status === 3 && /DURDU/.test(app9.stdout) && app9.stdout.includes(kod12), `${app9.status} ${app9.stderr.slice(0, 200)}`);
    const h13 = await prisma.cariAccount.findMany({ where: { id: { in: [c13.legacy, c13.cust] } }, select: { id: true, isActive: true, kind: true, customerId: true } });
    check("§9g ⭐ kart hesabı PASİF + eski bacak aktif: ölçümde çift (pasifKart, ikinci = pasif kart hesabı, kapatılabilir); `--apply` pasif kart hesabını siler, eski bacak kartın hesabına çevrilir",
      !!p13 && p13.pasifKart && p13.ikinci.id === c13.cust && p13.ilk.id === c13.legacy && p13.engel === null
        && h13.length === 1 && h13[0]!.id === c13.legacy && h13[0]!.isActive && h13[0]!.kind === "CUSTOMER" && h13[0]!.customerId === c13.k,
      JSON.stringify({ p13: p13 && { pk: p13.pasifKart, e: p13.engel }, h13 }));
    const h14 = await prisma.cariAccount.findMany({ where: { id: { in: [c14.legacy, c14.cust] } }, select: { id: true, isActive: true, mergedIntoId: true, balances: { select: { balance: true } } } });
    const l14 = h14.find((a) => a.id === c14.legacy);
    const k14 = h14.find((a) => a.id === c14.cust);
    check("§9h ⭐ (K3d) hareketli + engelsiz çift VİRMANLA birleşti: eski bacak pasif + mergedIntoId = kart hesabı, bakiyesi 0, kart hesabı 7 + 5 = 12; çözücü kart hesabını döner",
      !!l14 && !l14.isActive && l14.mergedIntoId === c14.cust && l14.balances.every((b) => Number(b.balance) === 0) && !!k14 && k14.balances.some((b) => Number(b.balance) === 12)
        && (await resolveCariAccountByCustomerTx(prisma, c14.k))?.id === c14.cust,
      JSON.stringify(h14));
    const o9b = await ciftOlc();
    check("§9f idempotent: ikinci ölçümde onarılan çift yok, hareketli çift hâlâ listede", !o9b.ciftler.some((c) => c.customerId === c11.k) && !o9b.ciftler.some((c) => c.customerId === c14.k) && o9b.ciftler.some((c) => c.customerId === c12.k));
  } finally {
    server.close();
    await temizle(ids, foto);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(ids: { customers: string[]; users: string[]; subs: string[] }, foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  const accs = await prisma.cariAccount.findMany({ where: { OR: [{ customerId: { in: ids.customers } }, { subcontractorId: { in: ids.subs } }] }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  await prisma.cariTransaction.deleteMany({ where: { cariId: { in: accIds } } });
  await prisma.cariBalance.deleteMany({ where: { cariId: { in: accIds } } });
  // K3d birleşme bağı (FK Restrict) önce çözülür.
  await prisma.cariAccount.updateMany({ where: { id: { in: accIds } }, data: { mergedIntoId: null } });
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
  process.exitCode = 1;
});
