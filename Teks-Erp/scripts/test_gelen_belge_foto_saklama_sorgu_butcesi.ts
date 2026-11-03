// =============================================================================
// BEKÇİ — K28 SEVKTE SİL aday taramasının SORGU BÜTÇESİ (S15c-d2, 2026-11-03)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_gelen_belge_foto_saklama_sorgu_butcesi.ts
//
// NEDEN: `findRetentionCandidates("DELETE_ON_DISPATCH")` her sevk/onay dürtmesinde, fotoğrafı duran BÜTÜN onaylı belgeleri
// 200'lük sayfalarla gezip sayfa başına bir üyelik sorgusu (`membershipSql("deliveryNote")`, `n.id::text IN (…)`) atıyordu;
// her sorgu satır tablosunu baştan taradığı için tur = (takılı belge / 200) × geçmiş.
// Ölçüm (2026-11-03, test DB, medyan/5; 6000 geçmiş + 5000 takılı belge, 110k top): 51 sorgu 1,3 sn (PG JIT açıkken
// 27,7 sn) → 3 sorgu 0,5 sn. Bu bekçi turu takılı belge sayısından bağımsız tutar.
//
// ÖLÇÜLENLER:
//   §1 (DB'siz) belge üyeliği `onlyIds` kümesini TEK parametreyle taşır: 3 ve 300 kimlikte bağlı değer sayısı eşit
//   §2 aday taraması sorgu sayısı takılı belge 3 → 3+250'de EŞİT (sabit); körlük zemini: takılı belgeler gerçekten aday
//      kümesinde (fotoğraf TAM, belge APPROVED) ve tur sorgu atıyor
//   §3 sonuç değişmedi: tam sevkli belgenin taraması aday, takılı belgelerinkiler aday DEĞİL
// Negatif sonda (2026-11-03): `NOTE_PAGE` 200'e indirilince §2 ❌ (3 → 5 sorgu); `membershipSql` belge süzgeci eski
// `${key} IN (${Prisma.join(onlyIds)})` biçimine döndürülünce §1 ❌ (değer 3 ≠ 300).
// =============================================================================
import { createHash, randomUUID } from "node:crypto";
import prisma, { pool } from "../src/lib/prisma";
import { membershipSql } from "../src/services/ready-works.service";
import { findRetentionCandidates } from "../src/services/gelen-belge-foto-saklama.service";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const engel = hedefDbEngeli();
if (engel) {
  console.error(`⛔ DURDURULDU — ${engel}`);
  process.exitCode = 1;
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? ` — ${extra}` : ""}`); } else { fail++; console.log(`❌ ${label}${extra ? ` — ${extra}` : ""}`); }
}

// --- Sorgu sayacı: pg istemcisini sarmala (yalnız ölçüm penceresinde sayar) ---
let total = 0;
let capture = false;
pool.on("connect", (client: unknown) => {
  const c = client as { query: (...a: unknown[]) => unknown };
  const orig = c.query.bind(c);
  c.query = (...args: unknown[]) => {
    if (capture) total++;
    return orig(...args);
  };
});
async function measure<T>(fn: () => Promise<T>): Promise<{ n: number; out: T }> {
  total = 0;
  capture = true;
  try {
    const out = await fn();
    return { n: total, out };
  } finally {
    capture = false;
  }
}

const TAG = `TEST-GBFB${Date.now().toString(36).toUpperCase()}`;
const made = { notes: [] as string[], rolls: [] as string[], items: [] as string[] };

/** Onaylı belge + 2 satır topu + TAM fotoğraf; `shipped` ise iki top da SHIPPED, değilse biri STOCK (canlı → takılı). */
async function mkNotes(itemId: string, count: number, shipped: boolean): Promise<{ noteIds: string[]; scanIds: string[] }> {
  const noteIds = Array.from({ length: count }, () => randomUUID());
  made.notes.push(...noteIds);
  await prisma.customerDeliveryNote.createMany({
    data: noteIds.map((id, i) => ({ id, noteNo: `${TAG}-${shipped ? "S" : "T"}${made.notes.length}-${i}`, status: "APPROVED" as const, sourceKind: "MANUAL" as const })),
  });
  const rolls = noteIds.flatMap((noteId) => [0, 1].map((k) => ({ id: randomUUID(), noteId, k })));
  made.rolls.push(...rolls.map((r) => r.id));
  await prisma.roll.createMany({
    data: rolls.map((r) => ({ id: r.id, itemId, initialQty: 100, currentQty: 100, status: shipped || r.k === 1 ? ("SHIPPED" as const) : ("STOCK" as const) })),
  });
  await prisma.customerDeliveryNoteLine.createMany({ data: rolls.map((r) => ({ noteId: r.noteId, lineNo: r.k + 1, meters: 100, rollId: r.id })) });
  const scans = noteIds.map((noteId) => {
    const content = Buffer.from(`${TAG} ${noteId}`);
    return { id: randomUUID(), noteId, sha256: createHash("sha256").update(content).digest("hex"), mimeType: "image/jpeg", sizeBytes: content.length, content: new Uint8Array(content), status: "READ" as const };
  });
  await prisma.documentScan.createMany({ data: scans });
  return { noteIds, scanIds: scans.map((s) => s.id) };
}

async function run(): Promise<void> {
  console.log("§1 belge üyeliği kimlik kümesini tek parametreyle taşır");
  const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
  const v3 = membershipSql("deliveryNote", undefined, ids(3)).values.length;
  const v300 = membershipSql("deliveryNote", undefined, ids(300)).values.length;
  check("§1 ⭐ bağlı değer sayısı kimlik sayısından bağımsız", v3 === v300, `3 kimlik=${v3} · 300 kimlik=${v300}`);

  const itemId = (await prisma.item.create({ data: { code: `${TAG}-MM`, name: `${TAG} mal`, itemType: "FABRIC", unit: "MT" }, select: { id: true } })).id;
  made.items.push(itemId);
  const shipped = await mkNotes(itemId, 1, true);
  const stuckA = await mkNotes(itemId, 3, false);
  const tur = () => findRetentionCandidates("DELETE_ON_DISPATCH", 5000, null);

  console.log("§2 sorgu sayısı takılı belge sayısından bağımsız");
  await tur(); // ısınma (Prisma bağlantı/hazırlık sorguları sayılmasın)
  const a = await measure(tur);
  const stuckB = await mkNotes(itemId, 250, false);
  const b = await measure(tur);
  const stuckCount = await prisma.customerDeliveryNote.count({
    where: { id: { in: [...stuckA.noteIds, ...stuckB.noteIds] }, status: "APPROVED", scans: { some: { contentState: "FULL" } } },
  });
  check("§2 körlük zemini: 253 takılı belge aday taramasında (APPROVED + TAM fotoğraf)", stuckCount === 253, `n=${stuckCount}`);
  check("§2 körlük zemini: tur sorgu atıyor", a.n > 0, `n=${a.n}`);
  check("§2 ⭐ tur sorgu sayısı takılı belge 3 → 253'te sabit", a.n === b.n, `3 takılı=${a.n} · 253 takılı=${b.n}`);

  console.log("§3 sonuç değişmedi");
  const stuckScans = new Set([...stuckA.scanIds, ...stuckB.scanIds]);
  check("§3 tam sevkli belgenin taraması aday", b.out.includes(shipped.scanIds[0]!), `aday=${b.out.length}`);
  check("§3 takılı belgelerin taraması aday değil", !b.out.some((id) => stuckScans.has(id)));
}

async function cleanup(): Promise<void> {
  await prisma.documentScan.deleteMany({ where: { noteId: { in: made.notes } } });
  await prisma.customerDeliveryNote.deleteMany({ where: { id: { in: made.notes } } });
  await prisma.roll.deleteMany({ where: { id: { in: made.rolls } } });
  await prisma.item.deleteMany({ where: { id: { in: made.items } } });
}

async function main(): Promise<void> {
  console.log("=== K28 sevkte silme aday taraması sorgu bütçesi bekçisi ===\n");
  try {
    await run();
  } catch (e) {
    fail++;
    console.error("HATA:", e);
  } finally {
    await cleanup().catch((e) => check("temizlik", false, (e as Error).message.replace(/\s+/g, " ").slice(0, 300)));
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız === (test verisi temizlendi)`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exitCode = fail > 0 ? 1 : 0;
  }
}

if (!engel) void main();
else void prisma.$disconnect();
