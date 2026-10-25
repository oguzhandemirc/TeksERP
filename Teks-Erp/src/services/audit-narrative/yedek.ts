// =============================================================================
// AUDIT ANLATI YEDEĞİ — şablonu olmayan satırın cümlesi (izlenebilirlik B2)
// -----------------------------------------------------------------------------
// "{kişi}, {kayıt no ya da kısa kimlik} {modül} kaydını {oluşturdu/düzenledi/sildi}"
// + "(olay: …)" + tek alan farkı. HİÇBİR satır yalnız UUID kalmaz (`test_audit_anlati`).
// Kimlik/sistem olayı (AUTH/SYSTEM) satırı: "{kişi}: {olayın Türkçesi}".
// =============================================================================

import { eventActionLabel } from "../../constants/audit-tablo-etiketleri";
import { kayitCekimi } from "../../constants/audit-isimler";
import { type NarrativeRow, type Baglam, type Parca, d, m } from "./sablonlar";

const FIILLER: Record<string, string> = { CREATE: "oluşturdu", UPDATE: "düzenledi", DELETE: "sildi" };

export function fallbackNarrative(s: NarrativeRow, b: Baglam): Parca[] {
  const fiil = FIILLER[s.action];
  if (!fiil) {
    // logEvent satırı: action bir olay kodudur ("LOGIN_SUCCESS").
    const ek = b.kayit.text ? [m(" — "), b.kayit] : [];
    return [b.kisi, m(": "), m(eventActionLabel(s.action)), ...ek];
  }
  const ad = kayitCekimi(b.modul);
  const bas: Parca[] = b.kayit.text ? [b.kisi, m(", "), b.kayit, m(" ")] : [b.kisi, m(", ")];
  const out: Parca[] = [...bas, m(`${ad.belirtme} ${fiil}`)];
  if (b.olay) out.push(m(` (olay: ${b.olay})`));
  const c = b.degisimler.length === 1 ? b.degisimler[0]! : null;
  if (c) out.push(...(c.gizli ? [m(` — ${c.alan} değişti`)] : [m(` — ${c.alan}: `), d(c.eski), m(" → "), d(c.yeni)]));
  else if (b.degisimler.length > 1) out.push(m(` — ${b.degisimler.length} alan değişti`));
  return out;
}
