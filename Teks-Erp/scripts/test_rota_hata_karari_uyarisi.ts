// TEST (KQ-D8, plan §3.8 / K7): tambursuz rota — kalite adımından sonra hata kararı
// veren adım (Tambur) yoksa rota şablonu / iş emri yanıtı `warnings` taşır, yazma
// ENGELLENMEZ. Ayrıca istasyon formunda varsayılan dışı muayene düzeni tablet sürümü uyarır.
// Çalıştır: npx tsx scripts/test_rota_hata_karari_uyarisi.ts
import fs from "node:fs";
import path from "node:path";
import prisma from "../src/lib/prisma";
import { StationKind, StepStatus } from "@prisma/client";
import { routeService } from "../src/routes/route.routes";
import { stationService } from "../src/routes/station.routes";
import { collectWorkOrderDecisionWarnings } from "../src/services/helpers/defect-decision.helper";
import {
  findDefectDecisionGap,
  INSPECTION_LAYOUT_MIN_TABLET,
  stepDecidesDefects,
} from "../src/services/helpers/quality-station.helper";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TRH${Date.now().toString(36).slice(-5).toUpperCase()}`;
const stationIds: string[] = [];
const routeIds: string[] = [];
let woId = "";

async function station(code: string, name: string, kind: StationKind, inspectionEnabled: boolean): Promise<string> {
  const s = await prisma.station.create({
    data: { code: `${TAG}_${code}`, name: `${TAG} ${name}`, type: "INTERNAL", kind, inspectionEnabled },
    select: { id: true },
  });
  stationIds.push(s.id);
  return s.id;
}

type Res = { success: boolean; data?: { id?: string }; warnings?: string[] };
async function saveRoute(label: string, ids: string[]): Promise<Res> {
  const r = (await routeService.create({
    name: `${TAG} ${label}`,
    steps: ids.map((stationId, i) => ({ stationId, sequence: i + 1 })),
  })) as Res;
  if (r.data?.id) routeIds.push(r.data.id);
  return r;
}
const decisionWarn = (r: { warnings?: string[] }) => (r.warnings ?? []).filter((w) => w.includes("hata kararı veren adım"));

async function main(): Promise<void> {
  console.log("\n§1 Saf yüklem (karar ikizi + boşluk)");
  check("§1 stepDecidesDefects: TAMBUR karar verir", stepDecidesDefects({ kind: StationKind.TAMBUR }));
  check("§1 stepDecidesDefects: PROCESS_QC karar VERMEZ", !stepDecidesDefects({ kind: StationKind.PROCESS_QC }));
  const kk = { name: "KK", kind: StationKind.PROCESS_QC, inspectionEnabled: true };
  const tb = { name: "Tambur", kind: StationKind.TAMBUR, inspectionEnabled: true };
  const ku = { name: "Kurşun", kind: StationKind.PROCESS_QC, inspectionEnabled: false };
  check("§1 KK→Tambur boşluk yok", findDefectDecisionGap([kk, tb]).length === 0);
  check("§1 KK→Kurşun boşluk = [KK]", JSON.stringify(findDefectDecisionGap([kk, ku])) === '["KK"]');
  check("§1 Tambur→KK boşluk = [KK]", JSON.stringify(findDefectDecisionGap([tb, kk])) === '["KK"]');
  check("§1 atlanmış Tambur karar saymaz", JSON.stringify(findDefectDecisionGap([kk, { ...tb, skipped: true }])) === '["KK"]');
  check("§1 atlanmış KK hata üretmez → boşluk yok", findDefectDecisionGap([{ ...kk, skipped: true }, ku]).length === 0);
  check("§1 muayenesi kapalı rota boşluk üretmez", findDefectDecisionGap([ku]).length === 0);

  const KK = await station("KK", "KK2", StationKind.PROCESS_QC, true);
  const KU = await station("KU", "Kurşun", StationKind.PROCESS_QC, false);
  const TB = await station("TB", "Tambur", StationKind.TAMBUR, true);

  console.log("\n§2 Rota şablonu kaydı (route.service)");
  const r1 = await saveRoute("KK-Kursun", [KK, KU]);
  check("§2 KK→Kurşun (Tambursuz) kaydedildi (engellenmedi)", r1.success === true && !!r1.data?.id);
  check("§2 KK→Kurşun warnings taşır", decisionWarn(r1).length === 1, decisionWarn(r1)[0] ?? "yok");
  check("§2 uyarı kalite adımının ADINI söyler", (decisionWarn(r1)[0] ?? "").includes(`${TAG} KK2`));
  const r2 = await saveRoute("KK-Tambur", [KK, TB]);
  check("§2 KK→Tambur warnings TAŞIMAZ", r2.success === true && decisionWarn(r2).length === 0, JSON.stringify(r2.warnings ?? []));
  const r3 = await saveRoute("Tambur-KK", [TB, KK]);
  check("§2 Tambur→KK warnings taşır (karar adımı kaliteden ÖNCE)", r3.success === true && decisionWarn(r3).length === 1);
  const r4 = (await routeService.update(r2.data!.id!, {
    // Panelin düzenleme gövdesi (RoutesPage): nested write.
    steps: { deleteMany: {}, create: [{ stationId: KK, sequence: 1 }, { stationId: KU, sequence: 2 }] },
  })) as Res;
  check("§2 güncellemede Tambur çıkarılınca warnings + kayıt", r4.success === true && decisionWarn(r4).length === 1);

  console.log("\n§3 İş emri (yazılmış rota; SKIPPED adım)");
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  if (!item) throw new Error("Seed eksik: PATOS");
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `${TAG}-WO`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS", width: 250, targetQuantity: 100, targetItemId: item.id,
      steps: { create: [
        { stationId: KK, stepSequence: 1, status: StepStatus.PENDING },
        { stationId: TB, stepSequence: 2, status: StepStatus.SKIPPED },
      ] },
    },
    select: { id: true },
  });
  woId = wo.id;
  const w1 = await collectWorkOrderDecisionWarnings(woId);
  check("§3 atlanmış Tambur karar saymaz → uyarı", w1.length === 1, w1[0] ?? "yok");
  await prisma.workOrderStep.updateMany({ where: { workOrderId: woId, stationId: TB }, data: { status: StepStatus.PENDING } });
  const w2 = await collectWorkOrderDecisionWarnings(woId);
  check("§3 bekleyen Tambur karar verir → uyarı yok", w2.length === 0, JSON.stringify(w2));
  const src = fs.readFileSync(path.join(__dirname, "../src/services/workorder.service.ts"), "utf8");
  check("§3 workorder.service create + replace aynı helper'ı çağırır (2 çağrı)", (src.match(/collectWorkOrderDecisionWarnings\(/g) ?? []).length === 2);

  console.log("\n§4 İstasyon formu — varsayılan dışı muayene düzeni");
  const u1 = (await stationService.update(KU, { inspectionEnabled: false })) as Res;
  const tw = (u1.warnings ?? []).find((w) => w.includes("tablet ≥"));
  check("§4 Ara istasyonda muayene kapalı → tablet sürüm uyarısı", !!tw && tw.includes(INSPECTION_LAYOUT_MIN_TABLET), tw ?? "yok");
  const u2 = (await stationService.update(KK, { inspectionEnabled: true })) as Res;
  check("§4 varsayılan düzen (muayene açık) uyarı TAŞIMAZ", !(u2.warnings ?? []).some((w) => w.includes("tablet ≥")));
  const u3 = (await stationService.update(TB, { inspectionEnabled: false })) as Res;
  check("§4 Tambur'da muayene kapalı → uyarı + kayıt", u3.success === true && (u3.warnings ?? []).some((w) => w.includes("tablet ≥")));
  const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../../mobil/app.json"), "utf8")) as { expo: { version: string } };
  const cmp = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  check("§4 sürüm sabiti 1.4.2'den (D3 öncesi yayın) büyük ve app.json'dan en fazla bir yama ileride",
    cmp(INSPECTION_LAYOUT_MIN_TABLET, "1.4.2") > 0 && cmp(INSPECTION_LAYOUT_MIN_TABLET, appJson.expo.version) <= 1,
    `${INSPECTION_LAYOUT_MIN_TABLET} vs app.json ${appJson.expo.version}`);
}

async function cleanup(): Promise<void> {
  if (woId) {
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrder.deleteMany({ where: { id: woId } });
  }
  await prisma.routeStep.deleteMany({ where: { routeId: { in: routeIds } } });
  await prisma.route.deleteMany({ where: { id: { in: routeIds } } });
  await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
}

main()
  .catch((e) => { fail++; console.error("HATA:", e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("temizlik:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
