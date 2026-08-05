// =============================================================================
// BEKÇİ: İş emri belge listesi — GET /work-orders/:id/documents
// Çalıştır: npx tsx scripts/test_workorder_documents.ts
// =============================================================================
// KİLİTLENEN KURAL: "Bir iş emrine tıklayınca TÜM belgelerine ulaşılır ve
// yazdırılır." Belgeler dört ayrı kaynakta yaşıyor (TravelerCard + üç
// PrintedDocument tipi) ve `findById` yalnız `steps[].dispatches`'i taşıyordu:
// fason KABUL MAKBUZU ve FASONDAN DOĞRUDAN SEVK irsaliyesi hiçbir istemciden
// ulaşılamıyordu — belge vardı, kapısı yoktu.
//
// Üç ayrı cephe doğrulanır:
//   1) Liste her kaynağı buluyor mu (kapsam),
//   2) Listedeki HER satır gerçekten BASILABİLİYOR mu (liste ↔ baskı hizası —
//      görünüp basılamayan belge sessiz bir 403/500 kapanıdır),
//   3) İptal edilmiş belge listede KALIYOR mu (donmuş belge silinmez).
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { PrintedDocType } from "@prisma/client";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { printedDocumentService } from "../src/services/printed-document.service";
// Belge builder'ları modül yan-etkisiyle kaydolur — import ŞART (yoksa
// "Belge builder kayıtlı değil" ile patlar).
import "../src/services/subcontractor.service";
// Baskı ucundaki belge-tipi izin haritası — liste ile hizalı mı diye okunur.
import { DOC_PERMISSIONS } from "../src/routes/printed-document.routes";

let pass = 0;
let fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`);
  }
}

interface DocRow {
  docType: string;
  sourceId: string;
  documentNo: string;
  date: string;
  group: string;
  title: string;
  subtitle: string;
  cancelled: boolean;
  contentDirty?: boolean;
}

const svc = new WorkOrderService();
const cardSvc = new TravelerCardService();

async function listDocs(workOrderId: string): Promise<DocRow[]> {
  const res = (await svc.getDocuments(workOrderId)) as unknown as {
    data: { documents: DocRow[] };
  };
  return res.data.documents;
}

/** Belgeyi gerçekten render et — "listede var ama basılamıyor" durumunu yakalar. */
async function renderable(d: DocRow): Promise<boolean> {
  try {
    const html =
      d.docType === "TRAVELER_CARD"
        ? await cardSvc.getCardHtml(d.sourceId)
        : ((await printedDocumentService.getHtml(d.docType as PrintedDocType, d.sourceId)).data
            ?.html ?? "");
    return /^<!doctype html>/i.test(html) && html.length > 500;
  } catch {
    return false;
  }
}

// ── 1) Kapsam: fason sevki OLAN gerçek bir WO ───────────────────────────────
async function testCoverage(): Promise<string | null> {
  console.log("\n── 1) Kapsam (fason sevkli iş emri) ──");
  const d = await prisma.subcontractorDispatch.findFirst({
    orderBy: { dispatchedAt: "desc" },
    select: { workOrderId: true },
  });
  if (!d) {
    // Ortamdaki veriye bağımlı OLMAMA kuralı: veri yoksa test ATLANIR ama
    // sessizce GEÇMİŞ sayılmaz — kullanıcıya neden atlandığı söylenir.
    console.log("  ⚠ dev DB'de fason sevk yok — kapsam bölümü atlandı");
    return null;
  }
  const docs = await listDocs(d.workOrderId);
  check("liste boş değil", docs.length > 0);
  check(
    "refakat kartı listede",
    docs.some((x) => x.docType === "TRAVELER_CARD"),
    "iş emri belgesi her zaman ilk grupta",
  );
  check(
    "fason sevk irsaliyesi listede",
    docs.some((x) => x.docType === "SUBCONTRACTOR_DISPATCH"),
  );
  check("kart İLK sırada", docs[0]?.docType === "TRAVELER_CARD", "sahada en çok basılan");

  for (const x of docs) {
    check(`alanlar dolu: ${x.title}`, Boolean(x.sourceId && x.documentNo && x.date && x.group));
  }
  return d.workOrderId;
}

// ── 2) Liste ↔ baskı hizası: HER satır basılabilmeli ────────────────────────
async function testPrintable(workOrderId: string | null): Promise<void> {
  console.log("\n── 2) Listedeki her belge BASILABİLİYOR mu ──");
  if (!workOrderId) {
    console.log("  ⚠ kapsam bölümü atlandı — bu bölüm de atlanıyor");
    return;
  }
  const docs = await listDocs(workOrderId);
  for (const x of docs) {
    check(`${x.title} (${x.documentNo}) render ediliyor`, await renderable(x));
  }
}

// ── 3) Kabul makbuzu — ASIL EKSİK OLAN belge ────────────────────────────────
// Kendi WO'sunu aramak yerine sistemde HERHANGİ bir kabul varsa onun WO'sunu
// kullanır: bu belge tipinin listeye GİRDİĞİNİ kanıtlamak için yeterli.
async function testReceiptReachable(): Promise<void> {
  console.log("\n── 3) Fason kabul makbuzu ulaşılabilir mi (eski kör nokta) ──");
  const r = await prisma.subcontractorReceipt.findFirst({
    orderBy: { receivedAt: "desc" },
    select: { workOrderId: true, receiptNo: true },
  });
  if (!r) {
    console.log("  ⚠ dev DB'de fason kabul yok — atlandı");
    return;
  }
  const docs = await listDocs(r.workOrderId);
  const hit = docs.find((x) => x.docType === "SUBCONTRACTOR_RECEIPT" && x.documentNo === r.receiptNo);
  check("kabul makbuzu listede", Boolean(hit), r.receiptNo);
  if (hit) check("kabul makbuzu basılabiliyor", await renderable(hit));
}

// ── 4) İzin hizası — listede görünen her tip BASILABİLİR izinlere sahip mi ──
// Liste izni `mobile:hizli-is-emri`yi kabul ediyor; baskı ucu belge-tipi bazlı
// gate uyguluyor. İkisi ayrışırsa operatör satıra basar ve HİÇBİR ŞEY olmaz.
function testPermissionAlignment(): void {
  console.log("\n── 4) Liste ↔ baskı İZİN hizası ──");
  const listRoles = ["workorder:read", "mobile:hizli-is-emri", "mobile:fason-sevk", "mobile:fason-kabul"];
  const docTypes = ["SUBCONTRACTOR_DISPATCH", "SUBCONTRACTOR_RECEIPT", "SUBCONTRACTOR_DIRECT_SHIP"];
  for (const dt of docTypes) {
    const read = DOC_PERMISSIONS[dt]?.read ?? [];
    for (const role of listRoles) {
      check(
        `${dt} ← ${role}`,
        read.includes(role),
        "listeyi görebilen bu belgeyi basabilmeli",
      );
    }
  }
}

// ── 5) İptal edilmiş belge listede KALIR ────────────────────────────────────
async function testCancelledKept(): Promise<void> {
  console.log("\n── 5) İptal edilmiş belge listede kalır ──");
  const cancelled = await prisma.subcontractorDispatch.findFirst({
    where: { cancelledAt: { not: null } },
    orderBy: { dispatchedAt: "desc" },
    select: { workOrderId: true, dispatchNo: true },
  });
  if (!cancelled) {
    console.log("  ⚠ dev DB'de iptal edilmiş sevk yok — atlandı");
    return;
  }
  const docs = await listDocs(cancelled.workOrderId);
  const hit = docs.find((x) => x.documentNo === cancelled.dispatchNo);
  check("iptal edilen sevkin belgesi listede DURUYOR", Boolean(hit), "donmuş belge silinmez");
  check("cancelled bayrağı işaretli", hit?.cancelled === true, "istemci İPTAL rozetiyle ayırır");
}

// ── 6) Bilinmeyen iş emri ───────────────────────────────────────────────────
async function testNotFound(): Promise<void> {
  console.log("\n── 6) Bilinmeyen iş emri ──");
  let threw = false;
  try {
    await svc.getDocuments("00000000-0000-0000-0000-000000000000");
  } catch {
    threw = true;
  }
  check("bilinmeyen WO → hata", threw, "sessiz boş liste DEĞİL");
}

async function main(): Promise<void> {
  try {
    const woId = await testCoverage();
    await testPrintable(woId);
    await testReceiptReachable();
    testPermissionAlignment();
    await testCancelledKept();
    await testNotFound();
  } catch (e) {
    fail++;
    console.log(`  ✗ BEKLENMEYEN HATA: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof Error && e.stack) console.log(e.stack);
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exitCode = fail > 0 ? 1 : 0;
}

void main();
