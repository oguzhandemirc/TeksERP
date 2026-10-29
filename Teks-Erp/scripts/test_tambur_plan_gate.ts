// =============================================================================
// Tambur plan-gerçek sapma kapısı + uyumsuz sipariş override zinciri (2026-08-19)
// =============================================================================
// İki kullanıcı kararının bekçisi:
//   C) PLAN-SAPMA DEFTERİ (roll_plan_deviations, 2026-08-19): onaylı her geçiş
//      KALICI satır bırakır (audit 6 ayda arşivlenir + rapor arşivi okumaz).
//      Granülerlik: geçiş × sapan alan, `confirmationId` geçişi gruplar —
//      renk+en birlikte sapan onay 2 satır ama TEK imzadır (karne çift saymasın).
//   A) Tambur finalize ONAYLI DEVAM: topun rengi/eni iş emri hedefinden saparsa
//      409 PLAN_MISMATCH; confirmMismatch:true ile geçer ve karar audit'e düşer.
//      Kapsam: renk (farklı VEYA hedef varken renksiz) + EŞİKLİ en (>10 cm).
//      Hedef renksiz + top boyalı KAPSAM DIŞI (zımpara WO'su meşru).
//   B) linkOrderLineWithOverride zinciri: plan düzelt + topları eşitle + bağla.
//      Kumaş farkı HER ZAMAN 400; zaten uyumlu satır 400 (yanlış kapı);
//      IN_PRODUCTION top yetkisiz permissions ile rollsFailed'a düşer ama bağ
//      yine kurulur (kısmi başarı bilinçli).
//   E) EN EŞİĞİ FABRİKA AYARI (D4-E1, 2026-10-29): `tambur.planGate.widthToleranceCm`
//      (varsayılan 10) + `tambur.planGate.widthCheck` (ENFORCE | OFF). Ayar yokken
//      409 seti bayt-aynı; eşik 0 her farkta sorar; OFF yalnız en kolunu atlar;
//      bilinmeyen değer 400; AST: sabit `src/`de yalnız ayar okuyucusunda okunur.
//      Negatif sonda (B1, commit mesajında): helper'da çözücü atlanıp sabit doğrudan
//      okununca E7 (AST) + E2 (eşik 0) kırmızı — 56 geçti / 3 başarısız (E3'te HATA).
// Ayar YAZAR: ilk iş `hedefDbEngeli()`; iki ayar satırı başta silinir (A-C bölümleri
// "ayar yazılmamış" hâlini ölçer) ve `finally`de BİREBİR geri yüklenir.
// Fixture TEST- prefix'li, kendi ürettiğini siler; kaliteye yalnız ROL üzerinden
// bağlanır (kod fabrikaya aittir, rol her kurulumda aynı).
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, RollStatus, StationKind } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { roleGrade } from "./fixture-quality-grade";
import { TamburService } from "../src/services/tambur.service";
import { workOrderLinkService } from "../src/services/workorder-link.service";
import {
  PLAN_MISMATCH_CODE,
  TAMBUR_PLAN_WIDTH_TOLERANCE_CM,
} from "../src/constants/tambur-plan-gate";
import { AppError } from "../src/utils/app-error";
import ts from "typescript";
import {
  SETTING_KEYS,
  readTamburPlanGateWidthCheck,
  readTamburPlanGateWidthToleranceCm,
  resolveTamburPlanWidthGate,
  systemSettingService,
} from "../src/services/system-setting.service";
import { updateSchema } from "../src/routes/feature-flag.routes";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, d = "") => {
  console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}${d ? ` — ${d}` : ""}`);
  c ? pass++ : fail++;
};

/** AppError yakala — yoksa null. */
async function expectAppError(fn: () => Promise<unknown>): Promise<AppError | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e : null;
  }
}

const rollIds: string[] = [];
const woIds: string[] = [];
const colorIds: string[] = [];
const itemIds: string[] = [];
const orderIds: string[] = [];
const customerIds: string[] = [];
const batchIds: string[] = [];

const GATE_KEYS = [
  SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM,
  SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_CHECK,
] as const;
async function writeGateSetting(key: string, value: Prisma.InputJsonValue | null): Promise<void> {
  if (value === null) {
    await prisma.systemSetting.deleteMany({ where: { key } });
    return;
  }
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** `src/` altında `name` tanımlayıcısının geçtiği yerler: dosya → kapsayan fonksiyon adları. */
function identifierRefs(name: string): { scanned: number; refs: Map<string, string[]> } {
  const srcDir = path.join(__dirname, "..", "src");
  const refs = new Map<string, string[]>();
  let scanned = 0;
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true }) as Dirent[]) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(ent.name) && !ent.name.endsWith(".d.ts")) {
        scanned++;
        const text = readFileSync(full, "utf8");
        if (!text.includes(name)) continue;
        const sf = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node) => {
          if (ts.isIdentifier(node) && node.text === name) {
            let owner = "(modül)";
            for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
              if (ts.isImportDeclaration(p)) { owner = "(import)"; break; }
              if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) {
                owner = p.name.getText(sf);
                break;
              }
            }
            const rel = path.relative(srcDir, full);
            refs.set(rel, [...(refs.get(rel) ?? []), owner]);
          }
          ts.forEachChild(node, visit);
        };
        visit(sf);
      }
    }
  };
  walk(srcDir);
  return { scanned, refs };
}

(async () => {
  const engel = hedefDbEngeli();
  if (engel) {
    console.error(`✗ ${engel}`);
    process.exitCode = 1;
    return;
  }
  const svc = new TamburService();
  // Ayar satırlarının ilk hâli — `finally`de birebir geri yüklenir.
  const savedGate = await prisma.systemSetting.findMany({
    where: { key: { in: [...GATE_KEYS] } },
    select: { key: true, value: true },
  });
  for (const k of GATE_KEYS) await writeGateSetting(k, null);
  const ts = `${process.pid}${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
  try {
    const station = await prisma.station.findFirstOrThrow({
      where: { kind: StationKind.TAMBUR },
      select: { id: true },
    });
    const [mavi, gri] = await Promise.all([
      prisma.color.create({ data: { code: `TEST-PG-MAVI-${ts}`, name: `TEST PG MAVI ${ts}` }, select: { id: true } }),
      prisma.color.create({ data: { code: `TEST-PG-GRI-${ts}`, name: `TEST PG GRI ${ts}` }, select: { id: true } }),
    ]);
    colorIds.push(mavi.id, gri.id);
    const [item, item2] = await Promise.all([
      prisma.item.create({
        data: { code: `TEST-PG-ITM-${ts}`, name: `TEST PG PATOS ${ts}`, itemType: "FABRIC", unit: "MT" },
        select: { id: true },
      }),
      prisma.item.create({
        data: { code: `TEST-PG-ITM2-${ts}`, name: `TEST PG TERGAL ${ts}`, itemType: "FABRIC", unit: "MT" },
        select: { id: true },
      }),
    ]);
    itemIds.push(item.id, item2.id);
    // Kalite ROLDEN çözülür: kod fabrikaya, rol kuruluma aittir.
    const gradeCode = (await roleGrade("FIRST")).code;

    /** WO + aktif TAMBUR adımı + adımda 1 top. */
    const makeWoWithRoll = async (opts: {
      targetColorId?: string | null;
      woWidth?: number | null;
      rollColorId?: string | null;
      rollWidth?: number | null;
    }) => {
      const wo = await prisma.workOrder.create({
        data: {
          workOrderNumber: `TEST-PG-IE-${ts}-${woIds.length}`,
          status: "IN_PROGRESS",
          targetItemId: item.id,
          targetColorId: opts.targetColorId ?? null,
          width: opts.woWidth ?? null,
        },
        select: { id: true },
      });
      woIds.push(wo.id);
      const step = await prisma.workOrderStep.create({
        data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: "ACTIVE" },
        select: { id: true },
      });
      const roll = await prisma.roll.create({
        data: {
          barcode: `TEST-PG-R-${ts}-${rollIds.length}`,
          itemId: item.id,
          colorId: opts.rollColorId ?? null,
          width: opts.rollWidth ?? null,
          initialQty: 100,
          currentQty: 100,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: step.id,
          entrySource: "SUPPLIER_RECEIPT",
          // ⚠️ KALİTE FIXTURE'DA (2026-09-03): finalize 100 m'lik topu 40 m
          // kesiyor → 60 m'lik KALAN-KUYRUK child'ı PARENT'ın kalitesini
          // devralır. Parent gradesizken `quality.gradeRequiredEnabled` AÇIK bir
          // kurulumda kuyruk kapısı 400 GRADE_REQUIRED veriyor ve bu bekçi kendi
          // konusunu (plan sapması) ölçemeden düşüyordu. KK1 (RAW_QC) bir kalite
          // istasyonu olduğu için üretimdeki topun kaliteli olması gerçekçidir.
          qualityGrade: gradeCode,
        },
        select: { id: true },
      });
      rollIds.push(roll.id);
      await prisma.rollMovement.create({ data: { rollId: roll.id, workOrderStepId: step.id, qtyIn: 100 } });
      return { woId: wo.id, stepId: step.id, rollId: roll.id };
    };
    const finalizeArgs = (rollId: string, confirm?: boolean) => ({
      rollId,
      decisions: [],
      cuts: [{ length: 40, qualityGrade: gradeCode, relatedErrorIds: [] as string[] }],
      ...(confirm ? { confirmMismatch: true } : {}),
    });

    // ── A1. Renk + en sapması → 409 PLAN_MISMATCH, top el değmeden kalır ──
    console.log("A) Finalize kapısı");
    const f1 = await makeWoWithRoll({ targetColorId: gri.id, woWidth: 330, rollColorId: mavi.id, rollWidth: 345 });
    const e1 = await expectAppError(() => svc.finalize(finalizeArgs(f1.rollId)));
    ok(e1 !== null && e1.statusCode === 409, "A1 sapma → 409", e1 ? `${e1.statusCode}` : "hata yok!");
    ok(e1?.details?.code === PLAN_MISMATCH_CODE, "A1 details.code=PLAN_MISMATCH", String(e1?.details?.code));
    const mm1 = (e1?.details?.mismatches ?? []) as { field: string }[];
    ok(
      mm1.length === 2 && mm1.some((m) => m.field === "color") && mm1.some((m) => m.field === "width"),
      "A1 renk + en ikisi de listede",
      mm1.map((m) => m.field).join(","),
    );
    const r1 = await prisma.roll.findUniqueOrThrow({ where: { id: f1.rollId }, select: { status: true } });
    ok(r1.status === RollStatus.IN_PRODUCTION, "A1 top IN_PRODUCTION kaldı (kapı pre-tx)", r1.status);

    // ── A2. Eşit fark eşiği AŞMAZ (±10 = normal) ──
    const f2 = await makeWoWithRoll({
      targetColorId: gri.id, woWidth: 330,
      rollColorId: gri.id, rollWidth: 330 + TAMBUR_PLAN_WIDTH_TOLERANCE_CM,
    });
    const res2 = await svc.finalize(finalizeArgs(f2.rollId));
    res2.data.splitRolls.forEach((c) => rollIds.push(c.id));
    ok(res2.success === true, "A2 eşik SINIRINDA fark kapıya çarpmaz (±10 dahil normal)");

    // ── A3. Hedef varken RENKSİZ top → sapma ──
    const f3 = await makeWoWithRoll({ targetColorId: gri.id, rollColorId: null });
    const e3 = await expectAppError(() => svc.finalize(finalizeArgs(f3.rollId)));
    const mm3 = (e3?.details?.mismatches ?? []) as { field: string; rollValue: unknown }[];
    ok(
      e3?.details?.code === PLAN_MISMATCH_CODE && mm3.length === 1 && mm3[0]!.field === "color" && mm3[0]!.rollValue === null,
      "A3 renksiz top hedefli WO'da kapıya çarpar",
      JSON.stringify(mm3),
    );

    // ── A4. Hedef RENKSİZ + top boyalı → KAPSAM DIŞI (zımpara WO'su) ──
    const f4 = await makeWoWithRoll({ targetColorId: null, rollColorId: mavi.id });
    const res4 = await svc.finalize(finalizeArgs(f4.rollId));
    res4.data.splitRolls.forEach((c) => rollIds.push(c.id));
    ok(res4.success === true, "A4 renk-hedefsiz WO'da boyalı top sapma DEĞİL (bilinçli kapsam)");

    // ── A5. confirmMismatch → geçer + imzalı karar audit'te ──
    const e5 = await expectAppError(() => svc.finalize(finalizeArgs(f1.rollId)));
    ok(e5 !== null, "A5 ön koşul: onaysız hâlâ 409");
    const res5 = await svc.finalize(finalizeArgs(f1.rollId, true));
    res5.data.splitRolls.forEach((c) => rollIds.push(c.id));
    ok(res5.data.originalRoll.status === RollStatus.TAMBUR_CONSUMED, "A5 onayla finalize geçti", res5.data.originalRoll.status);
    const auditRow = await prisma.systemLog.findFirst({
      where: { recordId: f1.rollId, newData: { path: ["event"], equals: "TAMBUR_PLAN_MISMATCH_CONFIRMED" } },
      select: { newData: true },
    });
    ok(auditRow !== null, "A5 onay kararı audit'e düştü (TAMBUR_PLAN_MISMATCH_CONFIRMED)");
    const auditMm = ((auditRow?.newData ?? {}) as { mismatches?: unknown[] }).mismatches;
    ok(Array.isArray(auditMm) && auditMm.length === 2, "A5 audit sapma detayını taşıyor", `n=${Array.isArray(auditMm) ? auditMm.length : "-"}`);

    // ── C1. DEFTER: finalize geçişi — alan başına satır, TEK confirmationId ──
    const dev1 = await prisma.rollPlanDeviation.findMany({
      where: { rollId: f1.rollId },
      select: {
        confirmationId: true, field: true, childRollId: true, qtyM: true,
        source: true, workOrderId: true, workOrderStepId: true, confirmedById: true,
        rollValue: true, planValue: true,
      },
    });
    ok(dev1.length === 2, "C1 finalize: renk+en → 2 defter satırı", `n=${dev1.length}`);
    ok(new Set(dev1.map((d) => d.confirmationId)).size === 1, "C1 iki satır TEK confirmationId (imza bir)");
    ok(
      dev1.some((d) => d.field === "color") && dev1.some((d) => d.field === "width"),
      "C1 alanlar color+width",
      dev1.map((d) => d.field).join(","),
    );
    ok(
      dev1.every((d) => d.childRollId === null && d.source === "finalize"),
      "C1 finalize satırı çocuk-bağımsız (childRollId null) + source=finalize",
    );
    ok(
      dev1.every((d) => new Prisma.Decimal(d.qtyM).equals(100)),
      "C1 qtyM = topun TÜM metrajı (100)",
      String(dev1[0]?.qtyM),
    );
    ok(
      dev1.every((d) => d.workOrderId === f1.woId && d.workOrderStepId === f1.stepId),
      "C1 iş emri + adım damgası doğru",
    );
    const colorRow = dev1.find((d) => d.field === "color");
    ok(
      (colorRow?.rollValue ?? "").includes("MAVI") && (colorRow?.planValue ?? "").includes("GRI"),
      "C1 değerler insan-okur metin olarak dondu",
      `${colorRow?.rollValue} → ${colorRow?.planValue}`,
    );

    // ── C2. NEG: onaysız 409 defter satırı SIZDIRMAZ ──
    const fNeg = await makeWoWithRoll({ targetColorId: gri.id, rollColorId: mavi.id });
    await expectAppError(() => svc.finalize(finalizeArgs(fNeg.rollId)));
    const devNeg = await prisma.rollPlanDeviation.count({ where: { rollId: fNeg.rollId } });
    ok(devNeg === 0, "C2 onaysız (409) geçişte defter satırı YOK", `n=${devNeg}`);

    // ── C3. NEG: sapmasız finalize defter satırı üretmez ──
    const fClean = await makeWoWithRoll({ targetColorId: gri.id, rollColorId: gri.id });
    const resClean = await svc.finalize(finalizeArgs(fClean.rollId));
    resClean.data.splitRolls.forEach((c) => rollIds.push(c.id));
    const devClean = await prisma.rollPlanDeviation.count({ where: { rollId: fClean.rollId } });
    ok(devClean === 0, "C3 sapmasız finalize → 0 satır (sıcak yol temiz)", `n=${devClean}`);

    // ── A6. Onaylı finalize'ın idempotent retry'ı kapıya ÇARPMAZ ──
    const res6 = await svc.finalize(finalizeArgs(f1.rollId)); // confirm YOK — yine de geçmeli
    ok(
      res6.success === true && (res6.message ?? "").includes("idempotent"),
      "A6 tamamlanmış topun replay'i onaysız da idempotent döner",
      res6.message ?? "",
    );
    const devAfterReplay = await prisma.rollPlanDeviation.count({ where: { rollId: f1.rollId } });
    ok(devAfterReplay === 2, "C4 finalize replay defteri BÜYÜTMEZ (erken dönüş kapıdan önce)", `n=${devAfterReplay}`);

    // ── A7. cutOpenFabric AYNI kapıdan geçer (çocuk kesim anında depoya iner) ──
    const f7 = await makeWoWithRoll({ targetColorId: gri.id, rollColorId: mavi.id });
    const e7 = await expectAppError(() =>
      svc.cutOpenFabric(f7.rollId, { lengthMeters: 30, status: "WAREHOUSE" }),
    );
    ok(e7?.details?.code === PLAN_MISMATCH_CODE, "A7 kesim (cutOpenFabric) kapıya çarpar", e7?.message ?? "hata yok!");
    const res7 = await svc.cutOpenFabric(f7.rollId, { lengthMeters: 30, status: "WAREHOUSE", confirmMismatch: true });
    const child7 = res7.data?.childRoll as { id: string } | undefined;
    if (child7) rollIds.push(child7.id);
    ok(!!child7, "A7 onayla kesim geçti");

    // ── C5. DEFTER: cut geçişi — çocuk bazlı + kesim metrajı ──
    const dev7 = await prisma.rollPlanDeviation.findMany({
      where: { rollId: f7.rollId, source: "cut" },
      select: { childRollId: true, qtyM: true, field: true, confirmationId: true },
    });
    ok(dev7.length === 1, "C5 cut: yalnız renk sapıyor → 1 satır", `n=${dev7.length}`);
    ok(dev7[0]?.childRollId === child7?.id, "C5 satır KESİMİN çocuğunu işaret eder");
    ok(
      dev7[0] != null && new Prisma.Decimal(dev7[0].qtyM).equals(30),
      "C5 qtyM = kesim metrajı (30)",
      String(dev7[0]?.qtyM),
    );

    // ── C6. NEG (idempotency): aynı clientToken ile kesim replay'i satır EKLEMEZ ──
    // Kanıt: child create P2002 → tx rollback → defter satırı da geri sarılır.
    const tokenRoll = await makeWoWithRoll({ targetColorId: gri.id, rollColorId: mavi.id });
    const replayToken = randomUUID();
    const cutA = await svc.cutOpenFabric(tokenRoll.rollId, {
      lengthMeters: 20, status: "WAREHOUSE", confirmMismatch: true, clientToken: replayToken,
    });
    const childA = cutA.data?.childRoll as { id: string } | undefined;
    if (childA) rollIds.push(childA.id);
    await svc.cutOpenFabric(tokenRoll.rollId, {
      lengthMeters: 20, status: "WAREHOUSE", confirmMismatch: true, clientToken: replayToken,
    });
    const devToken = await prisma.rollPlanDeviation.count({ where: { rollId: tokenRoll.rollId } });
    ok(devToken === 1, "C6 aynı clientToken replay'i defterde 1 satır bırakır (2 ise tx bağı kopmuş)", `n=${devToken}`);

    // ── A8. finalizeOpenFabric: keep_* kapıya çarpar, scrap/discard ÇARPMAZ ──
    const e8 = await expectAppError(() =>
      svc.finalizeOpenFabric(f7.rollId, { remainingAction: "keep_1kalite" }),
    );
    ok(e8?.details?.code === PLAN_MISMATCH_CODE, "A8 keep_1kalite bitirme kapıya çarpar", e8?.message ?? "hata yok!");
    const res8 = await svc.finalizeOpenFabric(f7.rollId, {
      remainingAction: "keep_1kalite",
      confirmMismatch: true,
    });
    if (res8.data?.remainingChildId) rollIds.push(res8.data.remainingChildId);
    ok(res8.success === true, "A8 onayla bitirme geçti");
    const dev8 = await prisma.rollPlanDeviation.findMany({
      where: { rollId: f7.rollId, source: "finalize-open-fabric" },
      select: { childRollId: true, qtyM: true },
    });
    ok(dev8.length === 1, "C7 finalize-open-fabric: 1 satır", `n=${dev8.length}`);
    ok(
      dev8[0]?.childRollId === (res8.data?.remainingChildId ?? null) && dev8[0]?.childRollId !== null,
      "C7 satır KALAN kuyruk çocuğunu işaret eder",
    );
    ok(
      dev8[0] != null && new Prisma.Decimal(dev8[0].qtyM).equals(70),
      "C7 qtyM = TAZE kalan metraj (100−30=70)",
      String(dev8[0]?.qtyM),
    );
    // scrap yolu: fire depoya inmez → kapı hiç açılmaz (ayrı fixture).
    const f9 = await makeWoWithRoll({ targetColorId: gri.id, rollColorId: mavi.id });
    const res9 = await svc.finalizeOpenFabric(f9.rollId, {
      remainingAction: "scrap",
      varianceReasonCode: "DIGER",
      varianceReasonText: "test fire",
    });
    if (res9.data?.remainingChildId) rollIds.push(res9.data.remainingChildId);
    ok(res9.success === true, "A8b scrap bitirme kapı DIŞI (fire depoya inmez)");
    const dev9 = await prisma.rollPlanDeviation.count({ where: { rollId: f9.rollId } });
    ok(dev9 === 0, "C8 scrap yolunda defter satırı YOK (kapı hiç açılmadı)", `n=${dev9}`);

    // ── C9. KALAN 0'ken keep ile bitirme → depoya inen yok → 0 satır ──
    // ⚠️ Bu kontrol KAPININ `currentQty > 0` şartını ölçer, yazımın `wantChild`
    // dalında olmasını DEĞİL (ölçüldü: defter dala dışına taşınınca yeşil kaldı,
    // çünkü kapı hiç açılmadığı için `mismatches` zaten boş). Yerleşimin kendisi
    // C10'da yapısal olarak kilitlenir — gerçek yarış (kapı açıldı, tx içinde
    // taze kalan 0'a düştü) deterministik kurulamıyor.
    const f10 = await makeWoWithRoll({ targetColorId: gri.id, rollColorId: mavi.id });
    const cutAll = await svc.cutOpenFabric(f10.rollId, {
      lengthMeters: 100, status: "WAREHOUSE", confirmMismatch: true,
    });
    const childAll = cutAll.data?.childRoll as { id: string } | undefined;
    if (childAll) rollIds.push(childAll.id);
    const devAfterCut = await prisma.rollPlanDeviation.count({ where: { rollId: f10.rollId } });
    const res10 = await svc.finalizeOpenFabric(f10.rollId, {
      remainingAction: "keep_1kalite",
      confirmMismatch: true,
    });
    if (res10.data?.remainingChildId) rollIds.push(res10.data.remainingChildId);
    const devAfterFinalize = await prisma.rollPlanDeviation.count({ where: { rollId: f10.rollId } });
    ok(
      devAfterFinalize === devAfterCut,
      "C9 kalan 0'ken bitirme defteri BÜYÜTMEZ (0 metrajlı satır yok)",
      `kesim sonrası=${devAfterCut} bitirme sonrası=${devAfterFinalize}`,
    );

    // ── C10. YAPISAL: open-fabric defteri `wantChild` dalının İÇİNDE mi ──
    // Gerekçe: kapı pre-tx "kalan var" görüp de tx içindeki TAZE kalan 0'a
    // düşerse (araya kesim girdi) depoya inen bir şey yoktur — dal dışında
    // yazan bir kod 0 metrajlı hayalet satır üretir ve karne metrajı şişer.
    // Kilit `child.id` üzerinden: o değişken YALNIZ `wantChild` bloğunda
    // kapsamdadır (dışarı taşınırsa TS derlemez) → üçlü birlikte aranır.
    // `import.meta` KULLANILMAZ — kök tsconfig CommonJS derler (typecheck:scripts
    // geçidi TS1343 ile düşer). Yol repo kökünden çözülür.
    const svcSrc = await readFile(
      path.join(__dirname, "..", "src", "services", "tambur.service.ts"),
      "utf-8",
    );
    const ofCall = svcSrc.match(
      /recordPlanDeviationTx\(tx, \{[\s\S]{0,600}?source: "finalize-open-fabric"[\s\S]{0,120}?\}\);/,
    )?.[0] ?? "";
    ok(
      ofCall.includes("childRollId: child.id") && ofCall.includes("qtyM: remainingQty"),
      "C10 open-fabric defteri wantChild dalında (child.id + taze remainingQty)",
      ofCall ? ofCall.split("\n")[0] : "çağrı bulunamadı!",
    );

    // ── B. Override zinciri ──
    console.log("B) Uyumsuz sipariş override zinciri");
    const customer = await prisma.customer.create({
      data: { code: `TEST-PG-CUS-${ts}`, name: `TEST PG MUSTERI ${ts}` },
      select: { id: true },
    });
    customerIds.push(customer.id);
    const order = await prisma.order.create({
      data: {
        orderNumber: `TEST-PG-ORD-${ts}`,
        customerId: customer.id,
        lines: {
          create: [
            { itemId: item.id, colorId: mavi.id, width: 345, quantity: 500 },  // renk+en uyumsuz (WO GRİ/330)
            { itemId: item2.id, colorId: gri.id, width: 330, quantity: 300 },  // kumaş uyumsuz
            { itemId: item.id, colorId: gri.id, width: 330, quantity: 200 },   // birebir uyumlu
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, itemId: true, colorId: true } } },
    });
    orderIds.push(order.id);
    const lineMismatch = order.lines.find((l) => l.itemId === item.id && l.colorId === mavi.id)!;
    const lineWrongItem = order.lines.find((l) => l.itemId === item2.id)!;
    const lineCompatible = order.lines.find((l) => l.itemId === item.id && l.colorId === gri.id)!;

    // WO: hedef GRİ/330; partiyle bağlı 1 STOCK top (yetkisiz düzeltilebilir)
    // + 1 IN_PRODUCTION top (roll:manual-adjust ister).
    const b = await makeWoWithRoll({ targetColorId: gri.id, woWidth: 330, rollColorId: gri.id, rollWidth: 330 });
    const batch = await prisma.batch.create({
      data: { batchNumber: `TEST-PG-BT-${ts}`, workOrderId: b.woId },
      select: { id: true },
    });
    batchIds.push(batch.id);
    const stockRoll = await prisma.roll.create({
      data: {
        barcode: `TEST-PG-RS-${ts}`,
        itemId: item.id,
        colorId: gri.id,
        width: 330,
        initialQty: 80,
        currentQty: 80,
        status: RollStatus.STOCK,
        batchId: batch.id,
        entrySource: "SUPPLIER_RECEIPT",
      },
      select: { id: true },
    });
    rollIds.push(stockRoll.id);

    // B1. Kumaş farkı HER ZAMAN 400 (cins düzeltilemez).
    const eB1 = await expectAppError(() =>
      workOrderLinkService.linkOrderLineWithOverride(b.woId, lineWrongItem.id, "test sebep", undefined, ["workorder:write", "roll:manual-adjust"]),
    );
    ok(eB1 !== null && eB1.statusCode === 400 && eB1.message.includes("Kumaş"), "B1 kumaş farkı → 400", eB1?.message ?? "hata yok!");

    // B2. Zaten uyumlu satır → yanlış kapı, 400.
    const eB2 = await expectAppError(() =>
      workOrderLinkService.linkOrderLineWithOverride(b.woId, lineCompatible.id, "test sebep", undefined, ["roll:manual-adjust"]),
    );
    ok(eB2 !== null && eB2.message.includes("zaten"), "B2 uyumlu satır → 'normal bağla' 400", eB2?.message ?? "hata yok!");

    // B3. Sebep kısa → 400.
    const eB3 = await expectAppError(() =>
      workOrderLinkService.linkOrderLineWithOverride(b.woId, lineMismatch.id, "x", undefined, ["roll:manual-adjust"]),
    );
    ok(eB3 !== null && eB3.statusCode === 400, "B3 sebepsiz/kısa sebep → 400");

    // B4. Yetkisiz permissions: STOCK top düzelir, IN_PRODUCTION top failed'a
    // düşer, bağ YİNE kurulur (kısmi başarı bilinçli).
    const resB4 = await workOrderLinkService.linkOrderLineWithOverride(
      b.woId, lineMismatch.id, "planlamaci yanlis renk girmis - mal mavi", undefined, [],
    );
    ok(resB4.data.changedColor && resB4.data.changedWidth, "B4 plan renk+en düzeltildi");
    ok(resB4.data.linked === true, "B4 bağ kuruldu (kısmi top başarısına rağmen)");
    ok(
      resB4.data.rollsUpdated === 1 && resB4.data.rollsFailed.length === 1 && resB4.data.rollsFailed[0]!.rollId === b.rollId,
      "B4 STOCK top düzeldi, IN_PRODUCTION top yetkisiz permissions ile failed",
      `updated=${resB4.data.rollsUpdated} failed=${resB4.data.rollsFailed.length}`,
    );
    const woB4 = await prisma.workOrder.findUniqueOrThrow({
      where: { id: b.woId },
      select: { targetColorId: true, width: true },
    });
    ok(
      woB4.targetColorId === mavi.id && woB4.width !== null && new Prisma.Decimal(woB4.width).equals(345),
      "B4 WO hedefi siparişe eşitlendi (MAVİ/345)",
      `color=${woB4.targetColorId === mavi.id} w=${woB4.width}`,
    );
    const stockAfter = await prisma.roll.findUniqueOrThrow({
      where: { id: stockRoll.id },
      select: { colorId: true, width: true },
    });
    ok(
      stockAfter.colorId === mavi.id && stockAfter.width !== null && new Prisma.Decimal(stockAfter.width).equals(345),
      "B4 STOCK top yeni değere çekildi",
      `color=${stockAfter.colorId === mavi.id} w=${stockAfter.width}`,
    );
    const linkRow = await prisma.workOrderToOrderLine.findFirst({
      where: { workOrderId: b.woId, orderLineId: lineMismatch.id },
      select: { orderLineId: true },
    });
    ok(linkRow !== null, "B4 workOrderToOrderLine satırı var");
    const ovAudit = await prisma.systemLog.findFirst({
      where: { recordId: b.woId, newData: { path: ["event"], equals: "ORDER_LINK_OVERRIDE" } },
      select: { id: true },
    });
    ok(ovAudit !== null, "B4 zincir audit'i (ORDER_LINK_OVERRIDE) yazıldı");

    // B5. IN_PRODUCTION top TAM yetkiyle de düzelir (tekil motor sözleşmesi).
    const resB5 = await workOrderLinkService.applyAttributeToRolls(
      b.woId,
      { rollIds: [b.rollId], colorId: mavi.id, reason: "supervizor duzeltmesi" },
      undefined,
      ["roll:manual-adjust"],
    );
    ok(resB5.data.updated === 1 && resB5.data.failed.length === 0, "B5 roll:manual-adjust ile IN_PRODUCTION top düzeldi");

    // ── E. EN EŞİĞİ FABRİKA AYARI (D4-E1) ──
    console.log("E) En eşiği/kontrolü fabrika ayarı");
    // E7 (statik, davranış bölümlerinden ÖNCE — kırmızısı onlara bağlı kalmasın): AST — sabit `src/`de yalnız tanımında ve ayar okuyucusunda okunur.
    const { scanned, refs } = identifierRefs("TAMBUR_PLAN_WIDTH_TOLERANCE_CM");
    ok(scanned > 300, "E7 körlük zemini: src/ taraması > 300 dosya", `n=${scanned}`);
    const allowed: Record<string, Set<string>> = {
      [path.join("constants", "tambur-plan-gate.ts")]: new Set(["(modül)"]),
      [path.join("services", "system-setting.service.ts")]: new Set([
        "(import)",
        "readTamburPlanGateWidthToleranceCm",
        "setFeatureFlags",
      ]),
    };
    const stray = [...refs].flatMap(([file, owners]) =>
      owners.filter((o) => !allowed[file]?.has(o)).map((o) => `${file}:${o}`),
    );
    ok(stray.length === 0, "E7 sabit çözücü dışında doğrudan OKUNMUYOR", stray.join(", "));
    const deadAllow = Object.keys(allowed).filter((f) => !refs.has(f));
    ok(deadAllow.length === 0, "E7 izinli dosyalar gerçekten sabiti taşıyor (ölü muaf yok)", deadAllow.join(", "));
    const helperSrc = readFileSync(
      path.join(__dirname, "..", "src", "services", "helpers", "tambur-plan-gate.helper.ts"),
      "utf8",
    );
    ok(
      (helperSrc.match(/resolveTamburPlanWidthGate\(\)/g) ?? []).length >= 2,
      "E7 kapı eşiği çözücüden okuyor (helper'da resolveTamburPlanWidthGate çağrısı)",
    );
    const gate0 = await resolveTamburPlanWidthGate();
    ok(gate0.check === "ENFORCE" && gate0.toleranceCm === 10, "E1 ayar yokken çözücü ENFORCE + 10", JSON.stringify(gate0));
    // E1: ayar yokken 409 gövdesi BAYT-AYNI (2026-08-19 sabitli kapının çıktısı).
    const fE1 = await makeWoWithRoll({ targetColorId: gri.id, woWidth: 330, rollColorId: gri.id, rollWidth: 345 });
    const eE1 = await expectAppError(() => svc.finalize(finalizeArgs(fE1.rollId)));
    const wantE1Details = {
      code: PLAN_MISMATCH_CODE,
      mismatches: [
        { field: "width", message: "Top 345 cm, terbiye iş emri 330 cm istiyor (eşik ±10 cm)", rollValue: 345, planValue: 330 },
      ],
      toleranceCm: 10,
    };
    ok(
      eE1?.statusCode === 409 && JSON.stringify(eE1.details) === JSON.stringify(wantE1Details),
      "E1 ayar yokken en sapması 409 gövdesi bayt-aynı",
      JSON.stringify(eE1?.details),
    );
    ok(
      eE1?.message ===
        "Plan ile top uyuşmuyor: Top 345 cm, terbiye iş emri 330 cm istiyor (eşik ±10 cm). Yine de devam etmek için onaylayın.",
      "E1 409 mesajı bayt-aynı",
      eE1?.message ?? "hata yok!",
    );
    ok(e3?.details?.toleranceCm === 10, "E1 yalnız renk sapmasında da toleranceCm=10 taşınır", String(e3?.details?.toleranceCm));

    // E2: eşik 0 → her farkta sorar; eşit en geçer.
    await writeGateSetting(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM, 0);
    const fE2 = await makeWoWithRoll({ targetColorId: gri.id, woWidth: 330, rollColorId: gri.id, rollWidth: 331 });
    const eE2 = await expectAppError(() => svc.finalize(finalizeArgs(fE2.rollId)));
    const mmE2 = (eE2?.details?.mismatches ?? []) as { field: string; message: string }[];
    ok(
      eE2?.details?.code === PLAN_MISMATCH_CODE && eE2.details.toleranceCm === 0 &&
        mmE2.length === 1 && mmE2[0]!.field === "width" && mmE2[0]!.message.includes("±0 cm"),
      "E2 eşik 0 → 1 cm fark da 409",
      JSON.stringify(eE2?.details),
    );
    const fE2b = await makeWoWithRoll({ targetColorId: gri.id, woWidth: 330, rollColorId: gri.id, rollWidth: 330 });
    const resE2b = await svc.finalize(finalizeArgs(fE2b.rollId));
    resE2b.data.splitRolls.forEach((c) => rollIds.push(c.id));
    ok(resE2b.success === true, "E2 eşik 0 → eşit en geçer");

    // E3: eşik 20 → 15 cm fark geçer (ayar sabiti gerçekten ezer).
    await writeGateSetting(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM, 20);
    const fE3 = await makeWoWithRoll({ targetColorId: gri.id, woWidth: 330, rollColorId: gri.id, rollWidth: 345 });
    const resE3 = await svc.finalize(finalizeArgs(fE3.rollId));
    resE3.data.splitRolls.forEach((c) => rollIds.push(c.id));
    ok(resE3.success === true, "E3 eşik 20 → 15 cm fark kapıya çarpmaz");
    await writeGateSetting(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM, null);

    // E4: OFF → en kolu atlanır, renk kapısı aynı kalır.
    await writeGateSetting(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_CHECK, "OFF");
    const fE4 = await makeWoWithRoll({ targetColorId: gri.id, woWidth: 330, rollColorId: gri.id, rollWidth: 400 });
    const resE4 = await svc.finalize(finalizeArgs(fE4.rollId));
    resE4.data.splitRolls.forEach((c) => rollIds.push(c.id));
    ok(resE4.success === true, "E4 OFF → 70 cm en farkı sorulmaz");
    const fE4b = await makeWoWithRoll({ targetColorId: gri.id, woWidth: 330, rollColorId: mavi.id, rollWidth: 400 });
    const eE4b = await expectAppError(() => svc.finalize(finalizeArgs(fE4b.rollId)));
    const mmE4b = (eE4b?.details?.mismatches ?? []) as { field: string }[];
    ok(
      eE4b?.details?.code === PLAN_MISMATCH_CODE && mmE4b.length === 1 && mmE4b[0]!.field === "color",
      "E4 OFF → renk kapısı aynı (yalnız color satırı)",
      JSON.stringify(mmE4b),
    );
    const resE4c = await svc.finalize(finalizeArgs(fE4b.rollId, true));
    resE4c.data.splitRolls.forEach((c) => rollIds.push(c.id));
    const devE4 = await prisma.rollPlanDeviation.findMany({ where: { rollId: fE4b.rollId }, select: { field: true } });
    ok(devE4.length === 1 && devE4[0]!.field === "color", "E4 OFF onaylı geçiş defterde yalnız color", devE4.map((d) => d.field).join(","));
    await writeGateSetting(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_CHECK, null);

    // E5: bilinmeyen değer 400 (Zod + servis sanitize, Türkçe).
    const zBad = [
      updateSchema.safeParse({ tamburPlanGateWidthCheck: "WARN" }),
      updateSchema.safeParse({ tamburPlanGateWidthToleranceCm: -1 }),
      updateSchema.safeParse({ tamburPlanGateWidthToleranceCm: 101 }),
      updateSchema.safeParse({ tamburPlanGateWidthToleranceCm: "10" }),
    ];
    ok(
      zBad.every((r) => !r.success && r.error.issues.every((i) => i.message.includes("Tambur en"))),
      "E5 Zod bilinmeyen değeri Türkçe mesajla reddeder",
      zBad.map((r) => (r.success ? "GEÇTİ!" : r.error.issues[0]?.message)).join(" | "),
    );
    const zGood = [
      updateSchema.safeParse({ tamburPlanGateWidthCheck: "ENFORCE" }),
      updateSchema.safeParse({ tamburPlanGateWidthCheck: "OFF" }),
      updateSchema.safeParse({ tamburPlanGateWidthToleranceCm: 0 }),
      updateSchema.safeParse({ tamburPlanGateWidthToleranceCm: null }),
    ];
    ok(zGood.every((r) => r.success), "E5 Zod geçerli değerleri (ENFORCE/OFF/0/null) kabul eder");
    const svcBad = [
      await expectAppError(() =>
        systemSettingService.setFeatureFlags({ tamburPlanGateWidthCheck: "WARN" as never }, "bekci"),
      ),
      await expectAppError(() =>
        systemSettingService.setFeatureFlags({ tamburPlanGateWidthToleranceCm: -1 }, "bekci"),
      ),
    ];
    ok(
      svcBad.every((e) => e?.statusCode === 400 && e.message.includes("Tambur en")),
      "E5 servis sanitize bilinmeyen değeri 400 ile reddeder",
      svcBad.map((e) => `${e?.statusCode} ${e?.message}`).join(" | "),
    );

    // E6: DB'de çöp değer → okuyucu varsayılana düşer (kod sigortası).
    await writeGateSetting(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_CHECK, "WARN");
    await writeGateSetting(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM, -3);
    const junkCheck = await readTamburPlanGateWidthCheck();
    const junkTol = await readTamburPlanGateWidthToleranceCm();
    ok(junkCheck === "ENFORCE" && junkTol === 10, "E6 çöp ayar değeri varsayılana düşer", `${junkCheck}/${junkTol}`);
    for (const k of GATE_KEYS) await writeGateSetting(k, null);

  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    try {
      for (const k of GATE_KEYS) {
        const orig = savedGate.find((r) => r.key === k);
        await writeGateSetting(k, orig ? (orig.value as Prisma.InputJsonValue) : null);
      }
    } catch (e) {
      fail++;
      console.error("ayar geri yükleme hatası:", e instanceof Error ? e.message : e);
    }
    try {
      // Söküm: variance → op → movement → property → log → roll → link → batch → step → WO → order → master.
      await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...woIds] } } }).catch(() => undefined);
      // ⚠️ RESTRICT FK (RollVariance dersi): top silen her temizlik defteri de
      // silmeli — `rollId` RESTRICT, `childRollId` SET NULL.
      await prisma.rollPlanDeviation.deleteMany({
        where: { OR: [{ rollId: { in: rollIds } }, { childRollId: { in: rollIds } }] },
      });
      await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
      await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.color.deleteMany({ where: { id: { in: colorIds } } });
      await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      console.log("(temizlendi — TEST-PG fixture silindi)");
    } catch (e) {
      console.error("cleanup hata:", e instanceof Error ? e.message : e);
    }
    await prisma.$disconnect();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
})();
