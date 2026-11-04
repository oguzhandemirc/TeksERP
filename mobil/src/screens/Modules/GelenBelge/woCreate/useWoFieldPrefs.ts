// K30-D kişisel alan tercihi (`tabletIeForm.gizli`): aynı blob'u panel de yazdığı için her kayıt oku-birleştir-yaz.
// Ağ hatasında seçim yerelde kalır ve sonra yeniden yazılır; tercih okunamazsa hepsi açık (bugünkü form).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { preferencesService } from '../../../../services/preferences.service';
import type { WoFormState } from './woForm';
import { docFilledFields, mergePrefBlob, otherFields, parseHidden, placement, toggleHidden, type FieldContext, type WoFieldKey } from './woFieldCatalog';

const PREFS_KEY = ['preferences'] as const;
/** Yazılamayan seçim bu aralıkla yeniden denenir (ekran açık kaldıkça). */
export const PREF_RETRY_MS = 30_000;

export interface WoFieldPrefs {
  hidden: WoFieldKey[];
  toggle: (k: WoFieldKey) => void;
  reset: () => void;
  /** Son seçim henüz sunucuya yazılamadı (yerelde tutuluyor). */
  pending: boolean;
}

export function useWoFieldPrefs(): WoFieldPrefs {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: PREFS_KEY, queryFn: preferencesService.get, staleTime: 5 * 60_000, retry: false });
  const [local, setLocal] = useState<WoFieldKey[] | null>(null);
  const [pending, setPending] = useState(false);
  const want = useRef<WoFieldKey[] | null>(null);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const flush = useCallback(async () => {
    if (busy.current || !want.current) return;
    busy.current = true;
    const target = want.current;
    let failed = false;
    try {
      // Taze blob okunur: panelin bu arada yazdığı tema/sıra ezilmez.
      const blob = await preferencesService.get();
      const saved = await preferencesService.save(mergePrefBlob(blob, target));
      qc.setQueryData(PREFS_KEY, saved);
      if (want.current === target) want.current = null;
    } catch {
      // Yerelde kalır; zamanlayıcı ya da sonraki değişiklik yeniden yazar.
      failed = true;
    } finally {
      busy.current = false;
      if (alive.current) {
        setPending(!!want.current);
        // Yazım sürerken yeni seçim geldiyse hemen; hata varsa aralıkla yeniden.
        if (want.current && !failed) void flush();
        else if (want.current && !timer.current) {
          timer.current = setTimeout(() => {
            timer.current = null;
            void flush();
          }, PREF_RETRY_MS);
        }
      }
    }
  }, [qc]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const hidden = useMemo(() => local ?? parseHidden(q.data), [local, q.data]);
  const write = useCallback(
    (next: WoFieldKey[]) => {
      setLocal(next);
      want.current = next;
      setPending(true);
      void flush();
    },
    [flush],
  );
  const toggle = useCallback((k: WoFieldKey) => write(toggleHidden(hidden, k)), [hidden, write]);
  const reset = useCallback(() => write([]), [write]);
  return { hidden, toggle, reset, pending };
}

/** Formun alan yerleşimi: üstte çizilenler, altta "Diğer alanlar"a inenler, ⚙ ve bölüm açıklığı. */
export function useWoFieldLayout(s: Pick<WoFormState, 'docShown' | 'suggestions' | 'docText'>, c: FieldContext, valued: readonly WoFieldKey[] = []) {
  const prefs = useWoFieldPrefs();
  const { docShown, suggestions, docText } = s;
  const docKeys = useMemo(() => docFilledFields({ docShown, suggestions, docText }), [docShown, suggestions, docText]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const isTop = useCallback((k: WoFieldKey) => placement(k, prefs.hidden, docKeys) === 'top', [prefs.hidden, docKeys]);
  const other = otherFields(prefs.hidden, docKeys, c);
  return {
    prefs,
    isTop,
    isOther: (k: WoFieldKey) => !isTop(k),
    other,
    /** Gizli ama dolu (gövdeye gidecek) alanlar — "Diğer alanlar" başlığında söylenir. */
    otherValued: other.filter((k) => valued.includes(k)),
    sheetOpen,
    openSheet: () => setSheetOpen(true),
    closeSheet: () => setSheetOpen(false),
    otherOpen,
    toggleOther: () => setOtherOpen((o) => !o),
  };
}
