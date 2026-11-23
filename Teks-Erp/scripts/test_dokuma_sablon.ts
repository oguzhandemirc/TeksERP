// =============================================================================
// BEKÇİ: Özel dokuma iş emri şablonu (İE ayrımı 2026-11-23) — `WeavingOrderTemplateService`
// Çalıştır: npx tsx scripts/test_dokuma_sablon.ts
// =============================================================================
// Ölçer: §1 gövde ALLOWLIST'tir (tanınmayan alan 400 — yeni kolon kendiliğinden yazılabilir olmaz) ·
// §2 kumaş olmayan kart / pasif fasoncu 400 · §3 içeride + fasoncu XOR'u (oluşturma ve güncellemede mevcut
// satırla birleşik) · §4 metre normalizasyonu (virgül, boş → null, ≤0 400) · §5 sil = pasife al (satır kalır).
// Fixture: TST-WSB-* business-key; finally'de FK sırasıyla temizlenir (şablon → kalem).
// Negatif sonda (2026-11-23): serviste `.strict()` kaldırıldı → §1a ❌; XOR'da `current` birleşimi atlandı → §3c ❌.
// =============================================================================
import { ItemUnit } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { weavingOrderTemplateService as svc } from "../src/routes/weaving-order-template.routes";
import { normalizePlannedM } from "../src/services/weaving-order-template.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.error(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

const ts = Date.now().toString(36);
const itemIds: string[] = [];
const tplIds: string[] = [];

async function rejects(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e) { return e instanceof Error ? e.message : String(e); }
}
function idOf(r: { data?: unknown }): string {
  return (r.data as { id: string }).id;
}

async function cleanup(): Promise<void> {
  // Ad öneki de süpürülür: negatif sondada beklenmedik başarılı create'in kimliği tplIds'e girmez.
  await prisma.weavingOrderTemplate.deleteMany({ where: { OR: [{ id: { in: tplIds } }, { name: { startsWith: "TST-WSB-" } }] } });
  if (itemIds.length) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) { console.log(`❌ ${engel}`); process.exitCode = 1; return; }
  try {
    const fabric = await prisma.item.create({ data: { code: `TST-WSB-F-${ts}`, name: `WSB Kumaş ${ts}`, itemType: "FABRIC", unit: ItemUnit.MT }, select: { id: true } });
    const yarn = await prisma.item.create({ data: { code: `TST-WSB-Y-${ts}`, name: `WSB İplik ${ts}`, itemType: "YARN", unit: ItemUnit.KG }, select: { id: true } });
    itemIds.push(fabric.id, yarn.id);
    const sub = await ensureTestDyeHouse();

    // §1 allowlist
    check("§1a tanınmayan alan (isActive=false doğuşta / clientToken) reddedilir", (await rejects(svc.create({ name: `TST-WSB-X-${ts}`, foo: 1 }))) !== null);
    check("§1b ad zorunlu", (await rejects(svc.create({ name: "  " }))) !== null);

    // §2 referanslar
    check("§2a kumaş olmayan kart 400", ((await rejects(svc.create({ name: `TST-WSB-Y-${ts}`, itemId: yarn.id }))) ?? "").includes("KUMAŞ"));
    check("§2b olmayan kart 400", ((await rejects(svc.create({ name: `TST-WSB-N-${ts}`, itemId: "00000000-0000-4000-8000-000000000000" }))) ?? "").includes("bulunamadı"));

    // §3 XOR
    check("§3a içeride + fasoncu oluşturmada 400", (await rejects(svc.create({ name: `TST-WSB-I-${ts}`, executionKind: "IN_HOUSE", subcontractorId: sub.id }))) !== null);
    const r = await svc.create({ name: `TST-WSB-A-${ts}`, itemId: fabric.id, executionKind: "SUBCONTRACTED", subcontractorId: sub.id, plannedM: "1250,5", notes: "Tahar 4" });
    const id = idOf(r);
    tplIds.push(id);
    const row = await prisma.weavingOrderTemplate.findUniqueOrThrow({ where: { id } });
    check("§3b fasonda + fasoncu kaydolur", row.executionKind === "SUBCONTRACTED" && row.subcontractorId === sub.id && row.isActive);
    check("§3c güncellemede yalnız tür IN_HOUSE yapılırsa mevcut fasoncuyla birleşik XOR 400", (await rejects(svc.update(id, { executionKind: "IN_HOUSE" }))) !== null);
    await svc.update(id, { executionKind: "IN_HOUSE", subcontractorId: null });
    const after = await prisma.weavingOrderTemplate.findUniqueOrThrow({ where: { id } });
    check("§3d tür + fasoncu birlikte değişince kabul", after.executionKind === "IN_HOUSE" && after.subcontractorId === null);

    // §4 metre
    check("§4a virgüllü metre sayıya çevrildi", Number(row.plannedM) === 1250.5, String(row.plannedM));
    check("§4b boş metin → null, sayı aynen", normalizePlannedM("") === null && normalizePlannedM(12) === 12 && normalizePlannedM(undefined) === undefined);
    check("§4c sıfır/negatif/metin metre 400", [0, "-3", "abc"].every((v) => { try { normalizePlannedM(v); return false; } catch { return true; } }));

    // §5 sil = pasife al
    await svc.softDelete(id);
    const gone = await prisma.weavingOrderTemplate.findUnique({ where: { id }, select: { isActive: true } });
    check("§5 sil satırı silmez, pasife alır", gone !== null && gone.isActive === false);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(async (err) => {
  console.error("Beklenmeyen hata:", err);
  await cleanup().catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
