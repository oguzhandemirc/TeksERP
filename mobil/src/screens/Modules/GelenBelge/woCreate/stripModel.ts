// Belge şeridinin üç aşaması (belge tanıt 3 aşama, T2) — saf: sunucunun `tanima` bloğu + tanıtma girişi + parti taslağı →
// "① Tanındı: X · %94" / "② 7 alan → iş emri" / "③ 3 parti → 3 iş emri (şablon kuralı)". Kural ve eşleme sunucudadır; burası
// yalnız metni kurar. Kip satırı taslaktan (kullanıcının seçtiği ile programın yaptığı ayrı gösterilir).
import type { Tanima, TanimaMappingRow, TanimaRule } from '../../../../services/inboundDoc.service';
import type { TeachEntry } from '../tanit/useTeachEntry';
import { modeRuleLine, type MultiPartyDraft } from './partyDraft';

export interface StripRecognition {
  tone: 'ok' | 'warn' | 'info';
  text: string;
  /** "Tanıt" düğmesi (tanınmamış + bu tablette fotoğraf var). */
  teach: boolean;
}

export interface StripModel {
  recognition: StripRecognition;
  /** ② eşleme; yerelde yeni tanıtılmış belgede sunucu eşlemesi bayattır → null. */
  mapping: { text: string; rows: readonly TanimaMappingRow[] } | null;
  /** ③ kurallar satırı; `canChange` = "Bu sefer değiştir" (yalnız çok partide). */
  rule: { text: string; sourceText: string | null; touched: boolean; canChange: boolean } | null;
  /** Sayfada listelenecek bütün kurallar (çok parti satırı taslaktan). */
  rules: readonly TanimaRule[];
}

export interface StripInput {
  tanima: Tanima | undefined;
  entry: Pick<TeachEntry, 'kind' | 'templateName' | 'noPhoto'>;
  /** Satır bu tablette yeni şablonla doldu (sunucu özeti henüz eski). */
  localTaught: boolean;
  multi: MultiPartyDraft | null | undefined;
  /** Kayıt sürüyor / bitti: kip değiştirilemez. */
  locked: boolean;
}

const pct = (score: number | null): string => (score == null ? '' : ` · %${Math.round(Math.max(0, Math.min(1, score)) * 100)}`);

function recognition(i: StripInput, t: Tanima): StripRecognition {
  if (i.localTaught && i.entry.templateName) return { tone: 'ok', text: `Tanındı: ${i.entry.templateName}`, teach: false };
  if (t.durum === 'TANITILDI' && t.template) return { tone: 'ok', text: `Tanındı: ${t.template.name}${pct(t.template.score)}`, teach: false };
  if (t.durum === 'SISTEM' && t.template) return { tone: 'info', text: `Hazır şablon: ${t.template.name}`, teach: false };
  return { tone: 'warn', text: 'Tanınmadı', teach: i.entry.kind === 'untaught' && !i.entry.noPhoto };
}

/** Şerit modeli; sunucu `tanima` göndermiyorsa (eski sunucu / okunmuş sayfa yok) null → bugünkü şerit. */
export function stripModel(i: StripInput): StripModel | null {
  const t = i.tanima;
  if (!t) return null;
  const others = t.rules.filter((r) => r.key !== 'multiParty');
  const mapping = !i.localTaught && t.mapping.length > 0 ? { text: `${t.mapping.length} alan → iş emri`, rows: t.mapping } : null;
  let rule: StripModel['rule'] = null;
  if (i.multi) {
    const line = modeRuleLine(i.multi);
    rule = { ...line, canChange: !i.locked };
  } else if (others.length > 0) {
    rule = { text: others.map((r) => r.text).join(' · '), sourceText: null, touched: false, canChange: false };
  }
  return { recognition: recognition(i, t), mapping, rule, rules: i.multi ? others : t.rules };
}
