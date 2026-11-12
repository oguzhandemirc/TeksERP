// =============================================================================
// Bekçi: liste sayfası standardı — tablo kart içinde çizilmez
// =============================================================================
// Saha (2026-11-02, "Metre Sapmaları"): liste tablosu sayfaya "emanet" gibi duruyordu — dış boşluklu, yuvarlak köşeli,
// çerçeveli bir kartın içinde. Standart Gelen Belgeler / Kumaş Stoğu düzenidir: başlık → sabit üst bant → kenardan
// kenara tablo (TEK kaydırıcı, yapışkan başlık) → alt şerit. DataTable bunu kendisi yapar; kendi <table>'ını çizen
// sayfa `components/layout/ListPage.tsx` (ListToolbar · ListBody · ListFooter) kullanır.
//
// Ölçüm (AST): `src/pages` altında <table>/<Table>/<DataTable>'ın AYNI bileşen içindeki JSX atalarından biri
// `Card`/`CardContent` ya da className'i hem `rounded*` hem `border` taşıyan <div>/<section> ise İHLAL.
// Diyalog/çekmece/modal dosyaları (ad *Dialog/*Sheet/*Modal) ölçülmez — orada kart içi tablo doğaldır.
// Kart içinde KALMASI gereken gömülü tablolar EXEMPT'te gerekçesiyle durur; liste DARALIR, büyümez.
// =============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const SRC = path.dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");
const PAGES = path.join(SRC, "pages");

const GOMULU = "gömülü bölüm tablosu (detay/form/kart içi; sayfanın ana listesi değil)";
const RAPOR = "rapor gövdesi (ReportPageLayout bölüm kartları; liste sayfası değil)";
const ARAC = "araç/ayar sayfasında küçük bölüm tablosu (birden çok kart yan yana; ana liste değil)";

/** Kart içinde kalması BİLİNÇLİ olan tablolar — yol `src/pages`e göre. */
const EXEMPT: Record<string, string> = {
  "Cost/PriceLists/PriceListLinesEditor.tsx": GOMULU,
  "Cost/Quotes/QuoteLinesTable.tsx": GOMULU,
  "Cost/shared/CostBreakdown.tsx": GOMULU,
  "Cost/Parameters/ParameterCompareTable.tsx": GOMULU,
  "Definitions/ItemPrices/ItemPricesPanel.tsx": GOMULU,
  "Finance/Allocations/OpenInvoiceTable.tsx": GOMULU,
  "Finance/Allocations/SourceAllocationsTable.tsx": GOMULU,
  "Finance/CariHold/CariHoldPanel.tsx": GOMULU,
  "Finance/CariMerge/CariMergePreviewStep.tsx": GOMULU,
  "Finance/Cheques/DeliveryNoteCancelPanel.tsx": GOMULU,
  "Finance/PeriodClose/CashPeriodSection.tsx": GOMULU,
  "Operations/GelenBelgeler/LinesTable.tsx": GOMULU,
  "Operations/Orders/production-proposal/ProposalInsights.tsx": GOMULU,
  "Operations/ProductBalance/ProductBalanceRow.tsx": GOMULU,
  "Operations/PurchaseOrders/GoodsReceiptOrderSection.tsx": GOMULU,
  "Operations/Rolls/card/RollInfoTable.tsx": GOMULU,
  "Operations/SackContentEdit/SackEntryGate.tsx": GOMULU,
  "Operations/SackContentEdit/ShipmentPreviewPanel.tsx": GOMULU,
  "Operations/Shipments/DirectShipmentDetailContent.tsx": GOMULU,
  "Operations/Shipments/detail/SackRow.tsx": GOMULU,
  "Operations/StockCounts/StockCountLines.tsx": GOMULU,
  "Operations/WeavingFloor/jobs/BulkParts.tsx": GOMULU,
  "Operations/WeavingFloor/stops/StopBulkParts.tsx": GOMULU,
  "Operations/WorkOrders/BranchLanes.tsx": GOMULU,
  "Operations/WorkOrders/CoveragePanel.tsx": GOMULU,
  "Operations/WorkOrders/oie/PartyList.tsx": GOMULU,
  "Quality/LabTests/LabResultsTable.tsx": GOMULU,
  "Stations/StationMachineTable.tsx": GOMULU,
  "System/DataImport/ConfigBundleCard.tsx": GOMULU,
  "System/DataImport/DataImportPage.tsx": ARAC,
  "System/Duplicates/MergeConfirmGate.tsx": GOMULU,
  "System/Duplicates/MergeShadowingList.tsx": GOMULU,
  "System/Backups/BackupsTable.tsx": ARAC,
  "System/DbRestore/CopiesTable.tsx": ARAC,
  "System/ReadOnlyDb/ReadOnlyDbPage.tsx": ARAC,
  "Reports/Finance/AgingBlockTable.tsx": RAPOR,
  "Reports/Finance/CashAccountsTable.tsx": RAPOR,
  "Reports/Finance/CashBookPage.tsx": RAPOR,
  "Reports/Finance/CashLedgerTable.tsx": RAPOR,
  "Reports/Finance/ChequeDuePage.tsx": RAPOR,
  "Reports/Finance/FxDiffPage.tsx": RAPOR,
  "Reports/Finance/VatSummaryPage.tsx": RAPOR,
  "Reports/_components/DetailTable.tsx": RAPOR,
  "Reports/_v2/PeriodCompareTable.tsx": RAPOR,
  "Reports/_v2/ReportTable.tsx": RAPOR,
};

const TABLE_TAGS = new Set(["table", "Table", "DataTable"]);
const CARD_TAGS = new Set(["Card", "CardContent"]);
const OVERLAY_FILE = /(Dialog|Sheet|Modal)[^/]*\.tsx$/;
/** Sayfa dosyasında satır içi çizilen diyalog/çekmece gövdesi — içindeki tablo gömülüdür, ölçülmez. */
const OVERLAY_TAGS = new Set(["DialogContent", "SheetContent", "AlertDialogContent", "PopoverContent", "DrawerContent"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx") && !p.includes(".test.")) out.push(p);
  }
  return out;
}

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;
const tagOf = (n: JsxNode) => (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText();
const attrsOf = (n: JsxNode) => (ts.isJsxElement(n) ? n.openingElement.attributes : n.attributes);

/** className içindeki TÜM string literal'ler (cn(...) argümanları dahil) — koşullu sınıf da sayılır. */
function classText(n: JsxNode): string {
  const a = attrsOf(n).properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === "className");
  if (!a || !ts.isJsxAttribute(a) || !a.initializer) return "";
  let s = "";
  const visit = (x: ts.Node) => {
    if (ts.isStringLiteralLike(x)) s += ` ${x.text}`;
    ts.forEachChild(x, visit);
  };
  visit(a.initializer);
  return s;
}

const isCardClass = (c: string) => /(^|\s)rounded(-[\w[\]]+)?(\s|$)/.test(c) && /(^|\s)border(\s|$)/.test(c);

function insideOverlay(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p && !ts.isFunctionLike(p); p = p.parent) {
    if (ts.isJsxElement(p) && OVERLAY_TAGS.has(tagOf(p))) return true;
  }
  return false;
}

/** Kart içinde çizilen tablolar: `etiket@satır` listesi. */
export function cardWrappedTables(source: string, fileName = "x.tsx"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) && TABLE_TAGS.has(tagOf(n)) && !insideOverlay(n)) {
      for (let p: ts.Node | undefined = n.parent; p && !ts.isFunctionLike(p); p = p.parent) {
        if (!ts.isJsxElement(p)) continue;
        const t = tagOf(p);
        if (CARD_TAGS.has(t) || ((t === "div" || t === "section") && isCardClass(classText(p)))) {
          hits.push(`${tagOf(n)}@${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`);
          break;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

function violations(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of walk(PAGES)) {
    const rel = path.relative(PAGES, f);
    if (OVERLAY_FILE.test(rel)) continue;
    const hits = cardWrappedTables(readFileSync(f, "utf8"), f);
    if (hits.length) out.set(rel, hits);
  }
  return out;
}

describe("liste standardı — tablo kart içinde çizilmez", () => {
  const found = violations();

  it("⭐ yeni kart-içi tablo yok (muaf değilse ListBody/DataTable kullan)", () => {
    const yeni = [...found.keys()].filter((f) => !(f in EXEMPT));
    expect(yeni.map((f) => `${f} ${found.get(f)?.join(",")}`)).toEqual([]);
  });

  it("muaf listesi bayat değil (dönüşen ya da silinen dosya listeden düşer)", () => {
    const bayat = Object.keys(EXEMPT).filter((f) => !found.has(f));
    expect(bayat).toEqual([]);
  });

  it("ölçer kartı tanır (sonda): rounded+border div ve Card içi tablo ihlal, düz tablo değil", () => {
    expect(cardWrappedTables(`const A = () => <div className="overflow-x-auto rounded-lg border"><table /></div>;`)).toEqual(["table@1"]);
    expect(cardWrappedTables(`const A = () => <Card><CardContent><DataTable table={t} /></CardContent></Card>;`)).toEqual(["DataTable@1"]);
    expect(cardWrappedTables(`const A = () => <ListBody><table /></ListBody>;`)).toEqual([]);
    expect(cardWrappedTables(`const A = () => <div className="border-b px-4"><table /></div>;`)).toEqual([]);
    expect(cardWrappedTables(`const A = () => <SheetContent><div className="rounded-md border"><table /></div></SheetContent>;`)).toEqual([]);
  });
});

// =============================================================================
// Liste araçları standardı (kullanıcı 2026-11-12): "tablo olan her yerde filtre ve sütunları aç kapa olmalı";
// "arama input'larının placeholder'larını kısa tut".
// (1) Ortak DataTable çizen her sayfa standart "Sütunlar" menüsünü (`DataTableTools` ya da araç çubuğuna `tools=`)
//     taşır — tablo bir çocuk bileşendeyse menü TOOLS_HOST'taki sayfa dosyasında aranır.
// (2) Aynı sayfa sunucu aramasını taşır (`onSearchChange` / `<ScanField`); backend'i arama almayan küçük katalog
//     NO_SEARCH'te gerekçesiyle durur (istemci süzmesi YAZILMAZ).
// (3) Liste tablosunu ELLE çizen sayfalar (ListBody içinde <table>) HAND_TABLES cırcırında: liste yalnız DARALIR;
//     geçirilen dosya listeden düşer, yeni elle tablo eklenemez.
// (4) Arama kutusu yer tutucusu ≤ 20 karakter; neyin arandığı `title`/`aria-label`/`searchHint`te.
// =============================================================================

/** Tabloyu çizen çocuk dosya → standart araçların (menü + arama) durduğu sayfa/araç çubuğu dosyaları. */
const TOOLS_HOST: Record<string, string[]> = {
  "Finance/CariTable.tsx": ["Finance/CariPage.tsx"],
  "Definitions/cariler/CariListTable.tsx": ["Definitions/CarilerPage.tsx", "Definitions/CarilerFilterRow.tsx"],
  "Operations/GelenBelgeler/NoteListTable.tsx": ["Operations/GelenBelgeler/GelenBelgelerPage.tsx", "Operations/GelenBelgeler/NoteListFilters.tsx"],
  "Operations/Rolls/RollsTableBody.tsx": ["Operations/Rolls/RollsPage.tsx", "Operations/Rolls/RollScanBar.tsx"],
  "Operations/MachineStops/StopsTable.tsx": ["Operations/MachineStops/MachineStopsPage.tsx"],
  "Finance/CashTransactions/CashTxnTable.tsx": ["Finance/CashTransactions/CashTransactionsPage.tsx", "Finance/CashTransactions/CashTxnFilterBar.tsx"],
  "Finance/Cheques/ChequeTable.tsx": ["Finance/Cheques/ChequesPage.tsx", "Finance/Cheques/ChequeFilterBar.tsx"],
  "Finance/PaymentsPage.tsx": ["Finance/PaymentsFilterBar.tsx"],
};

/** Sütun menüsü OLMAYAN DataTable — gerekçeli. */
const NO_COLUMN_MENU: Record<string, string> = {
  "Operations/SackContentEdit/SackContentsTable.tsx":
    "çuval düzenleyicisine gömülü 7 sütunlu içerik; düzen salt-okunur görünümle ortak `sack-contents` kaydında (menü orada)",
};

const KATALOG = "küçük katalog, liste ucu arama parametresi almıyor (backend gerekiyor); istemci süzmesi yazılmaz";
/** Arama kutusu OLMAYAN DataTable sayfası — gerekçeli. */
const NO_SEARCH: Record<string, string> = {
  "Operations/GelenBelgeler/GonderenSablonlariPage.tsx": KATALOG,
  "Operations/MachineStops/StopsTable.tsx": "gün + makine süzgeçli duruş listesi; uçta metin araması yok (backend gerekiyor)",
  "ShiftDefinitions/ShiftDefinitionsPage.tsx": KATALOG,
  "Finance/RatesPage.tsx": KATALOG,
  "Finance/AccountsPage.tsx": "kasa + banka hesabı tanımları (birkaç satır, iki bölüm); liste uçları arama almıyor (backend gerekiyor)",
  "Operations/SackContentEdit/SackContentsTable.tsx": "çuval içi gömülü tablo (onlarca top); arama salt-okunur görünümde",
  "Operations/SackContentEdit/SackContentsReadonlyTable.tsx": "çuval içi gömülü tablo; tek çuvalın topları bellekte süzülür (sayfalı liste değil)",
};

const LISTE = "liste tablosu elle çiziliyor — ortak DataTable'a geçirilecek";
/** Cırcır: liste tablosunu elle çizen dosyalar (yalnız daralır). */
const HAND_TABLES: Record<string, string> = Object.fromEntries(
  [
    "Access/PatronCloud/PatronCloudPage.tsx",
    "Access/Permissions/PermissionsCatalogPage.tsx",
    "Access/Templates/TemplatesPage.tsx",
    "Access/Users/AccessUsersPage.tsx",
    "Cost/ConsumableNorms/ConsumableNormsPage.tsx",
    "Cost/FinishingRates/FinishingRatesPage.tsx",
    "Cost/Items/CostItemsTable.tsx",
    "Cost/MachineRates/MachineRatesPage.tsx",
    "Cost/PriceLists/PriceListsPage.tsx",
    "Cost/Quotes/QuotesTable.tsx",
    "Cost/YarnPrices/YarnPricesPage.tsx",
    "Definitions/DocumentDesigner/assignments/AssignmentsView.tsx",
    "Devices/DevicesPage.tsx",
    "Finance/InvoicesPage.tsx",
    "Finance/PeriodClose/PeriodClosePage.tsx",
    "GeneralSettings/Numbering/NumberingTable.tsx",
    "MachineCollectors/CollectorTable.tsx",
    "Notifications/NotificationTable.tsx",
    "Operations/AllocationRepair/RepairTable.tsx",
    "Operations/ConsignedWork/ConsignedWorkTable.tsx",
    "Operations/ConsignmentDispatches/ConsignmentDispatchTable.tsx",
    "Operations/ConsumableStock/ConsumableStockPage.tsx",
    "Operations/FasonCockpit/CockpitTable.tsx",
    "Operations/GoodsReceipts/GoodsReceiptsPage.tsx",
    "Operations/Kartela/OutstandingTab.tsx",
    "Operations/KursunMeterDeviations/DeviationTable.tsx",
    "Operations/LoomAlarms/LoomAlarmsTable.tsx",
    "Operations/Orders/OrderPlanView.tsx",
    "Operations/ProductBalance/ProductBalancePage.tsx",
    "Operations/PurchaseOrders/OpenLinesPanel.tsx",
    "Operations/PurchaseOrders/PurchaseOrderTable.tsx",
    "Operations/ReadyWorks/ReadyWorksTable.tsx",
    "Operations/SackContentEdit/PackingLotListView.tsx",
    "Operations/StockCounts/StockCountsPage.tsx",
    "Operations/WarehouseTransfers/WarehouseTransfersPage.tsx",
    "Operations/Yarn/YarnLotsPanel.tsx",
    "Operations/Yarn/YarnStockTable.tsx",
    "Quality/Certificates/CertificateList.tsx",
    "Quality/Certificates/CustomerSpecsPanel.tsx",
    "Quality/Inspections/InspectionList.tsx",
    "Quality/LabTests/LabTestList.tsx",
    "Quality/LabTests/LabTypesPanel.tsx",
    "Stations/StationListView.tsx",
    "System/Clients/ClientsPage.tsx",
    "System/Duplicates/DuplicatesPage.tsx",
    "System/Events/SystemEventsList.tsx",
    "System/NotificationProfiles/ProfileMatrixTab.tsx",
    "System/PrintHistory/PrintHistoryTable.tsx",
    "System/WorkSessions/HistoryTable.tsx",
    "WeaveDesigns/WeaveDesignsPage.tsx",
  ].map((f) => [f, LISTE]),
);

const HAS_TOOLS = /<DataTableTools\b|\btools=\{|<DataTableToolbar\b[^>]*\btable=\{/;
const HAS_SEARCH = /\bonSearchChange=|<ScanField\b|\bset\w*Search\w*\(e\.target\.value\)|\bset\("search", e\.target\.value\)/;
const HAND_TABLE_TAG = /<(table|Table)\b/;

/** Ortak DataTable'ı çizen sayfa dosyaları için eksikler: `dosya: sütun-menüsü|arama`. */
export function missingListTools(files: Record<string, string>, opts = { host: TOOLS_HOST, noMenu: NO_COLUMN_MENU, noSearch: NO_SEARCH }): string[] {
  const out: string[] = [];
  for (const [rel, src] of Object.entries(files)) {
    if (!/<DataTable\b/.test(src) || OVERLAY_FILE.test(rel)) continue;
    const host = opts.host[rel];
    const both = src + (host ?? []).map((h) => files[h] ?? "").join("\n");
    if (!HAS_TOOLS.test(both) && !(rel in opts.noMenu)) out.push(`${rel}: sütun-menüsü`);
    if (!HAS_SEARCH.test(both) && !(rel in opts.noSearch)) out.push(`${rel}: arama`);
  }
  return out;
}

/** Arama kutusu yer tutucuları (ara/okut ile biten literal) 20 karakteri aşanlar. */
export function longSearchPlaceholders(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/placeholder="([^"]+)"/g)) {
    const text = m[1] ?? "";
    if (!/(^|[\s/·,])(ara|okut)(\.\.\.|…)?$/i.test(text)) continue;
    // Etiketin açılışı: önünde tanımlayıcı karakteri olmayan "<" (jenerik `<Select<Row>`in iç "<"i değil).
    let tagStart = src.lastIndexOf("<", m.index);
    while (tagStart > 0 && /\w/.test(src[tagStart - 1] ?? "")) tagStart = src.lastIndexOf("<", tagStart - 1);
    const tag = /^<([\w.]+)/.exec(src.slice(tagStart))?.[1] ?? "";
    if (/Select|Picker/.test(tag)) continue; // seçici tetiği arama kutusu değil
    if (text.length > 20) out.push(text);
  }
  return out;
}

function pageSources(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of walk(PAGES)) out[path.relative(PAGES, f)] = readFileSync(f, "utf8");
  return out;
}

describe("liste araçları standardı — sütun menüsü + arama + kısa yer tutucu", () => {
  const files = pageSources();

  it("⭐ ortak DataTable çizen her sayfa standart Sütunlar menüsünü ve aramayı taşır (muafiyet gerekçeli)", () => {
    expect(missingListTools(files)).toEqual([]);
  });

  it("muafiyet / yönlendirme listeleri bayat değil", () => {
    const tables = Object.keys(files).filter((f) => /<DataTable\b/.test(files[f] ?? ""));
    const stale = [...Object.keys(NO_COLUMN_MENU), ...Object.keys(NO_SEARCH), ...Object.keys(TOOLS_HOST)].filter((f) => !tables.includes(f));
    expect(stale).toEqual([]);
  });

  it("⭐ elle çizilen liste tablosu cırcırı: yeni yok, geçirilen listeden düşer", () => {
    const hand = Object.keys(files).filter(
      (f) => !OVERLAY_FILE.test(f) && HAND_TABLE_TAG.test(files[f] ?? "") && /<ListBody\b/.test(files[f] ?? ""),
    );
    expect(hand.filter((f) => !(f in HAND_TABLES))).toEqual([]);
    const stale = Object.keys(HAND_TABLES).filter((f) => !HAND_TABLE_TAG.test(files[f] ?? "") || /<DataTable\b/.test(files[f] ?? ""));
    expect(stale).toEqual([]);
  });

  it("⭐ arama yer tutucusu ≤ 20 karakter (tam açıklama title/aria-label/searchHint'te)", () => {
    const long = Object.entries(files)
      .filter(([f]) => !f.includes(".test."))
      .flatMap(([f, src]) => longSearchPlaceholders(src).map((t) => `${f}: ${t}`));
    expect(long).toEqual([]);
  });

  it("ölçerler tanır (sonda)", () => {
    const page = `const A = () => <><DefFilterRow onSearchChange={s} tools={{ table }} /><DataTable table={t} /></>;`;
    expect(missingListTools({ "X/A.tsx": page })).toEqual([]);
    expect(missingListTools({ "X/A.tsx": `const A = () => <DataTable table={t} />;` })).toEqual(["X/A.tsx: sütun-menüsü", "X/A.tsx: arama"]);
    expect(
      missingListTools(
        { "X/T.tsx": `<DataTable table={t} />`, "X/P.tsx": `<FilterRow onSearchChange={s} /><DataTableTools table={t} />` },
        { host: { "X/T.tsx": ["X/P.tsx"] }, noMenu: {}, noSearch: {} },
      ),
    ).toEqual([]);
    expect(longSearchPlaceholders(`<Input placeholder="Dokuma no, kumaş veya fasoncu ara..." />`)).toHaveLength(1);
    expect(longSearchPlaceholders(`<Input placeholder="Ara…" title="Dokuma no, kumaş ya da fasoncu" />`)).toEqual([]);
    expect(longSearchPlaceholders(`<ReferenceSelect<CariRow> placeholder="Müşteri / fason ara..." />`)).toEqual([]);
    expect(longSearchPlaceholders(`<Input placeholder="Kâğıdın üzerindeki numara" />`)).toEqual([]);
  });
});
