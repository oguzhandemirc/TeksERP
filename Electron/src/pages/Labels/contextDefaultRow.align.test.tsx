// =============================================================================
// BEKÇİ — Etiketler → Atamalar satırında hiza (X yuvası düşmez)
// =============================================================================
// Aynı sınıf hata, ikinci sekmede: "Atamayı kaldır" (X) yalnız atamalı satırda
// çiziliyordu → atamasız satırda şablon seçicisi X'in yerine kayıyor, sütun
// bozuluyordu. Düzenler sekmesindeki yuva kuralının ikizi: aksiyon o satırda
// ANLAMSIZSA görünmez yer tutucu kalır (yetki yoksa çizilmez — o dal
// PermissionGate'te ve tüm satırlarda birlikte düşer).
//
// NEGATİF SONDA (koşuldu, kırmızı görüldü): X düğmesi tekrar `{assigned && …}`
// koşuluna alınınca "düğme sayısı eşit" KIRMIZI (2 ≠ 1).
// =============================================================================
import { describe, it, expect, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { ContextDefaultRowItem } from "./ContextDefaultRowItem";
import type { ContextDefaultRow } from "@/services/labelTemplateService";

vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({
    hasPermission: () => true,
    hasAnyPermission: () => true,
    hasAllPermissions: () => true,
    isAdmin: false,
  }),
}));

const assigned: ContextDefaultRow = {
  kind: "SACK",
  templateId: "t1",
  templateName: "Çuval Düzeni",
};

function renderRow(withAssignment: boolean) {
  const r = renderWithProviders(
    <ul>
      <ContextDefaultRowItem
        kind="SACK"
        assigned={withAssignment ? assigned : undefined}
        activeTemplates={[{ id: "t1", name: "Çuval Düzeni" } as never]}
        pending={false}
        onChange={() => {}}
      />
    </ul>,
  );
  const buttons = Array.from(r.container.querySelectorAll("button"));
  r.unmount();
  return buttons;
}

describe("Etiketler → Atamalar satırı — hiza", () => {
  it("atamalı ve atamasız satır AYNI sayıda düğme çizer", () => {
    expect(renderRow(false).length).toBe(renderRow(true).length);
  });

  it("atamasız satırdaki X yer tutucudur: görünmez · disabled · sekmesiz", () => {
    const placeholder = renderRow(false).at(-1)!;
    expect(placeholder.className).toContain("invisible");
    expect(placeholder).toBeDisabled();
    expect(placeholder.getAttribute("aria-hidden")).toBe("true");
    expect(placeholder.getAttribute("tabindex")).toBe("-1");
    // Atamalı satırda aynı düğme GERÇEK aksiyondur.
    const real = renderRow(true).at(-1)!;
    expect(real.className).not.toContain("invisible");
    expect(real).not.toBeDisabled();
  });
});
