// =============================================================================
// BEKÇİ — Refakat kartı ↔ tasarımcı şablonu: CANLI çözüm, yalnız iz (P-e, T11) · DB'li
// =============================================================================
// Çalıştırma: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_belge_kart_canli.ts
//
// Gerçek `getCardHtml` / `recordPrintEvent` yolundan ölçer (fikstür iş emri + kart).
//   §1 bayrak kapalı: varsayılan yayında olsa da HTML bugünküyle BAYT-EŞİT; snapshot'ta
//      `designTemplate`, audit'te `templateVersionId` YOK
//   §2 bayrak açık: basım varsayılan şablonla; print-event snapshot + arşiv + audit İZİ taşır
//   §3 ⭐ yeni sürüm yayınlanınca SONRAKİ basım yeni tasarımla; kart sürümü (planKey) DEĞİŞMEZ,
//      iz yeni sürüme geçer; arşiv kopyası (?version) da güncel tasarımla (kart donmaz)
//   §4 tek seferlik sayfa ezmesi yalnız ayar kopyasına biner, kalıcı değildir
//   §5 kopya (P-d) kartın bugünkü ayarını taşır (`freezeCurrentSettings`)
//
// ⭐ NEGATİF SONDALAR (2026-10-25, ölçüldü; dosya md5 ile geri kondu):
//   (a) `resolvePrintPlan` tasarımı karttaki `designTemplate` izinden DONDURDU (ilk basımın sürümü)
//       → 3 ❌ (§3 v2 tasarımı, iz v2, audit v2)
//   (b) `planKey` `designTemplate`i atmadı → 2 ❌ (§2/§3 sürüm: tasarım revizyon sayıldı)
//   (c) serbest belge basımında tasarımcı dalı kapatıldı (`false && design`) → §6 3 ❌
// =============================================================================
import { isDeepStrictEqual } from "node:util";
import { ItemType, PrintedDocType, StationType, WorkOrderStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { freeDocumentService } from "../src/services/free-document.service";
import { travelerTemplateService } from "../src/services/traveler-template.service";
import { getSystemView } from "../src/services/document-template/contract-view.service";
import type { SystemEquivalent } from "../src/services/document-template/sistem/tipler";
import { getContract } from "../src/services/document-template/sozlesme/kayit";
import type { ContractDocType } from "../src/services/document-template/sozlesme/tipler";
import { createTemplate } from "../src/services/document-template/template.service";
import { publishVersion, saveVersion } from "../src/services/document-template/version.service";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const TYPE: ContractDocType = "TRAVELER_CARD";
const TAG = `bekci-kart-${process.pid}`;
const cards = new TravelerCardService();
const KEYS = [SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, SETTING_KEYS.DOCUMENTS_PUBLISH_SOD_ENABLED] as const;
const savedSettings = new Map<string, { value: unknown } | null>();
const templateIds: string[] = [];
let defaultRowBefore: { templateId: string } | null = null;
let freeDefaultBefore: { templateId: string } | null = null;
const FREE: ContractDocType = "FREE_DOCUMENT";
const freeBody = (mark: string) => `<p class="m">${mark} {{ belge.no }} NOT-{{ ayar.footerNote }}</p>`;
let woId = "";
let cardId = "";
let freeDocId = "";
let USER_A = "";
let USER_B = "";

const setFlag = (key: string, on: boolean) => prisma.systemSetting.upsert({ where: { key }, create: { key, value: on }, update: { value: on } });
const body = (mark: string) => `<p class="m">${mark} {{ belge.kart_no }} SAYFA-{{ ayar.pageSize }}</p>`;
const fakeEq = (html: string, docType: ContractDocType = TYPE): SystemEquivalent => ({ docType, editMode: "CODE", html, css: "p{margin:0}", pageSettings: {}, tableBindings: {} });

async function fixtureUser(username: string, fullName: string): Promise<string> {
  const u = await prisma.user.upsert({ where: { username }, create: { username, fullName, passwordHash: "-", isActive: false }, update: {}, select: { id: true } });
  return u.id;
}

async function makeCard(): Promise<void> {
  // İş anahtarlı kalıcı fikstürler (koşumlar arası yeniden kullanılır; kart/iş emri silinir).
  const item = await prisma.item.upsert({
    where: { code: "BEKCI-T11-KUMAS" },
    create: { code: "BEKCI-T11-KUMAS", name: "Bekçi kart kumaşı", itemType: ItemType.FABRIC },
    update: { isActive: true },
    select: { id: true },
  });
  const station = await prisma.station.upsert({
    where: { code: "BEKCI_T11_IST" },
    create: { code: "BEKCI_T11_IST", name: "Bekçi Kart İstasyonu", type: StationType.INTERNAL },
    update: { isActive: true },
    select: { id: true },
  });
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-KC-${process.pid}`,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      width: 150,
      targetQuantity: 100,
      targetItemId: item.id,
      steps: { create: [{ stationId: station.id, stepSequence: 1, status: "PENDING" as const }] },
    },
  });
  woId = wo.id;
  const r = await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id));
  cardId = r.card.id;
}

const cardRow = () => prisma.travelerCard.findUniqueOrThrow({ where: { id: cardId }, select: { version: true, snapshot: true } });
const traceOf = (snap: unknown) => (snap as { designTemplate?: { versionId?: string } } | null)?.designTemplate;
async function lastAudit(): Promise<Record<string, unknown>> {
  const row = await prisma.systemLog.findFirst({ where: { tableName: "TRAVELER_CARD", recordId: cardId }, orderBy: { createdAt: "desc" }, select: { newData: true } });
  return (row?.newData ?? {}) as Record<string, unknown>;
}
async function archivedTrace(version: number) {
  const row = await prisma.printedDocument.findUnique({
    where: { docType_sourceId_version: { docType: PrintedDocType.TRAVELER_CARD, sourceId: cardId, version } },
    select: { snapshot: true },
  });
  return traceOf(row?.snapshot ?? null);
}

async function newDefaultTemplate(docType: ContractDocType = TYPE, html = body("KART-V1")) {
  const r = await createTemplate({ docType, name: `${TAG}-${docType}`, copyFrom: { kind: "system" } }, USER_A, {
    systemEquivalents: (d) => (d === docType ? fakeEq(html, docType) : null),
  });
  templateIds.push(r.template.id);
  const v1 = await prisma.documentTemplateVersion.findFirstOrThrow({ where: { templateId: r.template.id, versionNo: 1 } });
  await publishVersion(r.template.id, { versionId: v1.id, expectedPublishedVersionId: null }, USER_B);
  await prisma.documentTemplateDefault.upsert({ where: { docType }, create: { docType, templateId: r.template.id }, update: { templateId: r.template.id } });
  return { id: r.template.id, v1 };
}

async function publishV2(templateId: string, v1: Awaited<ReturnType<typeof newDefaultTemplate>>["v1"], sourceHtml = body("KART-V2")) {
  const r = await saveVersion(
    templateId,
    {
      baseVersionId: v1.id,
      editMode: "CODE",
      sourceHtml,
      css: v1.css,
      pageSettings: v1.pageSettings,
      tableBindings: v1.tableBindings as Record<string, unknown>,
      settings: v1.settings,
      internalFields: v1.internalFields as string[],
    },
    USER_A,
  );
  const v2Id = (r.version as { id: string }).id;
  await publishVersion(templateId, { versionId: v2Id, expectedPublishedVersionId: v1.id }, USER_B);
  return v2Id;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) return check("hedef DB fixture DB'si", false, engel);
  USER_A = await fixtureUser("bekci.t11.tasarimci", "Bekçi Kart Tasarımcı");
  USER_B = await fixtureUser("bekci.t11.yayinci", "Bekçi Kart Yayıncı");
  for (const k of KEYS) savedSettings.set(k, await prisma.systemSetting.findUnique({ where: { key: k }, select: { value: true } }));
  defaultRowBefore = await prisma.documentTemplateDefault.findUnique({ where: { docType: TYPE }, select: { templateId: true } });
  await setFlag(SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, false);
  await setFlag(SETTING_KEYS.DOCUMENTS_PUBLISH_SOD_ENABLED, false);
  await makeCard();
  await cards.recordPrintEvent(cardId); // basım tarihi sabitlenir (HTML karşılaştırması belirlenimli)
  const baseline = await cards.getCardHtml(cardId);
  const v0 = (await cardRow()).version;

  console.log("§1 Bayrak kapalı → bugünkü yol bayt-eşit, iz yok");
  const tpl = await newDefaultTemplate();
  const offHtml = await cards.getCardHtml(cardId);
  check("varsayılan yayında, bayrak kapalı: HTML bayt-eşit", offHtml === baseline, `${offHtml.length}/${baseline.length} bayt`);
  check("tasarım işareti yok", !offHtml.includes("KART-V1"));
  await cards.recordPrintEvent(cardId);
  const off = await cardRow();
  check("snapshot'ta `designTemplate` anahtarı yok", traceOf(off.snapshot) === undefined && !("designTemplate" in (off.snapshot as object)));
  check("audit'te `templateVersionId` yok", !("templateVersionId" in (await lastAudit())));
  check("sürüm değişmedi", off.version === v0);

  console.log("§2 Bayrak açık → varsayılan şablonla basım, yalnız iz");
  await setFlag(SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, true);
  const onHtml = await cards.getCardHtml(cardId);
  check("basım tasarımcı şablonuyla (v1 işareti + kart no)", onHtml.includes(`KART-V1 TST-KC-${process.pid}`));
  await cards.recordPrintEvent(cardId);
  const on = await cardRow();
  check("print-event snapshot izi = v1", traceOf(on.snapshot)?.versionId === tpl.v1.id);
  check("arşiv kopyası da izi taşır", (await archivedTrace(on.version))?.versionId === tpl.v1.id);
  check("audit `templateVersionId` = v1", (await lastAudit()).templateVersionId === tpl.v1.id);
  check("tasarım bağlanması kart sürümünü artırmaz (planKey)", on.version === v0, `v${on.version}`);

  console.log("§3 ⭐ Yeni sürüm yayını → sonraki basım yeni tasarım; kart sürümü aynı; kart donmaz");
  const v2Id = await publishV2(tpl.id, tpl.v1);
  const v2Html = await cards.getCardHtml(cardId);
  check("sonraki basım v2 tasarımıyla", v2Html.includes("KART-V2") && !v2Html.includes("KART-V1"));
  await cards.recordPrintEvent(cardId);
  const after = await cardRow();
  check("iz v2'ye geçti (karttaki eski iz DONMADI)", traceOf(after.snapshot)?.versionId === v2Id);
  check("kart sürümü değişmedi", after.version === v0, `v${after.version}`);
  check("audit `templateVersionId` = v2", (await lastAudit()).templateVersionId === v2Id);
  const archived = await cards.getCardHtml(cardId, { version: after.version });
  check("arşiv kopyası (?version) da güncel tasarımla", archived.includes("KART-V2"));

  console.log("§4 Tek seferlik sayfa ezmesi yalnız ayar kopyasına");
  const own = String((tpl.v1.settings as { pageSize?: string }).pageSize ?? "A5");
  const other = own === "A4" ? "A5" : "A4";
  check("ezme ayar bağlamına biner", (await cards.getCardHtml(cardId, { pageSize: other })).includes(`SAYFA-${other}`));
  check("ezmesiz basım şablonun kendi ayarıyla", (await cards.getCardHtml(cardId)).includes(`SAYFA-${own}`));

  console.log("§5 Kopya (P-d) kartın bugünkü ayarını taşır");
  const live = await travelerTemplateService.resolveForPrint(null);
  const view = await getSystemView(TYPE);
  check("sistem görünümü ayarı = kart ayarının normalize hâli", isDeepStrictEqual(view.settings, getContract(TYPE).ayarNormalize(live.config)));
  check("kopyanın v1 ayarı da aynı", isDeepStrictEqual(tpl.v1.settings, view.settings));

  console.log("§6 Serbest belge canlı (P-e): türün varsayılanı her basımda çözülür");
  await setFlag(SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, false);
  freeDefaultBefore = await prisma.documentTemplateDefault.findUnique({ where: { docType: FREE }, select: { templateId: true } });
  const created = await freeDocumentService.create({ title: `${TAG} tutanak`, body: "Satır 1\nSatır 2", config: { footerNote: "BELGE-NOTU" } });
  freeDocId = (created.data as { id: string }).id;
  const freeHtml = async () => (await freeDocumentService.renderHtml(freeDocId)).data!.html;
  const freeBase = await freeHtml();
  const ft = await newDefaultTemplate(FREE, freeBody("SERBEST-V1"));
  check("bayrak kapalı: serbest belge HTML'i bayt-eşit", (await freeHtml()) === freeBase);
  await setFlag(SETTING_KEYS.DOCUMENTS_DESIGNER_ENABLED, true);
  const f1 = await freeHtml();
  check("bayrak açık: varsayılan şablonla basım", f1.includes("SERBEST-V1 "));
  check("belgenin kendi ayarı şablon ayarının üstüne biner (R4)", f1.includes("NOT-BELGE-NOTU"));
  await publishV2(ft.id, ft.v1, freeBody("SERBEST-V2"));
  const f2 = await freeHtml();
  check("v2 yayını sonraki basımda (donmaz)", f2.includes("SERBEST-V2 ") && !f2.includes("SERBEST-V1"));
}

async function cleanup(): Promise<void> {
  if (freeDocId) await prisma.freeDocument.deleteMany({ where: { id: freeDocId } });
  if (freeDefaultBefore) await prisma.documentTemplateDefault.update({ where: { docType: FREE }, data: { templateId: freeDefaultBefore.templateId } });
  else await prisma.documentTemplateDefault.deleteMany({ where: { docType: FREE, templateId: { in: templateIds } } });
  if (cardId) {
    await prisma.printedDocument.deleteMany({ where: { docType: PrintedDocType.TRAVELER_CARD, sourceId: cardId } });
    await prisma.travelerCard.deleteMany({ where: { id: cardId } });
  }
  if (woId) {
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: woId } });
    await prisma.workOrder.deleteMany({ where: { id: woId } });
  }
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
