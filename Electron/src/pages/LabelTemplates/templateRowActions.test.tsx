// =============================================================================
// BEKÇİ — Etiket şablonu satırında AKSİYON HİZASI (yuva sayısı satırdan satıra
// değişmez)
// =============================================================================
// ⭐ NEDEN VAR (2026-09-04, kullanıcı bildirimi: "butonlar simetrik değil").
//    Satırın sağ ucundaki düğmeler duruma göre KOŞULLU çiziliyordu:
//      · bağlam varsayılanı şablonda "Pasife Al" + "Kalıcı Sil" YOK,
//      · pasif şablonda "Yazdır" YOK.
//    Düğmeler sağa yaslı olduğu için EKSİK düğme kendisinden sonrakileri sola
//    çeker → aynı ikon her satırda başka bir sütunda durur. Demo DB ölçümü
//    (2026-09-04): 4 şablonun 2'si 6, 2'si 4 düğmeli.
//
// ⭐ ÖLÇÜLEN: satır durumu ne olursa olsun DOM'daki yuva DİZİSİ (sayı + sıra)
//    aynı mı; anlamsız yuva görünmez YER TUTUCU olarak duruyor mu (hiza) ve
//    gerçekten ATIL mı (disabled + aria-hidden + sekmesiz).
//
// ⚠️ İKİ FARKLI "yok" karıştırılmaz: yetki yoksa düğme ÇİZİLMEZ (gri/hayalet
//    düğme olmayan bir yolu vaat eder) — o dal ayrıca ölçülür: yazma yuvaları
//    hep birlikte düşer, kalan iki yuvanın sırası bozulmaz.
//
// NEGATİF SONDA (koşuldu, kırmızı görüldü): `Slot` yer tutucusu kaldırılıp eski
// koşullu render'a dönülünce ("applicable değilse null döndür") §2 · §3 · §4
// KIRMIZI (3 failed / 2 passed) — durumlar arası yuva sayısı 6/4'e ayrışıyor.
// ⚠️ §3 ilk yazımında bu sondada YEŞİL kalıyordu (kör nokta: yalnız çizilen yer
//    tutucuyu ölçüyordu, hiç çizilmeyeni değil) → yer tutucu SAYISI eklendi.
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { PoolRow } from "./TemplateRow";
import {
  resolveTemplateRowActions,
  TEMPLATE_ROW_ACTION_ORDER,
  TEMPLATE_ROW_WRITE_ACTIONS,
  type TemplateRowState,
} from "./templateRowActions";
import type { ContextDefaultRow, LabelTemplate } from "@/services/labelTemplateService";

let permissions: string[] = ["label-template:read", "label-template:write"];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: (p: string) => permissions.includes(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => permissions.includes(p)),
    hasAllPermissions: (ps: string[]) => ps.every((p) => permissions.includes(p)),
    isAdmin: false,
  }),
}));

/** Ölçülen dört durum — canlı verideki tüm kombinasyonları kapsar. */
const STATES: Array<{ name: string; state: TemplateRowState }> = [
  { name: "aktif · varsayılan değil", state: { isActive: true, isAnyDefault: false } },
  { name: "aktif · bağlam varsayılanı", state: { isActive: true, isAnyDefault: true } },
  { name: "pasif · varsayılan değil", state: { isActive: false, isAnyDefault: false } },
  { name: "pasif · bağlam varsayılanı", state: { isActive: false, isAnyDefault: true } },
];

function makeTemplate(isActive: boolean): LabelTemplate {
  return {
    id: "t1",
    name: "Sonda Şablonu",
    kind: null,
    isDefault: false,
    isActive,
    standalone: false,
    fields: [],
    variants: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

const noop = () => {};

function renderRow(state: TemplateRowState) {
  const defaults: ContextDefaultRow[] = state.isAnyDefault
    ? [{ kind: "ROLL_FINISHED", templateId: "t1", templateName: "Sonda Şablonu" }]
    : [];
  const r = renderWithProviders(
    <ul>
      <PoolRow
        template={makeTemplate(state.isActive)}
        defaults={defaults}
        onEdit={noop}
        onDelete={noop}
        onRestore={noop}
        onHardDelete={noop}
        onPrint={noop}
        onExport={noop}
        onDuplicate={noop}
      />
    </ul>,
  );
  const slots = Array.from(r.container.querySelectorAll("[data-action-slot]"));
  r.unmount();
  return slots;
}

describe("etiket şablonu satırı — aksiyon hizası", () => {
  it("§1 saf çözüm: yuva sırası HER durumda kanonik sırayla birebir", () => {
    for (const { name, state } of STATES) {
      const keys = resolveTemplateRowActions(state).map((s) => s.key);
      expect(keys, name).toEqual([...TEMPLATE_ROW_ACTION_ORDER]);
    }
  });

  it("§1b yazma yuvaları BİTİŞİK son ek (PermissionGate tek blok sarabilsin)", () => {
    const suffix = TEMPLATE_ROW_ACTION_ORDER.slice(-TEMPLATE_ROW_WRITE_ACTIONS.length);
    expect(suffix).toEqual([...TEMPLATE_ROW_WRITE_ACTIONS]);
  });

  it("§2 DOM: yuva sayısı ve sırası dört durumda da AYNI", () => {
    const rendered = STATES.map(({ name, state }) => ({
      name,
      keys: renderRow(state).map((el) => el.getAttribute("data-action-slot")),
    }));
    const reference = rendered[0]!.keys;
    expect(reference).toEqual([...TEMPLATE_ROW_ACTION_ORDER]);
    for (const row of rendered) expect(row.keys, row.name).toEqual(reference);
  });

  it("§3 anlamsız yuva ATIL yer tutucudur (görünmez · disabled · sekmesiz)", () => {
    for (const { name, state } of STATES) {
      const slots = resolveTemplateRowActions(state);
      const expected = new Map(slots.map((s) => [s.key, s.applicable] as const));
      const els = renderRow(state);
      // ⚠️ Kör nokta sondası: yalnız "çizilen yer tutucu doğru mu" diye bakmak,
      // yer tutucu HİÇ çizilmediğinde de yeşil kalır (eski koşullu render).
      expect(els.filter((e) => e.getAttribute("data-slot-state") === "placeholder").length, name)
        .toBe(slots.filter((s) => !s.applicable).length);
      for (const el of els) {
        const key = el.getAttribute("data-action-slot")!;
        const applicable = expected.get(key as never);
        expect(el.getAttribute("data-slot-state"), `${name} · ${key}`).toBe(
          applicable ? "action" : "placeholder",
        );
        if (applicable) continue;
        expect(el.className, `${name} · ${key}`).toContain("invisible");
        expect(el).toBeDisabled();
        expect(el.getAttribute("aria-hidden"), `${name} · ${key}`).toBe("true");
        expect(el.getAttribute("tabindex"), `${name} · ${key}`).toBe("-1");
      }
    }
  });

  it("§4 yetki yoksa yazma yuvaları ÇİZİLMEZ (yer tutucu da bırakmaz)", () => {
    permissions = ["label-template:read"];
    try {
      for (const { name, state } of STATES) {
        const keys = renderRow(state).map((el) => el.getAttribute("data-action-slot"));
        expect(keys, name).toEqual(["print", "export"]);
      }
    } finally {
      permissions = ["label-template:read", "label-template:write"];
    }
  });
});
