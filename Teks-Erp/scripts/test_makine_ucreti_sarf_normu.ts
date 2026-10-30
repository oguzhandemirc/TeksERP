// =============================================================================
// BEKÇİ — MAKİNE SAAT ÜCRETİ + HİZMET SARF NORMU ANA VERİSİ (D4-G1a; tasarım DALGA4 §8.4–8.7, §13 D4-G1)
// =============================================================================
//   §0 statik — as-of yüklemi (`revokedAt: { gt … }` / ham SQL pencere) yalnız `helpers/cost-rate-validity.helper.ts`te
//   §1 ücret YARAT — aynı clientToken iki istek (ardışık + eşzamanlı) → tek satır + replay; aktif varken ikinci yaratma
//      409 COST_RATE_ACTIVE_EXISTS; aynı token başka değer 409 CLIENT_TOKEN_COLLISION; negatif ücret 400
//   §2 ücret DEĞİŞTİR — damga + yeni satır tek tx; aynı token tekrar → aynı yeni satır, üçüncü satır YOK; bayat satırı
//      değiştirme 409 COST_RATE_STALE ve eski damga değişmez; eşzamanlı iki değişim → 1 başarı + 1 COST_RATE_STALE
//   §3 as-of tablosu — değişim öncesi/sonrası tarih doğru satırı verir; damgalı satır damga anından sonra görünmez;
//      bellek-içi ikiz aynı satırlarda aynı cevabı verir
//   §4 sarf normu — SERVICE dışı hizmet 400 SERVICE_ITEM_INVALID; CONSUMABLE dışı sarf 400 CONSUMABLE_ITEM_INVALID;
//      token replay tek satır; değişim damga + yeni; birim sarf kaleminden donar; as-of okuma
//   §5 DB seddi — çift aktif tarife / norm insert 23505; negatif ücret 23514; damga açansız 23514
//   §6 pasif makine / pasif kalem → 409; kaldırma damgadır, ikinci kaldırma 409
//   §7 HTTP — maliyet kapalıyken dört uç 403 MODULE_DISABLED; cost:read okur ama yazamaz (403); cost:write 201;
//      filter[machineId] süzer, çıplak machineId 400
//   §8 audit — CREATE/UPDATE satırları var, yükte ücret/norm DEĞERİ yok
//
// ⭐ NEGATİF SONDA (ölçüldü 2026-10-30): ① `machine_cost_rates_active_machine_uq` test DB'de düşürüldü → §5a ❌
//    (çift aktif insert geçti; 37/1); index geri kondu → yeşil. ② `changeMachineCostRate` claim'inden `revokedAt: null`
//    çıkarıldı → §2c + §2d ❌ (kaybeden STALE yerine ACTIVE_EXISTS; 36/2). ③ `consumable-norm.service.ts`e ikinci
//    pencere yüklemi (`revokedAt: { gt: at }`) eklendi → §0a ❌ (37/1). Hepsi geri alındı → 38/0.
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım. Ayarlar fotoğrafa döner; temizlik yalnız `temizle`.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import * as ts from "typescript";
import { ItemLifecycleStatus, ItemType, Prisma, StationType } from "@prisma/client";
import app from "../src/app";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { ensureTestAdmin } from "./fixture-test-user";
import { AuthService } from "../src/services/auth.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { changeMachineCostRate, createMachineCostRate, revokeMachineCostRate } from "../src/services/machine-cost-rate.service";
import { changeConsumableNorm, createConsumableNorm, revokeConsumableNorm } from "../src/services/consumable-norm.service";
import { consumableNormsValidAt, isCostRateValidAt, machineCostRateValidAt } from "../src/services/helpers/cost-rate-validity.helper";
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
async function pgKodu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "geçti";
  } catch (e) {
    const m = String((e as { meta?: { code?: string } }).meta?.code ?? (e as Error).message);
    const k = /\b(23505|23514)\b/.exec(m);
    return k ? k[1]! : m.slice(0, 160);
  }
}

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const HELPER = path.join(SRC, "services/helpers/cost-rate-validity.helper.ts");
const TAG = `TEST-MUS-${process.pid}`;
const AYARLAR = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.MALIYET_ENABLED];
const MODELLER = new Set(["machineCostRate", "serviceConsumableNorm"]);
type Resp = { status: number; body: { message?: string; details?: Record<string, unknown>; data?: unknown } };

function tsDosyalari(dir: string): string[] {
  return readdirSync(dir).flatMap((ad) => {
    const f = path.join(dir, ad);
    if (statSync(f).isDirectory()) return tsDosyalari(f);
    return f.endsWith(".ts") ? [f] : [];
  });
}

/** as-of yüklemi: model erişimcisini anan dosyada `revokedAt: { gt|gte … }` nesnesi ya da tabloya ham SQL pencere. */
function asOfYuklemleri(dosya: string): number {
  const ham = readFileSync(dosya, "utf8");
  const sf = ts.createSourceFile(dosya, ham, ts.ScriptTarget.Latest, true);
  let modelVar = false;
  let n = 0;
  const gez = (x: ts.Node): void => {
    if (ts.isPropertyAccessExpression(x) && MODELLER.has(x.name.text)) modelVar = true;
    if (ts.isPropertyAssignment(x) && x.name.getText(sf) === "revokedAt" && ts.isObjectLiteralExpression(x.initializer)) {
      const anahtarlar = x.initializer.properties.map((p) => p.name?.getText(sf));
      if (anahtarlar.some((k) => k === "gt" || k === "gte")) n++;
    }
    ts.forEachChild(x, gez);
  };
  gez(sf);
  const sql = /(machine_cost_rates|service_consumable_norms)[\s\S]{0,400}"revokedAt"\s*(>|IS\s+NULL\s+OR)/i.test(ham) ? 1 : 0;
  return (modelVar ? n : 0) + sql;
}

function statik(): void {
  console.log("── §0 Statik ──");
  const ihlal = tsDosyalari(SRC).filter((f) => f !== HELPER && asOfYuklemleri(f) > 0).map((f) => path.relative(SRC, f));
  check("§0 körlük zemini: helper'daki pencere yüklemi tarayıcıya görünüyor (≥ 1)", asOfYuklemleri(HELPER) >= 1, `${asOfYuklemleri(HELPER)}`);
  check("§0a ⭐ ücret/norm as-of yüklemi yalnız cost-rate-validity.helper.ts'te", ihlal.length === 0, ihlal.join(", ") || "temiz");
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  console.log("=== MAKİNE SAAT ÜCRETİ + SARF NORMU BEKÇİSİ ===\n");
  statik();

  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const setSetting = (key: string, v: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  const admin = await ensureTestAdmin();
  const ids = { stations: [] as string[], machines: [] as string[], items: [] as string[], users: [] as string[] };
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
  const kullanici = async (ek: string, izinler: string[]): Promise<{ id: string; token: string }> => {
    const username = `${TAG}-${ek}`.toLowerCase();
    const u = await prisma.user.create({ data: { username, fullName: `${TAG} ${ek}`, passwordHash: await AuthService.hashPassword("test123456"), isActive: true }, select: { id: true } });
    ids.users.push(u.id);
    const perms = await prisma.permission.findMany({ where: { code: { in: izinler } }, select: { id: true } });
    if (perms.length) await prisma.userPermission.createMany({ data: perms.map((p) => ({ userId: u.id, permissionId: p.id })) });
    const r = await call("POST", "/api/auth/login", null, { username, password: "test123456" });
    const token = (r.body as { data?: { token?: string } }).data?.token;
    if (!token) throw new Error(`login başarısız: ${username} (${r.status})`);
    return { id: u.id, token };
  };
  const station = await prisma.station.create({ data: { code: `MUS-ST-${process.pid}`, name: `${TAG} istasyon`, type: StationType.INTERNAL }, select: { id: true } });
  ids.stations.push(station.id);
  let sira = 0;
  const makine = async (isActive = true): Promise<string> => {
    const m = await prisma.machine.create({ data: { stationId: station.id, code: `MUS${process.pid % 100000}-${++sira}`, name: `${TAG} makine ${sira}`, isActive }, select: { id: true } });
    ids.machines.push(m.id);
    return m.id;
  };
  const kalem = async (itemType: ItemType, isActive = true): Promise<string> => {
    const it = await prisma.item.create({
      data: { code: `MUS${process.pid % 100000}-${++sira}`, name: `${TAG} ${itemType} ${sira}`, itemType, unit: itemType === ItemType.CONSUMABLE ? "KG" : "MT", isActive, ...(isActive ? {} : { lifecycleStatus: ItemLifecycleStatus.ARCHIVED }) },
      select: { id: true },
    });
    ids.items.push(it.id);
    return it.id;
  };
  const uid = admin.id;

  try {
    await setSetting(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setSetting(SETTING_KEYS.MALIYET_ENABLED, true);

    // ── §1 ücret YARAT ──
    console.log("\n── §1 Ücret yarat ──");
    const m1 = await makine();
    const t1 = randomUUID();
    const r1a = await createMachineCostRate(m1, { hourRateTry: "150.5", normMPerHour: "40", clientToken: t1 }, uid);
    const r1b = await createMachineCostRate(m1, { hourRateTry: "150.5", normMPerHour: "40", clientToken: t1 }, uid);
    check("§1a ⭐ aynı clientToken iki istek → aynı satır (replay)", r1a.row.id === r1b.row.id && (await prisma.machineCostRate.count({ where: { machineId: m1 } })) === 1, `${r1a.row.id} / ${r1b.row.id}`);
    const m1b = await makine();
    const t1b = randomUUID();
    const ikiz = await Promise.allSettled([
      createMachineCostRate(m1b, { hourRateTry: "10", clientToken: t1b }, uid),
      createMachineCostRate(m1b, { hourRateTry: "10", clientToken: t1b }, uid),
    ]);
    const ikizIds = ikiz.map((x) => (x.status === "fulfilled" ? x.value.row.id : `RED:${kod(x.reason as AppError)}`));
    check("§1b ⭐ aynı token eşzamanlı iki istek → tek satır, iki yanıt aynı", ikizIds[0] === ikizIds[1] && (await prisma.machineCostRate.count({ where: { machineId: m1b } })) === 1, ikizIds.join(" | "));
    const e1c = await hata(() => createMachineCostRate(m1, { hourRateTry: "99", clientToken: randomUUID() }, uid));
    check("§1c aktif ücret varken ikinci yaratma → 409 COST_RATE_ACTIVE_EXISTS", e1c?.statusCode === 409 && kod(e1c) === "COST_RATE_ACTIVE_EXISTS", kod(e1c));
    const e1d = await hata(() => createMachineCostRate(m1, { hourRateTry: "151", clientToken: t1 }, uid));
    check("§1d aynı token başka ücret → 409 CLIENT_TOKEN_COLLISION", e1d?.statusCode === 409 && kod(e1d) === "CLIENT_TOKEN_COLLISION", kod(e1d));
    const m1e = await makine();
    const e1e = await hata(() => createMachineCostRate(m1e, { hourRateTry: "-1", clientToken: randomUUID() }, uid));
    check("§1e negatif ücret → 400", e1e?.statusCode === 400, kod(e1e));

    // ── §2 ücret DEĞİŞTİR ──
    console.log("\n── §2 Ücret değiştir ──");
    const a = r1a.row;
    const t2 = randomUUID();
    const c2a = await changeMachineCostRate(a.id, { hourRateTry: "175", clientToken: t2 }, uid);
    const aSonra = await prisma.machineCostRate.findUniqueOrThrow({ where: { id: a.id } });
    const b = await prisma.machineCostRate.findUniqueOrThrow({ where: { id: c2a.row.id } });
    check("§2a ⭐ değişim: eski satır damgalı + yeni satır aynı anda doğdu", !!aSonra.revokedAt && aSonra.revokedAt.getTime() === b.createdAt.getTime() && b.revokedAt === null && c2a.previousId === a.id, `${aSonra.revokedAt?.toISOString()} = ${b.createdAt.toISOString()}`);
    const c2b = await changeMachineCostRate(a.id, { hourRateTry: "175", clientToken: t2 }, uid);
    check("§2b ⭐ aynı token tekrar (zaman aşımı sonrası) → ilk yanıtın satırı, üçüncü satır YOK", c2b.row.id === b.id && (await prisma.machineCostRate.count({ where: { machineId: m1 } })) === 2, `${c2b.row.id} n=${await prisma.machineCostRate.count({ where: { machineId: m1 } })}`);
    const e2c = await hata(() => changeMachineCostRate(a.id, { hourRateTry: "180", clientToken: randomUUID() }, uid));
    const aSon = await prisma.machineCostRate.findUniqueOrThrow({ where: { id: a.id } });
    check("§2c ⭐ bayat (damgalı) satırı değiştirme → 409 COST_RATE_STALE, eski damga değişmedi", e2c?.statusCode === 409 && kod(e2c) === "COST_RATE_STALE" && aSon.revokedAt?.getTime() === aSonra.revokedAt?.getTime(), kod(e2c));
    const yaris = await Promise.allSettled([
      changeMachineCostRate(b.id, { hourRateTry: "190", clientToken: randomUUID() }, uid),
      changeMachineCostRate(b.id, { hourRateTry: "195", clientToken: randomUUID() }, uid),
    ]);
    const ok2 = yaris.filter((x) => x.status === "fulfilled").length;
    const red2 = yaris.flatMap((x) => (x.status === "rejected" ? [kod(x.reason as AppError)] : []));
    check("§2d ⭐ eşzamanlı iki değişim → 1 başarı + 1 409 COST_RATE_STALE", ok2 === 1 && red2.length === 1 && red2[0] === "COST_RATE_STALE", `ok=${ok2} red=${red2.join(",")}`);
    check("§2e makinede tek aktif ücret kaldı", (await prisma.machineCostRate.count({ where: { machineId: m1, revokedAt: null } })) === 1);

    // ── §3 as-of tablosu ──
    console.log("\n── §3 As-of okuma ──");
    const satirlar = await prisma.machineCostRate.findMany({ where: { machineId: m1 }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    const [s0, s1, s2] = satirlar;
    const ms = (d: Date, k: number) => new Date(d.getTime() + k);
    const vaka = async (ad: string, at: Date, beklenen: string | null): Promise<string | null> => {
      const r = await machineCostRateValidAt(prisma, m1, at);
      const ikizSatir = satirlar.filter((x) => isCostRateValidAt(x, at));
      const ok = (r?.id ?? null) === beklenen && (ikizSatir[0]?.id ?? null) === beklenen && ikizSatir.length <= 1;
      if (!ok) return `${ad}: db=${r?.id ?? "null"} ikiz=${ikizSatir.map((x) => x.id).join(",") || "null"} beklenen=${beklenen ?? "null"}`;
      return null;
    };
    const vakalar = [
      await vaka("ilk sürümden önce", ms(s0!.createdAt, -1), null),
      await vaka("ilk sürüm başı (dahil)", s0!.createdAt, s0!.id),
      await vaka("değişimden 1 ms önce", ms(s1!.createdAt, -1), s0!.id),
      await vaka("değişim anı (eski sonu hariç)", s1!.createdAt, s1!.id),
      await vaka("ikinci değişimden önce", ms(s2!.createdAt, -1), s1!.id),
      await vaka("şimdi", new Date(), s2!.id),
    ].filter((x): x is string => x !== null);
    check("§3a ⭐ as-of tablosu: değişim öncesi/sonrası doğru sürüm (DB + bellek-içi ikiz)", vakalar.length === 0 && satirlar.length === 3, vakalar.join(" · ") || "6/6");
    await revokeMachineCostRate(s2!.id, null, uid);
    const s2d = await prisma.machineCostRate.findUniqueOrThrow({ where: { id: s2!.id } });
    const sonra = await machineCostRateValidAt(prisma, m1, s2d.revokedAt!);
    const once = await machineCostRateValidAt(prisma, m1, ms(s2d.revokedAt!, -1));
    check("§3b ⭐ damgalı satır damga anından sonra görünmez, öncesinde görünür", sonra === null && once?.id === s2!.id, `sonra=${sonra?.id ?? "null"} önce=${once?.id ?? "null"}`);

    // ── §4 sarf normu ──
    console.log("\n── §4 Sarf normu ──");
    const hizmet = await kalem(ItemType.SERVICE);
    const sarf = await kalem(ItemType.CONSUMABLE);
    const kumas = await kalem(ItemType.FABRIC);
    const e4a = await hata(() => createConsumableNorm(kumas, sarf, { qtyPerM: "0.01", clientToken: randomUUID() }, uid));
    check("§4a ⭐ SERVICE dışı hizmet kalemi → 400 SERVICE_ITEM_INVALID", e4a?.statusCode === 400 && kod(e4a) === "SERVICE_ITEM_INVALID", kod(e4a));
    const e4b = await hata(() => createConsumableNorm(hizmet, kumas, { qtyPerM: "0.01", clientToken: randomUUID() }, uid));
    check("§4b ⭐ CONSUMABLE dışı sarf kalemi → 400 CONSUMABLE_ITEM_INVALID", e4b?.statusCode === 400 && kod(e4b) === "CONSUMABLE_ITEM_INVALID", kod(e4b));
    const tn = randomUUID();
    const n1 = await createConsumableNorm(hizmet, sarf, { qtyPerM: "0.012500", clientToken: tn }, uid);
    const n1b = await createConsumableNorm(hizmet, sarf, { qtyPerM: "0.0125", clientToken: tn }, uid);
    check("§4c ⭐ norm: aynı clientToken iki istek → tek satır + replay", n1.row.id === n1b.row.id && (await prisma.serviceConsumableNorm.count({ where: { serviceItemId: hizmet } })) === 1);
    check("§4d birim sarf kaleminden donar (KG)", n1.row.unit === "KG", n1.row.unit);
    const tn2 = randomUUID();
    const n2 = await changeConsumableNorm(n1.row.id, { qtyPerM: "0.015", clientToken: tn2 }, uid);
    const n2b = await changeConsumableNorm(n1.row.id, { qtyPerM: "0.015", clientToken: tn2 }, uid);
    const n1d = await prisma.serviceConsumableNorm.findUniqueOrThrow({ where: { id: n1.row.id } });
    check("§4e ⭐ norm değişimi: damga + yeni satır; aynı token tekrar üçüncü satır yaratmaz", n2b.row.id === n2.row.id && n1d.revokedAt?.getTime() === new Date(n2.row.createdAt).getTime() && (await prisma.serviceConsumableNorm.count({ where: { serviceItemId: hizmet } })) === 2);
    const e4f = await hata(() => changeConsumableNorm(n1.row.id, { qtyPerM: "0.02", clientToken: randomUUID() }, uid));
    check("§4f bayat normu değiştirme → 409 CONSUMABLE_NORM_STALE", e4f?.statusCode === 409 && kod(e4f) === "CONSUMABLE_NORM_STALE", kod(e4f));
    const gecmis = await consumableNormsValidAt(prisma, hizmet, new Date(n1d.revokedAt!.getTime() - 1));
    const simdi = await consumableNormsValidAt(prisma, hizmet, new Date());
    check("§4g ⭐ norm as-of: değişim öncesi eski, sonrası yeni miktar", gecmis.length === 1 && gecmis[0]!.id === n1.row.id && simdi.length === 1 && simdi[0]!.qtyPerM.equals("0.015"), `${gecmis.map((x) => x.qtyPerM.toString())} / ${simdi.map((x) => x.qtyPerM.toString())}`);
    const e4h = await hata(() => createConsumableNorm(hizmet, sarf, { qtyPerM: "0.03", clientToken: randomUUID() }, uid));
    check("§4h aktif norm varken ikinci yaratma → 409 CONSUMABLE_NORM_ACTIVE_EXISTS", kod(e4h) === "CONSUMABLE_NORM_ACTIVE_EXISTS", kod(e4h));

    // ── §5 DB seddi ──
    console.log("\n── §5 DB seddi ──");
    const ham = (machineId: string, rate: string, revoked = false) =>
      prisma.$executeRaw`INSERT INTO "machine_cost_rates" ("id","machineId","hourRateTry","clientToken","createdById","revokedAt","updatedAt")
        VALUES (${randomUUID()}::uuid, ${machineId}::uuid, ${rate}::numeric, ${randomUUID()}::uuid, ${uid}::uuid, ${revoked ? new Date() : null}::timestamptz, now())`;
    check("§5a ⭐ DB'de çift aktif tarife insert → 23505", (await pgKodu(() => ham(m1b, "11"))) === "23505", await pgKodu(() => ham(m1b, "11")));
    const m5 = await makine();
    check("§5b negatif ücret insert → 23514", (await pgKodu(() => ham(m5, "-1"))) === "23514");
    check("§5c damga açansız insert → 23514", (await pgKodu(() => ham(m5, "1", true))) === "23514");
    const hamNorm = () =>
      prisma.$executeRaw`INSERT INTO "service_consumable_norms" ("id","serviceItemId","consumableItemId","qtyPerM","unit","clientToken","createdById","updatedAt")
        VALUES (${randomUUID()}::uuid, ${hizmet}::uuid, ${sarf}::uuid, 0.5, 'KG', ${randomUUID()}::uuid, ${uid}::uuid, now())`;
    check("§5d ⭐ DB'de çift aktif norm insert → 23505", (await pgKodu(hamNorm)) === "23505");

    // ── §6 pasif + kaldırma ──
    console.log("\n── §6 Pasif kayıt ve kaldırma ──");
    const pasifM = await makine(false);
    const e6a = await hata(() => createMachineCostRate(pasifM, { hourRateTry: "5", clientToken: randomUUID() }, uid));
    check("§6a pasif makine → 409 MACHINE_INACTIVE", e6a?.statusCode === 409 && kod(e6a) === "MACHINE_INACTIVE", kod(e6a));
    const pasifSarf = await kalem(ItemType.CONSUMABLE, false);
    const e6b = await hata(() => createConsumableNorm(hizmet, pasifSarf, { qtyPerM: "0.1", clientToken: randomUUID() }, uid));
    check("§6b pasif sarf kalemi → 409 ITEM_INACTIVE", e6b?.statusCode === 409 && kod(e6b) === "ITEM_INACTIVE", kod(e6b));
    await revokeConsumableNorm(n2.row.id, "deneme", uid);
    const e6c = await hata(() => revokeConsumableNorm(n2.row.id, null, uid));
    const nKalan = await prisma.serviceConsumableNorm.count({ where: { serviceItemId: hizmet } });
    check("§6c kaldırma damgadır (satır durur), ikinci kaldırma 409", kod(e6c) === "CONSUMABLE_NORM_STALE" && nKalan === 2, `${kod(e6c)} n=${nKalan}`);
    const e6d = await hata(() => createConsumableNorm(hizmet, sarf, { qtyPerM: "0.0125", clientToken: tn }, uid));
    check("§6d damgalanmış normun token'ı tekrar → 409 CONSUMABLE_NORM_SUPERSEDED", kod(e6d) === "CONSUMABLE_NORM_SUPERSEDED", kod(e6d));

    // ── §7 HTTP ──
    console.log("\n── §7 HTTP ──");
    const okur = await kullanici("okur", ["cost:read"]);
    const yazar = await kullanici("yazar", ["cost:read", "cost:write"]);
    const m7 = await makine();
    await setSetting(SETTING_KEYS.MALIYET_ENABLED, false);
    const kapali = [
      await call("GET", "/api/cost/machine-rates", yazar.token),
      await call("POST", "/api/cost/machine-rates", yazar.token, { machineId: m7, hourRateTry: 1, clientToken: randomUUID() }),
      await call("GET", "/api/cost/consumable-norms", yazar.token),
      await call("POST", "/api/cost/consumable-norms", yazar.token, { serviceItemId: hizmet, consumableItemId: sarf, qtyPerM: 1, clientToken: randomUUID() }),
    ];
    check("§7a ⭐ maliyet kapalıyken dört uç 403 MODULE_DISABLED", kapali.every((r) => r.status === 403 && r.body.details?.code === "MODULE_DISABLED"), kapali.map((r) => `${r.status}/${String(r.body.details?.code)}`).join(" "));
    await setSetting(SETTING_KEYS.MALIYET_ENABLED, true);
    const r7b = await call("POST", "/api/cost/machine-rates", okur.token, { machineId: m7, hourRateTry: 1, clientToken: randomUUID() });
    check("§7b cost:read ile yazma → 403", r7b.status === 403, String(r7b.status));
    const r7c = await call("POST", "/api/cost/machine-rates", yazar.token, { machineId: m7, hourRateTry: "12.5", clientToken: randomUUID() });
    check("§7c cost:write ile yaratma → 201", r7c.status === 201, `${r7c.status} ${r7c.body.message ?? ""}`);
    const r7d = await call("GET", `/api/cost/machine-rates?filter[machineId]=${m7}&includeRevoked=1`, okur.token);
    const liste = (r7d.body.data as Array<{ machineId: string }> | undefined) ?? [];
    check("§7d filter[machineId] sunucuda süzer", r7d.status === 200 && liste.length === 1 && liste[0]!.machineId === m7, `${r7d.status} n=${liste.length}`);
    const r7e = await call("GET", `/api/cost/machine-rates?machineId=${m7}`, okur.token);
    check("§7e çıplak machineId → 400 BARE_FILTER_PARAM", r7e.status === 400 && r7e.body.details?.code === "BARE_FILTER_PARAM", `${r7e.status}`);
    const r7f = await call("POST", "/api/cost/machine-rates", yazar.token, { machineId: m7, hourRateTry: "12.5" });
    check("§7f clientToken'sız yaratma → 400", r7f.status === 400, String(r7f.status));

    // ── §8 audit ──
    console.log("\n── §8 Audit ──");
    await new Promise((r) => setTimeout(r, 300));
    const loglar = await prisma.systemLog.findMany({ where: { recordId: { in: [a.id, b.id, n1.row.id] } }, select: { tableName: true, action: true, newData: true, oldData: true } });
    // UUID'ler sayıyı rastgele içerebilir (ör. "…175…") — değer araması kimliklerden arındırılmış yükte.
    const yuk = JSON.stringify(loglar.map((l) => [l.newData, l.oldData])).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>");
    check("§8a CREATE + UPDATE satırları var (ücret + norm)", loglar.some((l) => l.tableName === "MACHINE_COST_RATE" && l.action === "UPDATE") && loglar.some((l) => l.tableName === "MACHINE_COST_RATE" && l.action === "CREATE") && loglar.some((l) => l.tableName === "SERVICE_CONSUMABLE_NORM"), `${loglar.length} satır`);
    check("§8b ⭐ audit yükünde ücret/norm DEĞERİ yok", !/150\.5|175|0\.0125|0\.015/.test(yuk), yuk.slice(0, 160));
  } finally {
    server.close();
    await temizle(ids, foto);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
}

async function temizle(ids: { stations: string[]; machines: string[]; items: string[]; users: string[] }, foto: Array<{ key: string; value: Prisma.JsonValue }>): Promise<void> {
  const oranlar = await prisma.machineCostRate.findMany({ where: { machineId: { in: ids.machines } }, select: { id: true } });
  const normlar = await prisma.serviceConsumableNorm.findMany({ where: { serviceItemId: { in: ids.items } }, select: { id: true } });
  await prisma.systemLog.deleteMany({ where: { recordId: { in: [...oranlar.map((x) => x.id), ...normlar.map((x) => x.id)] } } });
  await prisma.machineCostRate.deleteMany({ where: { machineId: { in: ids.machines } } });
  await prisma.serviceConsumableNorm.deleteMany({ where: { serviceItemId: { in: ids.items } } });
  await prisma.machine.deleteMany({ where: { id: { in: ids.machines } } });
  await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
  await prisma.item.deleteMany({ where: { id: { in: ids.items } } });
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
