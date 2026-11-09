// Parti kaydı satırında müşteri parti no'su (2026-11-09): sunucu satıra yazar (`customerBatchNo`), panel yalnız gösterir;
// belge satırı / eski sunucu → çizilmez. Negatif sonda: LineRow'daki `line.customerBatchNo &&` koşulu kaldırılıp hep çizilince
// §2 kırmızı.
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { LineRow } from "../LineRow";
import type { DeliveryNoteLine } from "../types";

const line = (o: Partial<DeliveryNoteLine>): DeliveryNoteLine => ({
  id: "l1", noteId: "n1", lineNo: 9, blockNo: 2, lineKind: "ARABA", summary: true, senderRollNo: null, meters: "50", weightKg: null, widthCm: null,
  itemText: null, itemId: null, colorText: null, colorId: null, processText: null, confidence: 1, needsReview: false, sourceRects: null,
  status: "ENTERED", failReason: null, rollId: "r1", item: null, color: null, ...o,
});
const noop = () => undefined;
const row = (l: DeliveryNoteLine) =>
  renderWithProviders(
    <table>
      <tbody>
        <LineRow line={l} suggestion={undefined} editable={false} fixable={false} selected={false} ownerCustomerId={null} onSelect={noop} onPatch={noop} onDelete={noop} onPickItem={noop} infoOnly />
      </tbody>
    </table>,
  );

describe("Parti kaydı müşteri parti no", () => {
  it("⭐ §1 parti satırında müşteri parti no görünür", () => {
    row(line({ customerBatchNo: "P-77B" }));
    expect(screen.getByTestId("line-customer-batch")).toHaveTextContent(/^Müşteri parti P-77B$/);
  });

  it("⭐ §2 belge satırı / eski sunucu (alan yok ya da null) → çizilmez", () => {
    row(line({ lineKind: "TOP", summary: false, customerBatchNo: null }));
    row(line({}));
    expect(screen.queryByTestId("line-customer-batch")).toBeNull();
  });
});
