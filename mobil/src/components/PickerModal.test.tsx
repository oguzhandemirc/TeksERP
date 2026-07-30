import { fireEvent } from "@testing-library/react-native";
import PickerModal from "./PickerModal";
import { renderWithPaper } from "../test/render";

// PickerModal `leadingAction` — listenin başına sabitlenen mor aksiyon kartı
// (kanonik kullanım: KK1 "Desen Seç" içindeki "Yeni Desen"). Korunan davranış:
//   1. Kart HER ZAMAN ilk hücre — alfabetik sıralama onu araya sokmaz.
//   2. Arama hiçbir sonuç döndürmese bile görünür kalır (asıl "ekle" anı).
//   3. Basılınca SEÇİM değildir: onSelect/onDismiss çağrılmaz, picker açık kalır.
//   4. disabled iken dokunma hiç işlemez.

const OPTIONS = [
  { value: "b", label: "Bordo Jakar" },
  { value: "a", label: "Antrasit Dokuma" },
];

function setup(overrides?: {
  disabled?: boolean;
  onPress?: () => void;
  onSelect?: (v: string) => void;
  onDismiss?: () => void;
}) {
  const onPress = overrides?.onPress ?? jest.fn();
  const onSelect = overrides?.onSelect ?? jest.fn();
  const onDismiss = overrides?.onDismiss ?? jest.fn();
  const utils = renderWithPaper(
    <PickerModal
      visible
      title="Desen Seç"
      options={OPTIONS}
      onSelect={onSelect}
      onDismiss={onDismiss}
      leadingAction={{
        label: "Yeni Desen",
        sublabel: "Listede yok — hemen ekle",
        icon: "plus",
        disabled: overrides?.disabled,
        onPress,
      }}
    />,
  );
  return { ...utils, onPress, onSelect, onDismiss };
}

describe("PickerModal — leadingAction (mor 'yeni ekle' kartı)", () => {
  it("alfabetik sıralamaya rağmen listenin İLK elemanıdır", () => {
    const { getAllByText } = setup();
    // Etiketleri ekrandaki dikey sırayla topla: aksiyon kartı A'dan da önce gelir.
    const labels = getAllByText(/Yeni Desen|Antrasit Dokuma|Bordo Jakar/).map(
      (n) => n.props.children,
    );
    expect(labels[0]).toBe("Yeni Desen");
    expect(labels.slice(1)).toEqual(["Antrasit Dokuma", "Bordo Jakar"]);
  });

  it("arama hiçbir seçenek bırakmasa da görünür kalır", () => {
    const { getByPlaceholderText, getByText, queryByText } = setup();
    fireEvent.changeText(getByPlaceholderText("Ara..."), "zzz-yok");
    expect(getByText("Yeni Desen")).toBeTruthy();
    expect(getByText("Seçenek yok")).toBeTruthy();
    expect(queryByText("Bordo Jakar")).toBeNull();
  });

  it("basılınca onPress çağrılır; onSelect/onDismiss ÇAĞRILMAZ (picker açık kalır)", () => {
    const { getByLabelText, onPress, onSelect, onDismiss } = setup();
    fireEvent.press(getByLabelText("Yeni Desen — Listede yok — hemen ekle"));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("disabled iken dokunma işlemez (offline)", () => {
    const { getByLabelText, onPress } = setup({ disabled: true });
    fireEvent.press(getByLabelText("Yeni Desen — Listede yok — hemen ekle"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("gerçek seçenek seçimi onSelect + onDismiss tetikler", () => {
    const { getByText, onSelect, onDismiss } = setup();
    fireEvent.press(getByText("Bordo Jakar"));
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
