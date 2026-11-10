// =============================================================================
// TOP AŞAMASI — ETİKET TÜRÜ (2026-11-10, plan "Top aşaması")
// Çalıştır: npx tsx scripts/run-all-tests.ts roll_asama_etiket
// =============================================================================
// NEDEN: Top etiketinin türü (ROLL_RAW / ROLL_FINISHED) `colorId`den türüyordu: renksiz bitmiş top ham
// etiket, renkli ham top bitmiş etiket basıyordu (Gülkesim demo bulgusu — fason kurşun/tambur malı renksiz).
// Tür artık yalnız `Roll.stage`den (`rollLabelKindOf`); `?kind=` elle seçimi kazanır.
//
// ÖLÇÜLENLER
//   §0 AST: `src` altında koşulu `colorId` okuyup dallarında LabelKind.ROLL_* dönen üçlü ifade YOK; baskı
//      yolu (label.service) ve çuval bayatlama (sack-label-stale) türü aşama helper'ından alır
//   §1 renksiz + FINISHED → ROLL_FINISHED + bağlam varsayılan (LabelContextDefault) şablonu;
//      renkli + RAW → ROLL_RAW + ham varsayılanı; renkli + SEMI → ROLL_RAW
//   §2 `?kind=` aşamayı ezer
//   §3 müşteri şablonu > varsayılan, türe göre: FINISHED topa müşterinin FINISHED ataması, ham atama değil
//   §4 toplu bağlam (buildBulkContext) tekil yolla AYNI şablonu çözer; baskı izi (recordPrintEvent) aynı türü yazar
//   §5 çuval müşteri değişimi bayatlaması türü aşamadan okur (renksiz bitmiş top FINISHED atamasıyla bayatlar)
// Negatif sondalar (2026-11-10, cp ile geri; temel 15/0):
//   · toplu yolda `stage` renkten türetildi → §4a/§4b ❌ (13/2)
//   · recordPrintEvent türü sabit ROLL_RAW → §0c/§4c ❌ (13/2)
//   · tekil yola eski renk kuralı (`colorId == null ? ROLL_RAW : ROLL_FINISHED`) → §0b/§0c/§1a/§1b/§3a/§4b ❌ (9/6)
//   · çuval bayatlama filtresi sabit ROLL_RAW → §0d/§5 ❌ (13/2)
//   · `rollLabelKindOf` SEMI'yi bitmiş saydı → §1d ❌ (14/1)
// ⚠️ DB'ye YAZAR (LabelContextDefault ROLL_RAW/ROLL_FINISHED geçici) → `hedefDbEngeli()` ilk adım; eski
//    varsayılanlar `finally`de birebir geri yüklenir.
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { LabelKind, RollStage, type LabelContextDefault } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { LabelService } from "../src/services/label.service";
import { LabelTemplateService } from "../src/services/label-template.service";
import { CustomerTemplateRouteService } from "../src/services/customer-template-route.service";
import { markSackLabelsStaleOnCustomerChangeTx } from "../src/services/helpers/sack-label-stale.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

// ── §0 AST ──────────────────────────────────────────────────────────────────
const SRC = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const mentions = (n: ts.Node, sf: ts.SourceFile, re: RegExp): boolean => re.test(n.getText(sf));

function astBolumu(): void {
  const ihlal: string[] = [];
  let taranan = 0;
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("LabelKind.ROLL_")) continue;
    taranan++;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isConditionalExpression(n) && mentions(n.condition, sf, /colorId/) &&
          (mentions(n.whenTrue, sf, /LabelKind\.ROLL_/) || mentions(n.whenFalse, sf, /LabelKind\.ROLL_/))) {
        ihlal.push(`${relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  check("§0a tarayıcı kör değil (LabelKind.ROLL_ geçen dosya var)", taranan >= 3, `${taranan} dosya`);
  check("§0b renkten etiket türü türeten üçlü ifade yok (colorId → LabelKind.ROLL_*)", ihlal.length === 0, ihlal.join(", "));
  const label = readFileSync(join(SRC, "services/label.service.ts"), "utf8");
  check("§0c baskı yolu türü aşama helper'ından alıyor (resolveRollLabelKind + rollLabelKindOf)",
    /resolveRollLabelKind\(stage, kindOverride\)/.test(label) && /rollLabelKindOf\(roll\.stage\)/.test(label));
  const stale = readFileSync(join(SRC, "services/helpers/sack-label-stale.helper.ts"), "utf8");
  check("§0d çuval bayatlaması türü aşamadan okuyor", (stale.match(/rollLabelKindOf\(r\.stage\)/g) ?? []).length === 2);
}

// ── DB ──────────────────────────────────────────────────────────────────────
const TAG = `TEST-ASE-${Date.now()}`;
const svc = new LabelService();
const tplSvc = new LabelTemplateService();
const routeSvc = new CustomerTemplateRouteService();
const tplIds: string[] = [];
const rollIds: string[] = [];
let itemId: string | null = null;
let colorId: string | null = null;
let customerId: string | null = null;
let customer2Id: string | null = null;
let sackId: string | null = null;
const eskiVarsayilan = new Map<LabelKind, LabelContextDefault | null>();
const KINDS = [LabelKind.ROLL_RAW, LabelKind.ROLL_FINISHED] as const;

async function makeRoll(code: string, color: boolean, stage: RollStage): Promise<string> {
  const r = await prisma.roll.create({
    data: {
      barcode: `${TAG}-${code}`, itemId: itemId!, colorId: color ? colorId : null, stage,
      status: "WAREHOUSE", currentQty: 40, initialQty: 40, width: 150, qualityGrade: "A", entrySource: "MANUAL_ENTRY",
    },
    select: { id: true },
  });
  rollIds.push(r.id);
  return r.id;
}

async function dbBolumu(): Promise<void> {
  itemId = (await prisma.item.create({ data: { code: `${TAG}-I`, name: `${TAG} Ürün`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  colorId = (await prisma.color.create({ data: { code: `${TAG}-C`, name: `${TAG} Renk`, hex: "#336699" }, select: { id: true } })).id;
  customerId = (await prisma.customer.create({ data: { code: `${TAG}-M`, name: `${TAG} Müşteri` }, select: { id: true } })).id;
  customer2Id = (await prisma.customer.create({ data: { code: `${TAG}-M2`, name: `${TAG} Müşteri 2` }, select: { id: true } })).id;

  // Bağlam varsayılanları: test şablonlarına çevrilir, finally'de birebir geri.
  const def: Record<string, string> = {};
  for (const k of KINDS) {
    eskiVarsayilan.set(k, await prisma.labelContextDefault.findUnique({ where: { kind: k } }));
    const t = (await tplSvc.create({ name: `${TAG}-DEF-${k}`, kind: k })).data as { id: string };
    tplIds.push(t.id);
    def[k] = t.id;
    await prisma.labelContextDefault.upsert({ where: { kind: k }, update: { templateId: t.id }, create: { kind: k, templateId: t.id } });
  }

  const renksizBitmis = await makeRoll("RB", false, RollStage.FINISHED);
  const renkliHam = await makeRoll("RH", true, RollStage.RAW);
  const renkliYari = await makeRoll("RY", true, RollStage.SEMI_FINISHED);

  const p1 = await svc.getRollPreview(renksizBitmis, undefined, { stock: true });
  check("§1a ⭐ renksiz + FINISHED → ROLL_FINISHED", p1.data.kind === LabelKind.ROLL_FINISHED, `kind=${p1.data.kind}`);
  check("§1b renksiz + FINISHED → bitmiş bağlam varsayılan şablonu", p1.data.meta.templateId === def.ROLL_FINISHED);
  const p2 = await svc.getRollPreview(renkliHam, undefined, { stock: true });
  check("§1c ⭐ renkli + RAW → ROLL_RAW + ham varsayılanı", p2.data.kind === LabelKind.ROLL_RAW && p2.data.meta.templateId === def.ROLL_RAW, `kind=${p2.data.kind}`);
  const p3 = await svc.getRollPreview(renkliYari, undefined, { stock: true });
  check("§1d renkli + SEMI_FINISHED → ROLL_RAW", p3.data.kind === LabelKind.ROLL_RAW, `kind=${p3.data.kind}`);

  const p4 = await svc.getRollPreview(renksizBitmis, LabelKind.ROLL_RAW, { stock: true });
  check("§2 ?kind=ROLL_RAW aşamayı ezer", p4.data.kind === LabelKind.ROLL_RAW && p4.data.meta.templateId === def.ROLL_RAW);

  const tCustF = (await tplSvc.create({ name: `${TAG}-CUST-F`, kind: LabelKind.ROLL_FINISHED })).data as { id: string };
  const tCustR = (await tplSvc.create({ name: `${TAG}-CUST-R`, kind: LabelKind.ROLL_RAW })).data as { id: string };
  tplIds.push(tCustF.id, tCustR.id);
  await routeSvc.set(customerId, LabelKind.ROLL_FINISHED, tCustF.id);
  await routeSvc.set(customerId, LabelKind.ROLL_RAW, tCustR.id);
  const n1 = await svc.getRollLabelNative(renksizBitmis, undefined, { customerId });
  check("§3a renksiz bitmiş top + müşteri → müşterinin BİTMİŞ ataması", n1.data.meta.templateId === tCustF.id && n1.data.kind === LabelKind.ROLL_FINISHED);
  const n2 = await svc.getRollLabelNative(renkliHam, undefined, { customerId });
  check("§3b renkli ham top + müşteri → müşterinin HAM ataması", n2.data.meta.templateId === tCustR.id && n2.data.kind === LabelKind.ROLL_RAW);

  type Priv = {
    buildBulkContext: (ids: string[], copies: number, routing?: unknown, overrideCustomerId?: string | null) => Promise<unknown>;
    buildRollRenderInput: (id: string, k: LabelKind | undefined, o: { customerId?: string }, ctx: unknown) => Promise<{ kind: LabelKind; meta: { templateId: string | null } }>;
  };
  const priv = svc as unknown as Priv;
  const ctx = await priv.buildBulkContext([renksizBitmis, renkliHam], 1, undefined, customerId);
  const b1 = await priv.buildRollRenderInput(renksizBitmis, undefined, { customerId }, ctx);
  const b2 = await priv.buildRollRenderInput(renkliHam, undefined, { customerId }, ctx);
  check("§4a toplu: renksiz bitmiş top tekil yolla aynı tür + şablon", b1.kind === n1.data.kind && b1.meta.templateId === n1.data.meta.templateId, `${b1.kind}/${b1.meta.templateId === tCustF.id}`);
  check("§4b toplu: renkli ham top tekil yolla aynı tür + şablon", b2.kind === n2.data.kind && b2.meta.templateId === n2.data.meta.templateId);

  await svc.recordPrintEvent(renksizBitmis, undefined, { customerId });
  const log = await prisma.systemLog.findFirst({ where: { tableName: "LABEL_PRINT_EVENT", recordId: renksizBitmis }, orderBy: { createdAt: "desc" }, select: { newData: true } });
  check("§4c baskı izi aşamadan çözülen şablonu yazar (müşterinin BİTMİŞ ataması)", ((log?.newData ?? {}) as Record<string, unknown>).templateId === tCustF.id);

  // §5 çuval: yalnız FINISHED ataması farklı müşteri → renksiz BİTMİŞ top bayatlar, renkli HAM top bayatlamaz.
  await routeSvc.set(customerId, LabelKind.ROLL_RAW, null);
  sackId = (await prisma.sack.create({ data: { sackNo: `${TAG}-S`, customerId }, select: { id: true } })).id;
  await prisma.roll.updateMany({ where: { id: { in: [renksizBitmis, renkliHam] } }, data: { sackId, labelDirty: false } });
  const n = await prisma.$transaction((tx) => markSackLabelsStaleOnCustomerChangeTx(tx, sackId!, customerId, customer2Id));
  const dirty = await prisma.roll.findMany({ where: { id: { in: [renksizBitmis, renkliHam] } }, select: { id: true, labelDirty: true } });
  const d = new Map(dirty.map((r) => [r.id, r.labelDirty]));
  check("§5 ⭐ çuval bayatlaması: renksiz bitmiş top FINISHED atamasıyla bayatlar, renkli ham top bayatlamaz",
    n === 1 && d.get(renksizBitmis) === true && d.get(renkliHam) === false, `işaretlenen=${n}`);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB yazmaya uygun", false, engel); return; }
  astBolumu();
  await dbBolumu();
}

main()
  .catch((e) => { fail++; console.error("HATA:", e instanceof Error ? e.message : e); })
  .finally(async () => {
    try {
      for (const k of KINDS) {
        if (!eskiVarsayilan.has(k)) continue;
        const eski = eskiVarsayilan.get(k);
        if (eski) await prisma.labelContextDefault.update({ where: { kind: k }, data: { templateId: eski.templateId } });
        else await prisma.labelContextDefault.deleteMany({ where: { kind: k } });
      }
      for (const c of [customerId, customer2Id]) if (c) await prisma.customerTemplateRoute.deleteMany({ where: { customerId: c } });
      if (rollIds.length) {
        await prisma.printJob.deleteMany({ where: { subjectId: { in: rollIds } } });
        await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (sackId) await prisma.sack.deleteMany({ where: { id: sackId } });
      if (tplIds.length) {
        await prisma.labelTemplateVariant.deleteMany({ where: { templateId: { in: tplIds } } });
        await prisma.labelTemplate.deleteMany({ where: { id: { in: tplIds } } });
      }
      for (const c of [customerId, customer2Id]) if (c) await prisma.customer.deleteMany({ where: { id: c } });
      if (colorId) await prisma.color.deleteMany({ where: { id: colorId } });
      if (itemId) await prisma.item.deleteMany({ where: { id: itemId } });
    } catch (e) {
      fail++;
      console.error("TEMİZLİK HATASI:", e instanceof Error ? e.message : e);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
