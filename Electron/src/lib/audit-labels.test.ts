import { describe, it, expect } from "vitest";
import {
  tableLabel,
  eventActionLabel,
  enumValueLabel,
  fieldLabel,
  auditValueText,
  formatAuditValue,
  EVENT_ACTION_LABELS,
} from "./audit-labels";
import { actionLabel as reportActionLabel } from "@/pages/Reports/_components/audit-labels";
import { eventActionLabel as eventsPageLabel, ACTIONS_BY_CATEGORY } from "@/pages/System/Events/labels";

// Saha bulgusu (2026-08-25): audit ekranlarında ham İngilizce ifadeler.
// Kapsamın MEKANİK bekçisi backend'te (`scripts/test_audit_labels.ts`, backend'in
// bastığı her tableName/olay/enum için karşılık arar). Buradaki testler DAVRANIŞI
// kilitler: fail-open korunuyor mu, iki ekran aynı sözlükten mi besleniyor.

describe("audit sözlüğü", () => {
  it("modül adını Türkçeleştirir, bilinmeyende HAM değeri döner (fail-open)", () => {
    expect(tableLabel("BATCH")).toBe("Parti");
    expect(tableLabel("WORK_SESSION")).toBe("Çalışma Oturumu");
    expect(tableLabel("HENUZ_YOK")).toBe("HENUZ_YOK");
    expect(tableLabel(null)).toBe("—");
  });

  it("alan adı TEK sözlükten gelir — ham blok ile diff satırı aynı Türkçeyi basar", () => {
    // Eskiden `currentQty` diff satırında "Metraj", ham blokta "currentQty" idi.
    expect(fieldLabel("currentQty")).toBe("Metraj");
    expect(fieldLabel("weightKg")).toBe("Ağırlık (kg)");
    expect(fieldLabel("bilinmeyenAlan")).toBe("bilinmeyenAlan");
  });

  it("diff satırı da enum sözlüğünden geçer", () => {
    // Regresyon: `auditValueText` eski hâlinde String(v) diyordu → "WAREHOUSE".
    expect(auditValueText("WAREHOUSE")).toBe("Depoda");
    expect(formatAuditValue("WAREHOUSE")).toBe("Depoda");
    expect(auditValueText(true)).toBe("Evet");
    expect(auditValueText(null)).toBe("—");
    expect(auditValueText({ a: 1 })).toBe("(içerik)");
  });

  it("uzun metni kırpar ama enum çevirisini bozmaz", () => {
    const uzun = "x".repeat(200);
    expect(auditValueText(uzun)).toHaveLength(61); // 60 + …
    expect(enumValueLabel("ACIK")).toBe("Açık kumaş");
  });
});

describe("sistem olayı adları TEK KAYNAK", () => {
  it("Sistem Kayıtları ile Denetim Raporları aynı sözlükten beslenir", () => {
    // Eskiden ayrı haritalardı: biri 11, diğeri 5 olay biliyordu.
    for (const action of Object.keys(EVENT_ACTION_LABELS)) {
      expect(eventsPageLabel(action)).toBe(EVENT_ACTION_LABELS[action]);
      expect(reportActionLabel(action)).toBe(EVENT_ACTION_LABELS[action]);
    }
    expect(eventActionLabel("BACKUP_COMPLETED")).toBe("Yedekleme tamamlandı");
  });

  it("CRUD çekimi ekrana ÖZEL kalır (rapor emir kipi)", () => {
    expect(reportActionLabel("CREATE")).toBe("Oluştur");
    expect(reportActionLabel(null)).toBe("—");
  });

  it("filtre listesi sözlükten TÜRER — elle tutulan liste bayatlamaz", () => {
    const hepsi = [...ACTIONS_BY_CATEGORY.AUTH, ...ACTIONS_BY_CATEGORY.SYSTEM].sort();
    expect(hepsi).toEqual(Object.keys(EVENT_ACTION_LABELS).sort());
    expect(ACTIONS_BY_CATEGORY.AUTH).toContain("LOGIN_CONFLICT");
    expect(ACTIONS_BY_CATEGORY.SYSTEM).toContain("DB_COPY_FAILED");
  });
});
