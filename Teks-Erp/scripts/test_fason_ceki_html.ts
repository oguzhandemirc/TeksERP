// =============================================================================
// UNIT TEST: Fason çeki "KUMAŞ İRSALİYESİ" HTML renderer (saf fonksiyon)
// Çalıştır: npx tsx scripts/test_fason_ceki_html.ts
// =============================================================================
// Gerçek DB/sunucu GEREKMEZ — renderFasonCekiHtml saf: snapshot → HTML string.
// Tüm cihazlar (mobil + Electron) bunu basar; format regresyonlarını anında yakalar.
// =============================================================================
import { renderFasonCekiHtml } from "../src/services/document-render/fason-ceki.html";

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

// renderFasonCekiHtml(snapshot, meta) — snapshot tipini gevşek kurarız (test fixture).
type AnySnap = Parameters<typeof renderFasonCekiHtml>[0];

function roll(seq: number, qty: number, width: number | null, extra: Partial<Record<string, unknown>> = {}) {
  return {
    sequence: seq,
    barcode: `BC${seq}`,
    itemCode: "PATOS",
    itemName: "PATOS",
    colorCode: null,
    colorName: null,
    dispatchedQty: qty,
    dispatchedWeight: null,
    qualityGrade: "1.KALITE",
    width,
    ...extra,
  };
}

function makeSnap(over: {
  doc?: Record<string, unknown>;
  rolls?: ReturnType<typeof roll>[];
  company?: Record<string, unknown>;
  docConfigOverride?: Record<string, unknown> | null;
} = {}): AnySnap {
  const rolls = over.rolls ?? [roll(1, 115, 150), roll(2, 100, 150), roll(3, 83, 150)];
  const totalQty = rolls.reduce((s, r) => s + r.dispatchedQty, 0);
  return {
    schemaVersion: 1,
    frozenAt: "2026-06-19T10:00:00.000Z",
    company: { name: "Adnan Şahin Tekstil", letterhead: { addressLine: "", phone: "", taxInfo: "" }, ...over.company },
    docConfigOverride: over.docConfigOverride ?? null,
    doc: {
      dispatchNo: "SD2606000013",
      dispatchedAt: "2026-06-19T10:00:00.000Z",
      driverName: null,
      plateNumber: null,
      notes: null,
      workOrder: { id: "wo1", batchNumber: "P-260619-001", type: "STOCK_PRODUCTION" },
      subcontractor: { id: "s1", name: "Boyer Boyacılık", code: "BOYER" },
      requestedColor: "BEYAZ",
      instruction: null,
      step: { stepSequence: 1, station: { name: "Boyahane", code: "BOYA" } },
      rolls,
      totals: { rollCount: rolls.length, totalQty, totalWeight: 0 },
      ...over.doc,
    },
  } as unknown as AnySnap;
}

function countOccur(hay: string, needle: string): number {
  return hay.split(needle).length - 1;
}

// ── 1) Temel yapı + fotoğraf örneği (115/100/83 → 298) ──────────────────────
function testBasic(): void {
  console.log("\n── 1) Temel yapı / fotoğraf örneği ──");
  const html = renderFasonCekiHtml(makeSnap());
  check("doctype + html", html.startsWith("<!doctype html>") && html.includes("</html>"));
  check("başlık KUMAŞ İRSALİYESİ", html.includes("KUMAŞ İRSALİYESİ"));
  check("gönderen firma (antet)", html.includes("Adnan Şahin Tekstil"));
  check("SAYIN = fason firma", html.includes("Boyer Boyacılık"));
  check("İrsaliye No = dispatchNo", html.includes("SD2606000013"));
  check("Tarih DD.MM.YYYY", html.includes("19.06.2026"), "fmtDate");
  check("grid başlıkları Top/Metre/Cm", html.includes(">Top<") && html.includes(">Metre<") && html.includes(">Cm<"));
  check("metreler 115/100/83", html.includes(">115<") && html.includes(">100<") && html.includes(">83<"));
  check("en (cm) 150", html.includes(">150<"));
  check("toplam METRE 298", html.includes(">298<"), "115+100+83");
  check("CİNSİ ürün adı PATOS", html.includes("PATOS"));
  check("istenen renk (hedef) BEYAZ", html.includes("BEYAZ"));
  check("TOPLAM satırı", html.includes("TOPLAM"));
  check("FİYATI/TUTARI başlıkları (boş kolon)", html.includes("FİYATI") && html.includes("TUTARI"));
}

// ── 2) 100 hücreli grid yapısı ──────────────────────────────────────────────
function testGrid(): void {
  console.log("\n── 2) 100 hücreli grid (5×20) ──");
  const html = renderFasonCekiHtml(makeSnap());
  // Sıra no'ları: slot 1..100 (boş hücreler bile numaralı). Köşe değerleri:
  check("slot 1 var", html.includes(">1<"));
  check("slot 20 var", html.includes(">20<"));
  check("slot 21 var (2. grup)", html.includes(">21<"));
  check("slot 100 var", html.includes(">100<"));
  check("slot 101 YOK (tek sayfa)", !html.includes(">101<"));
  check("tek grid tablosu", countOccur(html, '<table class="grid"') === 1);
}

// ── 3) Çok sayfa (>100 top) ─────────────────────────────────────────────────
function testMultiPage(): void {
  console.log("\n── 3) Çok sayfa (150 top → 2 grid) ──");
  const rolls = Array.from({ length: 150 }, (_, i) => roll(i + 1, 50, 150));
  const html = renderFasonCekiHtml(makeSnap({ rolls }));
  check("2 grid sayfası", countOccur(html, '<table class="grid"') === 2);
  check("slot 150 var", html.includes(">150<"));
  check("toplam 150 top", html.includes(">150<"));
}

// ── 4) Sayı/tarih formatlama kenar durumları ────────────────────────────────
function testFormatting(): void {
  console.log("\n── 4) Formatlama kenar durumları ──");
  const html = renderFasonCekiHtml(
    makeSnap({ rolls: [roll(1, 100.5, 148), roll(2, 90, null)] }),
  );
  check("ondalık 100.5 korunur", html.includes(">100.5<"));
  check("tam sayı 90 ondalıksız", html.includes(">90<") && !html.includes(">90.0<"));
  check("yuvarlanan en 148", html.includes(">148<"));
  const badDate = renderFasonCekiHtml(makeSnap({ doc: { dispatchedAt: "gecersiz" } }));
  check("geçersiz tarih → boş (çökmez)", typeof badDate === "string" && badDate.length > 100);
}

// ── 5) Filigranlar (draft / void / superseded) ──────────────────────────────
function testWatermarks(): void {
  console.log("\n── 5) Filigranlar ──");
  check("draft → TASLAK", renderFasonCekiHtml(makeSnap(), { draft: true }).includes("TASLAK"));
  check("VOIDED → İPTAL", renderFasonCekiHtml(makeSnap(), { status: "VOIDED" }).includes("İPTAL"));
  check("SUPERSEDED → ESKİ KOPYA", renderFasonCekiHtml(makeSnap(), { status: "SUPERSEDED" }).includes("ESKİ KOPYA"));
  check("ACTIVE → filigran yok", !renderFasonCekiHtml(makeSnap(), { status: "ACTIVE" }).includes("TASLAK"));
}

// ── 6) HTML escaping (XSS koruması) ─────────────────────────────────────────
function testEscaping(): void {
  console.log("\n── 6) HTML escaping ──");
  const html = renderFasonCekiHtml(
    makeSnap({ doc: { subcontractor: { id: "s", name: "A & <script>B</script>", code: null } } }),
  );
  check("özel karakter escape edildi", html.includes("&lt;script&gt;") && !html.includes("<script>B"));
  check("& → &amp;", html.includes("A &amp;"));
}

// ── 7) Fason talimatı (instruction) + sections toggle ───────────────────────
function testInstruction(): void {
  console.log("\n── 7) Fason talimatı bloğu ──");
  const withInstr = renderFasonCekiHtml(makeSnap({ doc: { instruction: "yıkama yapma, matlaştır" } }));
  check("talimat varsa basılır", withInstr.includes("FASON TALİMATI") && withInstr.includes("yıkama yapma"));
  const noInstr = renderFasonCekiHtml(makeSnap({ doc: { instruction: null } }));
  check("talimat yoksa blok yok", !noInstr.includes("FASON TALİMATI"));
  const off = renderFasonCekiHtml(
    makeSnap({ doc: { instruction: "x" }, docConfigOverride: { sections: { dyehouseNote: false } } }),
  );
  check("sections.dyehouseNote=false → gizli", !off.includes("FASON TALİMATI"));
}

// ── 8) docConfig override (başlık/antet/imza) ───────────────────────────────
function testDocConfig(): void {
  console.log("\n── 8) docConfig override ──");
  const t = renderFasonCekiHtml(makeSnap({ docConfigOverride: { titleOverride: "SEVK FİŞİ" } }));
  check("titleOverride uygulanır", t.includes("SEVK FİŞİ"));
  const noLh = renderFasonCekiHtml(
    makeSnap({ company: { letterhead: { addressLine: "Adres X", phone: "555", taxInfo: "VD1" } }, docConfigOverride: { showLetterhead: false } }),
  );
  check("showLetterhead=false → adres basılmaz", !noLh.includes("Adres X"));
  const noSign = renderFasonCekiHtml(makeSnap({ docConfigOverride: { showSignatures: false } }));
  check("showSignatures=false → imza yok", !noSign.includes("Teslim Eden"));
  const sign = renderFasonCekiHtml(makeSnap());
  check("varsayılan imzalar", sign.includes("Teslim Eden") && sign.includes("Teslim Alan"));
}

// ── 9) Renk yedeği (requestedColor yoksa rol rengi) ─────────────────────────
function testColorFallback(): void {
  console.log("\n── 9) Renk yedeği ──");
  const noReq = renderFasonCekiHtml(
    makeSnap({ doc: { requestedColor: null }, rolls: [roll(1, 50, 150, { colorName: "LACİVERT" })] }),
  );
  check("requestedColor yoksa rol rengi", noReq.includes("LACİVERT"));
}

function main(): void {
  testBasic();
  testGrid();
  testMultiPage();
  testFormatting();
  testWatermarks();
  testEscaping();
  testInstruction();
  testDocConfig();
  testColorFallback();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
