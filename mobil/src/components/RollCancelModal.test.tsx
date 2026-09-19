import { act, fireEvent } from "@testing-library/react-native";
import RollCancelModal, { type RollCancelModalProps } from "./RollCancelModal";
import { renderWithPaper } from "../test/render";
import { CANCEL_REASON_PRESETS } from "../constants/cancelReasons";
import type { RollCancelPreview } from "../services/roll.service";
import type { Roll } from "../types/models";

// =============================================================================
// TOP İPTAL MODALI — sözleşme.
//   1. Sebep KAPALI başlar ve OPSİYONEL (eski sunucu `reasonRequired` göndermez → aynı) — chip yok, tetik var.
//   2. Chip AKSİYONDUR — dokununca doğrudan iptal eder ve sunucuya chip'in UZUN metni gider.
//   3. Hard-block'ta onay yolu hiç açılmaz. Etiket uyarısı varken genel açıklama BASTIRILIR.
//   4. Önizleme `reasonRequired:true` → sebep alanı AÇIK ve yıldızlı; ana düğme serbest metin (≥3) girilmeden
//      kilitli; chip yine tek dokunuşla iptal eder (sebebi taşır). Çevrimdışında opsiyonel kalır.
//   5. Sunucu reddi (`submitError`) → satır çizilir, sebep alanı zorunlu açılır; prop düşünce satır düşer.
// =============================================================================

const ROLL = {
  id: "r1",
  barcode: "T060826H0055",
  initialQty: 95,
  width: 180,
  item: { name: "BAYRO SİMLİ" },
  color: { name: "Kırmızı" },
} as unknown as Roll;

const PREVIEW_LABELLED: RollCancelPreview = {
  canCancel: true,
  requiresConfirm: false,
  labelPrinted: true,
} as RollCancelPreview;

const PREVIEW_PLAIN: RollCancelPreview = {
  canCancel: true,
  requiresConfirm: false,
  labelPrinted: false,
} as RollCancelPreview;

const PREVIEW_REQUIRED: RollCancelPreview = { ...PREVIEW_PLAIN, reasonRequired: true };

function setup(
  preview: RollCancelPreview | null,
  onConfirm = jest.fn(),
  extra: Partial<RollCancelModalProps> = {},
) {
  const props: RollCancelModalProps = {
    roll: ROLL,
    preview,
    previewLoading: false,
    previewError: null,
    offline: false,
    loading: false,
    onDismiss: jest.fn(),
    onConfirm,
    ...extra,
  };
  const utils = renderWithPaper(<RollCancelModal {...props} />);
  return { ...utils, onConfirm, props };
}

const isDisabled = (node: ReturnType<typeof setup>["getByTestId"] extends (id: string) => infer R ? R : never) =>
  node.props.accessibilityState?.disabled === true;

describe("RollCancelModal — sadeleştirilmiş iptal onayı", () => {
  it("sebep KAPALI başlar: açılışta chip yok, tek satırlık tetik var", () => {
    const { queryByText, getByText } = setup(PREVIEW_LABELLED);
    getByText("Sebep ekle (opsiyonel)");
    CANCEL_REASON_PRESETS.forEach((p) => expect(queryByText(p.short)).toBeNull());
    // "zorunlu" kelimesi ekranın hiçbir yerinde geçmemeli — sebep opsiyonel.
    expect(queryByText(/zorunlu/i)).toBeNull();
  });

  it("sebepsiz iptal EDİLEBİLİR — onay butonu kilitli değil", () => {
    const { getByText, onConfirm } = setup(PREVIEW_LABELLED);
    fireEvent.press(getByText("Etiketi söktüm — İptal Et"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("chip TEK DOKUNUŞTA iptal eder ve sunucuya UZUN metni gönderir", async () => {
    const { getByText, onConfirm } = setup(PREVIEW_LABELLED);
    fireEvent.press(getByText("Sebep ekle (opsiyonel)"));
    await act(async () => {});
    const preset = CANCEL_REASON_PRESETS[0];
    fireEvent.press(getByText(preset.short));
    expect(onConfirm).toHaveBeenCalledWith(preset.full);
  });

  it("etiket uyarısı varken genel açıklama BASTIRILIR (tek mesaj)", () => {
    const { getByText, queryByText } = setup(PREVIEW_LABELLED);
    getByText(/Etiketi basıldı/);
    expect(queryByText(/fire sayılmaz/)).toBeNull();
  });

  it("etiketsiz topta uyarı yok, genel açıklama var, onay sade", () => {
    const { getByText, queryByText, onConfirm } = setup(PREVIEW_PLAIN);
    expect(queryByText(/Etiketi basıldı/)).toBeNull();
    getByText(/fire sayılmaz/);
    fireEvent.press(getByText("İptal Et"));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("hard-block: onay yolu hiç açılmaz (sebep tetiği de yok)", () => {
    const blocked = {
      canCancel: false,
      requiresConfirm: false,
      labelPrinted: false,
      blockReason: "Sevk edilmiş top iptal edilemez",
    } as RollCancelPreview;
    const { queryByText, getByText } = setup(blocked);
    getByText("Sevk edilmiş top iptal edilemez");
    expect(queryByText("Sebep ekle (opsiyonel)")).toBeNull();
    expect(queryByText("İptal Et")).toBeNull();
    getByText("Kapat");
  });
});

describe("RollCancelModal — iptalde sebep zorunlu bayrağı (önizleme reasonRequired)", () => {
  it("§4 zorunlu: sebep alanı AÇIK ve yıldızlı, tetik yok, ana düğme kilitli", async () => {
    const u = setup(PREVIEW_REQUIRED);
    await act(async () => {});
    expect(u.queryByText("Sebep ekle (opsiyonel)")).toBeNull();
    u.getByText(/Sebep \* — zorunlu/);
    u.getByText(CANCEL_REASON_PRESETS[0].short);
    expect(isDisabled(u.getByTestId("cancel-onay"))).toBe(true);
    fireEvent.press(u.getByText("İptal Et"));
    expect(u.onConfirm).not.toHaveBeenCalled();
  });

  it("§4b zorunlu: chip yine tek dokunuşla iptal eder (sebebi taşır)", async () => {
    const u = setup(PREVIEW_REQUIRED);
    await act(async () => {});
    fireEvent.press(u.getByText(CANCEL_REASON_PRESETS[1].short));
    expect(u.onConfirm).toHaveBeenCalledWith(CANCEL_REASON_PRESETS[1].full);
  });

  it("§4c zorunlu: Diğer… metni ≥3 karakter olunca ana düğme açılır ve metin gider", async () => {
    const u = setup(PREVIEW_REQUIRED);
    await act(async () => {});
    fireEvent.press(u.getByText("Diğer…"));
    // Alt çubuk portalda: prop tazelenmesi bir mikrotask sonra (SimplePortal) — her yazımdan sonra bir tur akıt.
    fireEvent.changeText(u.getByTestId("cancel-other-text"), "ab");
    await act(async () => {});
    expect(isDisabled(u.getByTestId("cancel-onay"))).toBe(true);
    fireEvent.changeText(u.getByTestId("cancel-other-text"), " yanlış parti ");
    await act(async () => {});
    expect(isDisabled(u.getByTestId("cancel-onay"))).toBe(false);
    fireEvent.press(u.getByText("İptal Et"));
    expect(u.onConfirm).toHaveBeenCalledWith("yanlış parti");
  });

  it("§4d çevrimdışı: önizleme yok → opsiyonel kalır (kuyruk; kapı sunucuda)", () => {
    const u = setup(null, jest.fn(), { offline: true });
    u.getByText("Sebep ekle (opsiyonel)");
    fireEvent.press(u.getByText("İptal Et"));
    expect(u.onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("§5 sunucu reddi: satır çizilir, sebep alanı zorunlu açılır, kilit; prop düşünce satır düşer", async () => {
    const msg = "Top iptali için sebep zorunlu (ayar: iptalde sebep zorunlu) — katalogdan seçin ya da yazın.";
    const u = setup(PREVIEW_PLAIN, jest.fn(), { submitError: msg });
    await act(async () => {});
    expect(u.getByTestId("cancel-form-error").props.children).toBe(msg);
    expect(u.queryByText("Sebep ekle (opsiyonel)")).toBeNull();
    expect(isDisabled(u.getByTestId("cancel-onay"))).toBe(true);
    fireEvent.press(u.getByText(CANCEL_REASON_PRESETS[0].short));
    expect(u.onConfirm).toHaveBeenCalledWith(CANCEL_REASON_PRESETS[0].full);
    u.rerender(<RollCancelModal {...u.props} submitError={null} />);
    await act(async () => {});
    expect(u.queryByTestId("cancel-form-error")).toBeNull();
  });
});
