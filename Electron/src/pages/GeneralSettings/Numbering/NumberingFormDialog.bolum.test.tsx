// =============================================================================
// BEKÇİ — BİÇİM HATASI SAYAÇ VE KAYNAK KAYDINI BAĞLAMAZ (K1 · K5, 2026-09-23)
// =============================================================================
// ⭐ NEDEN VAR (d3 gerçek panelde ölçtü): diyalog açılır açılmaz önizleme ucuna
//    istek gidiyordu; kilitli bir seride o uç 400 dönüyor, panel hatayı TEK bir
//    kovaya yazıyor ve Kaydet düğmesi TAMAMEN kapanıyordu. Sonuç: biçimi kilitli
//    ama sayacı AÇIK 44 seride sayaç ayarı hiç kaydedilemiyordu — motoru ve izni
//    olan, çıkış yüzeyi kapalı bir yetenek (bu depoda adı konmuş sınıf).
//
//   §1 ⭐ kilitli seride önizleme İSTENMEZ (istek sayısı 0)
//   §2 ⭐ kilitli biçim + değişen sayaç → Kaydet AÇIK
//   §3 ⭐ önizleme hatası: örnek "—" olur (bayat örnek kalmaz) ve hata BÖLÜMDE
//   §4 ⭐ geçersiz sayaç değeri Kaydet'i bağlar ve mesaj alanın yanındadır
//
// ⭐ NEGATİF SONDA (ölçüldü, bu commit): `disabled`ı eski hâline
//    (`hata !== null`) çevirince §2 KIRMIZI; `if (!row.editable) return;`
//    satırı silinince §1 KIRMIZI; `setOnizleme("")` kaldırılınca §3 KIRMIZI;
//    `engel`den sayaç ayağı çıkarılınca §4 KIRMIZI.
// =============================================================================
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NumberingFormDialog } from "./NumberingFormDialog";
import { numberingService } from "./service";
import type { NumberSeriesRow } from "./types";

vi.mock("./service", () => ({
  numberingService: {
    preview: vi.fn(),
    saveChanges: vi.fn(),
  },
}));

function row(over: Partial<NumberSeriesRow> = {}): NumberSeriesRow {
  return {
    key: "workOrder",
    label: "İş emri / refakat kartı no",
    prefix: "IE",
    dateSegment: "DDMMYY",
    digits: 4,
    separator: "",
    separator2: null,
    retiredPrefixes: [],
    editable: false,
    lockedReason: "Bu serinin biçimi henüz açılmadı; sayaç ayarları kullanılabilir.",
    lockUnlock: "Bir sonraki program güncellemesinde açılacak.",
    lockActor: "biz",
    lockKind: "SAYAC",
    panelGroup: "uretim",
    panelGroupLabel: "Üretim",
    counter: { startValue: true, step: true, maxValue: true, reset: false, resetReason: "Sayaç geriye alınamaz." },
    source: { editable: false, value: "FREE" },
    startValue: null,
    step: null,
    maxValue: null,
    wrap: false,
    preview: "IE2309230001",
    ...over,
  };
}

const ciz = (r: NumberSeriesRow) =>
  render(
    <NumberingFormDialog
      row={r}
      etkiSayisi={12}
      birim="kayıt"
      exhaustion={null}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );

const kaydet = (): HTMLElement => screen.getByRole("button", { name: "Kaydet" });

describe("Numaralandırma diyaloğu — bölüm bölüm hata", () => {
  beforeEach(() => {
    vi.mocked(numberingService.preview).mockReset();
    vi.mocked(numberingService.preview).mockResolvedValue({ preview: "IE2309230001", next: "IE2309230004" });
  });

  it("⭐ §1 kilitli seride önizleme ucuna İSTEK GİTMEZ", () => {
    ciz(row());
    expect(numberingService.preview).not.toHaveBeenCalled();
  });

  it("⭐ §2 biçim kilitliyken sayaç değişince Kaydet AÇIK", () => {
    // ⚠️ ÖNİZLEME BİLEREK REDDEDİYOR: kilitli satırda uç zaten 400 dönüyordu.
    // Kilit-atlaması kalkarsa bu istek gider, hata kovaya düşer ve ESKİ davranışta
    // Kaydet kapanırdı — sonda o regresyonu görsün diye mock REDDEDER.
    vi.mocked(numberingService.preview).mockRejectedValue({
      response: { data: { message: "Bu serinin biçimi değiştirilemez." } },
    });
    ciz(row());
    expect(kaydet()).toBeDisabled(); // hiçbir şey değişmedi
    fireEvent.change(screen.getByLabelText("Başlangıç"), { target: { value: "5" } });
    expect(kaydet()).not.toBeDisabled();
  });

  it("⭐ §2b AÇIK seride biçim hatası varken bile SAYAÇ kaydedilebilir", async () => {
    // Bu, K1'in çekirdeği: hata BİÇİM bölümüne aittir, diyaloğa değil.
    vi.mocked(numberingService.preview).mockRejectedValue({
      response: { data: { message: "Hane sayısı en fazla 8 olabilir." } },
    });
    ciz(row({ key: "packingLotCode", editable: true, lockKind: undefined, lockedReason: undefined }));
    await screen.findByText("Hane sayısı en fazla 8 olabilir.");
    expect(kaydet()).toBeDisabled(); // henüz hiçbir bölüm değişmedi
    fireEvent.change(screen.getByLabelText("Başlangıç"), { target: { value: "5" } });
    expect(kaydet()).not.toBeDisabled(); // sayaç bölümü bağımsız
  });

  it("⭐ §5 ALAN mesajı gösterilir: `errors[0].message` `message`in önüne geçer", async () => {
    // d3 ölçtü (2026-09-23): sunucu alan mesajını `errors[]`te döndürüyor, gövdedeki
    // `message` yalnız "Validasyon hatası" diyor. Ekran `message`i tek başına
    // okuyunca kullanıcı sebebi HİÇ görmüyordu.
    vi.mocked(numberingService.preview).mockRejectedValue({
      response: {
        data: {
          message: "Validasyon hatası",
          errors: [{ field: "digits", message: "Hane sayısı en fazla 8 olabilir." }],
        },
      },
    });
    ciz(row({ key: "packingLotCode", editable: true, lockKind: undefined, lockedReason: undefined }));
    expect(await screen.findByText("Hane sayısı en fazla 8 olabilir.")).toBeTruthy();
    expect(screen.queryByText("Validasyon hatası")).toBeNull();
  });

  it("⭐ §3 önizleme hatası: örnek '—' olur ve hata BİÇİM bölümünde görünür", async () => {
    vi.mocked(numberingService.preview).mockRejectedValue({
      response: { data: { message: "Hane sayısı en fazla 8 olabilir." } },
    });
    ciz(row({ key: "packingLotCode", editable: true, lockKind: undefined, lockedReason: undefined }));
    expect(await screen.findByText("Hane sayısı en fazla 8 olabilir.")).toBeTruthy();
    // İKİ kutu da "—" olur: bayat örnek DE bayat "sıradaki numara" DA kalmaz.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("⭐ §4 geçersiz sayaç değeri Kaydet'i bağlar, mesaj alanın yanındadır", () => {
    ciz(row());
    fireEvent.change(screen.getByLabelText("Başlangıç"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Üst sınır"), { target: { value: "2" } });
    expect(screen.getByText("Üst sınır, başlangıç değerinden küçük olamaz.")).toBeTruthy();
    expect(kaydet()).toBeDisabled();
  });

  it("§4b sıfır/negatif adım da bağlar", () => {
    ciz(row());
    fireEvent.change(screen.getByLabelText("Artış adımı"), { target: { value: "0" } });
    expect(screen.getByText("Artış adımı en az 1 olmalı.")).toBeTruthy();
    expect(kaydet()).toBeDisabled();
  });
});

describe("Numaralandırma diyaloğu — ALAN bazında kilit (E4)", () => {
  beforeEach(() => {
    vi.mocked(numberingService.preview).mockReset();
    vi.mocked(numberingService.preview).mockResolvedValue({ preview: "FS2309230001", next: "FS2309230002" });
  });

  // ⭐ ÖLÇÜLDÜ (d3'ün eski istemci simülasyonu): okutulan sekiz serinin altısında
  // eski panel/tablet YALNIZ ön ekten kırılıyor. "Seriyi tamamen kapat" kararı
  // fabrikanın hane/tarih/ayraç ayarını SEBEPSİZ kilitliyordu.
  // ⭐ NEGATİF SONDA (bu commit): `lockedAxes` yok sayılınca tarih alanı da pasif
  // kalıyor ve §2 kırmızı; `prefix` listeden çıkarılınca §1 kırmızı.
  it("⭐ §1 kilitli eksen (ön ek) PASİF çizilir", () => {
    ciz(row({ key: "subcontractorDispatch", editable: true, lockKind: "ISTEMCI", lockedAxes: ["prefix"] }));
    expect(screen.getByLabelText("Ön ek")).toBeDisabled();
  });

  it("⭐ §2 kilitli OLMAYAN eksenler AÇIK kalır (tarih · hane · ayraç)", () => {
    ciz(row({ key: "subcontractorDispatch", editable: true, lockKind: "ISTEMCI", lockedAxes: ["prefix"] }));
    expect(screen.getByLabelText("Hane")).not.toBeDisabled();
    expect(screen.getByLabelText("Tarih")).not.toBeDisabled();
    expect(screen.getByLabelText("Ayraç (ön ek ile tarih arası)")).not.toBeDisabled();
  });

  // ⭐ K25 (2026-09-23): kısmi kilitte satır `editable` olduğu için gerekçe
  // cümlesi HİÇ çizilmiyordu — kullanıcı pasif bir alan görüyor, sebebini yalnız
  // TABLO rozetinde bulabiliyordu. Sebep, alanın YANINDA olmalı.
  // ⭐ NEGATİF SONDA (bu commit): koşuldaki `lockedAxes` kolu kaldırılınca §2b ❌.
  it("⭐ §2b KISMİ kilitte de GEREKÇE cümlesi çizilir (sebep alanın yanında)", () => {
    ciz(
      row({
        key: "subcontractorDispatch",
        editable: true,
        lockKind: "ISTEMCI",
        lockedAxes: ["prefix"],
        lockedReason: "Okutulan bir seri: sahadaki eski panel/tablet ön ek değişimini okutamıyor.",
        lockUnlock: "Panel 1.3.2 ve tablet 1.0.8 ya da üstü kurulunca açılır.",
      }),
    );
    // Cümle SUNUCUDAN gelir; panel yalnız birleştirir (`lockSentence`).
    expect(screen.getByText(/ön ek değişimini okutamıyor/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.0\.8 ya da üstü/i)).toBeInTheDocument();
  });

  it("§2c kilitsiz seride gerekçe cümlesi ÇİZİLMEZ (kapı fazla geniş değil)", () => {
    ciz(row({ key: "order", editable: true, lockKind: undefined, lockedAxes: undefined }));
    expect(screen.queryByText(/okutamıyor/i)).toBeNull();
  });

  it("§3 tam kilitte (tüm eksenler) her alan pasif", () => {
    ciz(
      row({
        key: "sack",
        editable: false,
        lockKind: "ISTEMCI",
        lockedAxes: ["prefix", "dateSegment", "digits", "separator", "separator2"],
      }),
    );
    expect(screen.getByLabelText("Ön ek")).toBeDisabled();
    expect(screen.getByLabelText("Hane")).toBeDisabled();
  });
});
