// =============================================================================
// BEKÇİ — BAYAT TASLAK: YENİ SERİNİN ANAHTARI, ESKİ SERİNİN BİÇİMİ (K11)
// =============================================================================
// ⭐ SAHA BULGUSU (kullanıcı gördü, d3 görüntüledi 2026-09-23): Numaralandırma
//    ekranında bir seri açılınca ALAKASIZ bir çakışma mesajı çıkıyordu — çuval
//    açılınca "IE … iş emri ile çakışıyor", kartela kabul açılınca "KS …".
//    Kök neden bir eşzamanlılık değil, bir STATE BAĞIDIR: diyalog sayfada
//    sürekli bağlı duruyor, `row` değişince taslağı sıfırlayan effect ile
//    önizlemeyi çağıran effect AYNI commit'te koşuyor ve önizleme YENİ anahtarla
//    ESKİ biçimi gönderiyordu. Sunucu haklı olarak çakışma diyordu; yalan olan
//    İSTEKTİ.
//
//   §1 ⭐ Seri değişince atılan HİÇBİR önizleme isteği eski biçimi taşımaz
//   §2 ⭐ Önizleme isteği global toast BASTIRIR (hata alanın yanında durur)
//
// ⭐ NEGATİF SONDA (ölçüldü, bu commit): taslağın anahtar bağı kaldırılıp
//    `fmt` doğrudan state'ten okunduğunda §1 KIRMIZI (istek `sack` anahtarıyla
//    `IE` ön ekini taşıyor); `suppressErrorToast` kaldırılınca §2 KIRMIZI.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { NumberingFormDialog } from "./NumberingFormDialog";
import { numberingService } from "./service";
import type { NumberSeriesRow } from "./types";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("./service", () => ({
  numberingService: { preview: vi.fn(), saveChanges: vi.fn() },
}));

function row(key: string, prefix: string): NumberSeriesRow {
  return {
    key,
    label: key,
    prefix,
    dateSegment: "DDMMYY",
    digits: 4,
    separator: "",
    separator2: null,
    retiredPrefixes: [],
    editable: true,
    panelGroup: "uretim",
    panelGroupLabel: "Üretim",
    counter: { startValue: true, step: true, maxValue: true, reset: false, resetReason: "…" },
    source: { editable: false, value: "FREE" },
    startValue: null,
    step: null,
    maxValue: null,
    preview: `${prefix}2309230001`,
  };
}

const ciz = (r: NumberSeriesRow | null) => (
  <NumberingFormDialog
    row={r}
    etkiSayisi={null}
    birim="kayıt"
    exhaustion={null}
    onClose={() => {}}
    onSaved={() => {}}
  />
);

describe("Numaralandırma diyaloğu — bayat taslak", () => {
  beforeEach(() => {
    vi.mocked(numberingService.preview).mockReset();
    vi.mocked(numberingService.preview).mockResolvedValue({ preview: "X0001", next: "X0002" });
  });

  it("⭐ §1 seri değişince önizleme isteği ESKİ biçimi taşımaz", () => {
    const { rerender } = render(ciz(row("workOrder", "IE")));
    // Aynı bileşen bağlı kalır (sayfadaki gerçek durum), yalnız satır değişir.
    rerender(ciz(row("sack", "CV")));

    const cagrilar = vi.mocked(numberingService.preview).mock.calls;
    expect(cagrilar.length).toBeGreaterThan(0); // körlük zemini: istek gerçekten atıldı
    for (const [key, fmt] of cagrilar) {
      const beklenen = key === "workOrder" ? "IE" : "CV";
      expect(fmt.prefix).toBe(beklenen);
    }
  });

  it("⭐ §2 önizleme isteği global toast'ı bastırır (hata diyalogda durur)", () => {
    const kaynak = readFileSync(resolve(__dirname, "service.ts"), "utf8");
    // Yüklem ÇAĞRIYA bakar: bayrak preview çağrısının kendi config'inde olmalı.
    const parca = kaynak.slice(kaynak.indexOf("async preview("), kaynak.indexOf("async impact("));
    expect(parca).toContain("suppressErrorToast: true");
  });
});
