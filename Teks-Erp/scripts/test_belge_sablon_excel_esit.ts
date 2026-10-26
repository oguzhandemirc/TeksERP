// =============================================================================
// BEKÇİ — Şablonlu belgenin `/tables` dalı ↔ `/html` (plan §3.8, TX) · DB'li
// =============================================================================
// Çalıştırma: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_belge_sablon_excel_esit.ts
//
// Gerçek `freezeForSource` / `getHtml` / `getTables` / `saveVersion` yolundan ölçer; yalnız kaynak
// okuyucusu (`fresh`) fikstürdür (`test_belge_sablon_basim` kalıbı). Sevk irsaliyesi:
//   §1 Sistem yolu (bayrak kapalı): `/tables` = renderer tabloları bayt-eşit, uyarı yok, `tablesAvailable` yok
//   §2 kod kipi Sistem kopyası (bağsız): `/tables` = Sistem tabloları + "Excel varsayılan kolonlarla"
//      uyarısı; `/html` `tablesAvailable: true`; kayıt yanıtı da uyarır
//   §3 görsel kip kopyası: `/html` `data-kolon` hücreleri ↔ `/tables` (kolon/başlık/satır/hücre/toplam);
//      başlık satırları + dipnotlar Sistem'le aynı
//   §4 kolon gizlenmiş + sıra ters sürüm → Excel bağ sırasıyla
//   §5 iç kolon: opt-in'li sürümde iki tarafta; opt-in'siz bağda kalmış iç kolon Excel'e SIZMAZ
//   §6 `systemTemplate` (Sistem ile bas) → `/tables` Sistem, uyarısız
//
// ⭐ NEGATİF SONDALAR (2026-10-25, ölçüldü; md5 ile geri kondu):
//   (a) `getTables` şablon dalı kapatıldı (hep Sistem) → 145 ❌ · (b) `tablesAvailable: false` → 5 ❌
// Bulgu: jsonb `tableBindings` anahtar sırasını korumaz — §3 tablo sırası kırmızısı üreticiyi düzeltti.
// =============================================================================
import { randomUUID } from "node:crypto";
import { PrintedDocType } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import "../src/services/shipping.service";
import { getRegisteredDocBuilders, printedDocumentService, registerPrintedDocBuilder, type PrintedDocSnapshot } from "../src/services/printed-document.service";
import { SAMPLE_PRINTED_DOCS } from "../src/services/document-render/sample-data";
import { docNum } from "../src/services/document-render/fmt-num";
import type { DocTablesPayload } from "../src/services/document-render/doc-model";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { EXCEL_DEFAULT_COLUMNS_WARNING } from "../src/services/document-template/excel-tables";
import { createTemplate } from "../src/services/document-template/template.service";
import { publishVersion, saveVersion } from "../src/services/document-template/version.service";
import { getContract } from "../src/services/document-template/sozlesme/kayit";
import type { TableDef } from "../src/services/document-template/sozlesme/tipler";
import { bindingsOf, compareTable, htmlTables, itemTableHtml } from "./lib/belge-excel-karsilastir";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  if (!ok) console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
}

const TYPE = PrintedDocType.SHIPMENT_DISPATCH;
const TAG = `bekci-excel-${process.pid}`;
let USER = "";
const templateIds: string[] = [];
const sourceIds: string[] = [];
const savedSettings = new Map<string, { value: unknown } | null>();
let defaultRowBefore: { templateId: string } | null = null;

const real = getRegisteredDocBuilders().get(TYPE)!;
registerPrintedDocBuilder(TYPE, {
  ...real,
  fresh: async (_db, sourceId) => ({ documentNo: `TEST-TX-${sourceId.slice(0, 8)}`, doc: SAMPLE_PRINTED_DOCS[TYPE] }),
  resolveProfileId: async () => null,
});

const contract = getContract(TYPE);
const table = (k: string): TableDef => contract.tablolar.find((t) => t.anahtar === k)!;
const customer = (t: TableDef) => t.kolonlar.filter((k) => k.sinif === "musteri").map((k) => k.yol);
const internalOf = (t: TableDef) => t.kolonlar.filter((k) => k.sinif === "ic");

async function setFlag(key: string, on: boolean): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key }, create: { key, value: on }, update: { value: on } });
}
async function freeze(): Promise<string> {
  const sourceId = randomUUID();
  sourceIds.push(sourceId);
  await prisma.$transaction((tx) => printedDocumentService.freezeForSource(tx, TYPE, sourceId));
  return sourceId;
}
async function snap(sourceId: string): Promise<PrintedDocSnapshot> {
  const row = await prisma.printedDocument.findFirstOrThrow({ where: { docType: TYPE, sourceId }, orderBy: { version: "desc" }, select: { snapshot: true } });
  return row.snapshot as unknown as PrintedDocSnapshot;
}

type Layout = Array<[TableDef, string[]]>;
interface Tpl {
  id: string;
  last: { id: string };
  published: string | null;
}
/** Görsel sürüm kaydet + yayınla; dönüş kayıt uyarıları. */
async function visualVersion(tpl: Tpl, layout: Layout, opts: { internalFields?: string[]; excelLayout?: Layout } = {}): Promise<string[]> {
  const base = await prisma.documentTemplateVersion.findUniqueOrThrow({ where: { id: tpl.last.id } });
  const r = await saveVersion(
    tpl.id,
    {
      baseVersionId: base.id,
      editMode: "VISUAL",
      sourceHtml: layout.map(([t, cols]) => itemTableHtml(t, cols)).join("\n"),
      css: base.css,
      pageSettings: base.pageSettings,
      tableBindings: bindingsOf(opts.excelLayout ?? layout),
      settings: base.settings,
      internalFields: opts.internalFields ?? [],
    },
    USER,
  );
  const id = (r.version as { id: string }).id;
  await publishVersion(tpl.id, { versionId: id, expectedPublishedVersionId: tpl.published }, USER);
  tpl.last = { id };
  tpl.published = id;
  return r.warnings;
}

/** `/html` ↔ `/tables` (şablonlu belge) + başlık/dipnot Sistem'le aynı. */
async function compareDoc(where: string, sourceId: string, excelOnly: ReadonlySet<string> = new Set()): Promise<DocTablesPayload> {
  const s = await snap(sourceId);
  const h = (await printedDocumentService.getHtml(TYPE, sourceId)).data!;
  const t = await printedDocumentService.getTables(TYPE, sourceId);
  const system = real.renderTables!(s, {});
  check(`${where}: /html tablesAvailable`, h.tablesAvailable === true, String(h.tablesAvailable));
  check(`${where}: /tables uyarısız`, !t.warnings?.length, JSON.stringify(t.warnings));
  check(`${where}: başlık + dipnot Sistem'le aynı`, JSON.stringify([t.data!.header, t.data!.notes, t.data!.documentNo]) === JSON.stringify([system.header, system.notes, system.documentNo]));
  const html = htmlTables(h.html);
  for (const m of t.data!.tables) {
    compareTable(`${where} · ${m.key}`, m, html.get(m.key), { num: docNum(s), hiddenInternal: excelOnly, check });
  }
  check(`${where}: HTML'deki her kalem tablosu Excel'de`, [...html.keys()].every((k) => t.data!.tables.some((m) => m.key === k)), [...html.keys()].join(","));
  return t.data!;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) return check("hedef DB fixture DB'si", false, engel);
  USER = (
    await prisma.user.upsert({
      where: { username: "bekci.tx.tasarimci" },
      create: { username: "bekci.tx.tasarimci", fullName: "Bekçi TX", passwordHash: "-", isActive: false },
      update: {},
      select: { id: true },
    })
  ).id;
  for (const k of [SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, SETTING_KEYS.DOCUMENTS_PUBLISH_SOD_ENABLED]) {
    savedSettings.set(k, await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }));
  }
  defaultRowBefore = await prisma.documentTemplateDefault.findUnique({ where: { docType: TYPE }, select: { templateId: true } });
  await setFlag(SETTING_KEYS.DOCUMENTS_PUBLISH_SOD_ENABLED, false);

  console.log("§1 Sistem yolu");
  await setFlag(SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, false);
  const sys = await freeze();
  const sysTables = await printedDocumentService.getTables(TYPE, sys);
  check("§1 /tables = renderer tabloları (bayt-eşit)", JSON.stringify(sysTables) === JSON.stringify({ success: true, data: real.renderTables!(await snap(sys), {}) }));
  check("§1 /html tablesAvailable taşımaz", !("tablesAvailable" in (await printedDocumentService.getHtml(TYPE, sys)).data!));

  console.log("§2 kod kipi Sistem kopyası (bağsız)");
  await setFlag(SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, true);
  const created = await createTemplate({ docType: TYPE, name: `${TAG}-kopya`, copyFrom: { kind: "system" } }, USER);
  templateIds.push(created.template.id);
  const v1 = await prisma.documentTemplateVersion.findFirstOrThrow({ where: { templateId: created.template.id, versionNo: 1 } });
  check("§2 kopya kod kipinde, bağsız", v1.editMode === "CODE" && Object.keys(v1.tableBindings as object).length === 0);
  await publishVersion(created.template.id, { versionId: v1.id, expectedPublishedVersionId: null }, USER);
  await prisma.documentTemplateDefault.upsert({ where: { docType: TYPE }, create: { docType: TYPE, templateId: created.template.id }, update: { templateId: created.template.id } });
  const code = await freeze();
  check("§2 belge şablonla dondu", (await snap(code)).template?.versionId === v1.id);
  const codeTables = await printedDocumentService.getTables(TYPE, code);
  check("§2 /tables = Sistem tabloları", JSON.stringify(codeTables.data) === JSON.stringify(real.renderTables!(await snap(code), {})));
  check("§2 /tables uyarısı", JSON.stringify(codeTables.warnings) === JSON.stringify([EXCEL_DEFAULT_COLUMNS_WARNING]), JSON.stringify(codeTables.warnings));
  check("§2 /html tablesAvailable", (await printedDocumentService.getHtml(TYPE, code)).data!.tablesAvailable === true);
  const codeSave = await saveVersion(
    created.template.id,
    { baseVersionId: v1.id, editMode: "CODE", sourceHtml: `${v1.sourceHtml}\n`, css: v1.css, pageSettings: v1.pageSettings, tableBindings: {}, settings: v1.settings, internalFields: v1.internalFields as string[] },
    USER,
  );
  check("§2 kayıt yanıtı Excel uyarısı taşır", codeSave.warnings.includes(EXCEL_DEFAULT_COLUMNS_WARNING), JSON.stringify(codeSave.warnings));
  const tpl: Tpl = { id: created.template.id, last: { id: (codeSave.version as { id: string }).id }, published: v1.id };

  console.log("§3 görsel kip — müşteri kolonları");
  const full: Layout = ["urun", "cuval", "ceki"].map((k) => [table(k), customer(table(k))]);
  const w3 = await visualVersion(tpl, full);
  check("§3 bağlı görsel sürümde kayıt uyarısı yok", !w3.includes(EXCEL_DEFAULT_COLUMNS_WARNING), JSON.stringify(w3));
  const d3 = await compareDoc("§3", await freeze());
  check("§3 üç kalem tablosu", d3.tables.map((m) => m.key).join(",") === "urun,cuval,ceki", d3.tables.map((m) => m.key).join(","));

  console.log("§4 kolon gizlenmiş + sıra ters");
  const reordered: Layout = full.map(([t, cols]) => [t, cols.slice(1).reverse()]);
  await visualVersion(tpl, reordered);
  const d4 = await compareDoc("§4", await freeze());
  for (const [t, cols] of reordered) {
    const keys = d4.tables.find((m) => m.key === t.anahtar)?.columns.map((c) => c.key);
    check(`§4 ${t.anahtar}: Excel kolonları = bağ sırası`, JSON.stringify(keys) === JSON.stringify(cols), `${keys}`);
  }

  console.log("§5 iç kolon opt-in");
  const cuval = table("cuval");
  const allCuval: Layout = [[cuval, cuval.kolonlar.map((k) => k.yol)]];
  await visualVersion(tpl, allCuval, { internalFields: internalOf(cuval).map((k) => k.icKod!) });
  const d5 = await compareDoc("§5 opt-in", await freeze());
  const keys5 = d5.tables[0]?.columns.map((c) => c.key) ?? [];
  check("§5 opt-in iç kolonlar Excel'de", internalOf(cuval).every((k) => keys5.includes(k.yol)), `${keys5}`);
  await visualVersion(tpl, [[cuval, customer(cuval)]], { excelLayout: allCuval });
  const closed = await freeze();
  const d5b = await compareDoc("§5 opt-in'siz", closed);
  const keys5b = d5b.tables[0]?.columns.map((c) => c.key) ?? [];
  check("§5 opt-in'siz iç kolon Excel'e sızmaz", internalOf(cuval).every((k) => !keys5b.includes(k.yol)), `${keys5b}`);

  console.log("§6 Sistem ile bas");
  const sysOpt = await printedDocumentService.getTables(TYPE, closed, undefined, { systemTemplate: true });
  check("§6 /tables Sistem tabloları, uyarısız", JSON.stringify(sysOpt) === JSON.stringify({ success: true, data: real.renderTables!(await snap(closed), {}) }));
}

async function cleanup(): Promise<void> {
  registerPrintedDocBuilder(TYPE, real);
  if (sourceIds.length) await prisma.printedDocument.deleteMany({ where: { docType: TYPE, sourceId: { in: sourceIds } } });
  if (defaultRowBefore) await prisma.documentTemplateDefault.update({ where: { docType: TYPE }, data: { templateId: defaultRowBefore.templateId } });
  else await prisma.documentTemplateDefault.deleteMany({ where: { docType: TYPE, templateId: { in: templateIds } } });
  if (templateIds.length) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica'`);
      await tx.documentTemplate.updateMany({ where: { id: { in: templateIds } }, data: { publishedVersionId: null } });
      await tx.documentTemplateVersion.deleteMany({ where: { templateId: { in: templateIds } } });
      await tx.documentTemplate.deleteMany({ where: { id: { in: templateIds } } });
    });
  }
  for (const [key, row] of savedSettings) {
    if (row === null) await prisma.systemSetting.deleteMany({ where: { key } });
    else await prisma.systemSetting.update({ where: { key }, data: { value: row.value as never } });
  }
}

main()
  .catch((e) => {
    console.error("\n💥 ÇÖKTÜ:", e);
    fail++;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (e) {
      console.error("temizlik hatası:", e);
      fail++;
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode ||= fail ? 1 : 0;
  });
