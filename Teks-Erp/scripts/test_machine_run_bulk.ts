// =============================================================================
// BEKÇİ — Tezgah Salonu TOPLU KOŞUM (önizleme · iş ver / Değiştir · bitir)
// =============================================================================
// Sözleşme (tasarım TEZGAH-SALONU-SECIM-IS-VERME §C): ikinci yazar YOK (satır başına
// `openMachineRun` / `closeMachineRun`), satır başına tx, sonuç PARÇALI, satırlar sunucuda
// tezgah kodu sırasıyla, dolu hat SORAR (replaceRunId yoksa satır düşer), satır başına
// clientToken (aynı token'la yeniden gönderim özgün koşumu döndürür), tek özet audit.
//   §1 önizleme her tezgahı adıyla, sonuç türleri, varsayılan seçim, YAZMAZ
//   §2 boş tezgahlara iş ver → koşum + iş IN_PROGRESS
//   §3 dolu hat: replaceRunId yoksa OCCUPIED; varsa eski kapanır yenisi açılır (tek tx)
//   §4 kısmi başarı: olmayan satır kod + Türkçe sebeple
//   §5 eşzamanlı iki atama / iki Değiştir → biri olur, öteki 409 sınıfı; hatta tek açık koşum
//   §6 sıra: girdi ters verilse de ok[] tezgah kodu sırasında
//   §7 token replay: aynı token'lar → aynı koşumlar, yeni satır yok, Değiştir ikinci kez kapatmaz
//   §8 tek özet audit (MACHINE_RUN_BULK)
//   §9 bitir: koşum kapanır, iş KAPANMAZ; ikinci kez → RUN_ALREADY_CLOSED; yok → RUN_NOT_FOUND
//   §10 iş düzeyi kapılar: fason iş / iş zorunlu ayarı → önizleme 400; bağlam ucu ayarı söyler
//   §11 yapısal: toplu servis koşum tablosuna KENDİ yazmaz, Promise.all yok
// Koşum: npx tsx scripts/run-all-tests.ts machine_run_bulk
//
// NEGATİF SONDALAR (2026-10-11, koşuldu, dosyalar geri alındı):
//   ① `defaultSelected: outcome === "START"` → `true` → §1c ❌
//   ② `assertProductionLineFree`te replace erken dönüşü kaldırıldı → §3b/§3c/§5b ❌ (Değiştir OCCUPIED'a düşer)
//   ③ `rows.sort(byCodeThenLine)` (assign) kaldırıldı → §6 ❌
//   ④ assign satırında `clientToken` openMachineRun'a geçirilmedi → §7a/§7b ❌
//   ⑤ `closeReplacedRunTx` çağrısı kaldırıldı → §3b/§3c/§5b ❌ (yeni koşum seddi yarışına düşer)
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
import { assignBulkRuns, bulkRunContext, finishBulkRuns, previewBulkRuns } from "../src/services/machine-run-bulk.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}
async function hataKodu(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "yok";
  } catch (e) {
    return e instanceof AppError ? `${e.statusCode}:${String((e.details as { code?: unknown } | undefined)?.code ?? "")}` : `ham:${String(e).slice(0, 80)}`;
  }
}

const YONETILEN = [SETTING_KEYS.PRODUCTION_ENABLED, SETTING_KEYS.DOKUMA_ENABLED, SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, SETTING_KEYS.DEVERE_ENABLED, SETTING_KEYS.DEVERE_MOUNT_TRACKING];
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
    data: { name: `TEST-MRB-HOL-${ek}`, code: `TMRB-S-${ek}`.slice(0, 32), type: "INTERNAL", kind: "WEAVING", isActive: true, consumesWarpBeam: true },
  });
  // Kodlar bilerek ters adlandırılmadı: sıra ölçümü (§6) kod sırasıyla yapılır.
  const tezgah = async (n: string, extra: { productionLineCount?: number; isActive?: boolean } = {}) =>
    prisma.machine.create({
      data: { stationId: station.id, name: `TEST-MRB Tezgah ${n} ${ek}`, code: `TMRB-${ek}-${n}`.slice(0, 32), isActive: extra.isActive ?? true, productionLineCount: extra.productionLineCount ?? 1, warpBeamSlots: 1 },
      select: { id: true, code: true, name: true },
    });
  const [A, B, C, D, E, F, G, H] = [await tezgah("A"), await tezgah("B"), await tezgah("C", { productionLineCount: 2 }), await tezgah("D", { isActive: false }), await tezgah("E"), await tezgah("F"), await tezgah("G"), await tezgah("H")];
  const item = await prisma.item.create({ data: { code: `TMRB-I-${ek}`.slice(0, 32), name: `TEST-MRB KUMAS ${ek}`, itemType: ItemType.FABRIC } });
  const woIds: string[] = [];
  const is = async (suffix: string, extra: Record<string, unknown> = {}) => {
    const w = await prisma.weavingOrder.create({
      data: { weavingOrderNumber: `TMRB-${suffix}-${ek}`, itemId: item.id, executionKind: WeavingExecutionKind.IN_HOUSE, ...extra },
      select: { id: true, weavingOrderNumber: true },
    });
    woIds.push(w.id);
    return w;
  };

  try {
    await ayarYaz(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await ayarYaz(SETTING_KEYS.DOKUMA_ENABLED, true);
    await ayarYaz(SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, false);
    await ayarYaz(SETTING_KEYS.DEVERE_ENABLED, true);
    await ayarYaz(SETTING_KEYS.DEVERE_MOUNT_TRACKING, true);
    const IS1 = await is("IS1");
    const IS2 = await is("IS2");
    // B: başka iş koşuyor (bağsız) · C hat 1: aynı iş (IS1) koşuyor.
    const bRun = await openMachineRun({ machineId: B.id, productionLineNo: 1 });
    const cRun = await openMachineRun({ machineId: C.id, productionLineNo: 1, weavingOrderId: IS1.id });
    const runCount = () => prisma.machineRun.count({ where: { machine: { stationId: station.id } } });

    // ── §1 önizleme ─────────────────────────────────────────────────────────
    const once = await runCount();
    const pv = (
      await previewBulkRuns({
        action: "ASSIGN",
        weavingOrderId: IS1.id,
        targets: [
          { machineId: D.id, productionLineNo: 1 },
          { machineId: C.id, productionLineNo: 2 },
          { machineId: C.id, productionLineNo: 1 },
          { machineId: B.id, productionLineNo: 1 },
          { machineId: A.id, productionLineNo: 1 },
          { machineId: A.id, productionLineNo: 2 },
        ],
      })
    ).data!;
    const row = (id: string, line: number) => pv.rows.find((r) => r.machineId === id && r.productionLineNo === line);
    check("§1a her hedef AYRI satırda, tezgah kodu + adıyla (6 satır)", pv.rows.length === 6 && pv.rows.every((r) => r.machineCode.startsWith("TMRB-")) && row(A.id, 1)?.machineName === A.name, `${pv.rows.length}`);
    check(
      "§1b sonuçlar: A1 START · B1 REPLACE (şu anki koşum adıyla) · C1 SAME_JOB · C2 START · A2 BLOCKED hat yok · D BLOCKED pasif",
      row(A.id, 1)?.outcome === "START" && row(B.id, 1)?.outcome === "REPLACE" && row(B.id, 1)?.current?.id === bRun.data.id && row(C.id, 1)?.outcome === "SAME_JOB" && row(C.id, 1)?.current?.weavingOrderNumber === IS1.weavingOrderNumber
        && row(C.id, 2)?.outcome === "START" && row(A.id, 2)?.block?.code === "PRODUCTION_LINE_OUT_OF_RANGE" && row(D.id, 1)?.block?.code === "MACHINE_NOT_LOOM",
      JSON.stringify(pv.rows.map((r) => [r.machineCode.slice(-1), r.productionLineNo, r.outcome, r.block?.code ?? ""])),
    );
    check("§1c ⭐ varsayılan seçim YALNIZ START satırlarında (Değiştir/aynı iş kullanıcı işaretler, engelli seçilemez)", pv.rows.every((r) => r.defaultSelected === (r.outcome === "START")));
    check("§1d uyarı: leventsiz tezgah (levent defteri açık) satırda söylenir", (row(A.id, 1)?.warnings ?? []).some((w) => w.includes("bağlı levent yok")), JSON.stringify(row(A.id, 1)?.warnings));
    check("§1e satırlar tezgah kodu + hat sırasında (girdi sırası karışık)", pv.rows.map((r) => `${r.machineCode}:${r.productionLineNo}`).join() === [...pv.rows].map((r) => `${r.machineCode}:${r.productionLineNo}`).sort((a, b) => a.localeCompare(b, "tr")).join());
    check("§1f önizleme YAZMAZ (koşum sayısı aynı)", (await runCount()) === once);

    // ── §2 boş tezgahlara iş ver ────────────────────────────────────────────
    const t2 = { A: randomUUID(), E: randomUUID() };
    const body2 = { weavingOrderId: IS2.id, rows: [{ machineId: A.id, productionLineNo: 1, clientToken: t2.A }, { machineId: E.id, productionLineNo: 1, clientToken: t2.E }] };
    const r2 = (await assignBulkRuns(body2)).data!;
    const is2 = await prisma.weavingOrder.findUnique({ where: { id: IS2.id }, select: { status: true } });
    check("§2a iki boş tezgahta iki koşum, failed boş", r2.ok.length === 2 && r2.failed.length === 0, JSON.stringify(r2.failed));
    check("§2b koşumlar işe bağlı ve açık; iş PLANNED → IN_PROGRESS",
      (await prisma.machineRun.count({ where: { id: { in: r2.ok.map((o) => o.runId) }, weavingOrderId: IS2.id, endedAt: null } })) === 2 && is2?.status === WeavingOrderStatus.IN_PROGRESS);

    // ── §3 dolu hat ─────────────────────────────────────────────────────────
    const r3a = (await assignBulkRuns({ weavingOrderId: IS2.id, rows: [{ machineId: B.id, productionLineNo: 1, clientToken: randomUUID() }] })).data!;
    check("§3a ⭐ dolu hatta replaceRunId YOK → satır PRODUCTION_LINE_OCCUPIED (sessiz üzerine yazma yok)", r3a.ok.length === 0 && r3a.failed[0]?.code === "PRODUCTION_LINE_OCCUPIED", JSON.stringify(r3a.failed));
    const t3 = randomUUID();
    const body3 = { weavingOrderId: IS2.id, rows: [{ machineId: B.id, productionLineNo: 1, clientToken: t3, replaceRunId: bRun.data.id }] };
    const r3b = (await assignBulkRuns(body3)).data!;
    check("§3b ⭐ replaceRunId ile Değiştir olur, sonuç eski koşumu söyler", r3b.ok.length === 1 && r3b.ok[0]?.replacedRunId === bRun.data.id, JSON.stringify(r3b.failed));
    const eski = await prisma.machineRun.findUnique({ where: { id: bRun.data.id }, select: { endedAt: true, closedTermsAt: true } });
    const yeni = r3b.ok[0] ? await prisma.machineRun.findUnique({ where: { id: r3b.ok[0].runId }, select: { startedAt: true, weavingOrderId: true, endedAt: true } }) : null;
    check("§3c eski koşum KAPANDI (tek yazar, terimler dondu), yeni koşum eski bitişte başladı ve işe bağlı",
      !!eski?.endedAt && !!eski.closedTermsAt && yeni?.endedAt === null && yeni.weavingOrderId === IS2.id && yeni.startedAt.getTime() === eski.endedAt.getTime());
    const r3c = (await assignBulkRuns({ weavingOrderId: IS2.id, rows: [{ machineId: C.id, productionLineNo: 2, clientToken: randomUUID(), replaceRunId: cRun.data.id }] })).data!;
    check("§3d başka hattın koşumu Değiştir'le kapatılamaz (C hat 2 ← C hat 1 koşumu) → satır düşer, koşum açık kalır",
      r3c.ok.length === 0 && ["RUN_REPLACE_STALE", "RUN_LINE_MISMATCH"].includes(r3c.failed[0]?.code ?? "") && (await prisma.machineRun.findUnique({ where: { id: cRun.data.id }, select: { endedAt: true } }))?.endedAt === null,
      JSON.stringify(r3c.failed));

    // ── §4 kısmi başarı ─────────────────────────────────────────────────────
    const r4 = (await assignBulkRuns({ weavingOrderId: IS2.id, rows: [{ machineId: D.id, productionLineNo: 1, clientToken: randomUUID() }, { machineId: F.id, productionLineNo: 3, clientToken: randomUUID() }, { machineId: F.id, productionLineNo: 1, clientToken: randomUUID() }] })).data!;
    check("§4a ⭐ parçalı sonuç: 1 oldu, 2 olmadı; requested 3", r4.requested === 3 && r4.ok.length === 1 && r4.failed.length === 2);
    check("§4b olmayan her satır tezgah kodu + kod + Türkçe sebeple",
      r4.failed.some((f) => f.machineId === D.id && f.code === "MACHINE_NOT_LOOM") && r4.failed.some((f) => f.machineId === F.id && f.code === "PRODUCTION_LINE_OUT_OF_RANGE" && f.message.includes("hattı var"))
        && r4.failed.every((f) => f.message.length > 10 && f.machineCode !== ""),
      JSON.stringify(r4.failed));

    // ── §5 eşzamanlılık ─────────────────────────────────────────────────────
    const [p1, p2] = await Promise.all([
      assignBulkRuns({ weavingOrderId: IS2.id, rows: [{ machineId: G.id, productionLineNo: 1, clientToken: randomUUID() }] }),
      assignBulkRuns({ weavingOrderId: IS1.id, rows: [{ machineId: G.id, productionLineNo: 1, clientToken: randomUUID() }] }),
    ]);
    const okSay = p1.data!.ok.length + p2.data!.ok.length;
    const kaybeden = [...p1.data!.failed, ...p2.data!.failed][0];
    check("§5a ⭐ aynı hatta eşzamanlı iki atama → biri olur, öteki 409 sınıfı (OCCUPIED/RACE)",
      okSay === 1 && ["PRODUCTION_LINE_OCCUPIED", "MACHINE_RUN_RACE", "TRANSIENT_CONFLICT"].includes(kaybeden?.code ?? ""), `ok=${okSay} kaybeden=${kaybeden?.code}`);
    const gAcik = await prisma.machineRun.findFirst({ where: { machineId: G.id, endedAt: null, revokedAt: null }, select: { id: true } });
    const [q1, q2] = await Promise.all([
      assignBulkRuns({ weavingOrderId: IS1.id, rows: [{ machineId: G.id, productionLineNo: 1, clientToken: randomUUID(), replaceRunId: gAcik!.id }] }),
      assignBulkRuns({ weavingOrderId: IS2.id, rows: [{ machineId: G.id, productionLineNo: 1, clientToken: randomUUID(), replaceRunId: gAcik!.id }] }),
    ]);
    const qOk = q1.data!.ok.length + q2.data!.ok.length;
    const qKay = [...q1.data!.failed, ...q2.data!.failed][0];
    const gAcikSay = await prisma.machineRun.count({ where: { machineId: G.id, endedAt: null, revokedAt: null } });
    check("§5b ⭐ aynı koşuma eşzamanlı iki Değiştir → biri olur, öteki RUN_ALREADY_CLOSED/STALE/RACE; hatta TEK açık koşum",
      qOk === 1 && ["RUN_ALREADY_CLOSED", "RUN_REPLACE_STALE", "MACHINE_RUN_RACE", "TRANSIENT_CONFLICT"].includes(qKay?.code ?? "") && gAcikSay === 1, `ok=${qOk} kaybeden=${qKay?.code} açık=${gAcikSay}`);

    // ── §6 sıra ─────────────────────────────────────────────────────────────
    const r6 = (await assignBulkRuns({ weavingOrderId: IS2.id, rows: [{ machineId: H.id, productionLineNo: 1, clientToken: randomUUID() }, { machineId: C.id, productionLineNo: 2, clientToken: randomUUID() }] })).data!;
    check("§6 ⭐ satırlar SUNUCUDA tezgah kodu sırasıyla işlenir (girdi H, C → sonuç C, H)", r6.ok.map((o) => o.machineId).join() === [C.id, H.id].join(), r6.ok.map((o) => o.machineCode).join());

    // ── §7 token replay ─────────────────────────────────────────────────────
    const sayi7 = await runCount();
    const r7 = (await assignBulkRuns(body2)).data!;
    check("§7a ⭐ aynı token'larla yeniden gönderim → aynı koşum id'leri", r7.ok.length === 2 && r7.ok.map((o) => o.runId).sort().join() === r2.ok.map((o) => o.runId).sort().join(), JSON.stringify(r7.failed));
    const r7b = (await assignBulkRuns(body3)).data!;
    const eski7 = await prisma.machineRun.findUnique({ where: { id: bRun.data.id }, select: { closedTermsAt: true } });
    check("§7b Değiştir replay'i: aynı yeni koşum, eski koşum ikinci kez kapatılmaz, yeni satır yok",
      r7b.ok[0]?.runId === r3b.ok[0]?.runId && eski7?.closedTermsAt?.getTime() === eski?.closedTermsAt?.getTime() && (await runCount()) === sayi7);

    // ── §8 tek özet audit ───────────────────────────────────────────────────
    const audit0 = await prisma.systemLog.count({ where: { action: "MACHINE_RUN_BULK" } });
    const r8 = (await assignBulkRuns({ weavingOrderId: IS2.id, rows: [{ machineId: D.id, productionLineNo: 1, clientToken: randomUUID() }] })).data!;
    const son = await prisma.systemLog.findFirst({ where: { action: "MACHINE_RUN_BULK" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { newData: true } });
    const yuk = (son?.newData ?? {}) as { requested?: number; ok?: number; failed?: number };
    check("§8 ⭐ toplu işlem başına TEK özet audit (istendi/oldu/olmadı)",
      (await prisma.systemLog.count({ where: { action: "MACHINE_RUN_BULK" } })) === audit0 + 1 && yuk.requested === 1 && yuk.ok === r8.ok.length && yuk.failed === 1, JSON.stringify(yuk));

    // ── §9 bitir ────────────────────────────────────────────────────────────
    const eRun = r2.ok.find((o) => o.machineId === E.id)!.runId;
    const yok = randomUUID();
    const r9 = (await finishBulkRuns({ rows: [{ runId: eRun, picksAtClose: 1200 }, { runId: yok }] })).data!;
    const eSon = await prisma.machineRun.findUnique({ where: { id: eRun }, select: { endedAt: true, picksAtClose: true } });
    const is2b = await prisma.weavingOrder.findUnique({ where: { id: IS2.id }, select: { status: true } });
    check("§9a bitir: koşum kapandı (atkı sayacı dondu), yok koşum RUN_NOT_FOUND", r9.ok.length === 1 && !!eSon?.endedAt && eSon.picksAtClose === 1200 && r9.failed[0]?.code === "RUN_NOT_FOUND");
    check("§9b ⭐ İşi bitir Dokuma İş Emrini KAPATMAZ", is2b?.status === WeavingOrderStatus.IN_PROGRESS);
    const r9c = (await finishBulkRuns({ rows: [{ runId: eRun }] })).data!;
    check("§9c ikinci bitir → RUN_ALREADY_CLOSED (kapanış claim'i)", r9c.failed[0]?.code === "RUN_ALREADY_CLOSED");
    const pvF = (await previewBulkRuns({ action: "FINISH", targets: [{ machineId: E.id, productionLineNo: 1 }, { machineId: A.id, productionLineNo: 1 }] })).data!;
    check("§9d bitir önizlemesi: açık koşum FINISH (seçili), boş hat BLOCKED RUN_NOT_OPEN",
      pvF.rows.find((r) => r.machineId === A.id)?.outcome === "FINISH" && pvF.rows.find((r) => r.machineId === A.id)?.defaultSelected === true && pvF.rows.find((r) => r.machineId === E.id)?.block?.code === "RUN_NOT_OPEN");

    // ── §10 iş düzeyi kapılar ───────────────────────────────────────────────
    const fason = await ensureTestDyeHouse();
    const fasonIs = await is("FASON", { executionKind: WeavingExecutionKind.SUBCONTRACTED, subcontractorId: fason.id });
    check("§10a fason işle önizleme → 400 (iş bağlanamaz)", (await hataKodu(() => previewBulkRuns({ action: "ASSIGN", weavingOrderId: fasonIs.id, targets: [{ machineId: A.id, productionLineNo: 1 }] }))).startsWith("400:"));
    await ayarYaz(SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, true);
    const kod10 = await hataKodu(() => previewBulkRuns({ action: "ASSIGN", weavingOrderId: null, targets: [{ machineId: A.id, productionLineNo: 1 }] }));
    const ctx = (await bulkRunContext()).data!;
    check("§10b iş zorunlu ayarı açıkken işsiz önizleme 400 · bağlam ucu weavingOrderRequired=true ve açık işleri listeler",
      kod10.startsWith("400:") && ctx.weavingOrderRequired === true && ctx.weavingOrders.some((w) => w.id === IS1.id) && !ctx.weavingOrders.some((w) => w.id === fasonIs.id), kod10);
    await ayarYaz(SETTING_KEYS.DOKUMA_RUN_WEAVING_ORDER_REQUIRED, false);
    check("§10c ayar kapalıyken bağlam ucu weavingOrderRequired=false", (await bulkRunContext()).data!.weavingOrderRequired === false);

    // ── §11 yapısal ─────────────────────────────────────────────────────────
    const kod = yorumlariSok(fs.readFileSync(path.join(__dirname, "../src/services/machine-run-bulk.service.ts"), "utf8"));
    check("§11a toplu servis koşum tablosuna KENDİ yazmaz (ikinci yazar yok) — openMachineRun/closeMachineRun çağırır",
      !/machineRun\.(create|update|updateMany|upsert|delete)/.test(kod) && /openMachineRun\(/.test(kod) && /closeMachineRun\(/.test(kod));
    check("§11b satırlar sırayla (Promise.all yok)", !/Promise\.all/.test(kod));
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
