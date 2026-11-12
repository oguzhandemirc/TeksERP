// İE detayı "Gelen kg" (belge tanıt 3 aşama): yalnız İE belgeden doğmuşsa (incoming != null); kg null → "—" + "Belgede kg yok"
// ipucu (kısmi toplam gösterilmez). Negatif sonda: IncomingKg'deki `incoming.kg == null` dalı kaldırılınca (Number(null)=0)
// "0 kg" çıkar ve §2 kırmızı.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { IncomingKg } from "./SheetKpis";

describe("İE detayı Gelen kg", () => {
  it("⭐ §1 belgeden doğmuş İE: Decimal metni sayıya çevrilir", () => {
    render(<IncomingKg incoming={{ meters: "241", kg: "180.40", kgSource: "DOCUMENT" }} />);
    expect(screen.getByTestId("wo-incoming-kg")).toHaveTextContent(/^Gelen kg 180 kg$/);
  });

  it("⭐ §2 kg eksik → — ve ipucu", () => {
    render(<IncomingKg incoming={{ meters: 241, kg: null, kgSource: null }} />);
    const el = screen.getByTestId("wo-incoming-kg");
    expect(el).toHaveTextContent("Gelen kg —");
    expect(el).toHaveAttribute("title", "Belgede kg yok");
  });

  it("belgeden doğmamış İE (ya da eski sunucu) → çizilmez", () => {
    const { container } = render(<IncomingKg incoming={null} />);
    expect(container).toBeEmptyDOMElement();
    render(<IncomingKg incoming={undefined} />);
    expect(screen.queryByTestId("wo-incoming-kg")).toBeNull();
  });
});
