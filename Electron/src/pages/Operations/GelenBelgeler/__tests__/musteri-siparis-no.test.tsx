// S2(b) müşteri sipariş no: başlık formunda alan (değer görünür, odak çıkınca yalnız o anahtar PATCH'lenir,
// giriş VarChar(64)'te keser, onaylı belgede salt okunur) + liste hücresinde ikinci satır.
// Negatif sonda: TEXT_FIELDS'tan `customerOrderNo` satırı ya da hücredeki ikinci satır kaldırılınca kırmızı.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NoteHeaderForm } from "../NoteHeaderForm";
import { NOTE_COLUMNS } from "../noteColumns";
import type { DeliveryNoteDetail, DeliveryNoteHeader } from "../types";

vi.mock("@/components/forms/CustomerPickerField", () => ({ CustomerPickerField: () => null }));
vi.mock("@/components/forms/DatePickerInput", () => ({ DatePickerInput: () => null }));

const note = (o: Partial<DeliveryNoteDetail>) =>
  ({
    id: "n1", noteNo: "GB-0001", status: "DRAFT", ownerCustomerId: null, senderCustomerId: null, senderText: null, senderDocNo: null,
    senderDocDate: null, customerBatchNo: null, customerOrderNo: "123456", processText: null, pageCount: null, declaredTopCount: null,
    updatedAt: "2026-11-02T08:00:00.000Z", ...o,
  }) as DeliveryNoteDetail;

describe("müşteri sipariş no (S2b)", () => {
  it("§1 başlık formunda görünür, düzenlenince yalnız customerOrderNo PATCH'lenir, sınır 64", () => {
    const onPatch = vi.fn();
    render(<NoteHeaderForm note={note({})} suggestions={undefined} editable onPatch={onPatch} />);
    const input = screen.getByLabelText("Müşteri sipariş no") as HTMLInputElement;
    expect(input.value).toBe("123456");
    expect(input.maxLength).toBe(64);
    fireEvent.blur(input, { target: { value: " 654321 " } });
    expect(onPatch).toHaveBeenCalledWith({ customerOrderNo: "654321" });
    onPatch.mockClear();
    fireEvent.blur(input, { target: { value: "" } });
    expect(onPatch).toHaveBeenCalledWith({ customerOrderNo: null });
  });

  it("§2 onaylı belgede değer görünür ama düzenlenemez", () => {
    render(<NoteHeaderForm note={note({ status: "APPROVED" })} suggestions={undefined} editable={false} onPatch={vi.fn()} />);
    const input = screen.getByLabelText("Müşteri sipariş no") as HTMLInputElement;
    expect(input.value).toBe("123456");
    expect(input.disabled).toBe(true);
  });

  it("§3 liste hücresi: sipariş no varsa belge no altında, yoksa satır yok", () => {
    const col = NOTE_COLUMNS.find((c) => c.id === "senderDocNo")!;
    const Cell = col.cell as (ctx: { row: { original: DeliveryNoteHeader } }) => React.ReactNode;
    const row = (o: Partial<DeliveryNoteHeader>) => ({ original: { senderDocNo: "914279", customerOrderNo: null, ...o } as DeliveryNoteHeader });
    const { rerender } = render(<>{Cell({ row: row({ customerOrderNo: "123456" }) })}</>);
    expect(screen.getByTestId("note-order-no").textContent).toBe("Sip. 123456");
    rerender(<>{Cell({ row: row({}) })}</>);
    expect(screen.queryByTestId("note-order-no")).toBeNull();
  });
});
