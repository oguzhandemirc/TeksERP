// =============================================================================
// TEST: Fason seçici kategori süzgeci (2026-11-19) — GET /api/subcontractors
// `filter[categoryId]` sunucuda süzer (tek/CSV), tanınmayan değer 400
// `SUBCONTRACTOR_CATEGORY_FILTER_INVALID`, cursor kipi (`mode=cursor`) aynı where ile sayfalar.
// Koşum: npx tsx scripts/test_subcontractor_category_filter.ts
// =============================================================================
import type { Request } from "express";
import prisma from "../src/lib/prisma";
import { SubcontractorManagementService } from "../src/services/subcontractor-management.service";
import { AppError } from "../src/utils/app-error";

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
const svc = new SubcontractorManagementService();
const stamp = Date.now().toString(36).toUpperCase();
const fakeReq = (query: Record<string, unknown>) => ({ query } as unknown as Request);
type Row = { id: string };
type CursorRes = { data: Row[]; pagination: { nextCursor: string | null; hasMore: boolean; limit: number; totalEstimate?: number } };
type PageRes = { data: Row[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
const ids = (rows: Row[]) => new Set(rows.map((r) => r.id));
const eqSet = (a: Set<string>, b: string[]) => a.size === b.length && b.every((x) => a.has(x));
const code400 = (e: unknown) => e instanceof AppError && e.statusCode === 400 ? String((e.details as { code?: string } | undefined)?.code) : `yok(${String(e)})`;

async function main(): Promise<void> {
  const cA = await prisma.subcontractorCategory.create({ data: { code: `TEST-CF-A-${stamp}`, name: `T Devere ${stamp}` } });
  const cB = await prisma.subcontractorCategory.create({ data: { code: `TEST-CF-B-${stamp}`, name: `T Dokuma ${stamp}` } });
  const cEmpty = await prisma.subcontractorCategory.create({ data: { code: `TEST-CF-E-${stamp}`, name: `T Bos ${stamp}` } });
  const subIds: string[] = [];
  try {
    const mk = async (n: string, cats: string[]) => {
      const r = await svc.create({ code: `TEST-CF-${n}-${stamp}`, name: `T Fason CF ${n} ${stamp}`, categoryIds: cats }, undefined);
      const id = (r.data as Row).id;
      subIds.push(id);
      return id;
    };
    const s1 = await mk("1", [cA.id]);
    const s2 = await mk("2", [cA.id, cB.id]);
    const s3 = await mk("3", [cB.id]);
    const s4 = await mk("4", []);

    // §1 tek kategori → yalnız o kategoridekiler
    const r1 = (await svc.findAll(fakeReq({ "filter[categoryId]": cA.id, pageSize: "100" }))) as PageRes;
    check("§1 tek kategori yalnız {s1,s2}", eqSet(ids(r1.data), [s1, s2]), `${r1.data.length} satır`);
    check("§1b sayfa kipi şekli bayt-eşit (page/pageSize/total/totalPages)", r1.pagination.page === 1 && r1.pagination.total === 2 && r1.pagination.totalPages === 1);

    // §2 CSV iki kategori → birleşim, kategorisiz firma yok
    const r2 = (await svc.findAll(fakeReq({ "filter[categoryId]": `${cA.id},${cB.id}`, pageSize: "100" }))) as PageRes;
    check("§2 CSV {A,B} → {s1,s2,s3} (s4 kategorisiz dışarıda)", eqSet(ids(r2.data), [s1, s2, s3]) && !ids(r2.data).has(s4));

    // §2b atanmış fasonu olmayan kategori → 0 satır, hata değil (panel uyarı + tümünü göster buna dayanır)
    const r2b = (await svc.findAll(fakeReq({ "filter[categoryId]": cEmpty.id }))) as PageRes;
    check("§2b boş kategori → 0 satır, total 0", r2b.data.length === 0 && r2b.pagination.total === 0);

    // §3 uuid olmayan değer → 400 kodlu
    const e3 = await svc.findAll(fakeReq({ "filter[categoryId]": "DEVERE" })).then(() => null, (e: unknown) => e);
    check("§3 uuid olmayan → 400 SUBCONTRACTOR_CATEGORY_FILTER_INVALID", code400(e3) === "SUBCONTRACTOR_CATEGORY_FILTER_INVALID", code400(e3));
    const e3b = await svc.findAll(fakeReq({ "filter[categoryId]": `${cA.id},xyz` })).then(() => null, (e: unknown) => e);
    check("§3b CSV içinde bozuk değer → 400", code400(e3b) === "SUBCONTRACTOR_CATEGORY_FILTER_INVALID", code400(e3b));

    // §4 biçimce geçerli ama DB'de olmayan uuid → 400 (sessiz 0 satır değil)
    const e4 = await svc.findAll(fakeReq({ "filter[categoryId]": "00000000-0000-4000-8000-000000000000" })).then(() => null, (e: unknown) => e);
    check("§4 olmayan kategori → 400 SUBCONTRACTOR_CATEGORY_FILTER_INVALID", code400(e4) === "SUBCONTRACTOR_CATEGORY_FILTER_INVALID", code400(e4));

    // §5 cursor kipi: limit=2 ile sayfalar; birleşim = sayfa kipi kümesi; totalEstimate yalnız withTotal
    const q = { "filter[categoryId]": `${cA.id},${cB.id}`, mode: "cursor", limit: "2", sortBy: "name", sortOrder: "asc" };
    const p1 = (await svc.findAll(fakeReq({ ...q, withTotal: "true" }))) as CursorRes;
    check("§5a ilk sayfa 2 satır + hasMore + nextCursor", p1.data.length === 2 && p1.pagination.hasMore && !!p1.pagination.nextCursor);
    check("§5b withTotal → totalEstimate=3", p1.pagination.totalEstimate === 3, String(p1.pagination.totalEstimate));
    const p2 = (await svc.findAll(fakeReq({ ...q, cursor: p1.pagination.nextCursor }))) as CursorRes;
    check("§5c ikinci sayfa 1 satır, hasMore=false, totalEstimate yok", p2.data.length === 1 && !p2.pagination.hasMore && p2.pagination.nextCursor === null && p2.pagination.totalEstimate === undefined);
    check("§5d sayfalar birleşimi = {s1,s2,s3}, tekrar yok", eqSet(new Set([...ids(p1.data), ...ids(p2.data)]), [s1, s2, s3]) && p1.data.length + p2.data.length === 3);
    const pCat = (await svc.findAll(fakeReq({ "filter[categoryId]": cB.id, mode: "cursor", limit: "50" }))) as CursorRes;
    check("§5e cursor kipinde de kategori süzülür ({s2,s3})", eqSet(ids(pCat.data), [s2, s3]));
    const eCur = await svc.findAll(fakeReq({ "filter[categoryId]": "bozuk", mode: "cursor" })).then(() => null, (e: unknown) => e);
    check("§5f cursor kipinde bozuk süzgeç de 400", code400(eCur) === "SUBCONTRACTOR_CATEGORY_FILTER_INVALID");
  } finally {
    if (subIds.length > 0) {
      await prisma.subcontractorToCategory.deleteMany({ where: { subcontractorId: { in: subIds } } });
      await prisma.cariAccount.deleteMany({ where: { subcontractorId: { in: subIds } } });
      await prisma.subcontractor.deleteMany({ where: { id: { in: subIds } } });
    }
    await prisma.subcontractorCategory.deleteMany({ where: { id: { in: [cA.id, cB.id, cEmpty.id] } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  }
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exitCode = 1; });
