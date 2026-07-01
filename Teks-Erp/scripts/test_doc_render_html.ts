// =============================================================================
// UNIT TEST: yeni belge HTML renderer'ları (saf fonksiyonlar)
//   - renderKartelaCekiHtml      (kartela çeki listesi)
//   - renderFasonDirectShipHtml  (fasondan doğrudan sevk irsaliyesi)
//   - renderTravelerCardHtml     (refakat kartı)
// Çalıştır: npx tsx scripts/test_doc_render_html.ts
// =============================================================================
// Gerçek DB/sunucu GEREKMEZ — hepsi saf: (snapshot, meta) → HTML string. Tüm
// cihazlar (mobil + Electron) bu backend HTML'ini basar → format her yerde aynı;
// bu test format regresyonlarını anında yakalar.
// =============================================================================
import { renderKartelaCekiHtml } from "../src/services/document-render/kartela-ceki.html";
import { renderFasonDirectShipHtml } from "../src/services/document-render/fason-direct-ship.html";
import { renderTravelerCardHtml } from "../src/services/document-render/traveler-card.html";

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

// =============================================================================
// 1) KARTELA ÇEKİ LİSTESİ
// =============================================================================
type KartelaSnap = Parameters<typeof renderKartelaCekiHtml>[0];

function kartelaRoll(seq: number, qty: number, over: Record<string, unknown> = {}) {
  return {
    sequence: seq,
    barcode: `KR${seq}`,
    itemCode: "KMS-001",
    itemName: "Pamuklu Astar",
    colorCode: "BEJ",
    colorName: "Bej",
    dispatchedQty: qty,
    dispatchedWeight: 1.2,
    qualityGrade: "A",
    width: 150,
    ...over,
  };
}

function kartelaSnap(over: {
  doc?: Record<string, unknown>;
  rolls?: ReturnType<typeof kartelaRoll>[];
  company?: Record<string, unknown>;
  docConfigOverride?: Record<string, unknown> | null;
} = {}): KartelaSnap {
  const rolls = over.rolls ?? [kartelaRoll(1, 6), kartelaRoll(2, 6)];
  const totalQty = rolls.reduce((s, r) => s + r.dispatchedQty, 0);
  return {
    schemaVersion: 1,
    frozenAt: "2026-06-19T10:00:00.000Z",
    company: { name: "Adnan Şahin Tekstil", letterhead: { addressLine: "", phone: "", taxInfo: "" }, ...over.company },
    docConfigOverride: over.docConfigOverride ?? null,
    doc: {
      dispatchNo: "KRT-2026-0058",
      dispatchedAt: "2026-06-19T10:00:00.000Z",
      driverName: "Hasan Kaya",
      plateNumber: "06 KRT 060",
      notes: null,
      subcontractor: { id: "ks1", name: "Desen Kartela", code: "KF-01" },
      rolls,
      totals: { rollCount: rolls.length, totalQty, totalWeight: 2.3 },
      ...over.doc,
    },
  } as unknown as KartelaSnap;
}

function testKartela(): void {
  console.log("\n══ KARTELA ÇEKİ LİSTESİ ══");
  const html = renderKartelaCekiHtml(kartelaSnap());
  check("doctype + html", html.startsWith("<!doctype html>") && html.includes("</html>"));
  check("başlık KARTELA ÇEKİ LİSTESİ", html.includes("KARTELA ÇEKİ LİSTESİ"));
  check("firma anteti", html.includes("Adnan Şahin Tekstil"));
  check("KARTELA FİRMASI = subcontractor", html.includes("Desen Kartela"));
  check("Sevk No", html.includes("KRT-2026-0058"));
  check("Tarih DD.MM.YYYY", html.includes("19.06.2026"));
  check("top satırı (barkod + ürün)", html.includes("KR1") && html.includes("Pamuklu Astar"));
  check("TOPLAM satırı", html.includes("TOPLAM"));
  // watermarks
  check("draft → TASLAK", renderKartelaCekiHtml(kartelaSnap(), { draft: true }).includes("TASLAK"));
  check("VOIDED → İPTAL", renderKartelaCekiHtml(kartelaSnap(), { status: "VOIDED" }).includes("İPTAL"));
  check("SUPERSEDED → ESKİ KOPYA", renderKartelaCekiHtml(kartelaSnap(), { status: "SUPERSEDED" }).includes("ESKİ KOPYA"));
  check("ACTIVE → filigran yok", !renderKartelaCekiHtml(kartelaSnap(), { status: "ACTIVE" }).includes("TASLAK"));
  // escaping
  const esc = renderKartelaCekiHtml(kartelaSnap({ doc: { subcontractor: { id: "s", name: "X & <b>Y</b>", code: null } } }));
  check("escaping", esc.includes("&lt;b&gt;") && !esc.includes("<b>Y"));
  // sections toggles
  const noSub = renderKartelaCekiHtml(kartelaSnap({ docConfigOverride: { sections: { subcontractorInfo: false } } }));
  check("sections.subcontractorInfo=false → KARTELA FİRMASI gizli", !noSub.includes("KARTELA FİRMASI"));
  const noTable = renderKartelaCekiHtml(kartelaSnap({ docConfigOverride: { sections: { rollTable: false } } }));
  check("sections.rollTable=false → tablo gizli", !noTable.includes("Gönderilen Toplar"));
  // titleOverride + signatures
  check("titleOverride", renderKartelaCekiHtml(kartelaSnap({ docConfigOverride: { titleOverride: "ÖRNEK FİŞ" } })).includes("ÖRNEK FİŞ"));
  check("varsayılan imzalar", html.includes("Teslim Eden") && html.includes("Teslim Alan"));
  check("showSignatures=false → imza yok", !renderKartelaCekiHtml(kartelaSnap({ docConfigOverride: { showSignatures: false } })).includes("Teslim Eden"));
}

// =============================================================================
// 2) FASONDAN DOĞRUDAN SEVK İRSALİYESİ
// =============================================================================
type DirectSnap = Parameters<typeof renderFasonDirectShipHtml>[0];

function directSnap(over: { doc?: Record<string, unknown>; docConfigOverride?: Record<string, unknown> | null } = {}): DirectSnap {
  const rolls = [
    { sequence: 1, barcode: "R1", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: "BEJ", colorName: "Bej", dispatchedQty: 240, dispatchedWeight: 38, qualityGrade: "A", width: 150 },
    { sequence: 2, barcode: "R2", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorCode: "BEJ", colorName: "Bej", dispatchedQty: 260, dispatchedWeight: 41, qualityGrade: "A", width: 150 },
  ];
  return {
    schemaVersion: 1,
    frozenAt: "2026-06-19T10:00:00.000Z",
    company: { name: "Adnan Şahin Tekstil", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: over.docConfigOverride ?? null,
    doc: {
      directShip: true,
      dispatchNo: "DSF-2026-0012",
      directShippedAt: "2026-06-19T10:00:00.000Z",
      directShipReason: "Müşteri acil talep",
      directShippedBy: "Ayşe Kaya",
      dispatchedAt: "2026-06-19T10:00:00.000Z",
      driverName: "Ali Demir",
      plateNumber: "16 XYZ 789",
      notes: null,
      workOrder: { id: "wo1", batchNumber: "P-260619-014", type: "ORDER_PRODUCTION" },
      subcontractor: { id: "sub1", name: "Yıldız Boyahane", code: "FB-03" },
      step: { id: "st1", stepSequence: 2, station: { name: "Boyahane (Fason)", code: "DYE" } },
      rolls,
      allocations: [{ orderNumber: "SIP-2026-0107", itemCode: "KMS-001", itemName: "Pamuklu Astar", colorName: "Bej", qty: 500 }],
      totals: { rollCount: 2, totalQty: 500, totalWeight: 79 },
      ...over.doc,
    },
  } as unknown as DirectSnap;
}

function testDirectShip(): void {
  console.log("\n══ DOĞRUDAN SEVK İRSALİYESİ ══");
  const html = renderFasonDirectShipHtml(directSnap());
  check("doctype + html", html.startsWith("<!doctype html>") && html.includes("</html>"));
  check("başlık DOĞRUDAN SEVK İRSALİYESİ", html.includes("DOĞRUDAN SEVK İRSALİYESİ"));
  check("İrsaliye No", html.includes("DSF-2026-0012"));
  check("FASON FİRMA", html.includes("FASON FİRMA") && html.includes("Yıldız Boyahane"));
  check("iş emri batchNumber", html.includes("P-260619-014"));
  check("DOĞRUDAN SEVK kutusu (sebep + sevk eden)", html.includes("Müşteri acil talep") && html.includes("Ayşe Kaya"));
  check("Karşılanan Siparişler (allocations)", html.includes("Karşılanan Siparişler") && html.includes("SIP-2026-0107"));
  check("Sevk Edilen Toplar tablosu", html.includes("Sevk Edilen Toplar") && html.includes("R1"));
  check("TOPLAM 500 m", html.includes("500"));
  // section toggles aligned with DOC_DEF keys
  const noSub = renderFasonDirectShipHtml(directSnap({ docConfigOverride: { sections: { subcontractorInfo: false } } }));
  check("subcontractorInfo=false → FASON FİRMA gizli", !noSub.includes("FASON FİRMA"));
  const noDs = renderFasonDirectShipHtml(directSnap({ docConfigOverride: { sections: { directShipInfo: false } } }));
  check("directShipInfo=false → DOĞRUDAN SEVK kutusu gizli", !noDs.includes(">DOĞRUDAN SEVK<"));
  const noRoll = renderFasonDirectShipHtml(directSnap({ docConfigOverride: { sections: { rollTable: false } } }));
  check("rollTable=false → toplar gizli", !noRoll.includes("Sevk Edilen Toplar"));
  // empty allocations → bölüm yok
  const noAlloc = renderFasonDirectShipHtml(directSnap({ doc: { allocations: [] } }));
  check("allocations boş → bölüm yok", !noAlloc.includes("Karşılanan Siparişler"));
  // watermarks + escaping
  check("draft → TASLAK", renderFasonDirectShipHtml(directSnap(), { draft: true }).includes("TASLAK"));
  const esc = renderFasonDirectShipHtml(directSnap({ doc: { directShipReason: "A & <i>B</i>" } }));
  check("escaping", esc.includes("&lt;i&gt;") && !esc.includes("<i>B"));
}

// =============================================================================
// 3) REFAKAT KARTI
// =============================================================================
type TravelerSnap = Parameters<typeof renderTravelerCardHtml>[0];
type TravelerMeta = Parameters<typeof renderTravelerCardHtml>[1];

function travelerSnap(over: Record<string, unknown> = {}): TravelerSnap {
  return {
    batchNumber: "P-260619-014",
    type: "ORDER_PRODUCTION",
    width: 150,
    targetQuantity: 680,
    targetWeight: 110,
    foldType: "Top",
    plannedStartDate: "2026-06-19T00:00:00.000Z",
    plannedEndDate: "2026-06-26T00:00:00.000Z",
    routeTemplate: { name: "Standart Boyama Rotası" },
    targetItem: { code: "KMS-001", name: "Pamuklu Astar" },
    targetColor: { name: "Bej", hex: "#d8c9a8" },
    targetProperties: [{ propertyId: "p1", property: { name: "Su İticilik" } }],
    steps: [
      { id: "s1", stepSequence: 1, isUrgent: false, notes: null, station: { name: "Ham Kalite (KK1)", type: "INTERNAL" }, plannedSubcontractor: null },
      { id: "s2", stepSequence: 2, isUrgent: false, notes: "Yıkama yapma", station: { name: "Boyahane", type: "EXTERNAL" }, plannedSubcontractor: { id: "sub1", name: "Yıldız Boyahane" } },
    ],
    orderLinks: [
      { orderLineId: "ol1", orderLine: { quantity: 680, order: { orderNumber: "SIP-2026-0107", customer: { name: "Örnek Tekstil A.Ş." } }, item: { name: "Pamuklu Astar" } } },
    ],
    ...over,
  } as unknown as TravelerSnap;
}

const travelerMeta = (over: Partial<TravelerMeta> = {}): TravelerMeta => ({
  cardNumber: "RK-2606-014",
  barcode: "RK26069F2K3P7",
  version: 1,
  printedAt: "2026-06-19T10:30:00.000Z",
  qrSvg: "<svg id='qr'></svg>",
  ...over,
});

function testTraveler(): void {
  console.log("\n══ REFAKAT KARTI ══");
  const html = renderTravelerCardHtml(travelerSnap(), travelerMeta());
  check("doctype + html", html.startsWith("<!doctype html>") && html.includes("</html>"));
  check("başlık REFAKAT KARTI", html.includes("REFAKAT KARTI"));
  check("KART NO + cardNumber", html.includes("KART NO") && html.includes("RK-2606-014"));
  check("barkod metni", html.includes("RK26069F2K3P7"));
  check("versiyon v1 + tarih", html.includes("v1") && html.includes("19.06.2026"));
  check("batchNumber", html.includes("P-260619-014"));
  check("tip etiketi (Siparişe Özel)", html.includes("Siparişe Özel"));
  check("targetItem code + name", html.includes("KMS-001") && html.includes("Pamuklu Astar"));
  check("spec grid (Hedef Metraj/Ağırlık)", html.includes("Hedef Metraj") && html.includes("680") && html.includes("Hedef Ağırlık") && html.includes("110"));
  check("ÖZELLİKLER (properties)", html.includes("ÖZELLİKLER") && html.includes("Su İticilik"));
  check("OPERASYON KAYDI + istasyon", html.includes("OPERASYON KAYDI") && html.includes("Ham Kalite (KK1)"));
  check("fason adımı → subcontractor", html.includes("Yıldız Boyahane"));
  check("TALİMATLAR (step notes)", html.includes("TALİMATLAR") && html.includes("Yıkama yapma"));
  check("BAĞLI SİPARİŞLER + order", html.includes("BAĞLI SİPARİŞLER") && html.includes("SIP-2026-0107") && html.includes("Örnek Tekstil"));
  check("QR svg gömülü", html.includes("<svg id='qr'>"));
  // empty orders → stoğa üretim
  const stock = renderTravelerCardHtml(travelerSnap({ orderLinks: [] }), travelerMeta());
  check("orderLinks boş → 'Stoğa üretim'", stock.includes("Stoğa üretim"));
  // config toggles
  const noGrid = renderTravelerCardHtml(travelerSnap({ config: { showOperationGrid: false } }), travelerMeta());
  check("showOperationGrid=false → OPERASYON KAYDI gizli", !noGrid.includes("OPERASYON KAYDI"));
  const noProps = renderTravelerCardHtml(travelerSnap({ config: { showProperties: false } }), travelerMeta());
  check("showProperties=false → ÖZELLİKLER gizli", !noProps.includes("ÖZELLİKLER"));
  const noOrders = renderTravelerCardHtml(travelerSnap({ config: { showOrders: false } }), travelerMeta());
  check("showOrders=false → BAĞLI SİPARİŞLER gizli", !noOrders.includes("BAĞLI SİPARİŞLER"));
  const cfgCompany = renderTravelerCardHtml(travelerSnap({ config: { companyName: "Test Tekstil", addressLine: "Adres X", phone: "555" } }), travelerMeta());
  check("config.companyName + adres", cfgCompany.includes("Test Tekstil") && cfgCompany.includes("Adres X"));
  // sayfa boyutu + kenar payı (config yoksa A4 / 8mm default). @page BASKI, .sheet ekran.
  check(
    "default → A4 (@page + ekran sheet 210mm) + 8mm margin",
    html.includes("size: A4") && html.includes("margin: 8mm 8mm 8mm 8mm") && html.includes("width: 210mm"),
  );
  const a5 = renderTravelerCardHtml(travelerSnap({ config: { pageSize: "A5" } }), travelerMeta());
  check("config.pageSize=A5 → size: A5 + ekran sheet 148mm", a5.includes("size: A5") && a5.includes("width: 148mm"));
  const customMargin = renderTravelerCardHtml(
    travelerSnap({ config: { margins: { top: 12, right: 4, bottom: 6, left: 10 } } }),
    travelerMeta(),
  );
  check(
    "config.margins → @page margin + ekran sheet padding",
    customMargin.includes("margin: 12mm 4mm 6mm 10mm") && customMargin.includes("padding: 12mm 4mm 6mm 10mm"),
  );
  // spec alanları tek tek gizleme (kullanıcı örneği: en + hedef metraj gizle)
  check("default → En + Hedef Metraj görünür", html.includes(">En</div>") && html.includes("Hedef Metraj"));
  const hideFields = renderTravelerCardHtml(
    travelerSnap({ config: { specFields: { width: false, targetQuantity: false } } }),
    travelerMeta(),
  );
  check(
    "specFields width/targetQuantity=false → En + Hedef Metraj gizli",
    !hideFields.includes(">En</div>") && !hideFields.includes("Hedef Metraj"),
  );
  check("diğer spec alanları hâlâ görünür (Renk/Kat Tipi)", hideFields.includes("Renk") && hideFields.includes("Kat Tipi"));
  // yazı boyutu ölçeği (tüm font-size çarpılır) — default 9.5px, ×1.3 → 12.35px
  check("default → font-size ölçeklenmemiş (9.5px)", html.includes("9.5px"));
  const scaled = renderTravelerCardHtml(travelerSnap({ config: { fontScale: 1.3 } }), travelerMeta());
  check(
    "fontScale=1.3 → font-size çarpıldı (9.5→12.35px, orijinal yok)",
    scaled.includes("12.35px") && !scaled.includes("font-size: 9.5px"),
  );
  // yazı kalınlığı — default 800 var; bold +100 → 900 (+ body 400→500); light −100 → 700/300
  check("default → font-weight kaydırılmamış (800)", html.includes("font-weight: 800"));
  const bold = renderTravelerCardHtml(travelerSnap({ config: { fontWeight: "bold" } }), travelerMeta());
  check("fontWeight=bold → 800→900 + body 400→500", bold.includes("font-weight: 900") && bold.includes("font-weight: 500"));
  const light = renderTravelerCardHtml(travelerSnap({ config: { fontWeight: "light" } }), travelerMeta());
  check("fontWeight=light → 800→700 + body 400→300", light.includes("font-weight: 700") && light.includes("font-weight: 300"));
  // per-field spec kutusu boyut/kalınlık — md/normal = CSS default (inline YOK); sm/lg/ince/kalın = inline.
  check(
    "default spec cell → CSS md/normal, inline YOK",
    html.includes("font-size: 11px; font-weight: 600") && !html.includes("font-size:11px;font-weight:600"),
  );
  const bigBold = renderTravelerCardHtml(
    travelerSnap({ config: { specFields: { targetQuantity: { show: true, size: "lg", weight: "bold" } } } }),
    travelerMeta(),
  );
  check("specField lg+bold → inline 14px/800", bigBold.includes("font-size:14px;font-weight:800"));
  const smallLight = renderTravelerCardHtml(
    travelerSnap({ config: { specFields: { color: { show: true, size: "sm", weight: "light" } } } }),
    travelerMeta(),
  );
  check("specField sm+light → inline 9px/400", smallLight.includes("font-size:9px;font-weight:400"));
  // spec grid satır başına sütun sayısı
  check("default specColumns=3 → hücre %33.3333", html.includes("width: 33.3333%"));
  const cols2 = renderTravelerCardHtml(travelerSnap({ config: { specColumns: 2 } }), travelerMeta());
  check("specColumns=2 → hücre %50", cols2.includes("width: 50.0000%"));
  // bağlı sipariş sütunları — göster/boyut/kalınlık (per-column)
  const hideCust = renderTravelerCardHtml(
    travelerSnap({ config: { orderFields: { customer: { show: false, size: "md", weight: "normal" } } } }),
    travelerMeta(),
  );
  check("orderFields customer.show=false → Müşteri sütunu gizli", !hideCust.includes("Müşteri"));
  const ordStyled = renderTravelerCardHtml(
    travelerSnap({ config: { orderFields: { quantity: { show: true, size: "sm", weight: "bold" } } } }),
    travelerMeta(),
  );
  check("orderFields quantity sm+bold → inline 7px/800", ordStyled.includes("font-size:7px;font-weight:800"));
  // watermarks
  check("draft → TASLAK", renderTravelerCardHtml(travelerSnap(), travelerMeta({ draft: true })).includes("TASLAK"));
  check("VOIDED → İPTAL", renderTravelerCardHtml(travelerSnap(), travelerMeta({ status: "VOIDED" })).includes("İPTAL"));
  check("REPRINTED → ESKİ KOPYA", renderTravelerCardHtml(travelerSnap(), travelerMeta({ status: "REPRINTED" })).includes("ESKİ KOPYA"));
  check("ACTIVE → filigran yok", !renderTravelerCardHtml(travelerSnap(), travelerMeta({ status: "ACTIVE" })).includes("TASLAK"));
  // escaping + QR fallback
  const esc = renderTravelerCardHtml(travelerSnap({ targetItem: { code: "X", name: "A & <s>B</s>" } }), travelerMeta());
  check("escaping", esc.includes("&lt;s&gt;") && !esc.includes("<s>B"));
  const noQr = renderTravelerCardHtml(travelerSnap(), travelerMeta({ qrSvg: null }));
  check("qrSvg yok → çökmez, barkod yine var", typeof noQr === "string" && noQr.includes("RK26069F2K3P7"));
}

function main(): void {
  testKartela();
  testDirectShip();
  testTraveler();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
