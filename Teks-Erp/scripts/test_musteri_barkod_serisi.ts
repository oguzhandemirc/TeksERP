// =============================================================================
// BEKÇİ — D4-F2 müşteri barkod serisi + Tambur çıkışında müşteri kodunun doğuşu
// Çalıştır: npx tsx scripts/test_musteri_barkod_serisi.ts · DALGA4 §7.4–7.5, §12.1, §13 D4-F2
// =============================================================================
// §1 ⭐ seri yaratma aynı token iki istek → tek seri + replay; ikinci seri 409 CUSTOMER_SERIES_EXISTS;
//    aynı token farklı biçim → 409 CLIENT_TOKEN_COLLISION; geçersiz biçim 400.
// §2 önizleme: biçim değişiyorsa ilk üç kod; değişmiyorsa sıradaki kod; yazmaz.
// §3 ⭐ biçim değişimi atomik: bayat expectedUpdatedAt → 409 SERIES_CHANGED; aynı içerik → 200
//    değişiklik yok (formatChangedAt aynı).
// §4 ⭐ label.customerCodeAt=NONE (varsayılan) → Tambur finalize cevabı bugünkü anahtarlar, kod satırı YOK.
// §5 ⭐ TAMBUR_OUTPUT → depo çocuklarına seriden kod AYNI tx'te (source CUSTOMER_SERIES, seriesId);
//    sayaç satırının kapsamı formatChangedAt'i içerir.
// §5b ⭐ çakışma: sıradaki kod müşteride başka topa bağlıysa atlanır (P2002 retry karşılığı).
// §6 ⭐ biçim değişimi: eski kodlar DEĞİŞMEZ; yeni biçim sayacı baştan (CD…0001); A→B→A dönüşünde
//    YENİ kapsam satırı doğar (sayaç eski satırdan sürmez) ve mevcut kodlar atlanır.
// §7 dört kapı: Zod iki değeri kabul / bilinmeyeni red; servis 400; çöp → NONE; getFeatureFlags alanı.
// §8 ⭐ (PR #383 inceleme) seride 200+ dolu kod varken: üst sınır yükseltme formatChangedAt'i YENİLEMEZ ve sayaç
//    eski kodların üstünden sürer; A→B→A dönüşünde tohum eski A kodlarının üstünden; seri dolunca finalize
//    BAŞARILI + warnings (kodsuz top); eşzamanlı iki PUT'tan biri 409 (yalnız etkinlik değişimi dahil);
//    Tambur geri alımında iptal edilen çocuğun kodu damgalanır.
// Negatif sonda (2026-11-01): seedSeq'e `createdAt >= formatChangedAt` süzgeci + sınır değişiminde damga
//    yenileme geri konunca §8a/§8b ❌ ("200 ardışık kod dolu"); claim `formatChangedAt`e dönünce §3 + §8d ❌;
//    geri almada damga kaldırılınca §8e ❌.
// Negatif sonda (2026-11-01, elle; PR gövdesinde): `customerSeriesScope`ta biçim formatChangedAt'siz
// okunursa (`formatChangedAt: null`) §6 "A→B→A yeni kapsam satırı" ❌.
// Ayar YAZAR: ilk iş `hedefDbEngeli()`; ayar satırı başta silinir, `finally`de birebir geri yüklenir.
// =============================================================================
import { randomUUID } from "node:crypto";
import { Prisma, RollStatus, StationKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { cleanupTestCustomers } from "./fixture-customer-cleanup";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService } from "../src/services/tambur-undo.service";
import { CustomerBarcodeSeriesService } from "../src/services/customer-barcode-series.service";
import { customerSeriesCounterKey } from "../src/services/helpers/customer-code-birth.helper";
import { AppError } from "../src/utils/app-error";
import {
  SETTING_KEYS,
  invalidateFeatureFlagsCache,
  readLabelCustomerCodeAt,
  systemSettingService,
} from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function writeSetting(key: string, value: Prisma.InputJsonValue | null): Promise<void> {
  if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
  else await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  invalidateFeatureFlagsCache();
}

async function caught(fn: () => Promise<unknown>): Promise<{ status: number; code: string; msg: string }> {
  try {
    await fn();
    return { status: 0, code: "", msg: "hata yok" };
  } catch (e) {
    if (e instanceof AppError) {
      return { status: e.statusCode, code: String((e.details as { code?: string } | undefined)?.code ?? ""), msg: e.message };
    }
    return { status: -1, code: "", msg: e instanceof Error ? e.message : String(e) };
  }
}

const rollIds: string[] = [];
const woIds: string[] = [];
const itemIds: string[] = [];
const customerIds: string[] = [];
const seriesIds: string[] = [];

(async () => {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`✗ ${engel}`);
    process.exitCode = 1;
    return;
  }
  const saved = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEYS.LABEL_CUSTOMER_CODE_AT }, select: { value: true } });
  await writeSetting(SETTING_KEYS.LABEL_CUSTOMER_CODE_AT, null);
  const tag = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  // Ön ek iç serilerle çakışmasın diye "Q" ile başlar + damga (her koşum kendi serisi).
  const PA = `QA${tag.slice(-6)}`;
  const PB = `QB${tag.slice(-6)}`;
  const svc = new TamburService();
  try {
    const actor = await testActorId();
    const customer = await prisma.customer.create({ data: { code: `TEST-MBS-${tag}`.slice(0, 32), name: `TEST MBS ${tag}` }, select: { id: true } });
    customerIds.push(customer.id);
    const C = customer.id;
    const station = await prisma.station.findFirstOrThrow({ where: { kind: StationKind.TAMBUR }, select: { id: true } });
    const item = await prisma.item.create({
      data: { code: `TEST-MBS-ITM-${tag}`, name: `TEST MBS PERDE ${tag}`, itemType: "FABRIC", unit: "MT" },
      select: { id: true },
    });
    itemIds.push(item.id);
    const gradeCode = (await roleGrade("FIRST")).code;

    /** İş emri + aktif TAMBUR adımı + adımda 1 top (owner verilirse EMANET). */
    const makeRoll = async (owner: string | null) => {
      const wo = await prisma.workOrder.create({
        data: { workOrderNumber: `TEST-MBS-IE-${tag}-${woIds.length}`, status: "IN_PROGRESS", targetItemId: item.id, width: 280 },
        select: { id: true },
      });
      woIds.push(wo.id);
      const step = await prisma.workOrderStep.create({
        data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "ACTIVE" },
        select: { id: true },
      });
      const roll = await prisma.roll.create({
        data: {
          barcode: `TEST-MBS-R-${tag}-${rollIds.length}`, itemId: item.id, width: 280, initialQty: 100, currentQty: 100,
          status: RollStatus.IN_PRODUCTION, currentStepId: step.id, entrySource: "SUPPLIER_RECEIPT", qualityGrade: gradeCode,
          ownerCustomerId: owner,
        },
        select: { id: true },
      });
      rollIds.push(roll.id);
      await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: step.id, qtyIn: 100 } });
      return roll.id;
    };
    const finalize = (rollId: string, cuts = 2) =>
      svc.finalize({
        rollId,
        decisions: [],
        cuts: Array.from({ length: cuts }, () => ({ length: 30, qualityGrade: gradeCode, relatedErrorIds: [] as string[] })),
      }, actor);
    const codesOf = async (rollId: string) => {
      const kids = await prisma.roll.findMany({ where: { parentRollId: rollId, status: RollStatus.WAREHOUSE }, select: { id: true } });
      rollIds.push(...kids.map((k) => k.id));
      return prisma.rollCustomerCode.findMany({
        where: { rollId: { in: kids.map((k) => k.id) }, revokedAt: null },
        orderBy: { code: "asc" },
        select: { code: true, source: true, seriesId: true, rollId: true },
      });
    };

    // ── §1 yaratma + replay ──
    console.log("\n[§1] seri yaratma — token replay");
    const fmtA = { prefix: PA, dateSegment: "NONE" as const, digits: 4, separator: "", startValue: null, maxValue: null };
    const token = randomUUID();
    const c1 = await CustomerBarcodeSeriesService.create(C, { ...fmtA, clientToken: token }, actor);
    const c2 = await CustomerBarcodeSeriesService.create(C, { ...fmtA, clientToken: token }, actor);
    seriesIds.push(c1.data.id);
    const count = await prisma.customerBarcodeSeries.count({ where: { customerId: C } });
    check("§1 ⭐ aynı token iki istek → tek seri + replay", c1.data.id === c2.data.id && count === 1 && c2.idempotent === true && c1.idempotent !== true, `count=${count}`);
    const second = await caught(() => CustomerBarcodeSeriesService.create(C, { ...fmtA, clientToken: randomUUID() }, actor));
    check("§1b ikinci seri → 409 CUSTOMER_SERIES_EXISTS", second.status === 409 && second.code === "CUSTOMER_SERIES_EXISTS", `${second.status} ${second.code}`);
    const coll = await caught(() => CustomerBarcodeSeriesService.create(C, { ...fmtA, digits: 5, clientToken: token }, actor));
    check("§1c aynı token farklı biçim → 409 CLIENT_TOKEN_COLLISION", coll.status === 409 && coll.code === "CLIENT_TOKEN_COLLISION", `${coll.status} ${coll.code}`);
    const bad = await caught(() => CustomerBarcodeSeriesService.create(C, { ...fmtA, prefix: "A B", clientToken: randomUUID() }, actor));
    check("§1d geçersiz ön ek → 400", bad.status === 400, bad.msg);

    // ── §2 önizleme ──
    console.log("\n[§2] önizleme");
    const pv1 = await CustomerBarcodeSeriesService.preview(C, {});
    check("§2 biçim aynı → sıradaki kod (yazmadan)", !pv1.data.formatChanged && pv1.data.codes[0] === `${PA}0001` && !pv1.data.collides, JSON.stringify(pv1.data));
    const pv2 = await CustomerBarcodeSeriesService.preview(C, { prefix: PB, separator: "-", digits: 3 });
    check("§2b biçim farklı → ilk üç kod", pv2.data.formatChanged && pv2.data.codes.join(",") === `${PB}-001,${PB}-002,${PB}-003`, pv2.data.codes.join(","));
    const counterRows0 = await prisma.numberSeriesCounter.count({ where: { seriesKey: customerSeriesCounterKey(c1.data.id) } });
    check("§2c önizleme sayaç satırı yazmaz", counterRows0 === 0, String(counterRows0));

    // ── §3 biçim değişimi atomik ──
    console.log("\n[§3] biçim değişimi — atomik claim");
    const stale = await caught(() =>
      CustomerBarcodeSeriesService.update(C, { ...fmtA, prefix: PB, isActive: true, expectedUpdatedAt: new Date(Date.now() - 86_400_000).toISOString() }, actor),
    );
    check("§3 ⭐ bayat expectedUpdatedAt → 409 SERIES_CHANGED", stale.status === 409 && stale.code === "SERIES_CHANGED", `${stale.status} ${stale.code}`);
    const same = await CustomerBarcodeSeriesService.update(C, { ...fmtA, isActive: true, expectedUpdatedAt: new Date(0).toISOString() }, actor);
    check("§3b aynı içerik → değişiklik yok (idempotent, formatChangedAt aynı)", same.idempotent === true && same.data.formatChangedAt.getTime() === c1.data.formatChangedAt.getTime());
    const unchanged = await prisma.customerBarcodeSeries.findUniqueOrThrow({ where: { id: c1.data.id }, select: { prefix: true } });
    check("§3c 409 sonrası biçim değişmedi", unchanged.prefix === PA, unchanged.prefix);

    // ── §4 NONE: bugünkü davranış ──
    console.log("\n[§4] label.customerCodeAt=NONE");
    const r4 = await makeRoll(C);
    const res4 = await finalize(r4);
    const k4 = await codesOf(r4);
    check("§4 ⭐ NONE → cevap anahtarları bugünkü, kod satırı yok", Object.keys(res4.data).sort().join(",") === "originalRoll,processedErrors,splitRolls" && k4.length === 0, `${Object.keys(res4.data).join(",")} kod=${k4.length}`);

    // ── §5 TAMBUR_OUTPUT ──
    console.log("\n[§5] label.customerCodeAt=TAMBUR_OUTPUT");
    await writeSetting(SETTING_KEYS.LABEL_CUSTOMER_CODE_AT, "TAMBUR_OUTPUT");
    const r5 = await makeRoll(C);
    const res5 = await finalize(r5);
    const k5 = await codesOf(r5);
    const warehouseKids = await prisma.roll.count({ where: { parentRollId: r5, status: RollStatus.WAREHOUSE } });
    check(
      "§5 ⭐ depo çocuklarına seriden kod (CUSTOMER_SERIES + seriesId)",
      warehouseKids >= 2 && k5.length === warehouseKids && k5.every((k) => k.source === "CUSTOMER_SERIES" && k.seriesId === c1.data.id) && k5[0]!.code === `${PA}0001`,
      k5.map((k) => k.code).join(","),
    );
    check("§5a cevapta customerCodes", (res5.data.customerCodes?.length ?? 0) === k5.length, JSON.stringify(res5.data.customerCodes));
    const s5 = await prisma.customerBarcodeSeries.findUniqueOrThrow({ where: { id: c1.data.id } });
    const rows5 = await prisma.numberSeriesCounter.findMany({ where: { seriesKey: customerSeriesCounterKey(c1.data.id) }, select: { scopeKey: true, n: true } });
    check("§5c sayaç kapsamı formatChangedAt'i içerir", rows5.length === 1 && rows5[0]!.scopeKey.includes(String(s5.formatChangedAt.getTime())), JSON.stringify(rows5));
    const r5n = await makeRoll(null);
    const res5n = await finalize(r5n);
    check("§5d emanet olmayan top → kod yok, cevap bugünkü", res5n.data.customerCodes === undefined && (await codesOf(r5n)).length === 0);

    // ── §5b çakışma ──
    console.log("\n[§5b] çakışma — sıradaki kod başka topta");
    const nextExpected = `${PA}${String(warehouseKids + 1).padStart(4, "0")}`;
    const other = await prisma.roll.create({
      data: { barcode: `TEST-MBS-O-${tag}`, itemId: item.id, initialQty: 10, currentQty: 10, ownerCustomerId: C },
      select: { id: true },
    });
    rollIds.push(other.id);
    await prisma.rollCustomerCode.create({ data: { rollId: other.id, customerId: C, code: nextExpected, source: "BOUND_LABEL", clientToken: randomUUID() } });
    const r5b = await makeRoll(C);
    await finalize(r5b, 1);
    const k5b = await codesOf(r5b);
    check("§5b ⭐ dolu kod atlanır, sıradaki verilir", k5b.length >= 1 && !k5b.some((k) => k.code === nextExpected) && k5b[0]!.code.startsWith(PA), k5b.map((k) => k.code).join(","));

    // ── §6 biçim değişimi: eski kodlar değişmez, sayaç yeni biçimden ──
    console.log("\n[§6] biçim değişimi");
    const before = await prisma.rollCustomerCode.findMany({ where: { seriesId: c1.data.id }, select: { id: true, code: true }, orderBy: { id: "asc" } });
    const toB = await CustomerBarcodeSeriesService.update(C, { ...fmtA, prefix: PB, separator: "-", isActive: true, expectedUpdatedAt: s5.updatedAt.toISOString() }, actor);
    check("§6a biçim değişti → formatChangedAt ilerledi", toB.data.formatChangedAt.getTime() > s5.formatChangedAt.getTime());
    const r6 = await makeRoll(C);
    await finalize(r6, 1);
    const k6 = await codesOf(r6);
    const after = await prisma.rollCustomerCode.findMany({ where: { id: { in: before.map((b) => b.id) } }, select: { id: true, code: true }, orderBy: { id: "asc" } });
    check("§6b ⭐ eski kodlar değişmedi", JSON.stringify(before) === JSON.stringify(after), `${before.length} kod`);
    check("§6c ⭐ yeni biçim sayacı baştan", k6.length >= 1 && k6[0]!.code === `${PB}-0001`, k6.map((k) => k.code).join(","));
    const rowsB = await prisma.numberSeriesCounter.count({ where: { seriesKey: customerSeriesCounterKey(c1.data.id) } });
    // A→B→A: ön ek ve hane eski kapsamla AYNI; ayrışmayı yalnız formatChangedAt sağlar.
    const toA = await CustomerBarcodeSeriesService.update(C, { ...fmtA, isActive: true, expectedUpdatedAt: toB.data.updatedAt.toISOString() }, actor);
    const r6b = await makeRoll(C);
    await finalize(r6b, 1);
    const k6b = await codesOf(r6b);
    const rowsA = await prisma.numberSeriesCounter.findMany({ where: { seriesKey: customerSeriesCounterKey(c1.data.id) }, select: { scopeKey: true } });
    check(
      "§6d ⭐ A→B→A: yeni kapsam satırı doğdu (sayaç eski satırdan sürmez)",
      rowsA.length === rowsB + 1 && rowsA.some((r) => r.scopeKey.includes(String(toA.data.formatChangedAt.getTime()))),
      `önce=${rowsB} sonra=${rowsA.length}`,
    );
    const allCodes = await prisma.rollCustomerCode.findMany({ where: { customerId: C }, select: { code: true } });
    check("§6e A→B→A: mevcut kodlar atlandı (müşteride tekrar yok)", k6b.length >= 1 && new Set(allCodes.map((c) => c.code)).size === allCodes.length, k6b.map((k) => k.code).join(","));

    // ── §8 200+ dolu kod: üst sınır · A→B→A · tükenme · eşzamanlı PUT · geri alma ──
    console.log("\n[§8] 200+ dolu kodlu seri");
    const c8 = await prisma.customer.create({ data: { code: `TEST-MBS8-${tag}`.slice(0, 32), name: `TEST MBS8 ${tag}` }, select: { id: true } });
    customerIds.push(c8.id);
    const PC = `QC${tag.slice(-6)}`;
    const PD = `QD${tag.slice(-6)}`;
    const fmtC = { prefix: PC, dateSegment: "NONE" as const, digits: 4, separator: "", startValue: null, maxValue: 500 };
    const s8 = await CustomerBarcodeSeriesService.create(c8.id, { ...fmtC, clientToken: randomUUID() }, actor);
    seriesIds.push(s8.data.id);
    const holder = await prisma.roll.create({ data: { barcode: `TEST-MBS-H-${tag}`, itemId: item.id, initialQty: 10, currentQty: 10, ownerCustomerId: c8.id }, select: { id: true } });
    rollIds.push(holder.id);
    await prisma.rollCustomerCode.createMany({
      data: Array.from({ length: 210 }, (_, i) => ({
        rollId: holder.id, customerId: c8.id, code: `${PC}${String(i + 1).padStart(4, "0")}`, source: "CUSTOMER_SERIES" as const,
        seriesId: s8.data.id, clientToken: randomUUID(), revokedAt: new Date(), revokeReason: "TEST",
      })),
    });
    const seqOf = (code: string) => Number(code.slice(PC.length));
    const raised = await CustomerBarcodeSeriesService.update(c8.id, { ...fmtC, maxValue: 9999, isActive: true, expectedUpdatedAt: s8.data.updatedAt.toISOString() }, actor);
    const r8a = await makeRoll(c8.id);
    const res8a = await finalize(r8a, 1);
    const k8a = await codesOf(r8a);
    check(
      "§8a ⭐ üst sınır yükseltme: formatChangedAt aynı, sayaç 210'un üstünden, uyarı yok",
      raised.data.formatChangedAt.getTime() === s8.data.formatChangedAt.getTime() && k8a.length >= 1 && k8a[0]!.code === `${PC}0211` && !res8a.warnings,
      `${k8a.map((k) => k.code).join(",")} warnings=${JSON.stringify(res8a.warnings)}`,
    );
    const maxA = Math.max(...k8a.map((k) => seqOf(k.code)));
    const toD = await CustomerBarcodeSeriesService.update(c8.id, { ...fmtC, prefix: PD, maxValue: 9999, isActive: true, expectedUpdatedAt: raised.data.updatedAt.toISOString() }, actor);
    const backC = await CustomerBarcodeSeriesService.update(c8.id, { ...fmtC, maxValue: 9999, isActive: true, expectedUpdatedAt: toD.data.updatedAt.toISOString() }, actor);
    const pv8 = await CustomerBarcodeSeriesService.preview(c8.id, {});
    const r8b = await makeRoll(c8.id);
    const res8b = await finalize(r8b, 1);
    const k8b = await codesOf(r8b);
    check(
      "§8b ⭐ A→B→A: yeni kapsam, tohum eski A kodlarının üstünden (finalize kodlu, uyarısız)",
      backC.data.formatChangedAt.getTime() > raised.data.formatChangedAt.getTime() && k8b.length >= 1 && seqOf(k8b[0]!.code) === maxA + 1 && !res8b.warnings,
      `${k8b.map((k) => k.code).join(",")} beklenen=${maxA + 1} warnings=${JSON.stringify(res8b.warnings)}`,
    );
    check("§8b2 önizleme doğumla aynı kodu gösterir", pv8.data.codes[0] === k8b[0]?.code, `${pv8.data.codes[0]} ≠ ${k8b[0]?.code}`);
    const maxB = Math.max(...k8b.map((k) => seqOf(k.code)));
    await CustomerBarcodeSeriesService.update(c8.id, { ...fmtC, maxValue: maxB, isActive: true, expectedUpdatedAt: backC.data.updatedAt.toISOString() }, actor);
    const r8c = await makeRoll(c8.id);
    let warn8c: string[] | undefined;
    const res8c = await caught(async () => { warn8c = (await finalize(r8c, 1)).warnings; });
    const k8c = await codesOf(r8c);
    const kids8c = await prisma.roll.count({ where: { parentRollId: r8c, status: RollStatus.WAREHOUSE } });
    check("§8c ⭐ seri doldu → finalize BAŞARILI + uyarı, çocuklar doğdu, kod yok", res8c.status === 0 && kids8c >= 1 && k8c.length === 0 && (warn8c?.length ?? 0) === 1, `${res8c.status} ${res8c.code} ${res8c.msg} kids=${kids8c} warnings=${JSON.stringify(warn8c)}`);
    const s8c = await prisma.customerBarcodeSeries.findUniqueOrThrow({ where: { id: s8.data.id } });
    const exp8 = s8c.updatedAt.toISOString();
    const race = await Promise.allSettled([
      CustomerBarcodeSeriesService.update(c8.id, { ...fmtC, maxValue: maxB, isActive: false, expectedUpdatedAt: exp8 }, actor),
      CustomerBarcodeSeriesService.update(c8.id, { ...fmtC, maxValue: 9999, isActive: true, expectedUpdatedAt: exp8 }, actor),
    ]);
    const lost = race.filter((r) => r.status === "rejected" && r.reason instanceof AppError && (r.reason.details as { code?: string } | undefined)?.code === "SERIES_CHANGED").length;
    check("§8d ⭐ eşzamanlı iki PUT (biri yalnız etkinlik) → biri 409 SERIES_CHANGED", race.filter((r) => r.status === "fulfilled").length === 1 && lost === 1, race.map((r) => r.status).join(","));
    const undoKid = k8a[0]!.rollId;
    const undo = await caught(() => new TamburUndoService().applyUndo(undoKid, actor));
    const undoCode = await prisma.rollCustomerCode.findFirst({ where: { rollId: undoKid }, select: { revokedAt: true, revokeReason: true } });
    const undoKidRow = await prisma.roll.findUniqueOrThrow({ where: { id: undoKid }, select: { status: true } });
    check(
      "§8e ⭐ Tambur geri alımı: iptal edilen çocuğun müşteri kodu damgalandı",
      undo.status === 0 && undoKidRow.status === RollStatus.CANCELLED && undoCode?.revokedAt != null,
      `${undo.status} ${undo.msg} status=${undoKidRow.status} revoked=${undoCode?.revokedAt != null}`,
    );

    // ── §7 dört kapı ──
    console.log("\n[§7] ayar dört kapı");
    const zOk = ["NONE", "TAMBUR_OUTPUT"].every((v) => updateSchema.safeParse({ labelCustomerCodeAt: v }).success);
    check("§7a Zod iki değeri kabul, bilinmeyeni reddeder", zOk && !updateSchema.safeParse({ labelCustomerCodeAt: "TAMBUR" }).success);
    const eBad = await caught(() => systemSettingService.setFeatureFlags({ labelCustomerCodeAt: "TAMBUR" as never }, actor));
    check("§7b servis bilinmeyen değere 400", eBad.status === 400, eBad.msg);
    await systemSettingService.setFeatureFlags({ labelCustomerCodeAt: "TAMBUR_OUTPUT" }, actor);
    invalidateFeatureFlagsCache();
    const flags = (await systemSettingService.getFeatureFlags()).data!;
    check("§7c yazılan değer okunur + getFeatureFlags alanı", (await readLabelCustomerCodeAt()) === "TAMBUR_OUTPUT" && flags.labelCustomerCodeAt === "TAMBUR_OUTPUT");
    await writeSetting(SETTING_KEYS.LABEL_CUSTOMER_CODE_AT, "JUNK");
    check("§7d DB'de çöp → varsayılan NONE", (await readLabelCustomerCodeAt()) === "NONE");
    await writeSetting(SETTING_KEYS.LABEL_CUSTOMER_CODE_AT, null);
    check("§7e kayıt yok → varsayılan NONE", (await readLabelCustomerCodeAt()) === "NONE");
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.stack : e);
  } finally {
    try {
      // Anahtar AÇIKÇA yazılır — test_bekci_ayar_geri_alma §1b geri almayı anahtar düzeyinde eşler.
      if (saved) {
        const value = saved.value as Prisma.InputJsonValue;
        await prisma.systemSetting.upsert({ where: { key: SETTING_KEYS.LABEL_CUSTOMER_CODE_AT }, create: { key: SETTING_KEYS.LABEL_CUSTOMER_CODE_AT, value }, update: { value } });
      } else {
        await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.LABEL_CUSTOMER_CODE_AT } });
      }
      invalidateFeatureFlagsCache();
    } catch (e) {
      fail++;
      console.error("ayar geri yükleme hatası:", e instanceof Error ? e.message : e);
    }
    try {
      const children = await prisma.roll.findMany({ where: { parentRollId: { in: rollIds } }, select: { id: true } });
      const kids = children.map((c) => c.id);
      const all = [...new Set([...rollIds, ...kids])];
      const parents = all.filter((id) => !kids.includes(id));
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...all, ...woIds, ...seriesIds] } } });
      await prisma.rollCustomerCode.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.numberSeriesCounter.deleteMany({ where: { seriesKey: { in: seriesIds.map(customerSeriesCounterKey) } } });
      await prisma.customerBarcodeSeries.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.rollPlanDeviation.deleteMany({ where: { OR: [{ rollId: { in: all } }, { childRollId: { in: all } }] } });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: all } } });
      await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: all } } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: all } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: all } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: all } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: all } } });
      await prisma.roll.deleteMany({ where: { id: { in: kids } } });
      await prisma.roll.deleteMany({ where: { id: { in: parents } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      await cleanupTestCustomers(customerIds);
      console.log("(temizlendi — TEST-MBS fixture silindi)");
    } catch (e) {
      fail++;
      console.error("temizlik hatası:", e instanceof Error ? e.message : e);
    }
    await prisma.$disconnect();
  }
  if (pass + fail === 0) { fail++; console.log("❌ hiçbir kontrol koşmadı"); }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
})();
