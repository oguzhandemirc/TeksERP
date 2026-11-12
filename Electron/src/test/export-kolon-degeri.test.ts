// =============================================================================
// Bekçi: dışa aktarılan her tablo kolonu bir DEĞER kaynağı taşır
// =============================================================================
// Saha (2026-11-04): sipariş listesinin Excel'inde "Kumaş" ve "Renk" BOŞ çıkıyordu. Kolon yalnız `cell`
// (JSX) tanımlıyordu; `lib/table-export.ts` `rawCellValue` sırası meta.exportValue → accessorFn → original[id]
// olduğundan `original.items` undefined → boş hücre. Ekran doğru, dosya boş: kimse fark etmez.
//
// Ölçüm (AST): `src` altında `cell` + (`header` | `id`) taşıyan nesne literali bir TanStack kolon tanımıdır.
// `accessorKey` / `accessorFn` / `meta: { exportValue }` üçünden biri yoksa ve id select/actions değilse İHLAL.
// `meta` literal değilse (değişken/spread) ya da nesnede spread varsa ölçülemez → ihlal sayılmaz.
// Devralınan ihlaller BASELINE'da donar; liste yalnız DARALIR (düzelen kolon buradan silinmeli, yeni ihlal kırmızı).
// =============================================================================
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const SRC = path.dirname(fileURLToPath(import.meta.url)).replace(/\/test$/, "");

/** Devralınan ihlaller (yol `src/pages`e göre → kolon id'leri, sıralı). YENİ GİRDİ EKLEME — kolona exportValue yaz. */
const BASELINE: Record<string, string[]> = {
  "Colors/columns.tsx": ["swatch"],
  "FabricProperties/columns.tsx": ["stations", "swatch", "valueType"],
  "Items/columns.tsx": ["allowedColors", "allowedProperties"],
  "MachineStopCodeMaps/columns.tsx": ["scope", "stopReason"],
  "Machines/columns.tsx": ["loomLabel", "qr", "station"],
  "Operations/AccountingDispatch/columns.tsx": ["counts", "customer", "invoice", "receipt", "totals"],
  "Operations/Kartela/kartelaColumns.tsx": ["subcontractor", "subcontractor"],
  "Operations/MachineStops/columns.tsx": ["duration", "lossClass", "machine", "reason", "shift", "source", "start"],
  "Operations/Returns/returnsColumns.tsx": ["barcode", "customer", "item", "order", "quality", "reason", "receivedBy", "returnNo"],
  "Operations/SackContentEdit/sacksColumns.tsx": ["branch", "customer", "totalQty", "weightKg"],
  "Operations/Shipments/eirsaliye/recordsColumns.tsx": ["createdAt", "customer", "documentNo", "responseAt", "sentAt", "shipment", "status"],
  "Operations/WarpBeams/columns.tsx": ["length", "loom", "lots", "machine", "origin", "spec", "weavingOrder"],
  "Operations/WeavingOrders/columns.tsx": ["dates", "item", "loomFit", "orders", "party", "warpSpec"],
  "PeripheralDevices/columns.tsx": ["connection", "kind", "lang", "name", "owner", "routes", "test"],
  "ProductRecipes/columns.tsx": ["color", "item", "props", "route"],
  "QualityGrades/columns.tsx": ["color"],
  "Reports/Dokuma/leventColumns.tsx": ["kaynak"],
  "Reports/Sales/destinationMixColumns.tsx": ["kapsam", "ort", "tutar", "tutar"],
  "Reports/_components/BreakdownTable.tsx": ["delta", "prevQty", "share"],
  "ReturnReasons/columns.tsx": ["swatch"],
  "Routes/columns.tsx": ["customer", "stepCount"],
  "ShiftDefinitions/columns.tsx": ["break", "code", "days", "duration", "name", "status", "window"],
  "SubcontractorCategories/columns.tsx": ["appliesColor", "appliesProperty", "subcontractorCount"],
  "Subcontractors/columns.tsx": ["categories", "customer"],
  "Warehouses/columns.tsx": ["movements", "setDefault"],
  "WarpSpecs/columns.tsx": ["reed", "yarn"],
};

const NON_EXPORT_IDS = new Set(["select", "actions"]);

function propName(p: ts.ObjectLiteralElementLike): string | null {
  return p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
}

/** Bir kaynak metindeki değer kaynağı olmayan kolonların id'leri (id literal değilse "?"). */
function cellOnlyColumnIds(fileName: string, text: string): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isObjectLiteralExpression(n)) {
      const props = new Map<string, ts.ObjectLiteralElementLike>();
      let spread = false;
      for (const p of n.properties) {
        if (ts.isSpreadAssignment(p)) spread = true;
        const k = propName(p);
        if (k) props.set(k, p);
      }
      const isColumn = props.has("cell") && (props.has("header") || props.has("id"));
      if (isColumn && !spread && !props.has("accessorKey") && !props.has("accessorFn")) {
        const idp = props.get("id");
        const id = idp && ts.isPropertyAssignment(idp) && ts.isStringLiteralLike(idp.initializer) ? idp.initializer.text : "?";
        const meta = props.get("meta");
        let measurable = true;
        let hasExport = false;
        if (meta) {
          if (ts.isPropertyAssignment(meta) && ts.isObjectLiteralExpression(meta.initializer)) {
            hasExport = meta.initializer.properties.some((q) => propName(q) === "exportValue");
            if (meta.initializer.properties.some(ts.isSpreadAssignment)) measurable = false;
          } else measurable = false;
        }
        if (!NON_EXPORT_IDS.has(id) && measurable && !hasExport) found.push(id);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found.sort();
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) {
      if (f !== "node_modules" && f !== "test") walk(p, acc);
    } else if (/\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

function measure(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const file of walk(SRC)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("cell")) continue;
    const ids = cellOnlyColumnIds(file, text);
    if (ids.length > 0) out[path.relative(path.join(SRC, "pages"), file)] = ids;
  }
  return out;
}

describe("dışa aktarım kolon değeri bekçisi", () => {
  const actual = measure();

  it("yeni yalnız-cell kolon yok (baseline dışı ihlal kırmızı)", () => {
    const fresh: string[] = [];
    for (const [file, ids] of Object.entries(actual)) {
      const allowed = [...(BASELINE[file] ?? [])];
      for (const id of ids) {
        const i = allowed.indexOf(id);
        if (i >= 0) allowed.splice(i, 1);
        else fresh.push(`${file} → "${id}"`);
      }
    }
    expect(
      fresh,
      "Kolon yalnız `cell` taşıyor: Excel/PDF/CSV'de BOŞ çıkar. `meta.exportValue` (ekrandaki metinle aynı yardımcıdan) ya da accessorKey/accessorFn ekle.",
    ).toEqual([]);
  });

  it("baseline daralır (düzelen kolon listeden silinmeli)", () => {
    const stale: string[] = [];
    for (const [file, ids] of Object.entries(BASELINE)) {
      const left = [...(actual[file] ?? [])];
      for (const id of ids) {
        const i = left.indexOf(id);
        if (i >= 0) left.splice(i, 1);
        else stale.push(`${file} → "${id}"`);
      }
    }
    expect(stale, "Bu kolonlar artık değer taşıyor — BASELINE'dan sil.").toEqual([]);
  });

  it("ölçer ihlali görür, değerli kolonu geçer (sonda)", () => {
    const src = `const c = [
      { id: "a", header: "A", cell: () => null },
      { id: "b", header: "B", meta: { exportValue: (r) => r }, cell: () => null },
      { accessorKey: "c", header: "C", cell: () => null },
      { id: "select", cell: () => null },
      { id: "d", header: "D", meta: { label: "D" }, cell: () => null },
    ];`;
    expect(cellOnlyColumnIds("x.tsx", src)).toEqual(["a", "d"]);
  });

  it("sipariş/iş emri/sevkiyat/top listeleri tamamen temiz", () => {
    for (const f of [
      "Operations/Orders/columns.tsx",
      "Operations/WorkOrders/columns.tsx",
      "Operations/Shipments/columns.tsx",
      "Operations/Rolls/columns.tsx",
    ]) {
      expect(actual[f] ?? [], f).toEqual([]);
      expect(BASELINE[f], f).toBeUndefined();
    }
  });
});
