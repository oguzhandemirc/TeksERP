// Top etiket ad/renk/parti düzeltmesi (sevk edilene kadar): kilit yüklemi backend aynası, gövde yalnız
// değişeni taşır ("" temizler), kart sevkli topta Düzelt'i kapatıp nedenini yazar, yetkisize düğme çizmez.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { labelTextsFixBody, labelTextsLockReason } from "./labelTextsService";
import { RollLabelTextsCard } from "./RollLabelTextsCard";
import type { Roll } from "./types";

let perms: string[] = ["roll:write"];
vi.mock("@/hooks/useRoleAccess", () => ({
  useRoleAccess: () => ({ hasPermission: (p: string) => perms.includes(p) }),
}));

const wrap = (ui: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const mk = (status: string, extra: Partial<Roll> = {}) =>
  ({ id: "r1", barcode: "T1", status, item: { name: "PATOS" }, color: { name: "MAVİ" }, ...extra }) as unknown as Roll;

beforeEach(() => {
  perms = ["roll:write"];
});

describe("labelTextsLockReason", () => {
  it("sevkli / fason / kapanmış kilitli; canlı statüler açık", () => {
    expect(labelTextsLockReason("SHIPPED")).toMatch(/sevk edildi/);
    expect(labelTextsLockReason("AT_KARTELA")).toMatch(/dışarıda/);
    expect(labelTextsLockReason("SCRAP")).toMatch(/fire/);
    for (const s of ["WAREHOUSE", "A1_STOCK", "STOCK", "IN_PRODUCTION"]) expect(labelTextsLockReason(s)).toBeNull();
  });
});

describe("labelTextsFixBody", () => {
  it("yalnız değişen alan; boşaltılan alan boş metin; aynı değer boş gövde", () => {
    const cur = { labelItemName: "SULTAN", labelColorName: "EKRU", labelBatchNo: "J1" };
    expect(labelTextsFixBody(cur, { itemName: " SULTAN ", colorName: "EKRU", batchNo: "J1" })).toEqual({});
    expect(labelTextsFixBody(cur, { itemName: "LALE", colorName: "", batchNo: "J1" })).toEqual({ labelItemName: "LALE", labelColorName: "" });
    expect(labelTextsFixBody({ labelBatchNo: null }, { itemName: "", colorName: "", batchNo: "K2" })).toEqual({ labelBatchNo: "K2" });
  });
});

describe("RollLabelTextsCard", () => {
  it("canlı topta Düzelt açık; boş alan kumaşın kendi adını gösterir", () => {
    wrap(<RollLabelTextsCard roll={mk("WAREHOUSE", { labelColorName: "EKRU" })} />);
    expect(screen.getByTestId("etiket-bilgisi-duzelt")).not.toBeDisabled();
    expect(screen.getByText("Kendi adı (PATOS)")).toBeTruthy();
    expect(screen.getByText("EKRU")).toBeTruthy();
    expect(screen.queryByTestId("etiket-bilgisi-kilit")).toBeNull();
  });

  it("sevkli topta Düzelt kapalı ve neden yazılı", () => {
    wrap(<RollLabelTextsCard roll={mk("SHIPPED", { labelItemName: "SULTAN" })} />);
    expect(screen.getByTestId("etiket-bilgisi-duzelt")).toBeDisabled();
    expect(screen.getByTestId("etiket-bilgisi-kilit").textContent).toMatch(/sevk edildi/);
  });

  it("roll:write / label:edit yoksa düğme çizilmez", () => {
    perms = ["roll:read"];
    wrap(<RollLabelTextsCard roll={mk("WAREHOUSE")} />);
    expect(screen.queryByTestId("etiket-bilgisi-duzelt")).toBeNull();
  });
});
