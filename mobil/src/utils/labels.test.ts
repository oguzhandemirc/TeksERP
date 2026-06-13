import {
  trLabel,
  isRetiredRoll,
  RETIRED_ROLL_STATUSES,
  ROLL_STATUS_LABEL,
  WORK_ORDER_STATUS_LABEL,
} from "./labels";

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
