import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OUTPUT_STAGE_HELP, OutputStageButtons, outputStageLabel } from "./OutputStageButtons";

describe("OutputStageButtons — rota adımı çıktı aşaması", () => {
  it("dört seçenek; seçili olan aria-checked; yardım metni görünür", () => {
    render(<OutputStageButtons value="RAW" onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Otomatik", "Ham", "Yarı mamul", "Bitmiş"]);
    expect(radios[1]!.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(OUTPUT_STAGE_HELP)).toBeTruthy();
  });
  it("Otomatik null yazar, Bitmiş FINISHED yazar", () => {
    const onChange = vi.fn();
    render(<OutputStageButtons value="RAW" onChange={onChange} />);
    fireEvent.click(screen.getByText("Otomatik"));
    fireEvent.click(screen.getByText("Bitmiş"));
    expect(onChange.mock.calls).toEqual([[null], ["FINISHED"]]);
  });
  it("salt-okunur etiket", () => {
    expect(outputStageLabel(null)).toBe("Otomatik");
    expect(outputStageLabel("SEMI_FINISHED")).toBe("Yarı mamul");
  });
});
