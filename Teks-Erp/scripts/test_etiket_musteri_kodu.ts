// =============================================================================
// Bekçi: etikette müşteri barkodu + çekide müşteri kodu (D4-F3)
// Çalıştır: npx tsx scripts/test_etiket_musteri_kodu.ts
// =============================================================================
// Tasarım: DALGA4 §7.5 madde 4 ve 6, §12.1 `label.customerCodeMissing`, §13 D4-F3.
//   §1 (DB'siz) source'suz ve source=ROLL kanvas → HTML/PPLA/PPLB/ZPL/raster çıktısı
//      `scripts/lib/etiket-musteri-kodu-altin.json` ile bayt-aynı (altın D4-F3 ÖNCESİ
//      kodla yazıldı) + eleman doğrulaması.
//   §2 (DB'siz) kodlu payload + CUSTOMER_CODE → 4 dilde müşteri kodu basılır; kodsuz → eleman atlanır.
//   §3 (DB) basım yolu: kodsuz top + BLOCK → 400 CUSTOMER_CODE_MISSING ve print_jobs 0;
//      ROLL_BARCODE → iç barkod + warnings; kodlu top → kod basılır, uyarı yok.
//   §4 (DB) çeki: eski snapshot "—"; sevkte donan snapshot kodu taşır, kod sonradan
//      değişse belge değişmez; kolon varsayılan KAPALI (opt-in).
// Negatif sonda (ölçüldü, PR gövdesinde): `applyCustomerCodeGate`ten BLOCK dalı
// kaldırılınca §3 "print_jobs 0" ve "400" kırmızı.
// =============================================================================
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LabelKind, type LabelTemplateVariant, type Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { CanvasValidationError, validateCanvasLayout } from "../src/config/label-elements";
import { buildDefaultFields } from "../src/config/label-fields";
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import type { PrintedDocSnapshot } from "../src/services/printed-document.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import type { LabelPayload } from "../src/types/label.types";
import { firstGrade } from "./fixture-quality-grade";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { layoutWith, PAYLOAD, renderFive, renderRaw } from "./lib/etiket-musteri-kodu-fikstur";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}

const CODE = "GK-0001234";

async function dbsiz(): Promise<void> {
  console.log("\n[§1] varsayılan source=ROLL → altın dosyayla bayt-aynı");
  const altin = JSON.parse(readFileSync(join(__dirname, "lib", "etiket-musteri-kodu-altin.json"), "utf8")) as Record<string, string>;
  const yok = await renderFive(layoutWith());
  const roll = await renderFive(layoutWith({ source: "ROLL" }));
  for (const k of ["html", "ppla", "pplb", "zpl", "raster"] as const) {
    check(`§1 ${k}: source'suz şablon altınla bayt-aynı`, yok[k] === altin[k], yok[k].slice(0, 12));
    check(`§1 ${k}: source=ROLL altınla bayt-aynı`, roll[k] === altin[k], roll[k].slice(0, 12));
  }
  // Kodlu topta da ROLL şablonu değişmez (payload'a eklenen alan çıktıya sızmaz).
  const kodluRoll = await renderFive(layoutWith(), { ...PAYLOAD, customerCode: CODE } as LabelPayload);
  check("§1 kodlu top + ROLL şablonu → yine altınla aynı (4 dil)", (["html", "ppla", "pplb", "zpl"] as const).every((k) => kodluRoll[k] === altin[k]));

  const canvas = { widthMm: 100, heightMm: 60 };
  const fails = (extra: Record<string, unknown>, type = "code128"): boolean => {
    try {
      validateCanvasLayout({ v: 1, elements: [{ id: "a", type, x: 1, y: 1, ...(type === "field" ? { bind: "barcode" } : {}), ...extra }] }, canvas);
      return false;
    } catch (e) { return e instanceof CanvasValidationError; }
  };
  check("§1 doğrulama: source=CUSTOMER_CODE geçerli", !fails({ source: "CUSTOMER_CODE" }) && !fails({ source: "CUSTOMER_CODE" }, "qr"));
  check("§1 doğrulama: bilinmeyen source 400", fails({ source: "ORDER" }));
  check("§1 doğrulama: field elemanında source 400", fails({ source: "ROLL" }, "field"));

  console.log("\n[§2] CUSTOMER_CODE kaynağı 4 dilde");
  const cc = layoutWith({ source: "CUSTOMER_CODE" });
  const kodlu = await renderRaw(cc, { ...PAYLOAD, customerCode: CODE } as LabelPayload);
  for (const k of ["html", "ppla", "pplb", "zpl"] as const) {
    check(`§2 ${k}: müşteri kodu basıldı`, kodlu[k].includes(CODE));
  }
  check("§2 metin alanı (bind=barcode) iç barkodu basmaya devam eder", kodlu.zpl.includes(String(PAYLOAD.barcode)));
  const kodsuz = await renderRaw(cc, PAYLOAD);
  const rollOnly = await renderRaw(layoutWith(), PAYLOAD);
  check("§2 kodsuz payload: barkod/QR elemanı atlanır (ZPL'de ^BC/^BQ yok)", !/\^BC|\^BQ/.test(kodsuz.zpl) && /\^BC/.test(rollOnly.zpl));

  console.log("\n[§2b] top dışı bağlam (çuval) — CUSTOMER_CODE FAIL-CLOSED");
  const { assertNoCustomerCodeSource, CUSTOMER_CODE_SOURCE_NOT_ROLL } = await import("../src/services/helpers/label-customer-code-gate.helper");
  const asVariant = (elements: unknown) => ({ elements }) as unknown as LabelTemplateVariant;
  const sackCode = (() => { try { assertNoCustomerCodeSource(asVariant(cc), "Çuval"); return null; } catch (e) { return (e as { details?: { code?: string } }).details?.code ?? "?"; } })();
  check("§2b ⭐ çuval şablonunda CUSTOMER_CODE → 400 CUSTOMER_CODE_SOURCE_NOT_ROLL", sackCode === CUSTOMER_CODE_SOURCE_NOT_ROLL, String(sackCode));
  let rollOk = true;
  try { assertNoCustomerCodeSource(asVariant(layoutWith()), "Çuval"); assertNoCustomerCodeSource(null, "Çuval"); } catch { rollOk = false; }
  check("§2b source=ROLL / varyantsız çuval şablonu geçer", rollOk);
  const svc = readFileSync(join(__dirname, "../src/services/label.service.ts"), "utf8");
  const sackBody = svc.slice(svc.indexOf("private async buildSackRenderInput("), svc.indexOf("async getSackLabelHtml("));
  check("§2b buildSackRenderInput kapıyı render girdisinden ÖNCE çağırır", /assertNoCustomerCodeSource\(routing\.variant/.test(sackBody) && sackBody.indexOf("assertNoCustomerCodeSource") < sackBody.indexOf("input: {"));
}

type Resp = { success: boolean; warnings?: string[]; data: { content?: string; html?: string } };

async function dbli(): Promise<void> {
  const { LabelService } = await import("../src/services/label.service");
  const labelService = new LabelService();
  await import("../src/services/shipping.service");
  const { printedDocumentService } = await import("../src/services/printed-document.service");
  const { shippingService } = await import("../src/services/shipping.service");

  const AYARLAR = [SETTING_KEYS.LABEL_CUSTOMER_CODE_MISSING];
  const foto = await prisma.systemSetting.findMany({ where: { key: { in: AYARLAR } }, select: { key: true, value: true } });
  const setSetting = (key: string, v: Prisma.InputJsonValue | null) =>
    v === null ? prisma.systemSetting.deleteMany({ where: { key } }) : prisma.systemSetting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });

  const ts = Date.now();
  const item = await prisma.item.create({ data: { code: `TEST-F3-${ts}`, name: `TEST F3 ${ts}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  const customer = await prisma.customer.create({ data: { code: `TEST-F3-${ts}`, name: `TEST F3 ${ts}` }, select: { id: true } });
  const rollIds: string[] = [];
  const sackIds: string[] = [];
  let shipmentId: string | null = null;
  let templateId: string | null = null;
  try {
    const tpl = await prisma.labelTemplate.create({
      data: {
        name: `TEST-F3-${ts}`, kind: null, isActive: true,
        fields: buildDefaultFields(LabelKind.ROLL_RAW) as unknown as Prisma.InputJsonValue,
        variants: { create: { name: "100x60", widthMm: 100, heightMm: 60, isPrimary: true, elements: layoutWith({ source: "CUSTOMER_CODE" }) as unknown as Prisma.InputJsonValue } },
      },
      select: { id: true },
    });
    templateId = tpl.id;
    const grade = await firstGrade();
    const mkRoll = async (suffix: string) => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-F3-${suffix}-${ts}`, itemId: item.id, colorId: null, width: 150,
          initialQty: 100, currentQty: 100, status: "WAREHOUSE", qualityGrade: grade.code, qualityGradeId: grade.id,
          entrySource: "SUPPLIER_RECEIPT", ownerCustomerId: customer.id,
        },
        select: { id: true, barcode: true },
      });
      rollIds.push(r.id);
      return r as { id: string; barcode: string };
    };
    const bind = (rollId: string, code: string) =>
      prisma.rollCustomerCode.create({ data: { rollId, customerId: customer.id, code, source: "BOUND_LABEL", clientToken: randomUUID() } });
    const jobs = (rollId: string) => prisma.printJob.count({ where: { subjectId: rollId } });

    console.log("\n[§3] basım yolu — label.customerCodeMissing");
    const r1 = await mkRoll("A");
    await setSetting(SETTING_KEYS.LABEL_CUSTOMER_CODE_MISSING, null); // varsayılan = BLOCK
    let code: string | undefined;
    let status: number | undefined;
    try {
      await labelService.printRollNative(r1.id, undefined, { templateId });
    } catch (e) {
      const err = e as { statusCode?: number; details?: { code?: string } };
      status = err.statusCode;
      code = err.details?.code;
    }
    check("§3 ⭐ kodsuz top + BLOCK (varsayılan) → 400 CUSTOMER_CODE_MISSING", status === 400 && code === "CUSTOMER_CODE_MISSING", `${status} ${code}`);
    check("§3 ⭐ BLOCK → print_jobs 0 (iş kaydı yaratılmadı)", (await jobs(r1.id)) === 0, `jobs=${await jobs(r1.id)}`);
    let htmlBlocked = false;
    try { await labelService.getRollLabelHtml(r1.id, undefined, { templateId }); } catch { htmlBlocked = true; }
    check("§3 BLOCK → HTML yolu da 400 (tarayıcı/tablet basamaz)", htmlBlocked);

    await setSetting(SETTING_KEYS.LABEL_CUSTOMER_CODE_MISSING, "ROLL_BARCODE");
    const fb = (await labelService.printRollNative(r1.id, undefined, { templateId })) as unknown as Resp;
    check("§3 ⭐ ROLL_BARCODE → basım geçer + warnings", fb.success && (fb.warnings ?? []).some((w) => w.includes("müşteri barkodu yok")), JSON.stringify(fb.warnings));
    check("§3 ROLL_BARCODE → print_jobs 1", (await jobs(r1.id)) === 1);
    const fbHtml = (await labelService.getRollLabelHtml(r1.id, undefined, { templateId })) as unknown as Resp;
    check("§3 ROLL_BARCODE → HTML iç barkodu basar + uyarı", (fbHtml.data.html ?? "").includes(r1.barcode) && (fbHtml.warnings ?? []).length === 1);
    const fbPrev = (await labelService.getRollPreview(r1.id, undefined, { templateId })) as unknown as Resp;
    check("§3 ROLL_BARCODE → önizleme de uyarıyı taşır", (fbPrev.warnings ?? []).length === 1, JSON.stringify(fbPrev.warnings));

    await bind(r1.id, CODE);
    const ok = (await labelService.getRollLabelHtml(r1.id, undefined, { templateId })) as unknown as Resp;
    check("§3 ⭐ kodlu top → HTML müşteri kodunu basar, uyarı yok", (ok.data.html ?? "").includes(CODE) && !ok.warnings);
    const nat = (await labelService.getRollLabelNative(r1.id, undefined, { templateId })) as unknown as Resp;
    check("§3 kodlu top → native çıktı müşteri kodunu taşır", (nat.data.content ?? "").includes(CODE) && !nat.warnings);
    const payload = (await labelService.getRollLabel(r1.id)).data;
    check("§3 payload.customerCode = aktif kod", payload.customerCode === CODE);
    const r2 = await mkRoll("B");
    const p2 = (await labelService.getRollLabel(r2.id)).data;
    check("§3 kodsuz topta payload'da customerCode ALANI YOK (bayt-aynı)", !("customerCode" in p2));

    console.log("\n[§4] çeki — müşteri kodu kolonu");
    const opened = await shippingService.openSack({ customerId: customer.id });
    const sackId = (opened.data as { id: string }).id;
    sackIds.push(sackId);
    await shippingService.scanIntoSack({ sackId, barcode: r1.barcode });
    await shippingService.scanIntoSack({ sackId, barcode: r2.barcode });
    const sh = await prisma.shipment.create({ data: { shipmentNo: `TEST-F3-S-${ts}`, customerId: customer.id, status: "PLANNED" }, select: { id: true } });
    shipmentId = sh.id;
    await prisma.sack.update({ where: { id: sackId }, data: { shipmentId: sh.id, seq: 1 } });
    await prisma.shipment.update({ where: { id: sh.id }, data: { status: "DISPATCHED", dispatchedAt: new Date() } });
    await printedDocumentService.freezeForSource(prisma, "SHIPMENT_DISPATCH", sh.id);
    const frozen = await prisma.printedDocument.findFirst({ where: { sourceId: sh.id }, select: { snapshot: true } });
    const snap = frozen?.snapshot as unknown as PrintedDocSnapshot;
    const rows = ((snap?.doc ?? {}) as { cekiRows?: Array<{ barcode: string; customerCode?: string }> }).cekiRows ?? [];
    check("§4 ⭐ donmuş snapshot kodlu topta customerCode taşır", rows.find((r) => r.barcode === r1.barcode)?.customerCode === CODE);
    check("§4 kodsuz topun satırında alan YOK", rows.some((r) => r.barcode === r2.barcode && !("customerCode" in r)));

    // Kod sonradan değişir (iptal + yeni kod) → donmuş belge değişmez.
    await prisma.rollCustomerCode.updateMany({ where: { rollId: r1.id, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "test" } });
    await bind(r1.id, "GK-YENI-9");
    const show = { columns: { ceki: { shown: ["customerCode"] } } };
    const htmlDirect = renderShipmentDispatchHtml({ ...snap, docConfigOverride: show } as PrintedDocSnapshot);
    check("§4 ⭐ kod değişse de belge eski (donmuş) kodu basar", htmlDirect.includes(CODE) && !htmlDirect.includes("GK-YENI-9"));
    check("§4 kolon başlığı açılınca basılır", htmlDirect.includes("MÜŞTERİ BARKODU"));
    const htmlDefault = renderShipmentDispatchHtml({ ...snap, docConfigOverride: null } as PrintedDocSnapshot);
    check("§4 ⭐ kolon varsayılan KAPALI (opt-in)", !htmlDefault.includes("MÜŞTERİ BARKODU") && !htmlDefault.includes(CODE));

    // Eski snapshot: alan hiç yok → "—".
    const oldSnap = JSON.parse(JSON.stringify(snap)) as PrintedDocSnapshot;
    for (const r of ((oldSnap.doc as { cekiRows: Array<Record<string, unknown>> }).cekiRows)) delete r.customerCode;
    const htmlOld = renderShipmentDispatchHtml({ ...oldSnap, docConfigOverride: show } as PrintedDocSnapshot);
    check("§4 ⭐ eski snapshot → kolon '—' basar", htmlOld.includes("MÜŞTERİ BARKODU") && !htmlOld.includes(CODE) && htmlOld.includes("—"));
  } finally {
    for (const f of AYARLAR) {
      const o = foto.find((x) => x.key === f);
      await setSetting(f, o ? (o.value as Prisma.InputJsonValue) : null);
    }
    if (sackIds.length) await prisma.sack.updateMany({ where: { id: { in: sackIds } }, data: { shipmentId: null, seq: null } });
    if (rollIds.length) {
      await prisma.printJob.deleteMany({ where: { subjectId: { in: rollIds } } });
      await prisma.rollCustomerCode.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.updateMany({ where: { id: { in: rollIds } }, data: { sackId: null, shipmentId: null } });
      await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    }
    if (sackIds.length) await prisma.sack.deleteMany({ where: { id: { in: sackIds } } });
    if (shipmentId) {
      await prisma.printedDocument.deleteMany({ where: { sourceId: shipmentId } });
      await prisma.shipmentOrder.deleteMany({ where: { shipmentId } });
      await prisma.shipment.deleteMany({ where: { id: shipmentId } });
    }
    if (templateId) await prisma.labelTemplate.deleteMany({ where: { id: templateId } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
  }
}

async function main(): Promise<void> {
  console.log("=== ETİKETTE MÜŞTERİ BARKODU BEKÇİSİ (D4-F3) ===");
  await dbsiz();
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exitCode = 2;
    return;
  }
  await dbli();
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    process.exitCode = fail > 0 ? 1 : (process.exitCode ?? 0);
    await prisma.$disconnect();
    await pool.end();
  });
