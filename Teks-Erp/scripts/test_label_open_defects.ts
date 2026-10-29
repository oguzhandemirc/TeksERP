// TEST (KQ-D8, plan §3.8/3): mamul top etiketinde "Hata Notu" (`openDefects`) — opt-in alan.
//   §1 katalog: ROLL_FINISHED'da var, varsayılan şablonda KAPALI doğar (yeni + eski şablon)
//   §2 biçim: metreye göre "12,5 m Leke · 40 m Delik", ilk 4 + "+N", hatasız ""
//   §3 DB: yalnız AÇIK (isProcessed=false) işlem kökenli hata; kararlı / muayene satırı girmez
//   §4 çizim: şablonsuz düzen basmaz, şablonda açıkça açılınca basar
// Negatif sonda: label-fields'ta `defaultVisible: false` kaldır → §1 kırmızı.
// Çalıştır: npx tsx scripts/test_label_open_defects.ts
import prisma from "../src/lib/prisma";
import { LabelKind, RollStatus } from "@prisma/client";
import { buildDefaultFields, FIELD_CATALOG, type TemplateField } from "../src/config/label-fields";
import { formatOpenDefectNote, loadOpenDefectNotes } from "../src/services/helpers/open-defect-note.helper";
import { fieldDisplayValue } from "../src/services/helpers/label-field-values";
import { buildRollLabelHtml } from "../src/services/helpers/label-html.helper";
import { LabelService } from "../src/services/label.service";
import { roleGrade } from "./fixture-quality-grade";
import { fixtureWarehouseId } from "./fixture-warehouse";
import { testActorId } from "./fixture-test-user";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}
const TAG = `TLOD-${Date.now().toString(36).toUpperCase()}`;
const rollIds: string[] = [];

async function main(): Promise<void> {
  console.log("§1 Katalog — opt-in alan");
  const def = FIELD_CATALOG[LabelKind.ROLL_FINISHED].find((f) => f.key === "openDefects");
  check("§1 ROLL_FINISHED kataloğunda openDefects 'Hata Notu'", def?.defaultLabel === "Hata Notu" && def.type === "text");
  check("§1 ROLL_RAW kataloğunda YOK (yalnız mamul top)", !FIELD_CATALOG[LabelKind.ROLL_RAW].some((f) => f.key === "openDefects"));
  const dflt = buildDefaultFields(LabelKind.ROLL_FINISHED).find((f) => f.key === "openDefects");
  check("§1 ⭐ varsayılan şablonda GÖRÜNMEZ doğar", dflt?.isVisible === false, JSON.stringify(dflt));
  check("§1 diğer alanlar varsayılan görünür kalır (davranış birebir)",
    buildDefaultFields(LabelKind.ROLL_FINISHED).filter((f) => !["openDefects", "deliveryNoteItemText", "deliveryNoteColorText"].includes(f.key)).every((f) => f.isVisible));

  console.log("§2 Biçim");
  check("§2 metreye göre sıralı, TR ondalık",
    formatOpenDefectNote([{ startMeter: 40, name: "Delik" }, { startMeter: 12.5, name: "Leke" }]) === "12,5 m Leke · 40 m Delik");
  const alti = [1, 2, 3, 4, 5, 6].map((m) => ({ startMeter: m * 10, name: "Leke" }));
  check("§2 ilk 4 + '+N'", formatOpenDefectNote(alti) === "10 m Leke · 20 m Leke · 30 m Leke · 40 m Leke +2", formatOpenDefectNote(alti));
  check("§2 binlik ayırıcı", formatOpenDefectNote([{ startMeter: 1250, name: "Delik" }]) === "1.250 m Delik");
  check("§2 hatasız → boş", formatOpenDefectNote([]) === "");

  console.log("§3 DB — yalnız açık işlem hatası");
  const item = await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } });
  const actor = await testActorId();
  if (!item) throw new Error("Seed eksik: PATOS");
  const grade = await roleGrade("FIRST");
  const mk = async (n: number) => {
    const r = await prisma.roll.create({ data: { barcode: `${TAG}-${n}`, itemId: item.id, initialQty: 100, currentQty: 100, status: RollStatus.STOCK, warehouseId: await fixtureWarehouseId(), qualityGrade: grade.code, qualityGradeId: grade.id, width: 150, createdById: actor }, select: { id: true } });
    rollIds.push(r.id);
    return r.id;
  };
  const hatali = await mk(1);
  const temiz = await mk(2);
  // Test fikstürü — üretim yazımı tek boğazdan (`recordRollDefectTx`); burada doğrudan satır kurulur.
  await prisma.rollError.createMany({ data: [
    { rollId: hatali, startMeter: 40, errorType: "Delik" },
    { rollId: hatali, startMeter: 12.5, errorType: "Leke" },
    { rollId: hatali, startMeter: 60, errorType: "Kararlı", isProcessed: true, actionTaken: "NO_CUT" },
  ] });
  const notes = await loadOpenDefectNotes([hatali, temiz]);
  check("§3 açık hatalı top notu", notes.get(hatali) === "12,5 m Leke · 40 m Delik", notes.get(hatali) ?? "yok");
  check("§3 hatasız top haritada yok", !notes.has(temiz));
  const svc = new LabelService();
  const p1 = await svc.getRollLabel(hatali);
  const p2 = await svc.getRollLabel(temiz);
  check("§3 etiket payload openDefects (hatalı)", p1.data.openDefects === "12,5 m Leke · 40 m Delik");
  check("§3 etiket payload openDefects (hatasız) boş", p2.data.openDefects === "");
  check("§3 hatasızda alan present:false (satır basılmaz)", fieldDisplayValue(p2.data, "openDefects").present === false);

  console.log("§4 Çizim — opt-in");
  const html = (fields: TemplateField[] | null) =>
    buildRollLabelHtml({
      payload: p1.data,
      template: fields ? ({ id: "t", kind: LabelKind.ROLL_FINISHED, fields } as never) : null,
      barcodeSvg: "", qrSvg: "",
    });
  check("§4 şablonsuz (varsayılan) düzen hata notunu BASMAZ", !html(null).includes("Leke"));
  const fields = buildDefaultFields(LabelKind.ROLL_FINISHED);
  check("§4 varsayılan alan kümesiyle BASMAZ", !html(fields).includes("Leke"));
  const acik = fields.map((f) => (f.key === "openDefects" ? { ...f, isVisible: true } : f));
  check("§4 şablonda açılınca basar", html(acik).includes("12,5 m Leke · 40 m Delik"));
}

main()
  .catch((e) => { fail++; console.error("HATA:", e); })
  .finally(async () => {
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => undefined);
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch((e) => console.error("temizlik:", e));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    process.exitCode ||= fail > 0 ? 1 : 0;
  });
