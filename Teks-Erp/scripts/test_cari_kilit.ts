// =============================================================================
// BEKÇİ — CARİ KİLİDİ MODELİ (D4-I1a, ister 4.7; tasarım DALGA4 §10)
// =============================================================================
//   §0 statik — kilit yüklemi (`cariHold` OKUMASINDA `releasedAt` süzgeci) yalnız `helpers/cari-hold.helper.ts`te;
//      helper finans servisi / finance.helper import etmez (transitif ölçüm `test_finance_regime_gate` §4)
//   §1 KOY — aynı clientToken iki istek → tek satır + replay; ikinci aktif kilit 409 CARI_HOLD_EXISTS; aynı token
//      başka kapsam 409 CLIENT_TOKEN_COLLISION; boş kapsam 400; pasif cari 409 CARI_INACTIVE; DB'de çift aktif
//      insert 23505 (kısmi unique) · kapsamsız insert 23514 (CHECK) · eşzamanlı iki koyma → 1 başarı + 1 CARI_HOLD_EXISTS
//   §2 KAPI — `assertCariNotHeldTx`: kilit yok → geçer; INTAKE kapsamlı kilit → INTAKE 409 CARI_HOLD (holdId, sebep,
//      koyan, tarih), SHIPMENT/INVOICE geçer; onarılmamış K3a çiftinde (kart hesabı + eski fason bacağı) eski SHIPMENT
//      kilidi varken yeni INTAKE kilidi de kapıyı keser (kapsam WHERE'de aranır — fail-closed)
//   §3 AÇ — DENY'de koyan kişi 409 CARI_HOLD_SAME_PERSON, başka yetkili 200; açılan kilit yeniden açılamaz 409;
//      eşzamanlı iki açma → biri 200 diğeri 409; açılmış kilidin token replay'i 409 CARI_HOLD_RELEASED; yeniden kilit
//      yeni satır, liste tarihçeyi + aktifi döner
//   §4 HTTP — `finance:hold`suz koyma 403; `finance:hold` ile 201; `finance:hold-release`siz açma 403
//   §5 audit — CARI_HOLD CREATE + UPDATE satırları
//   §6 ayarlar — kayıt yokken varsayılanlar (INTAKE,SHIPMENT · ALLOW); tanınmayan değer 400
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-30): ① `cari_holds_active_cariId_key` test DB'de düşürüldü → §1f ❌ (çift aktif
//    insert geçti); index geri kondu → yeşil. ② servis dosyasına `cariHold.findFirst({ where: { releasedAt: null } })`
//    eklendi → §0a ❌; geri alındı → yeşil. ③ helper'a finans servisi importu → `test_finance_regime_gate` §4 ❌.
//    ④ `assertCariNotHeldTx` kapsamı WHERE yerine ilk satırın kolonundan okudu → §2e ❌. ⑤ servisteki ön okuma
//    (`activeHoldByCari`) kaldırıldı → §1c + §1i yine yeşil (P2002 → CARI_HOLD_EXISTS eşlemesi çalışıyor); eşleme
//    regex'i de bozuldu → §1c ham P2002 ile düştü (exit 1). Hepsi geri alındı → 32/0.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Ayarlar fotoğrafa döner; temizlik yalnız `temizle`.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import * as ts from "typescript";
import { Prisma } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS, systemSettingService, readFinanceCariHoldDefaultScope, readFinanceCariHoldReleaseBySamePerson } from "../src/services/system-setting.service";
import { customerService } from "../src/routes/customer.routes";
import { cariHoldService } from "../src/services/cari-hold.service";
import { assertCariNotHeldTx } from "../src/services/helpers/cari-hold.helper";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}
async function hata(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    if (e instanceof AppError) return e;
    throw e;
  }
}
const kod = (e: AppError | null): string => String((e?.details as { code?: string } | undefined)?.code ?? e?.statusCode ?? "geçti");
const det = (e: AppError | null): Record<string, unknown> => (e?.details as Record<string, unknown>) ?? {};

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const HELPER = path.join(SRC, "services/helpers/cari-hold.helper.ts");
const TAG = `TEST-CKL-${process.pid}`;
const AYARLAR = [SETTING_KEYS.FINANCE_ENABLED, SETTING_KEYS.FINANCE_CARI_HOLD_DEFAULT_SCOPE, SETTING_KEYS.FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON];
type Resp = { status: number; body: { message?: string; details?: Record<string, unknown>; data?: Record<string, unknown> } };

function tsDosyalari(dir: string): string[] {
  return readdirSync(dir).flatMap((ad) => {
    const f = path.join(dir, ad);
    if (statSync(f).isDirectory()) return tsDosyalari(f);
    return f.endsWith(".ts") ? [f] : [];
  });
}

const OKUMA = new Set(["findFirst", "findFirstOrThrow", "findMany", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);

/** `<x>.cariHold.<okuma>({ where: { … releasedAt … } })` çağrıları — kilit yüklemi = aktiflik süzgeçli okuma (`select` sayılmaz). */
function kilitYuklemleri(dosya: string): number {
  const sf = ts.createSourceFile(dosya, readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
  let n = 0;
  const releasedAtVar = (node: ts.Node): boolean => {
    let bulundu = false;
    const gez = (x: ts.Node): void => {
      if (bulundu) return;
      if (ts.isPropertyAssignment(x) && x.name.getText(sf) === "releasedAt") bulundu = true;
      ts.forEachChild(x, gez);
    };
    gez(node);
    return bulundu;
  };
  const gez = (x: ts.Node): void => {
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && OKUMA.has(x.expression.name.text)) {
      const sahip = x.expression.expression;
      const whereler = x.arguments.flatMap((a) => (ts.isObjectLiteralExpression(a) ? a.properties.filter((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "where") : []));
      if (ts.isPropertyAccessExpression(sahip) && sahip.name.text === "cariHold" && whereler.some(releasedAtVar)) n++;
    }
    ts.forEachChild(x, gez);
  };
  gez(sf);
  const ham = readFileSync(dosya, "utf8");
  if (/cari_holds[\s\S]{0,400}"releasedAt"\s+IS\s+NULL/i.test(ham)) n++;
  return n;
}

function statik(): void {
  console.log("── §0 Statik ──");
  const dosyalar = tsDosyalari(SRC);
  const ihlal = dosyalar.filter((f) => f !== HELPER && kilitYuklemleri(f) > 0).map((f) => path.relative(SRC, f));
  check("§0 körlük zemini: helper'daki yüklem tarayıcıya görünüyor (≥ 2)", kilitYuklemleri(HELPER) >= 2, `${kilitYuklemleri(HELPER)}`);
  check("§0a ⭐ kilit yüklemi (cariHold okumasında releasedAt) yalnız cari-hold.helper.ts'te", ihlal.length === 0, ihlal.join(", ") || "temiz");
  const helperSrc = readFileSync(HELPER, "utf8");
  const importlar = [...helperSrc.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
  const finans = importlar.filter((i) => /invoice|payment|cari\.service|finance\.helper|cari-hold\.service/.test(i));
  check("§0b helper finans servisi / finance.helper import etmiyor", finans.length === 0, finans.join(", ") || importlar.join(", "));
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== CARİ KİLİDİ BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const setSetting = (key: string, v: Prisma.InputJsonValue | null) =>
    v === null ? prisma.systemSetting.deleteMany({ where: { key } }) : prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  const admin = await ensureTestAdmin();
  const ids = { customers: [] as string[], users: [] as string[], subs: [] as string[] };
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, p: string, token: string | null, body?: unknown): Promise<Resp> => {
    const r = await fetch(`${base}${p}`, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    let parsed: Resp["body"] = {};
    try {
      parsed = (await r.json()) as Resp["body"];
    } catch {
      /* boş gövde */
    }
    return { status: r.status, body: parsed };
  };
  const login = async (u: string, p: string): Promise<string> => {
    const r = await call("POST", "/api/auth/login", null, { username: u, password: p });
    const t = (r.body as { data?: { token?: string } }).data?.token;
    if (!t) throw new Error(`login başarısız: ${u} (${r.status})`);
    return t;
  };
  const kullanici = async (ek: string, izinler: string[]): Promise<{ id: string; token: string }> => {
    const username = `${TAG}-${ek}`.toLowerCase();
    const u = await prisma.user.create({ data: { username, fullName: `${TAG} ${ek}`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
    ids.users.push(u.id);
    const perms = await prisma.permission.findMany({ where: { code: { in: izinler } }, select: { id: true } });
    if (perms.length) await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
    return { id: u.id, token: await login(username, "test123456") };
  };
  const kartAc = async (): Promise<{ customerId: string; cariId: string }> => {
    const r = (await customerService.create({ name: `${TAG} ${Math.random().toString(36).slice(2, 7)}`, isCustomerRole: true }, admin.id)) as { data: { id: string } };
    ids.customers.push(r.data.id);
    const acc = await prisma.cariAccount.findFirstOrThrow({ where: { customerId: r.data.id }, select: { id: true } });
    return { customerId: r.data.id, cariId: acc.id };
  };
  const girdi = (ek: Partial<Parameters<typeof cariHoldService.place>[1]> = {}) => ({
    blocksIntake: true,
    blocksShipment: true,
    blocksInvoice: false,
    reasonCode: "BORC" as const,
    reasonText: `${TAG} borç`,
    clientToken: randomUUID(),
    ...ek,
  });

  try {
    await setSetting(SETTING_KEYS.FINANCE_ENABLED, true);
    await setSetting(SETTING_KEYS.FINANCE_CARI_HOLD_DEFAULT_SCOPE, null);
    await setSetting(SETTING_KEYS.FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON, null);

    console.log("\n── §1 Koy ──");
    const k1 = await kartAc();
    const g1 = girdi();
    const [r1a, r1b] = [await cariHoldService.place(k1.cariId, g1, admin.id), await cariHoldService.place(k1.cariId, g1, admin.id)];
    const sayi1 = await prisma.cariHold.count({ where: { cariId: k1.cariId } });
    check("§1a ⭐ aynı clientToken iki istek → tek satır + replay yanıtı (aynı id)", sayi1 === 1 && r1a.data.id === r1b.data.id && r1b.message === "Cari kilidi zaten konmuş.", `satır=${sayi1} msg=${r1b.message}`);
    check("§1b yanıt kapsamı + sebep etiketi + koyan", r1a.data.scopes.join(",") === "INTAKE,SHIPMENT" && r1a.data.reasonLabel === "Borç" && r1a.data.placedById === admin.id);
    const e1c = await hata(() => cariHoldService.place(k1.cariId, girdi(), admin.id));
    check("§1c ⭐ ikinci aktif kilit → 409 CARI_HOLD_EXISTS", e1c?.statusCode === 409 && kod(e1c) === "CARI_HOLD_EXISTS", kod(e1c));
    const e1d = await hata(() => cariHoldService.place(k1.cariId, { ...g1, blocksInvoice: true }, admin.id));
    check("§1d aynı token başka kapsam → 409 CLIENT_TOKEN_COLLISION", e1d?.statusCode === 409 && kod(e1d) === "CLIENT_TOKEN_COLLISION", kod(e1d));
    const e1e = await hata(() => cariHoldService.place(k1.cariId, girdi({ blocksIntake: false, blocksShipment: false, blocksInvoice: false }), admin.id));
    check("§1e boş kapsam → 400 CARI_HOLD_SCOPE_EMPTY", e1e?.statusCode === 400 && kod(e1e) === "CARI_HOLD_SCOPE_EMPTY", kod(e1e));

    let dbHata = "";
    try {
      await prisma.$executeRaw`INSERT INTO cari_holds (id, "cariId", "blocksIntake", "reasonCode", "placedById", "clientToken", "updatedAt") VALUES (${randomUUID()}::uuid, ${k1.cariId}::uuid, true, 'BORC', ${admin.id}::uuid, ${randomUUID()}::uuid, now())`;
      dbHata = "GEÇTİ";
    } catch (e) {
      dbHata = String((e as Error).message);
    }
    check("§1f ⭐ DB'de çift aktif insert → 23505 (kısmi unique cari_holds_active_cariId_key)", /23505|cari_holds_active_cariId_key|Unique constraint/i.test(dbHata), dbHata.slice(0, 160));
    const k1b = await kartAc();
    let chkHata = "";
    try {
      await prisma.$executeRaw`INSERT INTO cari_holds (id, "cariId", "reasonCode", "placedById", "clientToken", "updatedAt") VALUES (${randomUUID()}::uuid, ${k1b.cariId}::uuid, 'BORC', ${admin.id}::uuid, ${randomUUID()}::uuid, now())`;
      chkHata = "GEÇTİ";
    } catch (e) {
      chkHata = String((e as Error).message);
    }
    check("§1g kapsamsız insert → 23514 (cari_holds_scope_chk)", /23514|cari_holds_scope_chk|check constraint/i.test(chkHata), chkHata.slice(0, 160));
    const kPasif = await kartAc();
    await prisma.cariAccount.update({ where: { id: kPasif.cariId }, data: { isActive: false } });
    const e1h = await hata(() => cariHoldService.place(kPasif.cariId, girdi(), admin.id));
    check("§1h pasif cari → 409 CARI_INACTIVE ('önce aktif edin')", e1h?.statusCode === 409 && kod(e1h) === "CARI_INACTIVE" && /aktif edin/.test(e1h.message), kod(e1h));
    const kYaris = await kartAc();
    const yaris = await Promise.allSettled([cariHoldService.place(kYaris.cariId, girdi(), admin.id), cariHoldService.place(kYaris.cariId, girdi(), admin.id)]);
    const yOk = yaris.filter((r) => r.status === "fulfilled").length;
    const yRed = yaris.filter((r) => r.status === "rejected" && r.reason instanceof AppError && r.reason.statusCode === 409 && kod(r.reason) === "CARI_HOLD_EXISTS").length;
    const yRedDiger = yaris.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason?.message ?? "").slice(0, 80));
    check("§1i ⭐ eşzamanlı iki koyma (farklı token) → 1 başarı + 1 409 CARI_HOLD_EXISTS", yOk === 1 && yRed === 1, `ok=${yOk} red=${yRed} ${yRedDiger.join(" | ")}`);

    console.log("\n── §2 Kapı ──");
    const k2 = await kartAc();
    const e2a = await hata(() => assertCariNotHeldTx(prisma, k2.customerId, "INTAKE"));
    check("§2a kilit yok → INTAKE geçer", e2a === null, kod(e2a));
    const h2 = await cariHoldService.place(k2.cariId, girdi({ blocksIntake: true, blocksShipment: false, blocksInvoice: false, reasonCode: "RISK" }), admin.id);
    const e2b = await hata(() => assertCariNotHeldTx(prisma, k2.customerId, "INTAKE"));
    const d2b = det(e2b);
    check(
      "§2b ⭐ INTAKE kapsamlı kilit → INTAKE 409 CARI_HOLD + holdId, sebep, koyan, tarih",
      e2b?.statusCode === 409 && d2b.code === "CARI_HOLD" && d2b.holdId === h2.data.id && d2b.sebep === "RISK" && typeof d2b.koyan === "string" && typeof d2b.tarih === "string",
      JSON.stringify(d2b),
    );
    check("§2c 409 mesajı Türkçe ve kimin açabileceğini söylüyor", !!e2b && /kilitli/.test(e2b.message) && /açabilir/.test(e2b.message), e2b?.message ?? "");
    const e2d = await hata(() => assertCariNotHeldTx(prisma, k2.customerId, "SHIPMENT"));
    const e2e = await hata(() => assertCariNotHeldTx(prisma, k2.customerId, "INVOICE"));
    check("§2d aynı kilitte SHIPMENT ve INVOICE geçer (kapsam dışı)", e2d === null && e2e === null, `${kod(e2d)} ${kod(e2e)}`);
    const k2e = await kartAc();
    const sub2e = await prisma.subcontractor.create({ data: { code: `${TAG}-SUB2E`.slice(0, 32), name: `${TAG} eski fason 2e`, customerId: k2e.customerId }, select: { id: true } });
    ids.subs.push(sub2e.id);
    const legacy2e = await prisma.cariAccount.create({ data: { kind: "SUBCONTRACTOR", subcontractorId: sub2e.id }, select: { id: true } });
    await cariHoldService.place(k2e.cariId, girdi({ blocksIntake: false, blocksShipment: true, blocksInvoice: false }), admin.id);
    const h2e = await cariHoldService.place(legacy2e.id, girdi({ blocksIntake: true, blocksShipment: false, blocksInvoice: false }), admin.id);
    const e2e1 = await hata(() => assertCariNotHeldTx(prisma, k2e.customerId, "INTAKE"));
    const e2e2 = await hata(() => assertCariNotHeldTx(prisma, k2e.customerId, "SHIPMENT"));
    const e2e3 = await hata(() => assertCariNotHeldTx(prisma, k2e.customerId, "INVOICE"));
    check(
      "§2e ⭐ onarılmamış K3a çifti: eski SHIPMENT kilidi + yeni INTAKE kilidi (eski bacakta) → INTAKE 409 (yeni kilidin id'si), SHIPMENT 409, INVOICE geçer",
      kod(e2e1) === "CARI_HOLD" && det(e2e1).holdId === h2e.data.id && kod(e2e2) === "CARI_HOLD" && e2e3 === null,
      `${kod(e2e1)} ${kod(e2e2)} ${kod(e2e3)}`,
    );

    console.log("\n── §3 Aç ──");
    const b = await kullanici("muhasebe", ["finance:read", "finance:hold", "finance:hold-release"]);
    await setSetting(SETTING_KEYS.FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON, "DENY");
    const e3a = await hata(() => cariHoldService.release(r1a.data.id, "ödeme geldi", admin.id));
    check("§3a ⭐ DENY'de koyan kişi açarsa → 409 CARI_HOLD_SAME_PERSON", e3a?.statusCode === 409 && kod(e3a) === "CARI_HOLD_SAME_PERSON", kod(e3a));
    const r3b = await cariHoldService.release(r1a.data.id, "ödeme geldi", b.id);
    check("§3b DENY'de başka yetkili → açıldı (releasedAt + açan + sebep)", !!r3b.data.releasedAt && r3b.data.releasedById === b.id && r3b.data.releaseReason === "ödeme geldi");
    const e3c = await hata(() => cariHoldService.release(r1a.data.id, "tekrar", b.id));
    check("§3c açılmış kilit yeniden açılamaz → 409 CARI_HOLD_NOT_ACTIVE", e3c?.statusCode === 409 && kod(e3c) === "CARI_HOLD_NOT_ACTIVE", kod(e3c));
    const e3d = await hata(() => cariHoldService.place(k1.cariId, g1, admin.id));
    check("§3d açılmış kilidin token replay'i → 409 CARI_HOLD_RELEASED", e3d?.statusCode === 409 && kod(e3d) === "CARI_HOLD_RELEASED", kod(e3d));
    await setSetting(SETTING_KEYS.FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON, "ALLOW");
    const yeni = await cariHoldService.place(k1.cariId, girdi({ reasonCode: "ANLASMAZLIK" }), admin.id);
    const sonuc = await Promise.allSettled([cariHoldService.release(yeni.data.id, "yarış bir", b.id), cariHoldService.release(yeni.data.id, "yarış iki", admin.id)]);
    const ok = sonuc.filter((s) => s.status === "fulfilled").length;
    const red = sonuc.filter((s) => s.status === "rejected" && s.reason instanceof AppError && s.reason.statusCode === 409 && kod(s.reason) === "CARI_HOLD_NOT_ACTIVE").length;
    check("§3e ⭐ eşzamanlı iki açma → biri 200, diğeri 409 CARI_HOLD_NOT_ACTIVE (ALLOW'da koyan da açabilir)", ok === 1 && red === 1, `ok=${ok} red=${red}`);
    const yeni2 = await cariHoldService.place(k1.cariId, girdi({ blocksInvoice: true }), admin.id);
    const liste = await cariHoldService.listByCari(k1.cariId);
    check(
      "§3f yeniden kilit YENİ satır; liste aktif + tarihçe (3 satır, en yeni önde)",
      liste.data.active?.id === yeni2.data.id && liste.data.history.length === 3 && liste.data.history[0]!.id === yeni2.data.id && liste.data.history.filter((h) => h.releasedAt).length === 2,
      `aktif=${liste.data.active?.id === yeni2.data.id} n=${liste.data.history.length}`,
    );

    console.log("\n── §4 HTTP + izin ──");
    const okur = await kullanici("okur", ["finance:read"]);
    const satis = await kullanici("satis", ["finance:hold"]);
    const k4 = await kartAc();
    const r4a = await call("POST", `/api/finance/cari/${k4.cariId}/holds`, okur.token, girdi());
    check("§4a finance:hold'suz koyma → 403", r4a.status === 403, `${r4a.status}`);
    const r4b = await call("POST", `/api/finance/cari/${k4.cariId}/holds`, satis.token, girdi({ blocksInvoice: true }));
    const holdId4 = (r4b.body.data as { id?: string } | undefined)?.id;
    check("§4b finance:hold ile koyma → 201", r4b.status === 201 && !!holdId4, `${r4b.status} ${r4b.body.message ?? ""}`);
    const r4c = await call("POST", `/api/finance/cari/holds/${holdId4}/release`, satis.token, { reason: "deneme açma" });
    check("§4c ⭐ finance:hold-release'siz açma → 403 (SoD)", r4c.status === 403, `${r4c.status}`);
    const r4d = await call("GET", `/api/finance/cari/${k4.cariId}/holds`, satis.token);
    check("§4d finance:hold ile liste okunur (aktif kilit görünür)", r4d.status === 200 && (r4d.body.data as { active?: { id?: string } } | undefined)?.active?.id === holdId4, `${r4d.status}`);
    const r4e = await call("POST", `/api/finance/cari/${k4.cariId}/holds`, satis.token, { ...girdi(), reasonCode: "UYDURMA" });
    check("§4e tanınmayan sebep kodu → 400", r4e.status === 400, `${r4e.status}`);

    console.log("\n── §5 Audit ──");
    const loglar = await prisma.systemLog.findMany({ where: { tableName: "CARI_HOLD", recordId: r1a.data.id }, select: { action: true } });
    check("§5 CARI_HOLD CREATE + UPDATE satırları", loglar.some((l) => l.action === "CREATE") && loglar.some((l) => l.action === "UPDATE"), loglar.map((l) => l.action).join(","));

    console.log("\n── §6 Ayarlar ──");
    await setSetting(SETTING_KEYS.FINANCE_CARI_HOLD_DEFAULT_SCOPE, null);
    await setSetting(SETTING_KEYS.FINANCE_CARI_HOLD_RELEASE_BY_SAME_PERSON, null);
    check("§6a kayıt yokken varsayılanlar INTAKE,SHIPMENT · ALLOW (bugünkü davranış = serbest)", (await readFinanceCariHoldDefaultScope()) === "INTAKE,SHIPMENT" && (await readFinanceCariHoldReleaseBySamePerson()) === "ALLOW");
    const e6b = await hata(() => systemSettingService.setFeatureFlags({ financeCariHoldDefaultScope: "SHIPMENT,INTAKE" as never }, admin.id));
    const e6c = await hata(() => systemSettingService.setFeatureFlags({ financeCariHoldReleaseBySamePerson: "BELKI" as never }, admin.id));
    check("§6b tanınmayan değer (sıra dışı alt küme · bilinmeyen kural) → 400", e6b?.statusCode === 400 && e6c?.statusCode === 400, `${e6b?.statusCode} ${e6c?.statusCode}`);
    await systemSettingService.setFeatureFlags({ financeCariHoldDefaultScope: "INTAKE,SHIPMENT,INVOICE" }, admin.id);
    check("§6c geçerli değer yazılır ve okunur", (await readFinanceCariHoldDefaultScope()) === "INTAKE,SHIPMENT,INVOICE");
  } finally {
    server.close();
    await temizle(ids, foto);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

async function temizle(ids: { customers: string[]; users: string[]; subs: string[] }, foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  const accs = await prisma.cariAccount.findMany({ where: { OR: [{ customerId: { in: ids.customers } }, { subcontractorId: { in: ids.subs } }] }, select: { id: true } });
  const accIds = accs.map((a) => a.id);
  const holds = await prisma.cariHold.findMany({ where: { cariId: { in: accIds } }, select: { id: true } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...holds.map((h) => h.id), ...ids.customers, ...accIds] } } });
  await prisma.cariHold.deleteMany({ where: { cariId: { in: accIds } } });
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
  for (const key of AYARLAR) {
    const eski = foto.find((f) => f.key === key);
    if (eski) await prisma.systemSetting.upsert({ where: { key }, create: { key, value: eski.value as Prisma.InputJsonValue }, update: { value: eski.value as Prisma.InputJsonValue } });
    else await prisma.systemSetting.deleteMany({ where: { key } });
  }
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exitCode = 1;
});
