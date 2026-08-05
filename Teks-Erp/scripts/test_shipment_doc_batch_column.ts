// =============================================================================
// BEKÇİ: Müşteri sevk irsaliyesi — çeki tablosundaki PARTİ NO kolonu (opt-in)
// Çalıştır: npx tsx scripts/test_shipment_doc_batch_column.ts
// =============================================================================
// Gerçek DB GEREKMEZ — renderShipmentDispatchHtml saf: snapshot → HTML.
//
// KİLİTLENEN KURAL (2026-08-05 ürün kararı): parti no müşteri sevk irsaliyesinin
// çeki tablosunda **VARSAYILAN BASILIR**. Tekstilde lot no müşterinin de sorduğu
// bir bilgidir. Kolon normal BLOCKLIST semantiğindedir: `columns.ceki.hidden`
// içine yazılmadıkça görünür.
//   ⚠️ Bu, "yeni kolon müşteri belgesine varsayılan sızmasın" genel kuralının
//   İSTİSNASI değil, o kuralın uygulanma sonucudur: kural iç/hassas veri içindir
//   (emsal: `sackNote` — hâlâ `defaultHidden`), parti no ise müşteriye ait bilgi.
//   Yeni bir İÇ veri kolonu eklerken `defaultHidden` kuralı AYNEN geçerli.
//
// İkinci kilit: parti ÇUVAL değil TOP başına taşınır — çuval karışık içerikli
// olabilir; çuval başına tek parti yazmak sessizce yanlış olurdu.
//
// Üçüncü kilit: alan taşımayan ESKİ donmuş snapshot uydurma parti BASMAZ ("—").
// =============================================================================
import { renderShipmentDispatchHtml } from "../src/services/document-render/shipment-dispatch.html";
import { renderFasonDirectShipHtml } from "../src/services/document-render/fason-direct-ship.html";

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

type AnySnap = Parameters<typeof renderShipmentDispatchHtml>[0];

function makeSnap(over: { ceki?: Record<string, unknown>[]; columns?: Record<string, unknown> } = {}): AnySnap {
  const cekiRows = over.ceki ?? [
    {
      rollId: "r1",
      sackCode: "Ç-01",
      barcode: "TR-R0200",
      desen: "Pamuklu Astar",
      varyant: "Bej",
      width: 150,
      meters: 480,
      kg: 42.5,
      batchNumber: "P1908260007",
    },
    {
      // Bilerek AYNI çuval, FARKLI parti — "parti çuval başına" varsayımını kırar.
      rollId: "r2",
      sackCode: "Ç-01",
      barcode: "TR-R0201",
      desen: "Pamuklu Astar",
      varyant: "Bej",
      width: 150,
      meters: 200,
      kg: 0,
      batchNumber: "P1908260008",
    },
  ];
  return {
    schemaVersion: 1,
    frozenAt: "2026-08-05T10:00:00.000Z",
    company: { name: "Adnan Şahin Tekstil", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
    docConfigOverride: over.columns ? { columns: over.columns } : null,
    doc: {
      header: {
        shipmentNo: "SVK0508260001",
        dispatchedAt: "2026-08-05T10:00:00.000Z",
        customerName: "Örnek Tekstil A.Ş.",
        customerCode: "M001",
      },
      products: [{ name: "Pamuklu Astar Bej 150cm.", rollCount: 2, totalMeters: 680 }],
      sacks: [{ code: "Ç-01", seq: 1, totalMeters: 680, totalKg: 42.5, packageCount: 2 }],
      cekiRows,
      totals: { totalRolls: 2, totalMeters: 680, totalKg: 42.5, sackCount: 1 },
    },
  } as unknown as AnySnap;
}

// ── 1) VARSAYILAN: kolon BASILIR ────────────────────────────────────────────
function testDefaultVisible(): void {
  console.log("\n── 1) Varsayılan görünür ──");
  const html = renderShipmentDispatchHtml(makeSnap());
  check("PARTİ NO başlığı var (config'siz)", html.includes("PARTİ NO"));
  check("birinci topun partisi", html.includes("P1908260007"));
  check(
    "AYNI çuvaldaki ikinci top FARKLI parti basar",
    html.includes("P1908260008"),
    "parti TOP başına — çuval karışık içerikli olabilir",
  );
}

// ── 2) hidden ile kapatılabilir (normal blocklist) ──────────────────────────
function testHideable(): void {
  console.log("\n── 2) hidden ile kapatılır ──");
  const off = renderShipmentDispatchHtml(makeSnap({ columns: { ceki: { hidden: ["batchNumber"] } } }));
  check("hidden'a yazılınca başlık YOK", !off.includes("PARTİ NO"));
  check("hidden'a yazılınca değer YOK", !off.includes("P1908260007"));

  // Başka kolonu gizlemek partiyi ETKİLEMEZ (blocklist kolon-başına).
  const otherHidden = renderShipmentDispatchHtml(makeSnap({ columns: { ceki: { hidden: ["desen"] } } }));
  check("başka kolon gizli → parti yine basılır", otherHidden.includes("P1908260007"));

  // ⚠️ `defaultHidden` KOLONLARIN semantiği bozulmadı: parti artık normal kolon,
  // yani `shown` listesinde ADI GEÇMESE DE basılır (allowlist ona uygulanmaz).
  const shownElsewhere = renderShipmentDispatchHtml(
    makeSnap({ columns: { ceki: { shown: ["note"] } } }),
  );
  check("shown başka kolonu sayıyor → parti etkilenmez", shownElsewhere.includes("P1908260007"));
}

// ── 3) Eski donmuş belge — alan yok ─────────────────────────────────────────
function testLegacySnapshot(): void {
  console.log("\n── 3) Eski donmuş snapshot (alan yok) ──");
  const legacyRows = [
    { rollId: "r1", sackCode: "Ç-01", barcode: "TR-R0200", desen: "Pamuklu Astar", varyant: "Bej", width: 150, meters: 480, kg: 42.5 },
  ];
  // Kolon varsayılan açık: başlık durur ama değer yoktur → "—". Uydurma parti
  // YAZILMAZ (geriye dönük doldurma donmuş belge kuralının ihlali olurdu).
  const on = renderShipmentDispatchHtml(makeSnap({ ceki: legacyRows }));
  check("alansız eski snapshot → başlık var", on.includes("PARTİ NO"));
  check("değer yerine tire, uydurma parti YOK", on.includes(">—<"));

  // Gizlenirse eski belge bugünküyle birebir aynı basılır (kaçış yolu duruyor).
  const off = renderShipmentDispatchHtml(
    makeSnap({ ceki: legacyRows, columns: { ceki: { hidden: ["batchNumber"] } } }),
  );
  check("gizlendiğinde alansız belge → PARTİ NO yok", !off.includes("PARTİ NO"));
}

// ── 4) Diğer kolonlar etkilenmedi ───────────────────────────────────────────
function testNoCollateral(): void {
  console.log("\n── 4) Mevcut kolonlar bozulmadı ──");
  const html = renderShipmentDispatchHtml(makeSnap());
  for (const label of ["ÇUVAL NO", "BARKOD NO", "DESEN", "VARYANT", "METRE"]) {
    check(`${label} kolonu duruyor`, html.includes(label));
  }
  // Blocklist normal kolonlarda ÇALIŞMAYA DEVAM ediyor (tri-state bozulmadı).
  const hideDesen = renderShipmentDispatchHtml(makeSnap({ columns: { ceki: { hidden: ["desen"] } } }));
  check("normal kolonda hidden hâlâ çalışıyor", !hideDesen.includes(">DESEN<"));
  check("aynı config'te parti yine basılıyor", hideDesen.includes("P1908260007"));
}

// ── 5) Fasondan doğrudan sevk irsaliyesi — aynı karar, ayrı renderer ────────
// Bu da MÜŞTERİYE giden bir belge ve aynı ürün kararına tabi. Ayrı dosyada
// yaşadığı için ayrıca kilitlenir: biri değişip diğeri kalırsa aynı fabrikanın
// iki çıkış belgesi parti no konusunda farklı davranır.
function testDirectShip(): void {
  console.log("\n── 5) Fasondan doğrudan sevk irsaliyesi ──");
  const snap = (over: { batchNumber?: string | null; sections?: Record<string, boolean> }) =>
    ({
      schemaVersion: 1,
      frozenAt: "2026-08-05T10:00:00.000Z",
      company: { name: "Adnan Şahin Tekstil", letterhead: { addressLine: "", phone: "", taxInfo: "" } },
      docConfigOverride: over.sections ? { sections: over.sections } : null,
      doc: {
        directShip: true,
        shipmentNo: "DSF0508260001",
        dispatchNo: "FS0508260001",
        directShippedAt: "2026-08-05T10:00:00.000Z",
        directShipReason: "Müşteri acil talep",
        directShippedBy: "Test",
        dispatchedAt: "2026-08-05T09:00:00.000Z",
        driverName: null,
        plateNumber: null,
        notes: null,
        ...("batchNumber" in over ? { batchNumber: over.batchNumber } : {}),
        customer: { id: "c1", name: "Örnek Tekstil", code: "M001", taxNumber: null, branchName: null, branchCode: null },
        workOrder: { id: "wo1", workOrderNumber: "IE0508260001", type: "ORDER_PRODUCTION" },
        subcontractor: { id: "s1", name: "Boyer", code: "BOYER" },
        step: { id: "st1", stepSequence: 2, station: { name: "Boyahane", code: "BOYA" } },
        rolls: [],
        allocations: [],
        totals: { rollCount: 0, totalQty: 0, totalWeight: 0 },
      },
    }) as unknown as Parameters<typeof renderFasonDirectShipHtml>[0];

  const on = renderFasonDirectShipHtml(snap({ batchNumber: "P1908260007" }));
  check("varsayılan BASILIR", on.includes("Parti No:") && on.includes("P1908260007"));

  const off = renderFasonDirectShipHtml(
    snap({ batchNumber: "P1908260007", sections: { batchInfo: false } }),
  );
  check("sections.batchInfo=false → susar", !off.includes("P1908260007"));

  const legacy = renderFasonDirectShipHtml(snap({}));
  check("alansız eski donmuş belge → satır YOK", !legacy.includes("Parti No"));
}

function main(): void {
  testDefaultVisible();
  testHideable();
  testLegacySnapshot();
  testNoCollateral();
  testDirectShip();
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
