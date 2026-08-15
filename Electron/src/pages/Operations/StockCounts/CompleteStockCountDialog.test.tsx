// =============================================================================
// BEKÇİ — yıkıcı onay SOMUT mu?
// =============================================================================
// `stockCountRules.test.ts` kapsamın DOĞRU TÜRETİLDİĞİNİ ölçer; bu dosya
// türetilen kapsamın GERÇEKTEN EKRANA BASILDIĞINI ölçer. İkisi ayrı hata
// sınıfıdır ve bu projede ikincisi yaşandı ("özellik yazıldı, test edildi,
// kullanıcıya hiç ulaşmadı" — 2026-08-05 "Ekleme Nedeni" vakası).
//
// Kilitlenenler:
//   ① İptal edilecek her top BARKODUYLA basılır ("N kayıt etkilenecek" yetmez).
//   ② "Hiç sayılmadı" sayacı görünür — sayılmayanın ne olacağı bu ekranda
//      cevaplanmalı, yoksa kullanıcı yarım sayımı tamamlamaya çekinir ya da
//      (daha kötüsü) hepsinin düşeceğini sanır.
//   ③ Kapsam dışı adayları SEBEBİYLE basılır.
//   ④ Engel varken düğme KAPALIDIR ve istek ATILMAZ.
//
// NEGATİF SONDA (2026-08-15, 2 sonda; dosyalar `shasum` ile geri yüklendi):
//   ① `missing` listesi `<li>`ler yerine yalnız sayı basacak şekilde
//      değiştirildi                                        → 2 kontrol düştü
//   ② onay düğmesindeki `disabled={Boolean(blocked)…}` kaldırıldı → 1 düştü
// =============================================================================
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import type { StockCountDetail, StockCountLine } from "./service";

const completeStockCount = vi.fn();
vi.mock("./service", () => ({
  completeStockCount: (...a: unknown[]) => completeStockCount(...a),
}));

import { CompleteStockCountDialog } from "./CompleteStockCountDialog";

let seq = 0;
function roll(over: Partial<StockCountLine> & { barcode?: string; status?: string } = {}): StockCountLine {
  const { barcode, status, ...rest } = over;
  seq++;
  return {
    id: `l${seq}`,
    kind: "ROLL",
    expectedQty: "100",
    countedQty: null,
    found: null,
    notes: null,
    outOfScopeReason: null,
    roll: {
      id: `r${seq}`,
      barcode: barcode ?? `TOP${seq}`,
      status: status ?? "WAREHOUSE",
      width: null,
      item: { name: "Süprem" },
      color: { name: "Siyah" },
    },
    item: null,
    ...rest,
  };
}

function yarn(over: Partial<StockCountLine> = {}): StockCountLine {
  seq++;
  return {
    id: `l${seq}`,
    kind: "YARN",
    expectedQty: "500",
    countedQty: null,
    found: null,
    notes: null,
    outOfScopeReason: null,
    roll: null,
    item: { id: `i${seq}`, code: "IP-01", name: "30/1 Penye" },
    ...over,
  };
}

function detail(lines: StockCountLine[], status: StockCountDetail["status"] = "DRAFT"): StockCountDetail {
  return {
    id: "sc-1",
    countNo: "SAY1508260001",
    status,
    notes: null,
    createdAt: "2026-08-15T08:00:00Z",
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    warehouse: { id: "w1", code: "MRK", name: "Merkez" },
    lines,
  };
}

describe("CompleteStockCountDialog", () => {
  beforeEach(() => {
    completeStockCount.mockResolvedValue({ data: { countNo: "SAY1508260001" } });
  });

  it("⭐ iptal edilecek her top BARKODUYLA basılır (soyut sayı yetmez)", () => {
    renderWithProviders(
      <CompleteStockCountDialog
        count={detail([
          roll({ barcode: "R-101", found: false, expectedQty: "140.5" }),
          roll({ barcode: "R-102", found: false, expectedQty: "60" }),
          roll({ barcode: "R-103", found: true }),
        ])}
        onOpenChange={() => {}}
        onCompleted={() => {}}
      />,
    );

    expect(screen.getByText("R-101")).toBeInTheDocument();
    expect(screen.getByText("R-102")).toBeInTheDocument();
    // Toplam da yazılır ama listenin YERİNE geçmez.
    expect(screen.getByText(/2 top · 200,5 m/)).toBeInTheDocument();
  });

  it("⭐ “hiç sayılmadı” sayacı görünür ve DÜŞÜLMEYECEĞİNİ söyler", () => {
    renderWithProviders(
      <CompleteStockCountDialog
        count={detail([roll(), roll(), roll({ found: false })])}
        onOpenChange={() => {}}
        onCompleted={() => {}}
      />,
    );
    expect(screen.getByText(/2 top hiç sayılmadı/)).toBeInTheDocument();
    expect(screen.getByText(/eksik SAYILMAZ/)).toBeInTheDocument();
    // ⚠️ Sayaç TEK BAŞINA YETMEZ: sayılmayanlar aynı anda "düşülecekler"
    // listesine de yazılıyor olabilir (kapsam türetimi bozulursa tam bu olur —
    // negatif sonda ① bu satır olmadan bu dosyayı YEŞİL bırakıyordu). Düşülecek
    // başlığı yalnız GERÇEKTEN eksik olan 1 topu saymalı.
    expect(screen.getByText(/1 top · 100 m/)).toBeInTheDocument();
  });

  it("⭐ kapsam dışı adayı SEBEBİYLE basılır ve düşülecekler listesinde YER ALMAZ", () => {
    renderWithProviders(
      <CompleteStockCountDialog
        count={detail([
          roll({ barcode: "R-201", found: false, expectedQty: "100" }),
          roll({ barcode: "R-202", found: false, expectedQty: "60", status: "SHIPPED" }),
        ])}
        onOpenChange={() => {}}
        onCompleted={() => {}}
      />,
    );
    expect(screen.getByText(/Bu sırada sevk edilmiş/)).toBeInTheDocument();
    // Metraj ŞİŞMEZ: yalnız gerçekten düşülecek 100 m sayılır.
    expect(screen.getByText(/1 top · 100 m/)).toBeInTheDocument();
  });

  it("iplik farkı yön İŞARETİYLE basılır (renk tek başına yetmez)", () => {
    renderWithProviders(
      <CompleteStockCountDialog
        count={detail([yarn({ expectedQty: "500", countedQty: "480" })])}
        onOpenChange={() => {}}
        onCompleted={() => {}}
      />,
    );
    expect(screen.getByText(/500 → 480 kg \(−20\)/)).toBeInTheDocument();
  });

  it("düğme yaptığı işin adını taşır", () => {
    renderWithProviders(
      <CompleteStockCountDialog
        count={detail([roll({ found: false }), yarn({ countedQty: "480" })])}
        onOpenChange={() => {}}
        onCompleted={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "1 topu düş · 1 iplik farkını yaz ve tamamla" })).toBeEnabled();
  });

  it("⭐ engel varken düğme KAPALI ve istek atılmaz (dokunulmamış sayım)", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CompleteStockCountDialog
        count={detail([roll(), roll()])}
        onOpenChange={() => {}}
        onCompleted={() => {}}
      />,
    );
    expect(screen.getByText(/Hiçbir satır işaretlenmedi/)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /tamamla/i });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(completeStockCount).not.toHaveBeenCalled();
  });

  it("onaylanınca sayım id'siyle tamamlama isteği gider", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CompleteStockCountDialog
        count={detail([roll({ found: false })])}
        onOpenChange={() => {}}
        onCompleted={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: /1 topu düş/ }));
    expect(completeStockCount).toHaveBeenCalledWith("sc-1");
  });

  it("liste bir ÖNGÖRÜDÜR — kesinlik iddia edilmez", () => {
    renderWithProviders(
      <CompleteStockCountDialog
        count={detail([roll({ found: false })])}
        onOpenChange={() => {}}
        onCompleted={() => {}}
      />,
    );
    expect(screen.getByText(/ÖNGÖRÜDÜR/)).toBeInTheDocument();
  });
});
