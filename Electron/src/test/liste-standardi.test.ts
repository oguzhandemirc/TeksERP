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
  "Operations/ProductBalance/ProductBalanceRow.tsx": GOMULU,
  "Operations/PurchaseOrders/GoodsReceiptOrderSection.tsx": GOMULU,
  "Operations/SackContentEdit/SackEntryGate.tsx": GOMULU,
  "Operations/SackContentEdit/ShipmentPreviewPanel.tsx": GOMULU,
  "Operations/Shipments/DirectShipmentDetailContent.tsx": GOMULU,
  "Operations/Shipments/detail/SackRow.tsx": GOMULU,
  "Operations/StockCounts/StockCountLines.tsx": GOMULU,
  "Operations/WeavingFloor/jobs/BulkParts.tsx": GOMULU,
  "Operations/WeavingFloor/stops/StopBulkParts.tsx": GOMULU,
  "Operations/WorkOrders/BranchLanes.tsx": GOMULU,
  "Operations/WorkOrders/CoveragePanel.tsx": GOMULU,
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

/** Henüz standarda çekilmemiş liste sayfaları — her parti PR'ı buradan siler; BOŞALINCA kaldırılır. */
const PENDING = new Set<string>([
  "Access/Permissions/PermissionsCatalogPage.tsx",
  "Definitions/DocumentDesigner/assignments/AssignmentsView.tsx",
  "Devices/DevicesPage.tsx",
  "Notifications/NotificationTable.tsx",
  "Operations/Orders/OrderPlanView.tsx",
  "Operations/SackContentEdit/PackingLotListView.tsx",
  "Stations/StationListView.tsx",
  "System/Clients/ClientsPage.tsx",
  "System/Duplicates/DuplicatesPage.tsx",
  "System/NotificationProfiles/ProfileMatrixTab.tsx",
  "System/WorkSessions/HistoryTable.tsx",
]);

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

  it("⭐ yeni kart-içi tablo yok (muaf ya da bekleyen değilse ListBody/DataTable kullan)", () => {
    const yeni = [...found.keys()].filter((f) => !(f in EXEMPT) && !PENDING.has(f));
    expect(yeni.map((f) => `${f} ${found.get(f)?.join(",")}`)).toEqual([]);
  });

  it("muaf/bekleyen listesi bayat değil (dönüşen ya da silinen dosya listeden düşer)", () => {
    const bayat = [...Object.keys(EXEMPT), ...PENDING].filter((f) => !found.has(f));
    expect(bayat).toEqual([]);
  });

  it("muaf ile bekleyen kesişmez", () => {
    expect([...PENDING].filter((f) => f in EXEMPT)).toEqual([]);
  });

  it("ölçer kartı tanır (sonda): rounded+border div ve Card içi tablo ihlal, düz tablo değil", () => {
    expect(cardWrappedTables(`const A = () => <div className="overflow-x-auto rounded-lg border"><table /></div>;`)).toEqual(["table@1"]);
    expect(cardWrappedTables(`const A = () => <Card><CardContent><DataTable table={t} /></CardContent></Card>;`)).toEqual(["DataTable@1"]);
    expect(cardWrappedTables(`const A = () => <ListBody><table /></ListBody>;`)).toEqual([]);
    expect(cardWrappedTables(`const A = () => <div className="border-b px-4"><table /></div>;`)).toEqual([]);
    expect(cardWrappedTables(`const A = () => <SheetContent><div className="rounded-md border"><table /></div></SheetContent>;`)).toEqual([]);
  });
});
