// =============================================================================
// Bekçi: DONMUŞ BELGENİN YUVARLAMA DAMGASI — yeniden baskı aslının aynısı (DB ister)
// Çalıştır: DATABASE_URL='postgresql://…/<ad>_test' npx tsx scripts/test_belge_yuvarlama_damgasi.ts
// =============================================================================
// Ticari yuvarlama (2026-09-26) yalnız DAMGALI zarfa uygulanır; damgasız (eski) donmuş
// belge her baskıda eski yuvarlamayla çizilir. Bu dosya bunu servisin GERÇEK baskı
// yolundan ölçer (`printedDocumentService.getHtml` / `getTables`):
//   §1 damgasız belge: PDF ve Excel eski haneyi basar
//   §2 ⭐ damgasız belge "Güncel şablonla bas" (`useCurrentConfig`) yolunda da eski haneyi
//      basar — o yol görünüm katmanını (şablon + firma) canlı çözer, damgayı TAZELEMEZ
//   §3 damgalı belge iki yolda da ticari yuvarlar
// DB'siz çekirdek (yardımcı, renderer'lar, AST kapıları): `test_belge_ticari_yuvarlama.ts`.
//
// Fikstür: iki `PrintedDocument` satırı (kaynağı olmayan rastgele `sourceId`, belge no
// `TEST-YUV-…`), `temizle()` finally'de siler.
// Gerekli mi: §2 doğduğu gün gerçek bir kusuru ölçüyordu — `useCurrentConfig` taze zarfı
// olduğu gibi kullanıyordu; damga eklenince eski belgeyi yeni kurala taşırdı. Düzeltme
// aynı commit'te.
// Sonda (✓B1, bu commit; md5 ile geri alındı): `resolveRenderInputs`te eski satır
// (`snapshot = { ...fresh, frozenAt: snapshot.frozenAt }`) geri kondu → §2 2 ❌.
// =============================================================================
import { randomUUID } from "node:crypto";
import { PrintedDocType, Prisma } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import "../src/services/shipping.service";
import { printedDocumentService } from "../src/services/printed-document.service";
import { SAMPLE_PRINTED_DOCS, setSampleClock } from "../src/services/document-render/sample-data";
import { NUMBER_ROUNDING_HALF_UP } from "../src/services/document-render/fmt-num";
import { fixtureHedefEngeli, hedefDbEngeli } from "./lib/hedef-db-kapisi";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
}

setSampleClock(() => new Date("2026-09-25T08:30:00.000Z"));
const TYPE = PrintedDocType.SHIPMENT_DISPATCH;
const TS = Date.now();
const olusan: string[] = [];

/** Çeki satırlarının metresi 112,345: eski `toFixed` "112,34", ticari "112,35" basar. */
function belge(damgali: boolean): Prisma.InputJsonValue {
  const doc = JSON.parse(JSON.stringify(SAMPLE_PRINTED_DOCS.SHIPMENT_DISPATCH)) as { cekiRows: Array<Record<string, unknown>> };
  doc.cekiRows = doc.cekiRows.map((r) => ({ ...r, meters: 112.345 }));
  return {
    schemaVersion: 1,
    frozenAt: "2026-09-25T08:30:00.000Z",
    company: { name: "Deneme Tekstil", letterhead: {}, logoHash: null },
    docConfigOverride: null,
    doc,
    ...(damgali ? { numberRounding: NUMBER_ROUNDING_HALF_UP } : {}),
  } as unknown as Prisma.InputJsonValue;
}

async function fikstur(damgali: boolean): Promise<string> {
  const sourceId = randomUUID();
  const row = await prisma.printedDocument.create({
    data: { docType: TYPE, sourceId, version: 1, documentNo: `TEST-YUV-${TS}-${damgali ? "D" : "E"}`, snapshot: belge(damgali) },
    select: { id: true },
  });
  olusan.push(row.id);
  return sourceId;
}

async function temizle(): Promise<void> {
  if (olusan.length) await prisma.printedDocument.deleteMany({ where: { id: { in: olusan } } });
}

async function basilan(sourceId: string, guncel: boolean): Promise<{ html: string; hucre: unknown[] }> {
  const opts = guncel ? { useCurrentConfig: true } : undefined;
  const h = await printedDocumentService.getHtml(TYPE, sourceId, undefined, opts);
  const t = await printedDocumentService.getTables(TYPE, sourceId, undefined, opts);
  const tablolar = (t.data as { tables: Array<{ rows: unknown[][] }> } | null)?.tables ?? [];
  return { html: h.data?.html ?? "", hucre: tablolar.flatMap((x) => x.rows.flat()) };
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli() ?? fixtureHedefEngeli();
  if (engel) {
    check("hedef DB fixture DB'si", false, engel);
    return;
  }
  const eski = await fikstur(false);
  const yeni = await fikstur(true);

  console.log("§1 Damgasız (eski) donmuş belge — aslı gibi basılır");
  {
    const b = await basilan(eski, false);
    check("PDF '112,34' (eski yuvarlama), '112,35' YOK", b.html.includes(">112,34<") && !b.html.includes(">112,35<"));
    check("Excel 112.34", b.hucre.includes(112.34) && !b.hucre.includes(112.35));
  }

  console.log("§2 ⭐ Damgasız belge \"Güncel şablonla bas\" — görünüm tazelenir, yuvarlama DEĞİŞMEZ");
  {
    const b = await basilan(eski, true);
    check("PDF '112,34' (damga taze zarftan gelmez)", b.html.includes(">112,34<") && !b.html.includes(">112,35<"));
    check("Excel 112.34", b.hucre.includes(112.34) && !b.hucre.includes(112.35));
  }

  console.log("§3 Damgalı belge — iki yolda da ticari yuvarlama");
  {
    const b = await basilan(yeni, false);
    const g = await basilan(yeni, true);
    check("PDF '112,35' · Excel 112.35", b.html.includes(">112,35<") && !b.html.includes(">112,34<") && b.hucre.includes(112.35));
    check("\"Güncel şablonla bas\": PDF '112,35' · Excel 112.35", g.html.includes(">112,35<") && !g.html.includes(">112,34<") && g.hucre.includes(112.35));
  }
}

main()
  .catch((e: unknown) => {
    fail++;
    console.log(`  ❌ beklenmeyen hata — ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(async () => {
    try {
      await temizle();
    } catch (e) {
      fail++;
      console.log(`  ❌ temizlik — ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  });
