// Müşteri kartı "Tambur / Etiket" ayarları (Gülkesim S5) — form ↔ PATCH gövdesi.
// Backend doğrulaması `customer.service normalizeTamburLabelSettings`; burada aynı sınırlar.

export type LabelWidthSource = "INCOMING" | "MEASURED";

export interface TamburLabelSettingsFields {
  labelWidthSource?: LabelWidthSource | null;
  tamburWeighRequired?: boolean;
  /** Decimal → API'de metin ya da sayı gelebilir. */
  tamburSplitLengthM?: string | number | null;
  /** Etikete müşterinin parti no'su (J1/K30) basılır; tablet kesimde sorar. */
  tamburLabelBatchEnabled?: boolean;
}

export interface TamburLabelSettingsForm {
  /** "" = bugünkü (topun güncel eni). */
  widthSource: "" | LabelWidthSource;
  weighRequired: boolean;
  /** Serbest metin; "" = öneri yok. */
  splitLength: string;
  labelBatchEnabled: boolean;
}

export const WIDTH_SOURCE_OPTIONS: ReadonlyArray<{ value: "" | LabelWidthSource; label: string; hint: string }> = [
  { value: "", label: "Topun güncel eni (bugünkü)", hint: "Ölçüldüyse ölçülen, değilse gelen en." },
  { value: "INCOMING", label: "Gelen en", hint: "Müşterinin gönderdiği en — sonradan ölçülse bile." },
  { value: "MEASURED", label: "Ölçülen en", hint: "Fabrikada ölçülen en." },
];

export function toForm(c: TamburLabelSettingsFields): TamburLabelSettingsForm {
  const split = c.tamburSplitLengthM;
  return {
    widthSource: c.labelWidthSource ?? "",
    weighRequired: c.tamburWeighRequired === true,
    splitLength: split == null || split === "" ? "" : String(Number(split)).replace(".", ","),
    labelBatchEnabled: c.tamburLabelBatchEnabled === true,
  };
}

export const SPLIT_LENGTH_ERROR = "Bölme ölçüsü 0'dan büyük ve en çok 100000 m olmalı.";

/** Bölme ölçüsü metni: boş = öneri yok; doluysa (0, 100000] m. Cari formu şeması da bunu okur (tek kural). */
export function splitLengthError(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  return !Number.isFinite(n) || n <= 0 || n > 100000 ? SPLIT_LENGTH_ERROR : null;
}

/** Form → PATCH gövdesi; bölme ölçüsü bozuksa hata metni döner. */
export function toPayload(
  f: TamburLabelSettingsForm,
): { ok: true; body: Required<Pick<TamburLabelSettingsFields, "labelWidthSource" | "tamburWeighRequired" | "tamburLabelBatchEnabled">> & { tamburSplitLengthM: number | null } } | { ok: false; error: string } {
  const raw = f.splitLength.trim();
  let split: number | null = null;
  if (raw !== "") {
    const err = splitLengthError(raw);
    if (err) return { ok: false, error: err };
    split = Math.round(Number(raw.replace(",", ".")) * 100) / 100;
  }
  return {
    ok: true,
    body: { labelWidthSource: f.widthSource === "" ? null : f.widthSource, tamburWeighRequired: f.weighRequired, tamburSplitLengthM: split, tamburLabelBatchEnabled: f.labelBatchEnabled },
  };
}
