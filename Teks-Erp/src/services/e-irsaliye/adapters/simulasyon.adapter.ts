// =============================================================================
// `simulasyon` — GİB'e HİÇBİR şey göndermez; test ve eğitim içindir (plan §3.3, R9).
// Ağ çağrısı YOK. Kayıt `adapter='simulasyon'` taşır ve her yanıtta `simulasyon:true`
// döner — uydurulmuş sonuç gerçek sanılmasın.
//
// BELİRLENİMLİ KURAL (durumSorgula): ETTN'in SON onaltılık hanesinin değeri v (0–15),
// d = v mod 10 →  d 0–6 → KABUL · d 7–8 → REDDEDILDI · d 9 → HATA.
// (a–f harfleri 10–15 → d 0–5 → KABUL.) `gonder` her zaman başarılıdır.
// =============================================================================
import type { StatusResult, EIrsaliyeAdapter } from "./adapter.types";

/** Kuralın tek yeri — bekçi aynı fonksiyonla beklenen sonucu hesaplar. */
export function simulatedOutcome(ettn: string): StatusResult["durum"] {
  const v = parseInt(ettn.trim().slice(-1), 16);
  const d = Number.isNaN(v) ? 9 : v % 10;
  if (d <= 6) return "KABUL";
  if (d <= 8) return "REDDEDILDI";
  return "HATA";
}

const DESCRIPTION: Record<StatusResult["durum"], string> = {
  GONDERILDI: "SİMÜLASYON — yanıt bekleniyor",
  KABUL: "SİMÜLASYON — alıcı kabul etti (GİB'e gitmedi)",
  KISMI_KABUL: "SİMÜLASYON — alıcı kısmen kabul etti (GİB'e gitmedi)",
  REDDEDILDI: "SİMÜLASYON — alıcı reddetti (GİB'e gitmedi)",
  HATA: "SİMÜLASYON — gönderim hatası (GİB'e gitmedi)",
};

export const simulasyonAdapter: EIrsaliyeAdapter = {
  kod: "simulasyon",
  etiket: "Simülasyon (GİB'e gitmez)",
  yetenek: { gonder: true, durumSorgula: true, yanitAl: true },
  gonder: async ({ ettn }) => ({ ok: true, saglayiciRef: `SIM-${ettn}` }),
  durumSorgula: async ({ ettn }) => {
    const outcome = simulatedOutcome(ettn);
    return { durum: outcome, aciklama: DESCRIPTION[outcome], yanit: { simulasyon: true } };
  },
};
