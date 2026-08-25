// TEST: "Fasona renksiz gitsin" (`dispatchWithoutColor`) — UÇTAN UCA SÖZLEŞME.
//
// 2026-08-17 "ekru" kuralı: müşteri siparişi rengi EKRU der ve iş emrinin hedefi
// de EKRU'dur; ama boyahane o rengi BOYAMAZ — kumaş kimyasal işlemden geçer ve
// çıkan ton "ekru" diye satılır. Çekiye "BOYANACAK RENK: EKRU" yazmak boyacıya
// YANLIŞ TALİMATTIR. Bayrak ADIMDA yaşar (renkte değil) ve YALNIZ çeki/talimat
// yüzeyini susturur; `WorkOrder.targetColorId` değişmez.
//
// ⚠️ NEDEN BU BEKÇİ VAR (2026-08-25 saha bulgusu): özellik 17.08'de yazıldı ve
// canlıda 623 iş emri adımının HİÇBİRİNDE işaretli değildi. Sebep tek bir hata
// değil, YEDİ ayrı katmanda aynı sessiz düşüştü:
//   1-4) controller Zod şemaları (create.steps / create.stepPlanning /
//        replace.steps / replace.stepPlanning) alanı tanımıyordu → Zod
//        bilinmeyen anahtarı SESSİZCE siler ("kesimde kat düşüyordu" dersi);
//   5-7) workorder.service'in ÜÇ Prisma yazım noktası (create nested
//        steps.create, replace update, replace create) alanı yazmıyordu —
//        `finalSteps` onu taşıyordu ama DB'ye hiç ulaşmıyordu;
//     +) RouteService.ALLOWED_STEP_KEYS onu reddediyordu → şablona kaydetmek
//        400 verirdi, dolayısıyla "şablondan miras" yolu da hiç kurulamadı.
// Servis katmanı BAŞTAN İTİBAREN doğruydu; bu yüzden servisi doğrudan çağıran
// bir test YEŞİL kalırdı. Bekçinin §1'i bilerek METİN üzerinden koşar.
//
// Çalıştır: npx tsx scripts/test_dispatch_without_color.ts
import fs from "fs";
import path from "path";
import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { resolveStepDyeColor } from "../src/services/helpers/fason-work-instructions.helper";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

const FIELD = "dispatchWithoutColor";

/** `blockName: z\n .array(z.object({ ... }))` gövdesini çıkarır (n. eşleşme). */
function zodArrayBlocks(src: string, blockName: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`  ${blockName}: z\\n    \\.array\\(z\\.object\\(\\{\\n([\\s\\S]*?)\\n    \\}\\)\\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

const svc = new WorkOrderService();

// ── fixture ──────────────────────────────────────────────────────────────────
let ITEM = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_TAMBUR = "";
let COLOR = "";
const created: string[] = []; // temizlenecek WO id'leri
let routeId: string | null = null;

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "User admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "Station BOYA_FASON");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "Station TAMBUR_1");
  COLOR = need(
    await prisma.color.findFirst({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true } }),
    "aktif Color",
  );
}

async function stepFlags(woId: string): Promise<boolean[]> {
  const rows = await prisma.workOrderStep.findMany({
    where: { workOrderId: woId },
    orderBy: { stepSequence: "asc" },
    select: { dispatchWithoutColor: true },
  });
  return rows.map((r) => r.dispatchWithoutColor);
}

async function main(): Promise<void> {
  // ══ §1 SÖZLEŞME (statik) — alanın düştüğü yedi kapı ═══════════════════════
  console.log("\n§1 Sözleşme: alan her katmanda taşınıyor mu?");
  const ctrl = read("src/controllers/workorder.controller.ts");
  const stepsBlocks = zodArrayBlocks(ctrl, "steps");
  const planBlocks = zodArrayBlocks(ctrl, "stepPlanning");
  check(
    "controller: iki `steps` Zod bloğu bulundu (create + replace)",
    stepsBlocks.length === 2,
    `bulunan: ${stepsBlocks.length}`,
  );
  check(
    "controller: iki `stepPlanning` Zod bloğu bulundu (create + replace)",
    planBlocks.length === 2,
    `bulunan: ${planBlocks.length}`,
  );
  stepsBlocks.forEach((b, i) =>
    check(`controller: ${i + 1}. \`steps\` bloğu ${FIELD} kabul ediyor`, b.includes(FIELD)),
  );
  planBlocks.forEach((b, i) =>
    check(`controller: ${i + 1}. \`stepPlanning\` bloğu ${FIELD} kabul ediyor`, b.includes(FIELD)),
  );

  const woSvc = read("src/services/workorder.service.ts");
  // Prisma'ya adım yazan HER nokta: nested steps.create + replace update/create.
  // "Adım yazan nokta" = WorkOrderStep satırını Prisma'ya YAZAN üç gövde
  // (create nested steps.create · replace update · replace create). Hepsi
  // `plannedSubcontractorId: <step|incoming>.plannedSubcontractorId` taşır;
  // `plannedSubcontractorId: true` olan `select`'ler (OKUMA) böylece elenir.
  // Sayı kontrolü KÖRLÜK ZEMİNİdir: bir refactor tarayıcıyı boşa düşürürse
  // "ihlal yok" ile "hiçbir şeye bakılmadı" aynı yeşile çıkmasın.
  const ANCHOR = /plannedSubcontractorId:\s*(?:step|incoming)\.plannedSubcontractorId/g;
  // Pencere iki yönlü: alan `plannedSubcontractorId`'nin üstünde de yazılabilir,
  // araya gerekçe yorumu da girebilir (bugün create dalında öyle).
  const writeSites = [...woSvc.matchAll(ANCHOR)].map((m) =>
    woSvc.slice(Math.max(0, (m.index ?? 0) - 400), (m.index ?? 0) + 600),
  );
  check(
    "servis: adım yazan üç Prisma noktası bulundu",
    writeSites.length === 3,
    `bulunan: ${writeSites.length}`,
  );
  writeSites.forEach((site, i) =>
    check(`servis: ${i + 1}. adım yazımı ${FIELD} içeriyor`, site.includes(FIELD)),
  );

  const routeSvc = read("src/services/route.service.ts");
  const allowlist = /ALLOWED_STEP_KEYS = new Set\(\[([\s\S]*?)\]\)/.exec(routeSvc)?.[1] ?? "";
  check("rota: ALLOWED_STEP_KEYS alanı kabul ediyor (şablon yolu)", allowlist.includes(FIELD));

  // ══ §2 ÇEKİ YÜZEYİ (saf yüklem) ═══════════════════════════════════════════
  console.log("\n§2 Çeki yüzeyi: işaret kategori süzgecini EZER mi?");
  const dyeCat = { requiredCategory: { appliesColor: true } };
  check(
    "işaretsiz + boya kategorisi → renk BASILIR",
    resolveStepDyeColor({ ...dyeCat, dispatchWithoutColor: false }, "EKRU") === "EKRU",
  );
  check(
    "işaretli + boya kategorisi → renk BASILMAZ (ekru kuralı)",
    resolveStepDyeColor({ ...dyeCat, dispatchWithoutColor: true }, "EKRU") === null,
  );

  await resolveFixtures();

  // ══ §3 CREATE — özel rota (steps[]) ═══════════════════════════════════════
  console.log("\n§3 create(): özel rota adımında işaret DB'ye yazılıyor mu?");
  const stamp = `${Date.now()}`.slice(-8);
  const r1 = await svc.create(
    {
      type: "STOCK_PRODUCTION",
      targetItemId: ITEM,
      targetColorId: COLOR,
      width: 250,
      steps: [
        { stationId: ST_BOYA, dispatchWithoutColor: true },
        { stationId: ST_TAMBUR },
      ],
    },
    ADMIN,
  );
  const wo1 = r1.data as { id: string };
  created.push(wo1.id);
  const f1 = await stepFlags(wo1.id);
  check("özel rota: fason adımı işaretli", f1[0] === true, `okunan: ${f1[0]}`);
  check("özel rota: Tambur adımı işaretsiz", f1[1] === false, `okunan: ${f1[1]}`);

  // ══ §4 ŞABLON + stepPlanning overlay ══════════════════════════════════════
  console.log("\n§4 create(): şablon rotası + stepPlanning overlay");
  const route = await prisma.route.create({
    data: {
      code: `TST-DWC-${stamp}`,
      name: `TEST Renksiz Rota ${stamp}`,
      isActive: true,
      steps: {
        create: [
          { stationId: ST_BOYA, sequence: 1 },
          { stationId: ST_TAMBUR, sequence: 2 },
        ],
      },
    },
    select: { id: true },
  });
  routeId = route.id;

  const r2 = await svc.create(
    {
      type: "STOCK_PRODUCTION",
      targetItemId: ITEM,
      targetColorId: COLOR,
      width: 250,
      routeTemplateId: route.id,
      stepPlanning: [{ sequence: 1, dispatchWithoutColor: true }],
    },
    ADMIN,
  );
  const wo2 = r2.data as { id: string };
  created.push(wo2.id);
  const f2 = await stepFlags(wo2.id);
  check("şablon + overlay: 1. adım işaretli", f2[0] === true, `okunan: ${f2[0]}`);

  // ══ §5 ŞABLONDAN MİRAS (overlay YOK) ══════════════════════════════════════
  console.log("\n§5 Şablonda işaretli adım → yeni iş emrine miras");
  await prisma.routeStep.updateMany({
    where: { routeId: route.id, sequence: 1 },
    data: { dispatchWithoutColor: true },
  });
  const r3 = await svc.create(
    {
      type: "STOCK_PRODUCTION",
      targetItemId: ITEM,
      targetColorId: COLOR,
      width: 250,
      routeTemplateId: route.id,
    },
    ADMIN,
  );
  const wo3 = r3.data as { id: string };
  created.push(wo3.id);
  const f3 = await stepFlags(wo3.id);
  check("şablon mirası: overlay olmadan da işaret geldi", f3[0] === true, `okunan: ${f3[0]}`);

  // ══ §6 REPLACE — işaret KAPATILABİLİR ═════════════════════════════════════
  console.log("\n§6 replace(): işaret geri alınabiliyor mu?");
  await svc.replace(
    wo3.id,
    {
      type: "STOCK_PRODUCTION",
      targetItemId: ITEM,
      targetColorId: COLOR,
      width: 250,
      routeTemplateId: route.id,
      stepPlanning: [{ sequence: 1, dispatchWithoutColor: false }],
    },
    ADMIN,
  );
  const f4 = await stepFlags(wo3.id);
  check(
    "replace: overlay=false şablondaki true'yu EZER (kapatma niyeti yutulmuyor)",
    f4[0] === false,
    `okunan: ${f4[0]}`,
  );

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  })
  .finally(async () => {
    // Temizlik: WO'lar (adım/kart/bağ cascade) + test rotası.
    for (const id of created) {
      await prisma.travelerCardScan.deleteMany({ where: { card: { workOrderId: id } } }).catch(() => {});
      await prisma.travelerCard.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrderStep.deleteMany({ where: { workOrderId: id } }).catch(() => {});
      await prisma.workOrder.delete({ where: { id } }).catch(() => {});
    }
    if (routeId) {
      await prisma.routeStep.deleteMany({ where: { routeId } }).catch(() => {});
      await prisma.route.delete({ where: { id: routeId } }).catch(() => {});
    }
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  });
