import {
  trLabel,
  isRetiredRoll,
  RETIRED_ROLL_STATUSES,
  ROLL_STATUS_LABEL,
  WORK_ORDER_STATUS_LABEL,
  ORDER_STATUS_LABEL,
  ORDER_STATUS_FILTER_LABEL,
  STATION_TYPE_LABEL,
} from "./labels";

describe("sipariş durumu — sevk dili (panel orderStatusLabels ile aynı)", () => {
  it("her durum günlük dil; 'Onaylandı' / 'Kısmen Sevk' jargonu yok", () => {
    expect(ORDER_STATUS_LABEL).toEqual({
      PENDING: "Henüz onaylanmadı",
      APPROVED: "Henüz gönderilmedi",
      PARTIAL_SHIPPED: "Bir kısmı gönderildi",
      COMPLETED: "Hepsi gönderildi",
      CANCELLED: "Sipariş iptal edildi",
    });
    expect(ORDER_STATUS_FILTER_LABEL.COMPLETED).toBe("Hepsi gönderildi ya da elle kapatıldı");
  });
});

describe("trLabel (enum → Türkçe etiket)", () => {
  it("bilinen kodu çevirir", () => {
    expect(trLabel(WORK_ORDER_STATUS_LABEL, "IN_PROGRESS")).toBe("Devam Ediyor");
    expect(trLabel(ROLL_STATUS_LABEL, "WAREHOUSE")).toBe("Depo");
  });
  it("boş/null/undefined → tire", () => {
    expect(trLabel(ROLL_STATUS_LABEL, null)).toBe("—");
    expect(trLabel(ROLL_STATUS_LABEL, undefined)).toBe("—");
    expect(trLabel(ROLL_STATUS_LABEL, "")).toBe("—");
  });
  it("bilinmeyen kod → kodu aynen döner (sessiz düşmez)", () => {
    expect(trLabel(ROLL_STATUS_LABEL, "BILINMEYEN")).toBe("BILINMEYEN");
  });
});

describe("isRetiredRoll (emekli/tüketilmiş top durumları)", () => {
  it("tüketilmiş durumlar emeklidir", () => {
    expect(isRetiredRoll("TAMBUR_CONSUMED")).toBe(true);
    expect(isRetiredRoll("SUBCONTRACTOR_CONSUMED")).toBe(true);
    expect(isRetiredRoll("KARTELA_CONSUMED")).toBe(true);
    expect(isRetiredRoll("CANCELLED")).toBe(true);
  });
  it("fiziksel olarak var olan toplar emekli DEĞİL", () => {
    // SCRAP fire KARARIDIR ama top kaydı arşiv değil → emekli listesinde değil.
    expect(isRetiredRoll("WAREHOUSE")).toBe(false);
    expect(isRetiredRoll("STOCK")).toBe(false);
    expect(isRetiredRoll("IN_PRODUCTION")).toBe(false);
    expect(isRetiredRoll("SCRAP")).toBe(false);
    expect(isRetiredRoll("SHIPPED")).toBe(false);
  });
  it("null/undefined → false (guard)", () => {
    expect(isRetiredRoll(null)).toBe(false);
    expect(isRetiredRoll(undefined)).toBe(false);
  });
  it("her emekli kodun bir etiketi var (UI tutarlılığı)", () => {
    for (const code of RETIRED_ROLL_STATUSES) {
      expect(ROLL_STATUS_LABEL[code]).toBeTruthy();
    }
  });
});

describe("istasyon türü — gerçek StationType enumu", () => {
  it("INTERNAL/EXTERNAL Türkçe; ham enum adı ekrana basılmaz (prova: \"INTERNAL · Aktif\")", () => {
    expect(trLabel(STATION_TYPE_LABEL, "INTERNAL")).toBe("Fabrika içi");
    expect(trLabel(STATION_TYPE_LABEL, "EXTERNAL")).toBe("Fason (dış)");
    expect(Object.keys(STATION_TYPE_LABEL).sort()).toEqual(["EXTERNAL", "INTERNAL"]);
  });
});
