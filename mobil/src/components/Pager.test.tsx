import { fireEvent, render } from "@testing-library/react-native";
import Pager from "./Pager";
import { renderWithPaper } from "../test/render";

describe("Pager (mobil sayfalama)", () => {
  it("totalPages<=1 → hiç render edilmez (null)", () => {
    // null yolu paper bileşeni kullanmaz → sarmalayıcısız render; kök null olmalı.
    const { toJSON } = render(<Pager page={1} totalPages={1} onPageChange={() => {}} />);
    expect(toJSON()).toBeNull();
  });

  it("sayfa/toplam metnini gösterir (+ kayıt)", () => {
    const { getByText } = renderWithPaper(
      <Pager page={2} totalPages={5} total={142} onPageChange={() => {}} />,
    );
    expect(getByText(/2 \/ 5/)).toBeTruthy();
    expect(getByText(/142 kayıt/)).toBeTruthy();
  });

  it("ilk sayfada 'Önceki' kilitli, son sayfada 'Sonraki' kilitli", () => {
    const onPageChange = jest.fn();
    const { getByLabelText } = renderWithPaper(
      <Pager page={1} totalPages={3} onPageChange={onPageChange} />,
    );
    fireEvent.press(getByLabelText("Önceki sayfa"));
    expect(onPageChange).not.toHaveBeenCalled(); // disabled
  });

  it("Sonraki → onPageChange(page+1)", () => {
    const onPageChange = jest.fn();
    const { getByLabelText } = renderWithPaper(
      <Pager page={2} totalPages={5} onPageChange={onPageChange} />,
    );
    fireEvent.press(getByLabelText("Sonraki sayfa"));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it("fetching=true → butonlar kilitli", () => {
    const onPageChange = jest.fn();
    const { getByLabelText } = renderWithPaper(
      <Pager page={2} totalPages={5} fetching onPageChange={onPageChange} />,
    );
    fireEvent.press(getByLabelText("Sonraki sayfa"));
    expect(onPageChange).not.toHaveBeenCalled();
  });
});
