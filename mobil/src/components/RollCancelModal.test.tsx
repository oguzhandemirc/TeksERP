import { act, fireEvent } from "@testing-library/react-native";
import RollCancelModal from "./RollCancelModal";
import { renderWithPaper } from "../test/render";
import { CANCEL_REASON_PRESETS } from "../constants/cancelReasons";
import type { RollCancelPreview } from "../services/roll.service";
import type { Roll } from "../types/models";

// =============================================================================
// TOP İPTAL MODALI — 2026-08-06 sadeleştirmesinin sözleşmesi.
//
// Saha şikâyeti: "iki modal üst üste çıkıyor". Tek modaldı; ölü etiket uyarısı
// kendi kenarlıklı kutusunda, kendi başlığıyla ve içinde ZORUNLU sebep seçimiyle
// çizildiği için modal-içinde-modal okunuyordu. Korunan davranışlar:
//   1. Sebep KAPALI başlar — açılış ekranında chip YOK.
//   2. Sebep OPSİYONEL — sebep seçilmeden onay butonu ÇALIŞIR (reason undefined).
//   3. Chip AKSİYONDUR — dokununca doğrudan iptal eder (iki dokunuş yok) ve
//      sunucuya chip'in KISA etiketi değil UZUN metni gider.
//   4. Hard-block'ta onay yolu hiç açılmaz (chip'ler de dahil).
//   5. Etiket uyarısı varken genel açıklama BASTIRILIR (tek mesaj okunur).
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

function setup(preview: RollCancelPreview | null, onConfirm = jest.fn()) {
  const utils = renderWithPaper(
    <RollCancelModal
      roll={ROLL}
      preview={preview}
      previewLoading={false}
      previewError={null}
      offline={false}
      loading={false}
      onDismiss={jest.fn()}
      onConfirm={onConfirm}
    />,
  );
  return { ...utils, onConfirm };
}

describe("RollCancelModal — sadeleştirilmiş iptal onayı", () => {
  it("sebep KAPALI başlar: açılışta chip yok, tek satırlık tetik var", () => {
    const { queryByText, getByText } = setup(PREVIEW_LABELLED);
    getByText("Sebep ekle (opsiyonel)");
    // Katalogdaki hiçbir chip görünmemeli.
    CANCEL_REASON_PRESETS.forEach((p) => expect(queryByText(p.short)).toBeNull());
    // "zorunlu" kelimesi ekranın hiçbir yerinde geçmemeli — sebep artık opsiyonel.
    expect(queryByText(/zorunlu/i)).toBeNull();
  });

  it("sebepsiz iptal EDİLEBİLİR — onay butonu kilitli değil", () => {
    const { getByText, onConfirm } = setup(PREVIEW_LABELLED);
    // Etiketli iptalde onay metni "kâğıdı söktüm" beyanını taşır.
    fireEvent.press(getByText("Etiketi söktüm — İptal Et"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("chip TEK DOKUNUŞTA iptal eder ve sunucuya UZUN metni gönderir", async () => {
    const { getByText, onConfirm } = setup(PREVIEW_LABELLED);
    fireEvent.press(getByText("Sebep ekle (opsiyonel)"));
    // SimplePortal bildirimi mikrotaskta gelir (2.7.2 çökme düzeltmesi) —
    // chip'lerin host'ta belirmesi için bir tur akıt.
    await act(async () => {});
    const preset = CANCEL_REASON_PRESETS[0];
    // Chip'te kısa etiket yazar…
    fireEvent.press(getByText(preset.short));
    // …ama kayda giden tam metindir (rapor gruplaması ona dayanıyor).
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
