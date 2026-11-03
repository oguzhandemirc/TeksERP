/**
 * test_pg_eszamanli_sorgu — tx içinde aynı pg bağlantısına eşzamanlı sorgu (S15a, 2026-11-03)
 *
 * Prisma 7 (adapter-pg) tek çağrıda AYNI düzeydeki birden çok ilişkiyi PARALEL ister;
 * interaktif tx'te tek bağlantı olduğundan pg 8.x ikinciyi kuyruğa alır ve "client.query()
 * when the client is already executing a query" uyarısı basar — pg@9'da HATA. Düzeltme
 * `sequentialTx(tx)` (helpers/tx-sequential-relations.helper.ts): ilişkiler sıralı `await`le yüklenir.
 *
 * Bölümler (hepsi TEK geri sarılan tx'te — kalıntı yok; fason firması sabit fikstürden):
 *  §1 sonda canlı: sarılmamış çoklu ilişki tx'te çakışma ÜRETİR (0 ise sonda ölüdür)
 *  §2 eşdeğerlik: ham tx sonucu === sequentialTx sonucu (JSON, anahtar sırası dahil), çakışma 0
 *  §3 gerçek sıcak yollar tx'te çakışmasız (alan-farkı, okutmayla rota, İE doğuşu, refakat kartı)
 *  §4 statik: düzeltilen her yer `sequentialTx` taşır; `$transaction` geri çağrısında sarılmamış
 *     ≥2 ilişkili literal include/select YOK (cırcır — yeni yer eklenemez)
 * Negatif sonda: workorder-field-diff.helper.ts'te `sequentialTx(tx).workOrderStep` → `tx.workOrderStep`
 * → §3 ve §4 kırmızı (ölçüldü 2026-11-03).
 */
import { readFileSync } from "fs";
import { join, relative } from "path";
import * as ts from "typescript";
import { Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { walkTs } from "./lib/ts-tarama";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { sequentialTx, hasParallelRelationRisk } from "../src/services/helpers/tx-sequential-relations.helper";
import { readStepSnapshotsTx } from "../src/services/helpers/workorder-field-diff.helper";
import { loadScanRouteFacts } from "../src/services/helpers/okutmayla-rota.helper";
import { createWorkOrderTx } from "../src/services/helpers/workorder-event.helper";
import { TravelerCardService } from "../src/services/traveler-card.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detay?: string): void {
  if (ok) { pass++; console.log(`✅ ${label}`); } else { fail++; console.log(`❌ ${label}${detay ? ` — ${detay}` : ""}`); }
}

// ── pg kancası: aynı Client'ta sorgu sürerken ya da kuyruk doluyken gelen query ──
const { Client } = require("pg") as { Client: { prototype: { query: (...a: unknown[]) => unknown } } };
let cakisma = 0;
const ornekler: string[] = [];
const ozgunQuery = Client.prototype.query;
Client.prototype.query = function (this: { _activeQuery?: unknown; _queryQueue?: unknown[] }, ...a: unknown[]) {
  if (this._activeQuery || (this._queryQueue?.length ?? 0) > 0) {
    cakisma++;
    const q = a[0] as { text?: string } | string;
    if (ornekler.length < 3) ornekler.push(String(typeof q === "string" ? q : q?.text).replace(/\s+/g, " ").slice(0, 120));
  }
  return ozgunQuery.apply(this, a);
};
async function olc<T>(f: () => Promise<T>): Promise<{ sonuc: T; n: number; ornek: string }> {
  cakisma = 0; ornekler.length = 0;
  const sonuc = await f();
  return { sonuc, n: cakisma, ornek: ornekler.join(" | ") };
}

type Tx = Prisma.TransactionClient;
const GERI_AL = new Error("S15A_GERI_AL");
const damga = `${Date.now()}`.slice(-8);

async function tutarli(tx: Tx): Promise<void> {
  const dye = await ensureTestDyeHouse();
  // ── Fikstür (tx içinde; sonda geri sarılır) ──
  const [s1, s2] = [
    await tx.station.create({ data: { code: `TEST-S15A-${damga}-1`, name: `TEST S15a A ${damga}`, type: "INTERNAL" } }),
    await tx.station.create({ data: { code: `TEST-S15A-${damga}-2`, name: `TEST S15a B ${damga}`, type: "INTERNAL" } }),
  ];
  const item = await tx.item.create({ data: { code: `TEST-S15A-${damga}`, name: `TEST S15a ürün ${damga}`, itemType: "FABRIC" } });
  const color = await tx.color.create({ data: { code: `TEST-S15A-${damga}`, name: `TEST S15a renk ${damga}` } });
  const customer = await tx.customer.create({ data: { code: `TEST-S15A-${damga}`, name: `TEST S15a müşteri ${damga}` } });
  const order = await tx.order.create({ data: { orderNumber: `TEST-S15A-${damga}`, customerId: customer.id } });
  const line = await tx.orderLine.create({ data: { orderId: order.id, itemId: item.id, colorId: color.id, quantity: new Prisma.Decimal(10) } });

  const WO_INCLUDE = {
    steps: { include: { station: true, requiredCategory: true }, orderBy: { stepSequence: "asc" } },
    orderLinks: { orderBy: { createdAt: "asc" }, include: { orderLine: { include: { order: { include: { customer: true } }, item: true, color: true } } } },
    routeTemplate: true,
    targetItem: true,
  } satisfies Prisma.WorkOrderInclude;

  // §3a — iş emri doğuşu (createWorkOrderTx, include'lu create) çakışmasız
  const dogus = await olc(() => createWorkOrderTx(tx, { trigger: "TEST_S15A" }, {
    data: {
      workOrderNumber: `TEST-S15A-${damga}`,
      targetItemId: item.id,
      targetColorId: color.id,
      steps: { create: [
        { stationId: s1.id, stepSequence: 1, requiredCategoryId: dye.categoryId },
        { stationId: s2.id, stepSequence: 2, plannedSubcontractorId: dye.id },
        { stationId: s1.id, stepSequence: 3 },
      ] },
      orderLinks: { create: [{ orderLineId: line.id }] },
    },
    include: WO_INCLUDE,
  }));
  const wo = dogus.sonuc;
  check("§3a createWorkOrderTx (çoklu include'lu create) tx'te çakışmasız", dogus.n === 0, `${dogus.n} çakışma: ${dogus.ornek}`);
  const hamDogus = await tx.workOrder.findUnique({ where: { id: wo.id }, include: WO_INCLUDE });
  check("§3a doğuş sonucu ham findUnique ile bayt-aynı", JSON.stringify(hamDogus) === JSON.stringify(wo));

  // §1 — sonda canlı: sarılmamış çoklu ilişki tx'te çakışma üretir
  const ham = await olc(() => tx.workOrder.findUnique({ where: { id: wo.id }, include: WO_INCLUDE }));
  check("§1 sonda canlı: sarılmamış çoklu include tx'te çakışma üretir", ham.n > 0, "0 çakışma — Prisma artık paralel istemiyor ya da kanca ölü; bekçiyi yeniden ölç");

  // §2 — eşdeğerlik
  const sirali = sequentialTx(tx);
  const durumlar: Array<{ ad: string; ham: () => Promise<unknown>; sir: () => Promise<unknown> }> = [
    { ad: "include iç içe (findUnique)",
      ham: () => tx.workOrder.findUnique({ where: { id: wo.id }, include: WO_INCLUDE }),
      sir: () => sirali.workOrder.findUnique({ where: { id: wo.id }, include: WO_INCLUDE }) },
    { ad: "select iç içe + _count + id seçilmemiş",
      ham: () => tx.workOrder.findUnique({ where: { id: wo.id }, select: SELECT_PLAN }),
      sir: () => sirali.workOrder.findUnique({ where: { id: wo.id }, select: SELECT_PLAN }) },
    { ad: "findMany ortak çocuk (aynı istasyon iki adımda)",
      ham: () => tx.workOrderStep.findMany({ where: { workOrderId: wo.id }, orderBy: { stepSequence: "asc" }, select: SELECT_ADIM }),
      sir: () => sirali.workOrderStep.findMany({ where: { workOrderId: wo.id }, orderBy: { stepSequence: "asc" }, select: SELECT_ADIM }) },
    { ad: "boş sonuç (findMany)",
      ham: () => tx.workOrderStep.findMany({ where: { workOrderId: "00000000-0000-0000-0000-000000000000" }, select: SELECT_ADIM }),
      sir: () => sirali.workOrderStep.findMany({ where: { workOrderId: "00000000-0000-0000-0000-000000000000" }, select: SELECT_ADIM }) },
  ];
  for (const d of durumlar) {
    const h = await d.ham();
    const s = await olc(d.sir);
    check(`§2 ${d.ad}: sonuç bayt-aynı`, JSON.stringify(h) === JSON.stringify(s.sonuc), `ham=${JSON.stringify(h).slice(0, 160)} sıralı=${JSON.stringify(s.sonuc).slice(0, 160)}`);
    check(`§2 ${d.ad}: çakışma 0`, s.n === 0, `${s.n}: ${s.ornek}`);
  }
  const adimlar = (await sirali.workOrderStep.findMany({ where: { workOrderId: wo.id }, orderBy: { stepSequence: "asc" }, select: SELECT_ADIM }));
  check("§2 ortak çocuk ayrı nesne (Prisma gibi; takma ad yok)", adimlar[0].station !== adimlar[2].station && adimlar[0].station.name === adimlar[2].station.name);
  check("§2 havuz istemcisi olduğu gibi döner", sequentialTx(prisma) === prisma);
  check("§2 risk yüklemi: tek ilişki risksiz, iki ilişki riskli",
    !hasParallelRelationRisk("workOrderStep", { select: { station: true } }) && hasParallelRelationRisk("workOrderStep", { select: { station: true, workOrder: true } }));

  // §3 — gerçek sıcak yollar
  const fark = await olc(() => readStepSnapshotsTx(tx, wo.id));
  check("§3b readStepSnapshotsTx (alan farkı defteri) çakışmasız", fark.n === 0 && fark.sonuc.length === 3, `${fark.n}: ${fark.ornek}`);
  const okr = await olc(() => loadScanRouteFacts(tx, wo.id));
  check("§3c loadScanRouteFacts (okutmayla rota) çakışmasız", okr.n === 0 && okr.sonuc.steps.length === 3, `${okr.n}: ${okr.ornek}`);
  const kart = await olc(() => new TravelerCardService().createForWorkOrder(tx, wo.id));
  check("§3d refakat kartı doğuşu (buildPlan) çakışmasız", kart.n === 0 && kart.sonuc.created, `${kart.n}: ${kart.ornek}`);
  throw GERI_AL;
}

const SELECT_PLAN = {
  workOrderNumber: true,
  routeTemplate: { select: { name: true } },
  targetItem: { select: { code: true, name: true } },
  targetColor: { select: { name: true, hex: true } },
  steps: {
    orderBy: { stepSequence: "asc" },
    select: { stepSequence: true, station: { select: { name: true, type: true } }, plannedSubcontractor: { select: { id: true, name: true } } },
  },
  orderLinks: { select: { orderLineId: true, orderLine: { select: { quantity: true, order: { select: { orderNumber: true, customer: { select: { name: true } } } }, item: { select: { name: true } } } } } },
  _count: { select: { steps: true, orderLinks: true } },
} satisfies Prisma.WorkOrderSelect;
const SELECT_ADIM = {
  id: true, stepSequence: true,
  station: { select: { name: true } },
  requiredCategory: { select: { name: true } },
  plannedSubcontractor: { select: { name: true } },
} satisfies Prisma.WorkOrderStepSelect;

// ── §4 statik ──
const KOK = join(__dirname, "..");
/** Düzeltilen yerler (S15a ölçümü): dosya → içinde bulunması gereken sarılı çağrı. */
const DUZELTILEN: Array<[string, string]> = [
  ["src/services/printed-document.service.ts", "(entry.freeze ?? entry.fresh)(seqTx, sourceId)"],
  ["src/services/traveler-card.service.ts", "sequentialTx(client).workOrder.findUnique"],
  ["src/services/helpers/workorder-field-diff.helper.ts", "sequentialTx(tx).workOrderStep.findMany"],
  ["src/services/helpers/okutmayla-rota.helper.ts", "sequentialTx(db).workOrderStep.findMany"],
  ["src/services/helpers/workorder-event.helper.ts", "sequentialTx(tx).workOrder.create"],
  ["src/services/workorder-batch-add.service.ts", "sequentialTx(tx).workOrder.findUnique"],
  ["src/services/helpers/workorder-clone.helper.ts", "sequentialTx(tx).workOrder.findUnique"],
  ["src/services/helpers/workorder-close-snapshot.helper.ts", "sequentialTx(tx).roll.findMany"],
  ["src/services/subcontractor.service.ts", "sequentialTx(tx).subcontractorDispatch.create"],
  ["src/services/subcontractor.service.ts", "sequentialTx(tx).subcontractorReceipt.findUnique"],
  ["src/services/order.service.ts", "sequentialTx(tx).order.create"],
  ["src/services/weaving-order.service.ts", "sequentialTx(tx).weavingOrder.findUniqueOrThrow"],
  ["src/services/inventory.service.ts", "sequentialTx(tx).roll.create"],
  ["src/services/batch.service.ts", "sequentialTx(tx).subcontractorDispatch.findMany"],
  ["src/services/helpers/batch-dispatch-surgery.helper.ts", "sequentialTx(tx).subcontractorDispatch.findMany"],
];

/** `$transaction` geri çağrısının parametresi ya da tipi TransactionClient/Tx olan alıcı. */
function txAlicilari(node: ts.Node): Set<string> {
  const s = new Set<string>();
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (!ts.isFunctionLike(n)) continue;
    const p = n.parent;
    const txGeriCagri = !!p && ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === "$transaction";
    for (const prm of n.parameters) {
      if (!ts.isIdentifier(prm.name)) continue;
      const tip = prm.type ? prm.type.getText() : "";
      if (txGeriCagri || /TransactionClient|\bTx\b/.test(tip)) s.add(prm.name.text);
    }
  }
  return s;
}

function statikIhlaller(): string[] {
  const delegeler = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name[0].toLowerCase() + m.name.slice(1)));
  const out: string[] = [];
  for (const dosya of walkTs(join(KOK, "src"))) {
    if (dosya.endsWith("tx-sequential-relations.helper.ts")) continue;
    const kaynak = ts.createSourceFile(dosya, readFileSync(dosya, "utf8"), ts.ScriptTarget.Latest, true);
    const gez = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const del = node.expression.expression;
        const arg = node.arguments[0];
        if (ts.isPropertyAccessExpression(del) && delegeler.has(del.name.text) && ts.isIdentifier(del.expression)
          && arg && ts.isObjectLiteralExpression(arg) && txAlicilari(node).has(del.expression.text)) {
          const args = literalArgs(arg);
          if (args && hasParallelRelationRisk(del.name.text, args)) {
            const { line } = kaynak.getLineAndCharacterOfPosition(node.getStart());
            out.push(`${relative(KOK, dosya)}:${line + 1} ${del.expression.text}.${del.name.text}.${node.expression.name.text}`);
          }
        }
      }
      ts.forEachChild(node, gez);
    };
    gez(kaynak);
  }
  return out;
}

/** Literal include/select'i risk yüklemi için düz nesneye çevirir (değer: true ya da iç nesne). */
function literalArgs(arg: ts.ObjectLiteralExpression): Record<string, unknown> | null {
  const cevir = (o: ts.ObjectLiteralExpression): Record<string, unknown> => {
    const r: Record<string, unknown> = {};
    for (const p of o.properties) {
      if (!ts.isPropertyAssignment(p)) continue;
      const k = p.name.getText().replace(/^["']|["']$/g, "");
      if (p.initializer.kind === ts.SyntaxKind.FalseKeyword) r[k] = false;
      else r[k] = ts.isObjectLiteralExpression(p.initializer) ? cevir(p.initializer) : true;
    }
    return r;
  };
  const r = cevir(arg);
  return r.include || r.select ? r : null;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(`⛔ DURDURULDU — ${engel}`); process.exitCode = 1; return; }
  try {
    await prisma.$transaction(tutarli, { timeout: 60_000, maxWait: 10_000 });
  } catch (e) {
    if (e !== GERI_AL) { fail++; console.log(`❌ beklenmeyen hata: ${e instanceof Error ? e.stack : String(e)}`); }
  }
  for (const [dosya, parca] of DUZELTILEN) {
    check(`§4 ${dosya} → ${parca}`, readFileSync(join(KOK, dosya), "utf8").includes(parca));
  }
  const ihlal = statikIhlaller();
  check("§4 tx geri çağrısında sarılmamış ≥2 ilişkili literal include/select yok", ihlal.length === 0, ihlal.join("; "));
}

main()
  .catch((e: unknown) => { fail++; console.log(`❌ ${String(e)}`); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
