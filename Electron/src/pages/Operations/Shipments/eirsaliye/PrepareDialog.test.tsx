// clientToken MANTIKSAL deneme başına: belirsiz hatada (ağ/5xx) aynı token yapışır, kesin
// 4xx'te ve başarıdan sonra yenisi doğar; düzenleme kipi token taşımaz.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";

const prepare = vi.fn();
const updateFields = vi.fn();
vi.mock("./service", async (orig) => ({
  ...(await orig<typeof import("./service")>()),
  eIrsaliyeService: {
    prepare: (...a: unknown[]) => prepare(...a),
    updateFields: (...a: unknown[]) => updateFields(...a),
  },
}));

import { PrepareDialog } from "./PrepareDialog";

const httpErr = (status?: number, details: Record<string, unknown> = {}) =>
  Object.assign(new Error("x"), { isAxiosError: true, response: status ? { status, data: { message: "Sunucu cümlesi", details } } : undefined });

function open() {
  const onDone = vi.fn();
  renderWithProviders(<PrepareDialog open onOpenChange={() => {}} shipmentId="s1" record={null} onDone={onDone} />);
  return onDone;
}
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Hazırla" }));

describe("PrepareDialog", () => {
  beforeEach(() => {
    prepare.mockReset();
    updateFields.mockReset();
  });

  it("⭐ belirsiz hata (5xx) → yeniden denemede AYNI token; kesin 4xx → YENİ token", async () => {
    prepare.mockRejectedValueOnce(httpErr(503)).mockRejectedValueOnce(httpErr(409)).mockResolvedValueOnce({ created: true });
    open();
    submit();
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    await screen.findByText("Sunucu cümlesi");
    submit();
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
    submit();
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(3));
    const [t1, t2, t3] = prepare.mock.calls.map((c) => c[2] as string);
    expect(t1).toBe(t2);
    expect(t3).not.toBe(t2);
  });

  it("boş alan gönderilmez (sunucu önerisi kalır); dolu alan kırpılıp gider", async () => {
    prepare.mockResolvedValue({ created: true });
    open();
    fireEvent.change(screen.getByLabelText("Dorse plakası"), { target: { value: "  16 DR 01 " } });
    submit();
    await waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    expect(prepare.mock.calls[0]![1]).toEqual({ trailerPlate: "16 DR 01" });
  });

  it("alan hatası ilgili kutuyu işaretler (details.alan)", async () => {
    prepare.mockRejectedValue(httpErr(400, { code: "EIRSALIYE_FIELD_INVALID", alan: "carrierTaxId" }));
    open();
    submit();
    await screen.findByText("Sunucu cümlesi");
    expect(screen.getByLabelText("Taşıyıcı VKN/TCKN").getAttribute("aria-invalid")).toBe("true");
  });
});
