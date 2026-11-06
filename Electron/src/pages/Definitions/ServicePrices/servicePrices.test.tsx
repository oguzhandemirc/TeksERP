import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import type { ServiceListRow, ServicePriceTable, ServicePriceTierRow } from "./service";
import { ServiceList } from "./ServiceList";
import {
  gramFillCandidates,
  nextRowIndex,
  parsePriceInput,
  SOURCE_BADGE,
  validFromPayload,
} from "./servicePrices";
import { servicePricesBlock, servicePricesTileVisible } from "./regime";
import { ServicePriceGrid } from "./ServicePriceGrid";

const slot = (price: string | null, pending: string | null = null) => ({
  current: price
    ? {
        id: `c-${price}`,
        price,
        priceUnit: null,
        since: "2026-11-01T00:00:00Z",
        until: pending ? "2026-11-20T21:00:00Z" : null,
      }
    : null,
  pending: pending
    ? { id: `p-${pending}`, price: pending, priceUnit: null, validFrom: "2026-11-20T21:00:00Z" }
    : null,
});

function tier(over: Partial<ServicePriceTierRow> & { valueId: string }): ServicePriceTierRow {
  return {
    code: over.valueId,
    name: over.valueId,
    amount: null,
    isActive: true,
    mapped: true,
    general: slot(null),
    customer: null,
    customerOverrideCount: 0,
    effective: { price: null, source: null, tierMissing: false, gramFormula: null },
    ...over,
  };
}

function table(tiers: ServicePriceTierRow[], customerId: string | null = null): ServicePriceTable {
  return {
    item: { id: "svc", code: "KUR", name: "Kurşun", unit: "MT", lifecycleStatus: "ACTIVE" },
    currency: "TRY",
    customerId,
    itemPrice: { general: slot("5"), customer: customerId ? slot(null) : null },
    gram: { customer: null, stations: [] },
    hasTiers: tiers.some((t) => t.general.current),
    tiers,
  };
}

describe("hizmet fiyat tablosu — saf kurallar", () => {
  it("Türkçe ondalık girişi; boş null, geçersiz/negatif NaN", () => {
    expect(parsePriceInput("12,5")).toBe(12.5);
    expect(parsePriceInput("1.234,50")).toBe(1234.5);
    expect(parsePriceInput("7.25")).toBe(7.25);
    expect(parsePriceInput("  ")).toBeNull();
    expect(parsePriceInput("-3")).toBeNaN();
    expect(parsePriceInput("abc")).toBeNaN();
  });

  it("rozet her kaynak için tanımlı (backend `ServicePriceSource` aynası)", () => {
    expect(Object.keys(SOURCE_BADGE).sort()).toEqual([
      "CUSTOMER_GRAM",
      "CUSTOMER_TIER",
      "ITEM",
      "STATION_GRAM",
      "TIER",
    ]);
  });

  it("satır gezintisi sınırda durur", () => {
    expect(nextRowIndex(0, -1, 3)).toBe(0);
    expect(nextRowIndex(2, 1, 3)).toBe(2);
    expect(nextRowIndex(1, 1, 3)).toBe(2);
  });

  it("yürürlük boşsa hemen (null), gün seçiliyse ISO", () => {
    expect(validFromPayload(null)).toBeNull();
    expect(validFromPayload("2026-12-01")).toMatch(/^2026-11-30T|^2026-12-01T/);
  });

  it("gram doldurma yalnız fiyatsız + gramdan gelen kademeyi önerir (var olan fiyat ezilmez)", () => {
    const gram = {
      price: "1.6",
      source: "STATION_GRAM" as const,
      tierMissing: false,
      gramFormula: "40 × 0.04",
    };
    const c = gramFillCandidates([
      tier({ valueId: "a", amount: "40", effective: gram }),
      tier({ valueId: "b", amount: "40", effective: gram, general: slot("2") }),
      tier({ valueId: "c", amount: "40", effective: gram, general: slot(null, "3") }),
      tier({ valueId: "d", amount: null, effective: gram }),
      tier({ valueId: "e", amount: "40", effective: gram, mapped: false }),
    ]);
    expect(c.map((x) => x.valueId)).toEqual(["a"]);
    expect(c[0]?.price).toBe(1.6);
  });

  it("kapı eksik olanı söyler (sıra: ön muhasebe → ticaret → hizmet faturası → izin)", () => {
    const on = { ticaretEnabled: true, financeEnabled: true, serviceBillingEnabled: true, canRead: true };
    expect(servicePricesBlock(on)).toBeNull();
    expect(servicePricesBlock({ ...on, financeEnabled: false, ticaretEnabled: false })?.title).toMatch(
      /Ön muhasebe/,
    );
    expect(servicePricesBlock({ ...on, ticaretEnabled: false })?.title).toMatch(/Ticaret/);
    expect(servicePricesBlock({ ...on, serviceBillingEnabled: false })?.title).toMatch(/Hizmet faturası/);
    expect(servicePricesBlock({ ...on, canRead: false })?.title).toMatch(/yetki/);
    expect(servicePricesTileVisible({ financeEnabled: false })).toBe(false);
  });
});

describe("ServicePriceGrid", () => {
  const mutations = () => ({
    save: vi.fn().mockResolvedValue(true),
    savingKey: null,
    revoke: { isPending: false, mutateAsync: vi.fn() },
  });

  it("kaynak rozeti, K5 uyarısı ve ileri tarihli fiyat görünür", () => {
    const t = table([
      tier({
        valueId: "40gr",
        general: slot("7", "8"),
        effective: { price: "7", source: "TIER", tierMissing: false, gramFormula: null },
      }),
      tier({
        valueId: "50gr",
        effective: { price: null, source: null, tierMissing: true, gramFormula: null },
      }),
    ]);
    renderWithProviders(
      <ServicePriceGrid
        table={t}
        canWrite
        validFromDay={null}
        mutations={mutations() as never}
        onHistory={() => {}}
      />,
    );
    expect(screen.getByText("Genel kademe")).toBeInTheDocument();
    expect(screen.getByText("Fiyatsız")).toBeInTheDocument();
    expect(screen.getByText(/8,00 ·/)).toBeInTheDocument();
  });

  it("rakam yaz → Enter kaydeder (kademe + yürürlük gövdeye gider), yazma izni yoksa düzenleme açılmaz", async () => {
    const m = mutations();
    const t = table([tier({ valueId: "40gr" })]);
    const { unmount } = renderWithProviders(
      <ServicePriceGrid
        table={t}
        canWrite
        validFromDay="2026-12-01"
        mutations={m as never}
        onHistory={() => {}}
      />,
    );
    const cell = document.querySelector<HTMLElement>('[data-price-cell="40gr:general"]');
    expect(cell).not.toBeNull();
    fireEvent.keyDown(cell as HTMLElement, { key: "9" });
    const input = screen.getByLabelText("Fiyat");
    fireEvent.change(input, { target: { value: "9,5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
    expect(m.save.mock.calls[0]?.[1]).toMatchObject({
      itemId: "svc",
      propertyValueId: "40gr",
      customerId: null,
      price: 9.5,
      validFromDay: "2026-12-01",
    });
    unmount();

    renderWithProviders(
      <ServicePriceGrid
        table={t}
        canWrite={false}
        validFromDay={null}
        mutations={m as never}
        onHistory={() => {}}
      />,
    );
    fireEvent.keyDown(
      document.querySelector<HTMLElement>('[data-price-cell="40gr:general"]') as HTMLElement,
      { key: "9" },
    );
    expect(screen.queryByLabelText("Fiyat")).toBeNull();
  });
});

describe("hizmet listesi (gece UX turu 2026-11-06)", () => {
  const row = (x: Partial<ServiceListRow>): ServiceListRow =>
    ({ id: "s1", code: "HZM-KURSUN-K1", name: "KURŞUN HİZMETİ K1 (≤30 GR/M)", unit: "M", lifecycleStatus: "ACTIVE", tierRowCount: 0, ...x }) as ServiceListRow;
  const list = (rows: ServiceListRow[]) =>
    renderWithProviders(<ServiceList rows={rows} isLoading={false} isError={false} onRetry={vi.fn()} selectedId={null} onSelect={vi.fn()} />);

  it("kademeye özel fiyat yoksa 'kademesiz' DEMEZ (gramaj kademesi olabilir); varsa sayıyı söyler", () => {
    list([row({}), row({ id: "s2", code: "HZM-B", name: "Brode", tierRowCount: 3 })]);
    expect(screen.queryByText("kademesiz")).toBeNull();
    expect(screen.getByText("3 kademe fiyatı")).toBeInTheDocument();
  });

  it("kesilebilen ad üzerine gelince tam okunur (title)", () => {
    list([row({})]);
    expect(screen.getByRole("option")).toHaveAttribute("title", "KURŞUN HİZMETİ K1 (≤30 GR/M) (HZM-KURSUN-K1)");
  });
});
