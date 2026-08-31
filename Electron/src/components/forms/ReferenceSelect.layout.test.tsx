// =============================================================================
// BEKÇİ — ReferenceSelect TEK KÖK ELEMAN DÖNDÜRÜR (pasif olsa da olmasa da)
// =============================================================================
// ⭐ NEDEN VAR (2026-08-15). "Pasif kayıt" düzeltmesi bileşenin RENDER
//    SÖZLEŞMESİNİ değiştirmişti: `<>` içinde Popover + (pasifse) kardeş bir
//    `<p>` uyarı. Yani bileşen bazen 1, bazen 2 düğüm döndürüyordu.
//
//    Tüketicilerin çoğu onu bir `<div>` içine sarıyor (güvenli) ama
//    `Operations/GoodsReceipts/ReceiptLineRows` satırı `grid` ve HEM kumaş HEM
//    renk seçicisi grid'in DOĞRUDAN çocuğu. İkinci düğüm fazladan bir HÜCRE
//    açar → satırdaki tüm sonraki kolonlar (metraj/en/kg/kat/sil) bir kolon
//    kayar, sonuncusu alt satıra düşer. Hata yok, log yok; yalnız bozuk satır.
//
// ⚠️ TETİKLENMESİ TEORİK DEĞİL: mal kabul formunda "Kalemleri siparişten
//    doldur" satırları sipariş kalemleriyle ön-doldurur
//    (`PurchaseOrders/receiptOrderFields.fillLinesFromOrder`); sonradan pasife
//    alınmış bir kalem `getById` ile `isActive: false` olarak çözülür ve
//    `selectedPassive` true olur — liste sorgusu `isActive:true` süzgeçli olsa
//    bile.
//
// ⭐ ÖLÇÜLEN: bir grid kapsayıcının DOĞRUDAN çocuk sayısı, pasif ve aktif
//    seçimde AYNI (1) kalıyor mu. Saf `isPassiveRecord` yüklemi ayrı bekçide
//    (`referenceSelectState.test.ts`) — o, RENDER ŞEKLİNİ ölçmez.
//
// NEGATİF SONDA (koşuldu, kırmızı görüldü): sarmalayıcı `<div>` yeniden `<>`
// Fragment'a çevrildi → "pasif seçimde de tek hücre" KIRMIZI (2 çocuk).
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { ReferenceSelect } from "./ReferenceSelect";
import { PASSIVE_HINT } from "./referenceSelectState";
import type { CrudService } from "@/services/crudService";

interface Row {
  id: string;
  name: string;
  isActive?: boolean;
}

/** `getById` pasif kayıt döndüren sahte servis (liste yalnız aktifleri verir). */
function makeService(selected: Row): Pick<CrudService<Row>, "getAll" | "getById"> {
  return {
    getAll: vi.fn().mockResolvedValue({ data: [], pagination: { total: 0 } }),
    getById: vi.fn().mockResolvedValue({ data: selected }),
  };
}

function renderInGrid(selected: Row) {
  const service = makeService(selected) as unknown as CrudService<Row>;
  const r = renderWithProviders(
    <div data-testid="grid" className="grid grid-cols-3">
      <ReferenceSelect<Row>
        value={selected.id}
        onChange={() => {}}
        service={service}
        queryKey="probe"
        getLabel={(x) => x.name}
      />
      <span>ikinci hücre</span>
      <span>üçüncü hücre</span>
    </div>,
  );
  return r;
}

describe("ReferenceSelect — grid hücresi sözleşmesi", () => {
  it("⭐ PASİF seçimde de grid'e TEK hücre koyar (kolonlar kaymaz)", async () => {
    const { getByTestId, findByText } = renderInGrid({
      id: "p1",
      name: "Pasif Kumaş",
      isActive: false,
    });
    // Pasif uyarısı GERÇEKTEN basıldı (körlük zemini: uyarı çizilmiyorsa bu
    // test hiçbir şey ölçmez — Fragment'lı hâlde de tek çocuk görünürdü).
    await findByText(PASSIVE_HINT);
    expect(getByTestId("grid").children.length).toBe(3);
  });

  it("AKTİF seçimde hücre sayısı aynı (davranış değişmedi)", async () => {
    const { getByTestId, queryByText } = renderInGrid({
      id: "a1",
      name: "Aktif Kumaş",
      isActive: true,
    });
    await waitFor(() => expect(getByTestId("grid").textContent).toContain("Aktif Kumaş"));
    expect(queryByText(PASSIVE_HINT)).toBeNull();
    expect(getByTestId("grid").children.length).toBe(3);
  });
});
