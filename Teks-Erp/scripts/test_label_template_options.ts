// =============================================================================
// Test: çoklu etiket seti (global + müşteri) — "bu etikete hangi şablonlar seçilebilir" (2026-11-11)
// =============================================================================
// Çalıştır: npx tsx scripts/run-all-tests.ts test_label_template_options
//
// §1 set boş → options = [DEFAULT], defaultTemplateId = resolveLabelRouting şablonu (bayt-aynılık işareti)
// §2 global PUT: sıra, LabelContextDefault yazımı, GET varsayılanı başta
// §3 müşteri PUT + birleşim: DEFAULT > CUSTOMER > GLOBAL sırası, TEKRARSIZ (sette hem müşteri hem global olan tek kez)
// §4 `labelShowGlobalTemplates=false` globali düşürür; müşteri set kaldırılınca varsayılan globale döner
// §5 stok (müşterisiz) bağlamda müşteri halkası yok
// §6 süzgeç: pasif · kind uyumsuz şablon listeden düşer; serbest (standalone) set'e yazılamaz; kalıcı silinen
//    şablonun set satırı düşer
// §7 PUT doğrulaması: varsayılan set dışında 400 · SACK 400 · tekrar 400
// §8 audit izi · birleştirme haritası satırı
// §9 KAYNAK: seçenek modellerine Prisma erişimi yalnız helper + set servisi; `usableForRoll` tek tanım
//
// GLOBAL DURUM YAZAR (ROLL_FINISHED global seti + bağlam varsayılanı): ilk adım `hedefDbEngeli()`, finally'de
// birebir geri yüklenir.
//
// NEGATİF SONDA ✓B3 (bu commit; bir kezlik mutasyon, md5 ile geri alındı):
//   (a) `label-template-options.helper.ts` birleşimde `if (seen.has(t.id)) continue;` silinince §3 ❌2 · §4 ❌1 · §5 ❌1 (toplam ❌4)
//   (b) `showsGlobal` her zaman `true` dönünce §4 ❌1
//   (c) `label.service.ts`e `prisma.customerLabelTemplateOption.findMany` eklenince §9 ❌1
// Gerekli mi: doğduğu gün ağaçta gerçek kusur YAKALAMADI (yeni özellik) — gerekçe ÖLÇÜLMEMİŞ, önleyici.
// =============================================================================
import fs from "node:fs";
import path from "node:path";
import type { LabelKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { LabelTemplateService } from "../src/services/label-template.service";
import { LabelTemplateOptionService } from "../src/services/label-template-option.service";
import { resolveLabelRouting } from "../src/services/helpers/label-routing.resolver";
import { resolveLabelTemplateOptions } from "../src/services/helpers/label-template-options.helper";
import { CUSTOMER_MERGE_RULES } from "../src/constants/merge-map.customer";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const FINISHED = "ROLL_FINISHED" as LabelKind;
const RAW = "ROLL_RAW" as LabelKind;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}
async function errCode(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: string } };
    return `${err.statusCode ?? "?"} ${err.details?.code ?? ""}`.trim();
  }
}

const tplSvc = new LabelTemplateService();
const optSvc = new LabelTemplateOptionService();
const TS = Date.now();
const P = `TEST-LTO-${TS}`;
const templateIds: string[] = [];
const customerIds: string[] = [];

async function tpl(name: string, kind: LabelKind = FINISHED, standalone = false): Promise<string> {
  const t = (await tplSvc.create({ name: `${P}-${name}`, kind: standalone ? null : kind, standalone })).data;
  templateIds.push(t.id);
  return t.id;
}

function sourceScan(): void {
  console.log("\n§9 kaynak taraması");
  const SRC = path.resolve(__dirname, "../src");
  const ALLOWED = new Set(["services/helpers/label-template-options.helper.ts", "services/label-template-option.service.ts"]);
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith(".ts") ? [p] : [];
  });
  const files = walk(SRC);
  const re = /\.(labelTemplateGlobalOption|customerLabelTemplateOption)\.\w+\(/g;
  const outside: string[] = [];
  let inside = 0;
  let usableDefs = 0;
  for (const f of files) {
    const rel = path.relative(SRC, f).split(path.sep).join("/");
    const src = fs.readFileSync(f, "utf8");
    const hits = src.match(re)?.length ?? 0;
    // Şablon kalıcı silme (audit'li eylem) set satırlarını yalnız deleteMany ile düşürebilir.
    const delOnly = rel === "services/label-template.service.ts" && (src.match(re) ?? []).every((m) => m.endsWith(".deleteMany("));
    if (ALLOWED.has(rel)) inside += hits; else if (hits > 0 && !delOnly) outside.push(rel);
    usableDefs += src.match(/function\s+usableForRoll\s*\(/g)?.length ?? 0;
  }
  check("körlük zemini: src > 300 dosya, izinli dosyalarda ≥ 8 erişim", files.length > 300 && inside >= 8, `${files.length} dosya · ${inside} erişim`);
  check("seçenek modellerine erişim yalnız helper + set servisi", outside.length === 0, outside.join(", "));
  check("`usableForRoll` tek tanım", usableDefs === 1, `${usableDefs}`);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { check("hedef DB yazılabilir", false, engel); return; }

  const origDefault = await prisma.labelContextDefault.findUnique({ where: { kind: FINISHED }, select: { templateId: true } });
  const origRows = await prisma.labelTemplateGlobalOption.findMany({ where: { kind: FINISHED }, select: { templateId: true, sortOrder: true } });
  try {
    await prisma.labelTemplateGlobalOption.deleteMany({ where: { kind: FINISHED } });
    const tDef = await tpl("DEF"); const tG1 = await tpl("G1"); const tG2 = await tpl("G2");
    const tCDef = await tpl("CDEF"); const tC1 = await tpl("C1");
    const tPassive = await tpl("PASIF"); const tRaw = await tpl("RAW", RAW); const tFree = await tpl("SERBEST", FINISHED, true);
    const ca = await prisma.customer.create({ data: { code: `${P}-A`, name: `${P} A` }, select: { id: true } });
    customerIds.push(ca.id);

    console.log("\n§1 set boş");
    const r0 = await resolveLabelTemplateOptions({ kind: FINISHED, customerId: ca.id });
    const chain0 = await resolveLabelRouting({ kind: FINISHED, customerId: ca.id });
    check("§1 defaultTemplateId = resolveLabelRouting şablonu", r0.defaultTemplateId === (chain0.template?.id ?? null));
    check("§1 options = yalnız DEFAULT (ya da hiç)", r0.options.length === (chain0.template ? 1 : 0) && r0.options.every((o) => o.source === "DEFAULT" && o.isDefault));

    console.log("\n§2 global PUT");
    await optSvc.setGlobal({ kind: FINISHED, templateIds: [tG1, tDef, tG2], defaultTemplateId: tDef });
    const g = (await optSvc.getGlobal(FINISHED)).data;
    check("§2 LabelContextDefault = yıldız", (await prisma.labelContextDefault.findUnique({ where: { kind: FINISHED } }))?.templateId === tDef);
    check("§2 sıra korunur", g.items.map((i) => i.templateId).join() === [tG1, tDef, tG2].join());
    check("§2 isDefault işaretli tek satır", g.items.filter((i) => i.isDefault).map((i) => i.templateId).join() === tDef);

    console.log("\n§3 müşteri seti + birleşim");
    await optSvc.setCustomer(ca.id, { kind: FINISHED, templateIds: [tCDef, tC1, tG1], defaultTemplateId: tCDef });
    check("§3 CustomerTemplateRoute = müşteri yıldızı", (await prisma.customerTemplateRoute.findUnique({ where: { customerId_kind: { customerId: ca.id, kind: FINISHED } } }))?.templateId === tCDef);
    const r3 = await resolveLabelTemplateOptions({ kind: FINISHED, customerId: ca.id });
    const ids3 = r3.options.map((o) => o.id);
    check("§3 sıra DEFAULT > CUSTOMER > GLOBAL", ids3.join() === [tCDef, tC1, tG1, tDef, tG2].join(), r3.options.map((o) => o.source).join());
    check("§3 tekrarsız (G1 yalnız müşteri satırı olarak)", new Set(ids3).size === ids3.length && r3.options.find((o) => o.id === tG1)?.source === "CUSTOMER");
    check("§3 DEFAULT = resolveLabelRouting (müşteri route)", r3.defaultTemplateId === tCDef && r3.options[0]?.source === "DEFAULT");
    const cv = (await optSvc.getCustomer(ca.id, FINISHED)).data;
    check("§3 GET müşteri: showGlobal açık + global önizleme", cv.showGlobalTemplates === true && cv.globalItems.length === 3);

    console.log("\n§4 herkes için seti gizle");
    await optSvc.setCustomer(ca.id, { kind: FINISHED, templateIds: [tCDef, tC1], defaultTemplateId: tCDef, showGlobalTemplates: false });
    const r4 = await resolveLabelTemplateOptions({ kind: FINISHED, customerId: ca.id });
    check("§4 showGlobal=false → GLOBAL kaynak yok", r4.options.every((o) => o.source !== "GLOBAL") && r4.options.length === 2);
    await optSvc.setCustomer(ca.id, { kind: FINISHED, templateIds: [], defaultTemplateId: null, showGlobalTemplates: true });
    const r4b = await resolveLabelTemplateOptions({ kind: FINISHED, customerId: ca.id });
    check("§4 müşteri seti kalkınca varsayılan globale döner", r4b.defaultTemplateId === tDef);

    console.log("\n§5 stok bağlamı");
    await optSvc.setCustomer(ca.id, { kind: FINISHED, templateIds: [tC1], defaultTemplateId: null });
    const r5 = await resolveLabelTemplateOptions({ kind: FINISHED, customerId: null });
    check("§5 müşterisiz: müşteri satırı yok", r5.options.every((o) => o.source !== "CUSTOMER") && !r5.options.some((o) => o.id === tC1));
    check("§5 müşterisiz: DEFAULT + GLOBAL", r5.options.map((o) => o.id).join() === [tDef, tG1, tG2].join());

    console.log("\n§6 süzgeç");
    await optSvc.setGlobal({ kind: FINISHED, templateIds: [tDef, tG1, tG2, tPassive, tRaw], defaultTemplateId: tDef });
    await tplSvc.deactivate(tPassive);
    const r6 = await resolveLabelTemplateOptions({ kind: FINISHED });
    check("§6 pasif şablon listeden düşer", !r6.options.some((o) => o.id === tPassive));
    check("§6 kind uyumsuz (ROLL_RAW) şablon düşer", !r6.options.some((o) => o.id === tRaw));
    check("§6 pasif şablon sette kalır (yeniden PUT edilebilir)", (await errCode(optSvc.setGlobal({ kind: FINISHED, templateIds: [tDef, tPassive], defaultTemplateId: tDef }))) === "OK");
    check("§6 pasif şablon yeni eklenemez / yıldız olamaz", (await errCode(optSvc.setGlobal({ kind: FINISHED, templateIds: [tPassive], defaultTemplateId: tPassive }))).startsWith("400"));
    check("§6 serbest şablon sete yazılamaz", (await errCode(optSvc.setGlobal({ kind: FINISHED, templateIds: [tDef, tFree], defaultTemplateId: tDef }))).startsWith("400"));
    await optSvc.setGlobal({ kind: FINISHED, templateIds: [tDef, tG2], defaultTemplateId: tDef });
    await tplSvc.hardDelete(tG2);
    check("§6 kalıcı silinen şablonun set satırı düşer", (await prisma.labelTemplateGlobalOption.count({ where: { templateId: tG2 } })) === 0);

    console.log("\n§7 PUT doğrulaması");
    check("§7 varsayılan set dışında → 400 LABEL_DEFAULT_NOT_IN_SET", (await errCode(optSvc.setGlobal({ kind: FINISHED, templateIds: [tG1], defaultTemplateId: tDef }))) === "400 LABEL_DEFAULT_NOT_IN_SET");
    check("§7 SACK → 400 LABEL_OPTION_KIND_UNSUPPORTED", (await errCode(optSvc.setGlobal({ kind: "SACK" as LabelKind, templateIds: [], defaultTemplateId: null }))) === "400 LABEL_OPTION_KIND_UNSUPPORTED");
    check("§7 tekrar → 400 LABEL_OPTION_DUPLICATE", (await errCode(optSvc.setCustomer(ca.id, { kind: FINISHED, templateIds: [tC1, tC1], defaultTemplateId: null }))) === "400 LABEL_OPTION_DUPLICATE");
    check("§7 bilinmeyen müşteri → 404", (await errCode(optSvc.getCustomer("00000000-0000-4000-8000-000000000000", FINISHED))).startsWith("404"));

    console.log("\n§8 audit + birleştirme");
    const log = await prisma.systemLog.findFirst({ where: { tableName: "CUSTOMER_LABEL_TEMPLATE_OPTION", recordId: ca.id }, orderBy: { createdAt: "desc" } });
    check("§8 müşteri seti audit izi", !!log);
    check("§8 birleştirme haritası UNION satırı", CUSTOMER_MERGE_RULES.some((r) => r.kind === "CONFLICT" && r.model === "CustomerLabelTemplateOption" && r.policy === "UNION"));
  } finally {
    await prisma.labelTemplateGlobalOption.deleteMany({ where: { kind: FINISHED } });
    if (origRows.length) await prisma.labelTemplateGlobalOption.createMany({ data: origRows.map((r) => ({ kind: FINISHED, ...r })) });
    if (origDefault) {
      await prisma.labelContextDefault.upsert({ where: { kind: FINISHED }, create: { kind: FINISHED, templateId: origDefault.templateId }, update: { templateId: origDefault.templateId } });
    } else {
      await prisma.labelContextDefault.deleteMany({ where: { kind: FINISHED } });
    }
    const restored = await prisma.labelContextDefault.findUnique({ where: { kind: FINISHED } });
    check("finally: bağlam varsayılanı birebir geri yüklendi", (restored?.templateId ?? null) === (origDefault?.templateId ?? null));
    await prisma.customerLabelTemplateOption.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customerTemplateRoute.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.labelContextDefault.deleteMany({ where: { templateId: { in: templateIds } } });
    await prisma.labelTemplate.updateMany({ where: { id: { in: templateIds }, isDefault: true }, data: { isDefault: false } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.labelTemplate.deleteMany({ where: { id: { in: templateIds } } });
  }
  sourceScan();
}

main()
  .catch((e) => { fail++; console.error("❌ beklenmeyen hata:", e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  });
