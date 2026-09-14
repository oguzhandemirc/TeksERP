// =============================================================================
// İLK GİRİŞTE KALİTE — seçilen kod topa yazılır, boş "Belirsiz" (NULL) kalır, kod uydurulmaz
// =============================================================================
// NEDEN (d9 C2 bulgusu, 2026-09-14): panel "Manuel Top Ekle" diyaloğunda kalite
// opsiyoneldir ("" → Belirsiz) ve bugüne kadar ÖLÇÜLMEMİŞTİ: seçilen değer yaratılan
// topa gerçekten yazılıyor mu, boş bırakınca topta ne var? Kalite kolonu çifttir
// (`qualityGrade` kod + `qualityGradeId` FK) ve ikisi birlikte dolar/boşalır;
// eski sabit "1.KALITE" varsayılanı ARTIK YAZILMAZ. Ölçüldü (0c): kusur yok —
// bu bekçi o ölçümü kalıcı kılar (kod→id kopyası, boş/whitespace → NULL çifti,
// bilinmeyen/pasif kod 400).
//
// Bölümler:
//   §0 körlük zemini — fikstür kalite satırları (aktif + PASİF) ve kumaş kalemi doğdu
//   §1 kod → kod + id (fikstürün id'si), ref aynı satır
//   §2 alan yok · "" · "   " → üçü de NULL/NULL ("Belirsiz")
//   §3 bilinmeyen kod → 400 ve top DOĞMAZ · §4 PASİF kod → 400 ve top DOĞMAZ
//
// NEGATİF SONDA (2026-09-14, cp+sha256 ile geri):
//   · `helpers/quality-grade.helper.ts` `if (!row.isActive)` → `if (false)` → §4 kırmızı
//   · `inventory.service.ts` `trimmedQuality || null` → `?? null` → §2 boş dize + whitespace kırmızı (kod "" yazıldı, id null: çift AYRIŞTI)
// ⚠️ DB'ye YAZAR → `hedefDbEngeli()` ilk adım; fikstür `TEST-C2-<pid>` önekiyle doğar ve silinir.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { InventoryService } from "../src/services/inventory.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
}

const inventory = new InventoryService();
const PID = process.pid;
const rollIds: string[] = [];

interface Sonuc {
  qualityGrade: string | null;
  qualityGradeId: string | null;
  refCode: string | null;
}

async function girisYap(itemId: string, qualityGrade: string | undefined): Promise<Sonuc> {
  const res = await inventory.createInitialEntry(
    { itemId, initialQty: 10, ...(qualityGrade !== undefined ? { qualityGrade } : {}) },
    undefined,
    undefined,
    false,
  );
  const id = (res.data as { id: string }).id;
  rollIds.push(id);
  const r = await prisma.roll.findUnique({ where: { id }, select: { qualityGrade: true, qualityGradeId: true, qualityGradeRef: { select: { code: true } } } });
  return { qualityGrade: r?.qualityGrade ?? null, qualityGradeId: r?.qualityGradeId ?? null, refCode: r?.qualityGradeRef?.code ?? null };
}

async function redBekle(itemId: string, qualityGrade: string): Promise<string | null> {
  const once = rollIds.length;
  try {
    await girisYap(itemId, qualityGrade);
    return null;
  } catch (e) {
    check(`   top DOĞMADI (${qualityGrade})`, rollIds.length === once);
    return (e as Error).message;
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) {
    console.log(`⛔ ${engel}`);
    process.exit(2);
  }
  console.log("=== İLK GİRİŞTE KALİTE BEKÇİSİ ===\n");
  const aktif = await prisma.qualityGrade.create({ data: { code: `TEST-C2-A-${PID}`, name: `Test C2 aktif ${PID}`, sortOrder: 900 }, select: { id: true, code: true } });
  const pasif = await prisma.qualityGrade.create({ data: { code: `TEST-C2-P-${PID}`, name: `Test C2 pasif ${PID}`, sortOrder: 901, isActive: false }, select: { id: true, code: true } });
  const item = await prisma.item.create({ data: { code: `TEST-C2-I-${PID}`, name: `Test C2 kumaş ${PID}`, itemType: "FABRIC", unit: "MT" }, select: { id: true } });
  try {
    console.log("── §0 Körlük zemini ──");
    check("§0a aktif + PASİF kalite fikstürü doğdu", !!aktif.id && !!pasif.id);
    check("§0b kumaş kalemi doğdu", !!item.id);

    console.log("\n── §1 kod → kod + id ──");
    const a = await girisYap(item.id, aktif.code);
    check("§1a qualityGrade = seçilen kod", a.qualityGrade === aktif.code, JSON.stringify(a));
    check("§1b qualityGradeId = kataloğun id'si (ref aynı satır)", a.qualityGradeId === aktif.id && a.refCode === aktif.code);

    console.log("\n── §2 boş → Belirsiz (NULL çifti) ──");
    for (const [ad, v] of [["alan yok", undefined], ["boş dize", ""], ["whitespace", "   "]] as const) {
      const s = await girisYap(item.id, v);
      check(`§2 ${ad} → NULL/NULL`, s.qualityGrade === null && s.qualityGradeId === null, JSON.stringify(s));
    }

    console.log("\n── §3 bilinmeyen kod ──");
    const m3 = await redBekle(item.id, `TEST-C2-YOK-${PID}`);
    check("§3 bilinmeyen kod → red (400), mesaj kodu anar", m3 !== null && m3.includes("bulunamadı"), m3 ?? "YAZILDI (KUSUR)");

    console.log("\n── §4 PASİF kod ──");
    const m4 = await redBekle(item.id, pasif.code);
    check("§4 pasif kod → red (400), mesaj 'pasif' der", m4 !== null && /pasif/i.test(m4), m4 ?? "YAZILDI (KUSUR)");
  } finally {
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.item.delete({ where: { id: item.id } }).catch(() => undefined);
    await prisma.qualityGrade.deleteMany({ where: { id: { in: [aktif.id, pasif.id] } } });
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("HATA", e);
  await pool.end();
  process.exit(1);
});
