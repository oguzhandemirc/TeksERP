// =============================================================================
// BEKÇİ — Tezgah Salonu TOPLU İŞ VER · SATIR BAŞINA İŞ (C.6, çok iş → çok tezgah)
// =============================================================================
// Sözleşme (tasarım TEZGAH-SALONU-SECIM-IS-VERME §C.6): tek istek, satır başına bağımsız sonuç;
// satırın işi TEK çözümleyiciden (`rowJobIdOf`: satır alanı tanımlıysa o, null = işsiz; tanımsızsa
// istek düzeyi). F3 yolu aynen: önizleme yazmaz, satır başına `openMachineRun` + clientToken.
//   §1 karışık önizleme: her satır KENDİ işini taşır; SAME_JOB/REPLACE satırın işine göre
//   §2 karışık iş ver: her koşum kendi işinde, iki iş de IN_PROGRESS, numune satırı işsiz
//   §3 satır işinin engeli (fason iş) YALNIZ o satırı düşürür — önizleme 400 DEĞİL, öteki satır olur
//   §4 iş zorunlu ayarı: istek düzeyi kullanılmıyorsa sorulmaz; satırdaki null → yalnız o satır engelli
//   §5 eski gövde (satır alanı yok) bugünkü sözleşme: istek düzeyi engeli tüm önizlemeyi 400 yapar
//   §6 token replay satır işiyle: aynı token'lar → aynı koşumlar, yeni satır yok
//   §7 yapısal: iki uç aynı çözümleyiciyi okur, rota şeması satır alanını iki uçta da taşır, bağlam `rowJobs`
// Koşum: npx tsx scripts/run-all-tests.ts machine_run_bulk_rowjobs
//
// NEGATİF SONDALAR (2026-10-13, koşuldu, dosyalar geri alındı):
//   ① `rowJobIdOf` satır alanını yok saydı (hep istek düzeyi) → §1a/§1b/§2b/§3a/§3b/§4b ❌
//   ② `checkRowJobs` iş kuralı hatasını yeniden fırlattı → §3a/§4b ❌ (önizleme 400)
//   ③ `usesRequestJob` hep true → §4a/§4b ❌ (istek düzeyi işsiz kapısı tüm isteği 400 yapar)
// =============================================================================
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ItemType, WeavingExecutionKind, WeavingOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { yorumlariSok } from "./lib/regime-gate-scan";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { openMachineRun } from "../src/services/machine-run.service";
import { assignBulkRuns, bulkRunContext, previewBulkRuns, type BulkRunPreviewDto } from "../src/services/machine-run-bulk.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
}
async function hataKodu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "yok";
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${String((e.details as { code?: unknown } | undefined)?.code ?? "")}` : `ham:${String(e).slice(0, 80)}`;
  }
}

/** Önizleme ya veri ya hata metni döner — 400 beklenmeyen bölümde hata ❌ olarak görünsün. */
async function onizle(input: Parameters<typeof previewBulkRuns>[0]): Promise<{ data: BulkRunPreviewDto | null; hata: string }> {
  try {
    return { data: (await previewBulkRuns(input)).data ?? null, hata: "" };
  } catch (e) {
    return { data: null, hata: String(e) };
  }
}

const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED];
const ilk = new Map<string, unknown>();
async function ayarYaz(key: string, value: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(1);
  }
  const rows0 = await prisma.systemSetting.findMany({ where: { key: { in: YONETILEN } }, select: { key: true, value: true } });
  for (const k of YONETILEN) ilk.set(k, rows0.find((r) => r.key === k)?.value ?? undefined);

  const ek = Date.now().toString(36).toUpperCase();
  const station = await prisma.station.create({
    data: { name: `TEST-MRJ-HOL-${ek}`, code: `TMRJ-S-${ek}`.slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true, consumesWarpBeam: true },
  });
  const tezgah = async (n: string) =>
    prisma.machine.create({
      data: { stationId: station.id, name: `TEST-MRJ Tezgah ${n} ${ek}`, code: `TMRJ-${ek}-${n}`.slice(0, 32), isActive: true, productionLineCount: 1, warpBeamSlots: 1 },
      select: { id: true, code: true },
    });
  const [A, B, C, D, E, F] = [await tezgah("A"), await tezgah("B"), await tezgah("C"), await tezgah("D"), await tezgah("E"), await tezgah("F")];
  const item = await prisma.item.create({ data: { code: `TMRJ-I-${ek}`.slice(0, 32), name: `TEST-MRJ KUMAS ${ek}`, itemType: ItemType.FABRIC } });
  const woIds: string[] = [];
  const is = async (suffix: string, extra: Record<string, unknown> = {}) => {
    const w = await prisma.weavingOrder.create({
      data: { weavingOrderNumber: `TMRJ-${suffix}-${ek}`, itemId: item.id, executionKind: WeavingExecutionKind.IN_HOUSE, ...extra },
      select: { id: true, weavingOrderNumber: true },
    });
    woIds.push(w.id);
    return w;
  };
  const t = (m: { id: string }, extra: { weavingOrderId?: string | null } = {}) => ({ machineId: m.id, productionLineNo: 1, ...extra });

  try {
    await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await ayarYaz(SETTING_KEYS.DOKUMA_ENABLED, true);
    await ayarYaz(SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, false);
    const IS1 = await is("IS1");
    const IS2 = await is("IS2");
    const fason = await ensureTestDyeHouse();
    const FASON = await is("FASON", { executionKind: WeavingExecutionKind.SUBCONTRACTED, subcontractorId: fason.id });
    // D: IS2 koşuyor — satır işi IS2 ise SAME_JOB, istek düzeyi IS1 ise REPLACE olmalı.
    await openMachineRun({ machineId: D.id, productionLineNo: 1, weavingOrderId: IS2.id });
    const runCount = () => prisma.machineRun.count({ where: { machine: { stationId: station.id } } });

    // ── §1 karışık önizleme ─────────────────────────────────────────────────
    const once = await runCount();
    const pv = (await previewBulkRuns({ action: "ASSIGN", weavingOrderId: IS1.id, targets: [t(A), t(B, { weavingOrderId: IS2.id }), t(C, { weavingOrderId: null }), t(D, { weavingOrderId: IS2.id })] })).data!;
    const row = (id: string) => pv.rows.find((r) => r.machineId === id);
    check("§1a ⭐ her satır KENDİ işini taşır (A istek düzeyi IS1 · B satır IS2 · C satır işsiz)",
      row(A.id)?.weavingOrder?.id === IS1.id && row(B.id)?.weavingOrder?.id === IS2.id && row(C.id)?.weavingOrder === null && row(B.id)?.outcome === "START" && row(C.id)?.outcome === "START",
      JSON.stringify(pv.rows.map((r) => [r.machineCode, r.weavingOrder?.weavingOrderNumber ?? null, r.outcome])));
    const pvD = (await previewBulkRuns({ action: "ASSIGN", weavingOrderId: IS1.id, targets: [t(D)] })).data!;
    check("§1b ⭐ SAME_JOB/REPLACE satırın işine göre (D satır IS2 → SAME_JOB · D istek IS1 → REPLACE)",
      row(D.id)?.outcome === "SAME_JOB" && pvD.rows[0]?.outcome === "REPLACE", `${row(D.id)?.outcome} / ${pvD.rows[0]?.outcome}`);
    check("§1c üst düzey weavingOrder istek düzeyindeki iş; önizleme YAZMAZ", pv.weavingOrder?.id === IS1.id && (await runCount()) === once);

    // ── §2 karışık iş ver ───────────────────────────────────────────────────
    const tok = { A: randomUUID(), B: randomUUID(), C: randomUUID() };
    const body2 = {
      weavingOrderId: IS1.id,
      rows: [
        { ...t(A), clientToken: tok.A },
        { ...t(B, { weavingOrderId: IS2.id }), clientToken: tok.B },
        { ...t(C, { weavingOrderId: null }), clientToken: tok.C },
      ],
    };
    const r2 = (await assignBulkRuns(body2)).data!;
    const runOf = async (m: { id: string }) => prisma.machineRun.findFirst({ where: { machineId: m.id, endedAt: null }, select: { id: true, weavingOrderId: true } });
    const [rA, rB, rC] = [await runOf(A), await runOf(B), await runOf(C)];
    check("§2a ⭐ tek istek, üç koşum, failed boş", r2.ok.length === 3 && r2.failed.length === 0, JSON.stringify(r2.failed));
    check("§2b ⭐ her koşum kendi işinde: A IS1 · B IS2 · C işsiz (numune)", rA?.weavingOrderId === IS1.id && rB?.weavingOrderId === IS2.id && rC !== null && rC.weavingOrderId === null);
    const st = await prisma.weavingOrder.findMany({ where: { id: { in: [IS1.id, IS2.id] } }, select: { status: true } });
    check("§2c iki iş de IN_PROGRESS", st.length === 2 && st.every((s) => s.status === WeavingOrderStatus.IN_PROGRESS));

    // ── §3 satır işinin engeli yalnız o satırı düşürür ─────────────────────
    const { data: pv3d, hata: h3 } = await onizle({ action: "ASSIGN", targets: [t(E, { weavingOrderId: FASON.id }), t(F, { weavingOrderId: IS1.id })] });
    const e3 = pv3d?.rows.find((r) => r.machineId === E.id);
    check("§3a ⭐ fason iş satırı BLOCKED (sebepli), öteki satır START — önizleme 400 DEĞİL",
      !!pv3d && e3?.outcome === "BLOCKED" && !!e3.block?.message && e3.defaultSelected === false && pv3d.rows.find((r) => r.machineId === F.id)?.outcome === "START",
      pv3d ? JSON.stringify(e3?.block) : h3);
    const r3 = (await assignBulkRuns({ rows: [{ ...t(E, { weavingOrderId: FASON.id }), clientToken: randomUUID() }, { ...t(F, { weavingOrderId: IS1.id }), clientToken: randomUUID() }] })).data!;
    check("§3b iş ver: fason satırı failed (kod + Türkçe sebep), öteki satır olur", r3.ok.length === 1 && r3.ok[0]?.machineId === F.id && r3.failed[0]?.machineId === E.id && !!r3.failed[0]?.message, JSON.stringify(r3.failed));

    // ── §4 iş zorunlu ayarı ─────────────────────────────────────────────────
    await ayarYaz(SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, true);
    const k4a = await hataKodu(() => previewBulkRuns({ action: "ASSIGN", targets: [t(E, { weavingOrderId: IS1.id })] }));
    check("§4a ⭐ istek düzeyi iş YOK ama her satır işli → istek düzeyi kapısı sorulmaz (400 değil)", k4a === "yok", k4a);
    const { data: pv4d, hata: h4 } = await onizle({ action: "ASSIGN", targets: [t(E, { weavingOrderId: null }), t(A, { weavingOrderId: IS1.id })] });
    check("§4b satırda işsiz (null) → yalnız o satır BLOCKED", !!pv4d && pv4d.rows.find((r) => r.machineId === E.id)?.outcome === "BLOCKED" && pv4d.rows.find((r) => r.machineId === A.id)?.outcome === "SAME_JOB", h4);
    const r4 = (await assignBulkRuns({ rows: [{ ...t(E, { weavingOrderId: null }), clientToken: randomUUID() }] })).data!;
    check("§4c iş ver: işsiz satır failed (iş zorunlu)", r4.ok.length === 0 && r4.failed.length === 1, JSON.stringify(r4.failed));
    await ayarYaz(SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, false);

    // ── §5 eski gövde ───────────────────────────────────────────────────────
    const k5 = await hataKodu(() => previewBulkRuns({ action: "ASSIGN", weavingOrderId: FASON.id, targets: [t(E), t(F, { weavingOrderId: IS1.id })] }));
    check("§5 eski sözleşme: istek düzeyi iş en az bir satırda kullanılıyorsa engeli tüm önizlemeyi 400 yapar", k5.startsWith("400:"), k5);

    // ── §6 token replay ─────────────────────────────────────────────────────
    const n6 = await runCount();
    const r6 = (await assignBulkRuns(body2)).data!;
    check("§6 ⭐ aynı token'larla yeniden gönderim → aynı koşumlar, yeni satır yok",
      r6.ok.length === 3 && r6.ok.map((o) => o.runId).sort().join() === r2.ok.map((o) => o.runId).sort().join() && (await runCount()) === n6, JSON.stringify(r6.failed));

    // ── §7 yapısal ──────────────────────────────────────────────────────────
    const svc = yorumlariSok(fs.readFileSync(path.join(__dirname, "../src/services/machine-run-bulk.service.ts"), "utf8"));
    const rota = yorumlariSok(fs.readFileSync(path.join(__dirname, "../src/routes/machine-run.routes.ts"), "utf8"));
    check("§7a iki uç aynı çözümleyiciyi okur (rowJobIdOf önizleme + uygulama); istek düzeyi iş openMachineRun'a DOĞRUDAN gitmez",
      (svc.match(/rowJobIdOf\(/g) ?? []).length >= 3 && !/weavingOrderId:\s*input\.weavingOrderId\s*\?\?\s*null,\s*targetUnitsPerMin/.test(svc));
    check("§7b rota şeması satır alanını iki uçta taşır (önizleme hedefi + iş ver satırı)",
      /targets:\s*z\.array\(jobTargetSchema\)/.test(rota) && /jobTargetSchema\.extend\(\{\s*clientToken/.test(rota));
    check("§7c bağlam ucu yeteneği söyler (rowJobs: true)", (await bulkRunContext()).data!.rowJobs === true);
  } finally {
    await prisma.machineRun.deleteMany({ where: { machine: { stationId: station.id } } });
    if (woIds.length) await prisma.weavingOrder.deleteMany({ where: { id: { in: woIds } } });
    await prisma.machine.deleteMany({ where: { stationId: station.id } });
    await prisma.station.deleteMany({ where: { id: station.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    for (const [key, value] of ilk) {
      if (value === undefined) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
