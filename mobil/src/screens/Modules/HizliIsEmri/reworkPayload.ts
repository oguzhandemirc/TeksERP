// =============================================================================
// YENİDEN ÜRETİM SEBEBİ → GÖNDERİM (saf, 2026-08-25)
// =============================================================================
// Sebep İKİ AYRI yere gider ve ikisi FARKLI iş yapar — bu yüzden mantık saf
// tutuldu, ekransız/DB'siz sınanabilsin:
//
//   1) METİN → 1. rota adımının NOTU → fason çeki listesine TALİMAT olarak
//      basılır ("Yeniden üretim: ton tutmadı"). Boyahane kâğıtta görür.
//      (`dispatch.instruction` adım notundan dolar — `test_fason_step_note_flow`.)
//   2) KOD + metin → `WorkOrder.parameters.rework` → RAPOR ANAHTARI. Fabrika
//      sebep etiketini yarın değiştirebilir; kod sabittir.
//
// ⚠️ Kod UYDURULMAZ. Bu kind metin SAKLAMAZ (`KIND_STORES_TEXT: false`), yani
// sunucu metinden kod türetmez — kodu istemci gönderir. Serbest metin yazılıp
// katalogda `requiresText` satırı yoksa `reasonCode: null` gider ve bu DOĞRUDUR:
// uydurma kod, raporu sessizce çöpe çevirir.
//
// ⚠️ Operatörün istasyon notu EZİLMEZ, birleşir: ikisi de aynı kâğıda basılır.
// =============================================================================

export interface ReworkReasonValue {
  code: string | null;
  text: string;
}

export interface ReworkRollRef {
  barcode: string;
  status: string;
}

export interface ReworkPlan {
  /** 1. adımın notuna yazılacak metin — yoksa `null` (not eklenmez). */
  stepNote: string | null;
  /** `WorkOrder.parameters` gövdesi — yoksa `null` (alan hiç gönderilmez). */
  parameters: { rework: { reasonCode: string | null; reasonText: string | null; rolls: ReworkRollRef[] } } | null;
}

/** Adım notu sınırı — backend Zod şeması `max(500)`. */
const NOTE_MAX = 500;

export function buildReworkPlan(args: {
  reworkRolls: ReworkRollRef[];
  reason: ReworkReasonValue;
  /** Katalog satırları (kod → etiket çözümü için). */
  presets: { code: string; label: string }[];
  /** 1. adımda zaten yazılmış istasyon notu (varsa). */
  existingNote?: string | null;
}): ReworkPlan {
  const { reworkRolls, reason, presets, existingNote } = args;
  if (reworkRolls.length === 0) return { stepNote: null, parameters: null };

  const text = reason.text.trim();
  // Metin varsa o, yoksa seçili chip'in ETİKETİ. Chip etiketi katalogdan gelir
  // (fabrika düzenlemiş olabilir) — kâğıda operatörün gördüğü kelime basılır.
  const label = text || (reason.code ? (presets.find((p) => p.code === reason.code)?.label ?? '') : '');

  const note = label ? `Yeniden üretim: ${label}` : null;
  const stepNote = note
    ? (existingNote?.trim() ? `${existingNote.trim()} | ${note}` : note).slice(0, NOTE_MAX)
    : existingNote?.trim() || null;

  return {
    stepNote,
    parameters: {
      rework: {
        reasonCode: reason.code,
        reasonText: text || null,
        rolls: reworkRolls.map((r) => ({ barcode: r.barcode, status: r.status })),
      },
    },
  };
}
