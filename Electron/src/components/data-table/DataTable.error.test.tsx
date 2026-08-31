// =============================================================================
// BEKÇİ — DataTable: "HATA" ile "KAYIT YOK" AYRI ŞEYLERDİR
// =============================================================================
// ⭐ Bu dosyanın var oluş sebebi bir HATA SINIFI: liste sorgusu düştüğünde
//    `rows` boş kalır ve boş-durum metni ("Kayıt bulunamadı.") OLUMLU bir iddia
//    olarak basılır. Kullanıcı kaydın silindiğini sanıp ikinci kez tanımlar —
//    ticarette bu MÜKERRER depo / cari / kasa demektir ve sonraki hareketler
//    yanlış karta yazılır.
// ⭐ SIRA LOAD-BEARING: hata dalı boş dalın ÖNÜNDE olmak zorunda. Altta kalsaydı
//    kod "isError prop'u var" derdi ama ekran yine "Kayıt bulunamadı." basardı;
//    yani düzeltme tamamen boşa düşerdi ve bunu yalnız bu test görür.
// ⭐ İKİNCİ KATMAN: elde bayat satır varken liste GİZLENMEZ (veri göstermemek de
//    bir yalandır) — üstüne "tazelenemedi" bandı konur.
// ⭐ CrudPage KABLOSU: prop'u eklemek yetmez, 14 tanım ekranının tek geçiş
//    noktası olan CrudPage'in onu GERÇEKTEN geçirmesi gerekir (2026-08-06
//    dersinin ikizi: "yazılmış ama hiçbir ekran import etmemiş").
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderWithProviders } from "@/test/render";
import { DataTable } from "./DataTable";

interface Row {
  id: string;
  name: string;
}

const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: "name", header: "Ad" }];

function Harness({
  rows,
  isError,
  onRetry,
  errorText,
}: {
  rows: Row[];
  isError?: boolean;
  onRetry?: () => void;
  errorText?: string;
}) {
  const table = useReactTable({
    data: rows,
    columns: COLUMNS,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: false,
  });
  return (
    <DataTable<Row>
      table={table}
      isError={isError}
      onRetry={onRetry}
      errorText={errorText}
      emptyText="Kayıt bulunamadı."
    />
  );
}

describe("DataTable — hata ↔ boş durum ayrımı", () => {
  it("HATA + satır yok: boş-durum metni BASILMAZ, hata kutusu basılır", () => {
    renderWithProviders(<Harness rows={[]} isError />);

    // Asıl kural: "Kayıt bulunamadı." hata anında EKRANDA OLMAMALI.
    expect(screen.queryByText("Kayıt bulunamadı.")).toBeNull();
    expect(screen.getByText("Liste yüklenemedi")).toBeTruthy();
    // "kayıt yok DEĞİLDİR" cümlesi olmadan kullanıcı yine yanlış okur.
    expect(screen.getByText(/anlamına GELMEZ/)).toBeTruthy();
  });

  it("hata kutusu SUNUCUNUN kendi cümlesini basar (yetki/modül sebebi yalnız orada yaşar)", () => {
    renderWithProviders(
      <Harness rows={[]} isError errorText="Ön muhasebe modülü bu kurulumda kapalı." />,
    );
    expect(screen.getByText("Ön muhasebe modülü bu kurulumda kapalı.")).toBeTruthy();
  });

  it("“Tekrar dene” yalnız onRetry verilince çıkar ve gerçekten çağırır", async () => {
    const onRetry = vi.fn();
    const { unmount } = renderWithProviders(<Harness rows={[]} isError onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /Tekrar dene/ }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    unmount();

    // İş yapmayan düğme, hata ekranındaki en kötü şeydir (ReportErrorCard kuralı).
    renderWithProviders(<Harness rows={[]} isError />);
    expect(screen.queryByRole("button", { name: /Tekrar dene/ })).toBeNull();
  });

  it("HATA + bayat satır var: satırlar GİZLENMEZ, üstüne tazelenemedi bandı konur", () => {
    renderWithProviders(<Harness rows={[{ id: "1", name: "Merkez Depo" }]} isError />);

    expect(screen.getByText("Merkez Depo")).toBeTruthy();
    expect(screen.getByText(/tazelenemedi/)).toBeTruthy();
    // Tam-ekran hata kutusu bu durumda BASILMAZ (veri var, gizlenmemeli).
    expect(screen.queryByText("Liste yüklenemedi")).toBeNull();
  });

  it("hata YOKKEN davranış bayt-bayt eski: boş liste boş-durum metnini basar", () => {
    renderWithProviders(<Harness rows={[]} />);
    expect(screen.getByText("Kayıt bulunamadı.")).toBeTruthy();
    expect(screen.queryByText("Liste yüklenemedi")).toBeNull();
    expect(screen.queryByText(/tazelenemedi/)).toBeNull();
  });

  it("dolu liste + hata yok: ne hata kutusu ne bant", () => {
    renderWithProviders(<Harness rows={[{ id: "1", name: "Merkez Depo" }]} />);
    expect(screen.getByText("Merkez Depo")).toBeTruthy();
    expect(screen.queryByText(/tazelenemedi/)).toBeNull();
  });
});

describe("CrudPage — kablo bağlı mı (14 tanım ekranının tek geçiş noktası)", () => {
  // ⚠️ KAYNAK TARAMASI, render DEĞİL: CrudPage jenerik bir servis + mutation
  // yığını ister ve onu ayağa kaldırmak bu kuralı ölçmekten daha kırılgandır.
  // Ölçülen şey tek ve nettir: prop GERÇEKTEN geçiriliyor mu.
  const source = readFileSync(
    resolve(__dirname, "../layout/CrudPage.tsx"),
    "utf8",
  );

  it("`isError` DataTable'a geçirilir", () => {
    expect(source).toMatch(/isError=\{query\.isError\}/);
  });

  it("`onRetry` gerçek bir refetch'e bağlıdır (boş fonksiyon değil)", () => {
    expect(source).toMatch(/onRetry=\{\(\) => void query\.refetch\(\)\}/);
  });
});
