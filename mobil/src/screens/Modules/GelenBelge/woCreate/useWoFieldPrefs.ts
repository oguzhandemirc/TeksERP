// K30-D kişisel alan tercihi (`tabletIeForm.gizli`): aynı blob'u panel de yazdığı için her kayıt oku-birleştir-yaz.
// Ağ hatasında seçim yerelde kalır ve sonra yeniden yazılır; tercih okunamazsa hepsi açık (bugünkü form).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { preferencesService } from '../../../../services/preferences.service';
import type { WoFormState } from './woForm';
import { docFilledFields, mergePrefBlob, otherFields, otherSectionShown, parseFillTarget, parseHidden, parseOtherHidden, parseStepNotesHidden, placement, toggleHidden, type FieldContext, type WoFieldKey } from './woFieldCatalog';

const PREFS_KEY = ['preferences'] as const;
/** Yazılamayan seçim bu aralıkla yeniden denenir (ekran açık kaldıkça). */
export const PREF_RETRY_MS = 30_000;

interface PrefValue {
  hidden: WoFieldKey[];
  fill: boolean;
  /** "Diğer alanlar" bölümü kapalı (varsayılan açık). */
  otherOff: boolean;
  /** Rota adımı boş not kutusu kapalı (varsayılan açık). */
  notesOff: boolean;
}

export interface WoFieldPrefs {
  hidden: WoFieldKey[];
  /** "Belgedeki gelen değerleri hedefe yaz" (varsayılan kapalı). */
  fillTarget: boolean;
  setFillTarget: (on: boolean) => void;
  /** "Diğer alanlar" bölümünü gizle (kişisel, varsayılan görünür). */
  otherHidden: boolean;
  setOtherHidden: (off: boolean) => void;
  /** Rota adımlarının boş not kutusunu gizle (kişisel, varsayılan görünür; dolu not hep görünür). */
  stepNotesHidden: boolean;
  setStepNotesHidden: (off: boolean) => void;
  toggle: (k: WoFieldKey) => void;
  reset: () => void;
  /** Son seçim henüz sunucuya yazılamadı (yerelde tutuluyor). */
  pending: boolean;
}

export function useWoFieldPrefs(): WoFieldPrefs {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: PREFS_KEY, queryFn: preferencesService.get, staleTime: 5 * 60_000, retry: false });
  const [local, setLocal] = useState<PrefValue | null>(null);
  const [pending, setPending] = useState(false);
  const want = useRef<PrefValue | null>(null);
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
      const saved = await preferencesService.save(mergePrefBlob(blob, target.hidden, target.fill, { digerGizli: target.otherOff, adimNotuGizli: target.notesOff }));
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

  const hidden = useMemo(() => local?.hidden ?? parseHidden(q.data), [local, q.data]);
  const fillTarget = local?.fill ?? parseFillTarget(q.data);
  const otherHidden = local?.otherOff ?? parseOtherHidden(q.data);
  const stepNotesHidden = local?.notesOff ?? parseStepNotesHidden(q.data);
  const cur: PrefValue = { hidden, fill: fillTarget, otherOff: otherHidden, notesOff: stepNotesHidden };
  const write = useCallback(
    (next: PrefValue) => {
      setLocal(next);
      want.current = next;
      setPending(true);
      void flush();
    },
    [flush],
  );
  const patch = (p: Partial<PrefValue>) => write({ ...cur, ...p });
  const toggle = (k: WoFieldKey) => patch({ hidden: toggleHidden(hidden, k) });
  // "Varsayılana dön" yalnız alan listesini sıfırlar; diğer anahtarlar kendi satırlarından değişir.
  const reset = () => patch({ hidden: [] });
  const setFillTarget = (on: boolean) => patch({ fill: on });
  const setOtherHidden = (off: boolean) => patch({ otherOff: off });
  const setStepNotesHidden = (off: boolean) => patch({ notesOff: off });
  return { hidden, fillTarget, setFillTarget, otherHidden, setOtherHidden, stepNotesHidden, setStepNotesHidden, toggle, reset, pending };
}

/** Formun alan yerleşimi: üstte çizilenler, altta "Diğer alanlar"a inenler, ⚙ ve bölüm açıklığı. */
export function useWoFieldLayout(
  s: Pick<WoFormState, 'docShown'>,
  c: FieldContext,
  valued: readonly WoFieldKey[] = [],
  /** Kontrollü kip: ⚙ seçici açıklığı üst ekranda (header "Alanlar" tuşu). */
  sheet?: { open: boolean; onOpenChange: (open: boolean) => void },
) {
  const prefs = useWoFieldPrefs();
  const { docShown } = s;
  const docKeys = useMemo(() => docFilledFields({ docShown }), [docShown]);
  const [ownSheetOpen, setOwnSheetOpen] = useState(false);
  const sheetOpen = sheet ? sheet.open : ownSheetOpen;
  const setSheetOpen = sheet ? sheet.onOpenChange : setOwnSheetOpen;
  const [otherOpen, setOtherOpen] = useState(false);
  // Bölüm ⚙'tan gizliyken alt çubuk hapı oradaki alana yönlendirirse bölüm bu form boyunca görünür olur.
  const [revealed, setRevealed] = useState(false);
  const isTop = useCallback((k: WoFieldKey) => placement(k, prefs.hidden, docKeys) === 'top', [prefs.hidden, docKeys]);
  const other = otherFields(prefs.hidden, docKeys, c);
  const otherValued = other.filter((k) => valued.includes(k));
  return {
    prefs,
    isTop,
    isOther: (k: WoFieldKey) => !isTop(k),
    other,
    /** Gizli ama dolu (gövdeye gidecek) alanlar — "Diğer alanlar" başlığında söylenir. */
    otherValued,
    /** "Diğer alanlar" bölümü çizilir mi (⚙ anahtarı; değerli gizli alan varken hep). */
    otherShown: otherSectionShown(prefs.otherHidden, otherValued, revealed),
    /** Alt çubuk yönlendirmesi: bölümü göster + aç. */
    revealOther: () => {
      setRevealed(true);
      setOtherOpen(true);
    },
    sheetOpen,
    openSheet: () => setSheetOpen(true),
    closeSheet: () => setSheetOpen(false),
    otherOpen,
    toggleOther: () => setOtherOpen((o) => !o),
  };
}
