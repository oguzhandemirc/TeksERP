// =============================================================================
// GELEN BELGE — okuma özetinin `templateFields` alan raporu (tablet İş Emirleri okutma önizlemesi, 2026-11-06)
// =============================================================================
// Sunucusuz, gerçek DB (`getReadSummary` doğrudan). Sınanan:
//   §1 saf `fieldReport`: şablon sırası, bulundu/bulunamadı, boşluk = bulunamadı, required taşınır; blok/bölüm alanı boşsa
//      rapora girmez, doluysa girer
//   §2 ⭐ dosya şablonuyla okunmuş not → `templateFields` (bulunan değerli, bulunamayan null, required işaretli)
//   §3 ⭐ kullanıcı şablonu (`u-`) önbellekte YOKKEN DB'den tazelenir → rapor var
//   §4 ⭐ GENEL yedek şablon / şablonsuz bölge / okunmamış not → anahtar YOK (eski sözleşme)
// Negatif sonda: `getReadSummary` yayma satırı silinince §2/§3 kırmızı; `noteTemplateFields` GENEL koşulu silinince §4 kırmızı.
// =============================================================================
import { randomUUID, createHash } from "crypto";
import prisma from "../src/lib/prisma";
import { pool } from "../src/lib/prisma";
import { fieldReport } from "../src/lib/gelen-belge/alan-raporu";
import { loadTemplates, type DocumentTemplate } from "../src/lib/gelen-belge/motor";
import { setUserTemplates } from "../src/lib/gelen-belge/sablon-bul";
import { getReadSummary } from "../src/services/gelen-belge-okuma-ozeti.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const TAG = `TEST-GAR${Date.now().toString(36).toUpperCase()}`;
const made = { notes: [] as string[], scans: [] as string[], templates: [] as string[] };
type Report = Array<{ key: string; label: string; value: string | null; required: boolean }>;

async function mkNote(ocrResult?: unknown): Promise<string> {
  const n = await prisma.customerDeliveryNote.create({ data: { noteNo: `${TAG}-${made.notes.length + 1}`, sourceKind: "OCR" }, select: { id: true } });
  made.notes.push(n.id);
  if (ocrResult !== undefined) {
    const content = Buffer.from(`${TAG}-${randomUUID()}`);
    const s = await prisma.documentScan.create({
      data: { noteId: n.id, pageNo: 1, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content, status: "READ", ocrResult: ocrResult as never },
      select: { id: true },
    });
    made.scans.push(s.id);
  }
  return n.id;
}

const report = async (id: string): Promise<Report | undefined> => ((await getReadSummary(id)) as { templateFields?: Report }).templateFields;

async function run(): Promise<void> {
  console.log("§1 saf fieldReport");
  const t: Pick<DocumentTemplate, "fields" | "blockFields" | "sections"> = {
    fields: [
      { key: "a", label: "A", type: "text", required: true, strategies: [] },
      { key: "b", label: "B", type: "text", strategies: [] },
      { key: "c", label: "C", type: "text", strategies: [] },
      { key: "blk", label: "Blok", type: "text", strategies: [] },
      { key: "sec", label: "Bölüm", type: "text", strategies: [] },
    ],
    blockFields: ["blk"],
    sections: { startLabels: ["X"], fields: ["sec"] },
  };
  const r1 = fieldReport(t, { a: " 12 ", b: "   ", sec: "P-1" });
  check("§1 sıra korunur, değer kırpılır, boşluk = bulunamadı, required taşınır; boş blok alanı yok, dolu bölüm alanı var",
    JSON.stringify(r1) === JSON.stringify([
      { key: "a", label: "A", value: "12", required: true },
      { key: "b", label: "B", value: null, required: false },
      { key: "c", label: "C", value: null, required: false },
      { key: "sec", label: "Bölüm", value: "P-1", required: false },
    ]), JSON.stringify(r1));
  check("§1 bölge yoksa her alan bulunamadı (blok/bölüm hariç)", fieldReport(t, null).map((x) => x.key).join(",") === "a,b,c");

  console.log("§2 dosya şablonu");
  const file = loadTemplates().find((x) => x.id !== "genel" && x.fields.some((f) => f.required) && x.fields.length >= 3);
  if (!file) { check("§2 ön koşul: required alanlı dosya şablonu", false); return; }
  const firstReq = file.fields.find((f) => f.required)!;
  const missing = file.fields.find((f) => f.key !== firstReq.key && !(file.blockFields ?? []).includes(f.key) && !(file.sections?.fields ?? []).includes(f.key))!;
  const n2 = await mkNote({ regions: [{ templateId: file.id, fields: { [firstReq.key]: "DEGER-1", [missing.key]: null } }] });
  const r2 = await report(n2);
  const f2 = r2?.find((x) => x.key === firstReq.key);
  const m2 = r2?.find((x) => x.key === missing.key);
  check(`§2 ⭐ ${file.id}: bulunan değerli + required, bulunamayan null`, !!r2 && f2?.value === "DEGER-1" && f2.required === true && f2.label === firstReq.label && m2?.value === null,
    JSON.stringify({ f2, m2, n: r2?.length }));

  console.log("§3 kullanıcı şablonu (önbellekte yok)");
  const code = `u-${TAG.toLowerCase()}`;
  const ut = await prisma.senderTemplate.create({ data: { code, template: { ...file, id: code } as never }, select: { id: true } });
  made.templates.push(ut.id);
  setUserTemplates([]);
  const n3 = await mkNote({ regions: [{ templateId: code, fields: { [firstReq.key]: "U-1" } }] });
  const r3 = await report(n3);
  check("§3 ⭐ u- şablonu DB'den tazelenir → rapor var", r3?.find((x) => x.key === firstReq.key)?.value === "U-1", JSON.stringify(r3?.slice(0, 2)));

  console.log("§4 rapor yok");
  const nG = await mkNote({ regions: [{ templateId: "genel", fields: { tarih: "01.01.2026" } }] });
  const nN = await mkNote({ regions: [{ templateId: null, fields: { tarih: "01.01.2026" } }] });
  const nE = await mkNote();
  const keys = await Promise.all([nG, nN, nE].map(async (id) => "templateFields" in (await getReadSummary(id))));
  check("§4 ⭐ GENEL / şablonsuz / okunmamış → templateFields anahtarı yok", keys.every((k) => !k), JSON.stringify(keys));
}

async function cleanup(): Promise<void> {
  const swallow = (e: unknown) => console.error("temizlik:", e instanceof Error ? e.message : e);
  await prisma.documentScan.deleteMany({ where: { id: { in: made.scans } } }).catch(swallow);
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } }).catch(swallow);
  await prisma.senderTemplateVersion.deleteMany({ where: { templateId: { in: made.templates } } }).catch(swallow);
  await prisma.senderTemplate.deleteMany({ where: { id: { in: made.templates } } }).catch(swallow);
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.error(`⛔ DURDURULDU — ${engel}`); process.exitCode = 1; return; }
  try { await run(); }
  catch (e) { fail++; console.error("❌ beklenmeyen hata:", e); }
  finally {
    await cleanup();
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    process.exitCode = fail > 0 ? 1 : 0;
    await prisma.$disconnect();
    await pool.end();
  }
}

void main();
