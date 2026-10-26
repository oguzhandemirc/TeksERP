// Tercih taslağı: sunucunun çözdüğü hücreler + kullanıcının dokunduğu anahtarlar → PUT tam gövdesi.
// PUT tam gövdedir (görülebilir türlerin satırları değişir): tabletin göstermediği kanallar (masaüstü,
// özet) ve kapsam süzgeçleri sunucudan geldiği gibi AYNEN geri gönderilir, yoksa silinirdi.
import type { PreferenceChannel, PreferenceItem, PreferencesResponse } from '../../services/bildirim/types';

/** Tablet ekranının gösterdiği kanallar (sıra = sütun sırası). */
export const TABLET_CHANNELS: readonly PreferenceChannel[] = ['UYGULAMA', 'TABLET_SES'];

export type DraftEdits = ReadonlyMap<string, boolean>;

export const editKey = (kind: string, channel: PreferenceChannel): string => `${kind}|${channel}`;

/** Hücrenin ekranda gösterilecek değeri: dokunulduysa taslak, değilse sunucunun kararı. */
export function cellValue(res: PreferencesResponse, edits: DraftEdits, kind: string, channel: PreferenceChannel): boolean | null {
  const local = edits.get(editKey(kind, channel));
  if (local !== undefined) return local;
  const cell = res.hucreler.find((h) => h.kind === kind)?.kanallar.find((c) => c.kanal === channel);
  return cell ? cell.durum === 'ACIK' : null;
}

export function buildPreferenceBody(res: PreferencesResponse, edits: DraftEdits): PreferenceItem[] {
  const out: PreferenceItem[] = [];
  for (const h of res.hucreler) {
    for (const c of h.kanallar) {
      if (c.durum === 'GIZLI') continue;
      const enabled = edits.get(editKey(h.kind, c.kanal)) ?? c.durum === 'ACIK';
      const row = res.satirlar.find((s) => s.tur === h.kind && s.kanal === c.kanal);
      out.push(row?.kapsam && c.kanal === 'UYGULAMA' && !c.kilit ? { tur: h.kind, kanal: c.kanal, acik: enabled, kapsam: row.kapsam } : { tur: h.kind, kanal: c.kanal, acik: enabled });
    }
  }
  return out;
}
