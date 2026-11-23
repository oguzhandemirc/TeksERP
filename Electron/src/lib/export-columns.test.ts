import { describe, expect, it } from "vitest";
import {
  UnknownExportColumnError,
  assertKnownColumns,
  defaultColumnSelection,
  orderByCatalog,
  readSavedExportChoice,
  restoreColumnSelection,
  type ExportColumnOption,
} from "./export-columns";

const catalog: ExportColumnOption[] = [
  { id: "a", label: "A", visible: true },
  { id: "b", label: "B", visible: false },
  { id: "c", label: "C", visible: true },
];

describe("export-columns", () => {
  it("varsayılan seçim = ekranda görünen sütunlar (gizli işaretsiz)", () => {
    expect(defaultColumnSelection(catalog)).toEqual(["a", "c"]);
  });

  it("hiç görünen yoksa bütün katalog", () => {
    expect(defaultColumnSelection(catalog.map((c) => ({ ...c, visible: false })))).toEqual(["a", "b", "c"]);
  });

  it("sıra işaretleme sırası değil katalog sırası", () => {
    expect(orderByCatalog(catalog, ["c", "b", "a"])).toEqual(["a", "b", "c"]);
  });

  it("tanınmayan id fırlatır (fail-closed), boş seçim de geçersiz", () => {
    expect(() => assertKnownColumns(catalog, ["a", "zz"])).toThrow(UnknownExportColumnError);
    expect(() => assertKnownColumns(catalog, [])).toThrow();
    expect(() => assertKnownColumns(catalog, ["b"])).not.toThrow();
  });

  it("kayıtlı seçimde eski id atılır, hiç kalmazsa null", () => {
    expect(restoreColumnSelection(catalog, ["c", "eski", "b"])).toEqual(["b", "c"]);
    expect(restoreColumnSelection(catalog, ["eski"])).toBeNull();
    expect(restoreColumnSelection(catalog, "bozuk")).toBeNull();
  });

  it("tercih blob'u güvenli okunur", () => {
    expect(readSavedExportChoice(null)).toBeNull();
    expect(readSavedExportChoice({ columns: ["a", 3], format: "docx", detail: "kalem" })).toEqual({
      columns: ["a"],
      detail: "kalem",
    });
    expect(readSavedExportChoice({ format: "pdf" })).toEqual({ format: "pdf" });
  });
});
