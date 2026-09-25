// BEKÇİ — numaralandırma önizlemesinin sunucu uyarısı (etikete SIĞMIYOR) SATIR İÇİ gösterilir, TOST OLMAZ
// (S1b SINIR, 2026-09-25). Uyarı tasarlanmıştı ama servis zarfı soyduğu için hiç görünmüyordu.
// ① istek `serverWarnings: "handled"` taşır → apiClient interceptor'ı tost basmaz (her tuşta tost yağmaz)
// ② servis `warnings`i döndürür · ③ önizleme kutusunun altında satır içi görünür.
// Negatif sonda (2026-09-25): servisten `serverWarnings` bayrağı kaldırıldı → ① kırmızı, geri alındı.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const UYARI = "“Top · 50x30” etiketine SIĞMIYOR (4 mm taşıyor).";
const post = vi.fn(async () => ({ data: { success: true, data: { preview: "P-0001", next: "P-0002" }, warnings: [UYARI] } }));
vi.mock("@/services/apiClient", () => ({ default: { post: (...a: unknown[]) => post(...(a as [])), get: vi.fn(), patch: vi.fn() } }));
import { numberingService } from "./service";
import { NumberingPreviewBoxes } from "./NumberingPreviewBoxes";

describe("Numaralandırma önizlemesi — sunucu uyarısı satır içi", () => {
  it("① ⭐ istek genel tost basımından çıkar (`serverWarnings: \"handled\"`) ② servis uyarıyı döndürür", async () => {
    const r = await numberingService.preview("batch", { prefix: "P", dateSegment: null, digits: 4, separator: "-", separator2: null } as never);
    const cfg = (post.mock.calls[0] as unknown[])[2] as { serverWarnings?: string };
    expect(cfg.serverWarnings).toBe("handled");
    expect(r.warnings).toEqual([UYARI]);
  });

  it("③ uyarı önizleme kutusunun altında satır içi; yoksa satır çizilmez", () => {
    const { rerender } = render(<NumberingPreviewBoxes preview="P-0001" next="P-0002" warnings={[UYARI]} />);
    expect(screen.getByRole("status").textContent).toBe(UYARI);
    rerender(<NumberingPreviewBoxes preview="P-0001" next="P-0002" warnings={[]} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
