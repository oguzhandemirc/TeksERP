// =============================================================================
// Bekçi: TOP ETİKETİ ELLE DÜZENLEME (panel "Etiketi düzenle", 2026-11-10)
// Çalıştır: npx tsx scripts/test_roll_label_edit.ts   (DB'li, _test DB)
// =============================================================================
//   §1 katalog: kimlik alanları (barkod/QR/müşteri barkodu) düzenlenemez; bilinmeyen anahtar 400 (kaydet + taslak)
//   §2 kaydet: kolon alanı kolona, gerisi labelOverrides'a; payload/fieldDisplayValue ezmeyi basar; kalite kararı gerçek
//   §3 ölçü ezmesi yalnız gösterim: currentQty/weightKg/width değişmez · serbest müşteri adı cariye yazılmaz
//   §4 şablon önceliği: topun bir seferlik şablonu müşteri rotasını yener (tekil + toplu); HTML ezmeyi basar
//   §5 şablon doğrulama: pasif / silinmiş / serbest şablon 400 LABEL_TEMPLATE_NOT_USABLE
//   §6 taslak önizleme ezmeyi gösterir, DB'ye yazmaz
//   §7 idempotency: aynı yamanın tekrarı changed=false + audit yok; bayat sürümle farklı yama 409 LABEL_EDIT_STALE
//   §8 null kaynağa döner, "" boş basar · audit event ROLL_LABEL_EDIT · sevkli top 409 ROLL_SHIPPED
//   §9 izin: PUT zinciri label:edit / roll:write geçer, yalnız label:print 403
// Negatif sonda (ölçüldü 2026-11-10, B — dosya dışı, md5 ile geri alındı; 3/3 ısırdı):
//   buildRollRenderInput'ta `payload.rollLabelTemplateId ??` düşürüldü → §4/§6 kırmızı · toplu yolda `byRoll`
//   halkası düşürüldü → §4 toplu kırmızı · fieldDisplayValue `displayOverrides` okuması kapatıldı → §2 kırmızı.
// =============================================================================
import type { NextFunction, Request, Response } from "express";
import { LabelKind, RollStage, RollStatus } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { LabelService } from "../src/services/label.service";
import { RollLabelEditService } from "../src/services/roll-label-edit.service";
import { ROLL_LABEL_EDIT_KEY_SET } from "../src/config/roll-label-edit";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import labelRouter from "../src/routes/label.routes";
import { roleGrade } from "./fixture-quality-grade";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";
import { findRouteLayer } from "./lib/router-katmani";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`); }
}
async function errCode(p: Promise<unknown>): Promise<string> {
  try { await p; return "OK"; } catch (e) {
    const x = e as { statusCode?: number; details?: { code?: string } };
    return `${x.statusCode ?? "?"}:${x.details?.code ?? ""}`;
  }
}

const labels = new LabelService();
const edit = new RollLabelEditService();
const ts = Date.now().toString().slice(-6);
const rollIds: string[] = [];
const templateIds: string[] = [];
const customerIds: string[] = [];

function routeAllows(path: string, method: string, permissions: string[]): boolean | null {
  const layer = findRouteLayer(labelRouter, path, method);
  if (!layer?.route) return null;
  const chain = layer.route.stack;
  if (chain.length < 3 || chain[0]!.name !== "verifyToken") return null;
  const req = { user: { permissions }, params: {}, query: {}, body: {} } as unknown as Request;
  for (const link of chain.slice(1, -1)) {
    let err: unknown;
    let called = false;
    link.handle(req, {} as Response, ((e?: unknown) => { called = true; err = e; }) as NextFunction);
    if (!called) return false;
    if (err) return (err as { statusCode?: number }).statusCode === 403 ? false : null;
  }
  return true;
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const item = await prisma.item.findUnique({ where: { code: "PATOS" }, select: { id: true } });
  const color = await prisma.color.findUnique({ where: { code: "MAVI" }, select: { id: true } });
  if (!item || !color) throw new Error("fixture: PATOS ürünü / MAVI renk yok");
  const grade = await roleGrade("FIRST");
  // Elle ezilen GÖSTERİM metni katalog kodundan türetilir; kodla aynı olmadığı (ezme) ölçülür.
  const elleKaliteYazisi = `${grade.code} PLUS`;
  const actor = await testActorId();

  const cust = await prisma.customer.create({ data: { code: `TEST-RLE-${ts}`, name: `TEST Etiket Duzenle ${ts}` }, select: { id: true } });
  customerIds.push(cust.id);
  const canvas = (binds: string[]) => ({
    v: 1,
    elements: [
      { id: "b", type: "barcode", x: 2, y: 2, wMm: 40, hMm: 10 },
      ...binds.map((bind, i) => ({ id: `f${i}`, type: "field", x: 3, y: 15 + i * 4, bind, font: "md" })),
    ],
  });
  const mkTemplate = async (tag: string, binds: string[], extra: { isActive?: boolean; standalone?: boolean; deletedAt?: Date } = {}) => {
    const t = await prisma.labelTemplate.create({
      data: {
        name: `TEST-RLE-${tag}-${ts}`, kind: extra.standalone ? null : LabelKind.ROLL_FINISHED, isActive: extra.isActive ?? true,
        standalone: extra.standalone ?? false, deletedAt: extra.deletedAt ?? null, fields: [] as never,
        variants: { create: [{ name: `V-${tag}`, widthMm: 100, heightMm: 50, elements: canvas(binds) as never, isPrimary: true }] },
      },
      select: { id: true },
    });
    templateIds.push(t.id);
    return t.id;
  };
  const tCust = await mkTemplate("CUST", ["itemName"]);
  const tOne = await mkTemplate("ONE", ["customerName", "deliveryNoteItemText", "lengthMeters", "weightKg", "qualityGrade"]);
  const tOff = await mkTemplate("OFF", ["itemName"], { isActive: false });
  const tDel = await mkTemplate("DEL", ["itemName"], { deletedAt: new Date() });
  const tFree = await mkTemplate("FREE", ["itemName"], { standalone: true });
  await prisma.customerTemplateRoute.create({ data: { customerId: cust.id, kind: LabelKind.ROLL_FINISHED, templateId: tCust } });

  const mkRoll = async (status: RollStatus = RollStatus.WAREHOUSE) => {
    const r = await prisma.roll.create({
      data: {
        barcode: `TST-RLE-${rollIds.length}-${ts}`, itemId: item.id, colorId: color.id, status, stage: RollStage.FINISHED,
        currentQty: 50, initialQty: 50, width: 150, weightKg: 12, qualityGrade: grade.code, qualityGradeId: grade.id,
        labelCustomerId: cust.id, lastLabelSnapshot: { customerId: cust.id },
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };

  console.log("\n[§1] katalog");
  check("§1 barkod/QR/müşteri barkodu/basım tarihi düzenlenemez", !["barcode", "qrCode", "customerCode", "printedAt"].some((k) => ROLL_LABEL_EDIT_KEY_SET.has(k)));
  check("§1 müşteri/desen/metraj/kalite düzenlenebilir", ["customerName", "deliveryNoteItemText", "lengthMeters", "qualityGrade", "consigneeName"].every((k) => ROLL_LABEL_EDIT_KEY_SET.has(k)));
  const r1 = await mkRoll();
  check("§1 bilinmeyen anahtar 400 (kaydet)", (await errCode(edit.save(r1, { fields: { barcode: "X" } }, actor))) === "400:LABEL_EDIT_KEY_UNKNOWN");
  check("§1 bilinmeyen anahtar 400 (taslak önizleme)", (await errCode(labels.getRollPreview(r1, undefined, { labelEdit: { fields: { nope: "X" } } }))) === "400:LABEL_EDIT_KEY_UNKNOWN");

  console.log("\n[§2] kaydet");
  const customersBefore = await prisma.customer.count({ where: { name: { contains: "SERBEST" } } });
  const saved = await edit.save(r1, {
    templateId: tOne,
    fields: { customerName: "SERBEST MUSTERI", deliveryNoteItemText: "DESEN-7", itemName: "lale", lengthMeters: "22,5", weightKg: "ELLE KG", qualityGrade: elleKaliteYazisi },
  }, actor);
  const row = await prisma.roll.findUnique({ where: { id: r1 }, select: { labelItemName: true, labelOverrides: true, labelTemplateId: true, labelDirty: true, labelEditedAt: true, currentQty: true, weightKg: true, width: true } });
  check("§2 changed=true, kolon alanı kolona (normalize)", saved.data?.changed === true && row?.labelItemName === "LALE", String(row?.labelItemName));
  const ov = row?.labelOverrides as Record<string, string> | null;
  check("§2 kolon dışı alanlar labelOverrides'ta, kolon anahtarı orada yok", ov?.customerName === "SERBEST MUSTERI" && ov?.lengthMeters === "22,5" && !("itemName" in (ov ?? {})), JSON.stringify(ov));
  check("§2 şablon + labelDirty + sürüm damgası", row?.labelTemplateId === tOne && row.labelDirty === true && row.labelEditedAt != null);
  const p = (await labels.getRollLabel(r1)).data!;
  check("§2 payload müşteri adını basar (eski düzenler için alan da yazılır)", p.customerName === "SERBEST MUSTERI" && fieldDisplayValue(p, "customerName").value === "SERBEST MUSTERI");
  check("§2 sayı ölçü ezmesi birimle biçimlenir", fieldDisplayValue(p, "lengthMeters").value.startsWith("22,5"), fieldDisplayValue(p, "lengthMeters").value);
  check("§2 sayı olmayan ölçü ezmesi aynen basılır", fieldDisplayValue(p, "weightKg").value === "ELLE KG");
  check("§2 kalite ezmesi yalnız gösterimde; karar alanı (payload.qualityGrade) gerçek", fieldDisplayValue(p, "qualityGrade").value === elleKaliteYazisi && p.qualityGrade === grade.code);
  check("§2 form görünümü elle yazıldı işaretini taşır", saved.data!.fields.find((f) => f.key === "customerName")?.overridden === true && saved.data!.fields.find((f) => f.key === "colorName")?.overridden === false);

  console.log("\n[§3] yalnız gösterim");
  check("§3 currentQty/weightKg/width değişmez", Number(row?.currentQty) === 50 && Number(row?.weightKg) === 12 && Number(row?.width) === 150, `${row?.currentQty}/${row?.weightKg}/${row?.width}`);
  check("§3 serbest müşteri adı cari kaydı doğurmaz", (await prisma.customer.count({ where: { name: { contains: "SERBEST" } } })) === customersBefore);
  check("§3 etiket müşterisi (kayıtlı cari) değişmez", (await prisma.roll.findUnique({ where: { id: r1 }, select: { labelCustomerId: true } }))?.labelCustomerId === cust.id);

  console.log("\n[§4] şablon önceliği + render");
  const pv = (await labels.getRollPreview(r1)).data!;
  check("§4 bir seferlik şablon müşteri rotasını yener (tekil)", pv.meta.templateId === tOne, String(pv.meta.templateName));
  const html = (await labels.getRollLabelHtml(r1)).data!.html;
  check("§4 HTML ezmeyi basar (müşteri + desen)", html.includes("SERBEST MUSTERI") && html.includes("DESEN-7"));
  const bulk = await labels.getBulkRollLabelsHtml([r1]);
  const bulkHtml = bulk.data?.html ?? "";
  check("§4 toplu basım da bir seferlik şablon + ezmeyi kullanır", bulkHtml.includes("DESEN-7") && bulkHtml.includes("SERBEST MUSTERI"));
  const rPlain = await mkRoll();
  check("§4 düzenlenmemiş topta müşteri rotası geçerli (bayt-aynı yol)", (await labels.getRollPreview(rPlain)).data!.meta.templateId === tCust);
  const plainPayload = (await labels.getRollLabel(rPlain)).data!;
  check("§4 düzenlenmemiş payload'da yeni alan yok", !("displayOverrides" in plainPayload) && !("rollLabelTemplateId" in plainPayload));

  console.log("\n[§5] şablon doğrulama");
  for (const [tag, id] of [["pasif", tOff], ["silinmiş", tDel], ["serbest", tFree]] as const) {
    check(`§5 ${tag} şablon 400`, (await errCode(edit.save(rPlain, { templateId: id }, actor))) === "400:LABEL_TEMPLATE_NOT_USABLE");
  }
  const form = (await edit.getEditForm(rPlain)).data;
  check("§5 form şablon listesinde pasif/silinmiş/serbest yok, uygun olan var", !form.templates.some((t) => [tOff, tDel, tFree].includes(t.id)) && form.templates.some((t) => t.id === tOne));
  check("§5 form zincir şablonunu bildirir", form.chainTemplateId === tCust && form.templateId === null);

  console.log("\n[§6] taslak önizleme");
  const draft = (await labels.getRollPreview(rPlain, undefined, { labelEdit: { templateId: tOne, fields: { customerName: "TASLAK ADI" } } })).data!;
  const rp = await prisma.roll.findUnique({ where: { id: rPlain }, select: { labelOverrides: true, labelTemplateId: true, labelEditedAt: true } });
  check("§6 taslak ezmeyi ve taslak şablonu gösterir", draft.content.includes("TASLAK ADI") && draft.meta.templateId === tOne);
  check("§6 taslak DB'ye yazmaz", rp?.labelOverrides === null && rp.labelTemplateId === null && rp.labelEditedAt === null);

  console.log("\n[§7] idempotency");
  const auditBefore = await prisma.systemLog.count({ where: { tableName: "ROLL", recordId: r1 } });
  const replay = await edit.save(r1, { templateId: tOne, fields: { customerName: "SERBEST MUSTERI", lengthMeters: "22,5" } }, actor);
  const auditAfter = await prisma.systemLog.count({ where: { tableName: "ROLL", recordId: r1 } });
  check("§7 aynı yamanın tekrarı changed=false, audit yok", replay.data?.changed === false && auditBefore === auditAfter, `${auditBefore}→${auditAfter}`);
  const oldStamp = saved.data!.labelEditedAt;
  await edit.save(r1, { fields: { orderNumber: "SP-1" } }, actor);
  check("§7 bayat sürümle farklı yama 409 LABEL_EDIT_STALE", (await errCode(edit.save(r1, { fields: { orderNumber: "SP-2" }, expectedEditedAt: oldStamp }, actor))) === "409:LABEL_EDIT_STALE");

  console.log("\n[§8] geri dönüş, audit, kilit");
  await edit.save(r1, { fields: { customerName: null, deliveryNoteItemText: "" } }, actor);
  const p8 = (await labels.getRollLabel(r1)).data!;
  check("§8 null kaynağa döner (kayıtlı cari adı)", p8.customerName !== "SERBEST MUSTERI" && !("customerName" in (p8.displayOverrides ?? {})), String(p8.customerName));
  check("§8 \"\" alanı boş basar (present:false)", fieldDisplayValue(p8, "deliveryNoteItemText").present === false);
  const a = await prisma.systemLog.findFirst({ where: { tableName: "ROLL", recordId: r1, action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { newData: true } });
  check("§8 audit event ROLL_LABEL_EDIT", (a?.newData as Record<string, unknown> | null)?.event === "ROLL_LABEL_EDIT");
  const rShip = await mkRoll(RollStatus.SHIPPED);
  check("§8 sevkli top 409 ROLL_SHIPPED", (await errCode(edit.save(rShip, { fields: { customerName: "X" } }, actor))) === "409:ROLL_SHIPPED");

  console.log("\n[§9] izin");
  check("§9 PUT zinciri okunabildi", routeAllows("/rolls/:id/overrides", "put", ["label:edit"]) !== null);
  check("§9 label:edit geçer", routeAllows("/rolls/:id/overrides", "put", ["label:edit"]) === true);
  check("§9 roll:write geçer", routeAllows("/rolls/:id/overrides", "put", ["roll:write"]) === true);
  check("§9 yalnız label:print 403", routeAllows("/rolls/:id/overrides", "put", ["label:print"]) === false);
  check("§9 taslak önizleme label:read ister", routeAllows("/rolls/:id/preview", "post", ["label:read"]) === true && routeAllows("/rolls/:id/preview", "post", ["order:read"]) === false);
}

async function cleanup(): Promise<void> {
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.customerTemplateRoute.deleteMany({ where: { customerId: { in: customerIds } } });
  await prisma.labelTemplateVariant.deleteMany({ where: { templateId: { in: templateIds } } });
  await prisma.labelTemplate.deleteMany({ where: { id: { in: templateIds } } });
  await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
}

main()
  .catch((e) => { fail++; console.error(e); })
  .finally(async () => {
    await cleanup().catch((e) => console.error("temizlik:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
