// "Elle Oluştur": belgesiz İE formu. Açılışta sayfasız MANUAL taslak doğar (mevcut `POST /gelen-belge/irsaliyeler`);
// kayıt belge okutmayla AYNI form ucundan gider (sunucu sayfasız taslağı NO_PAGES sayar, engellemez). Kaydedilmeden
// çıkılırsa ya da "Kendi üretim" seçilirse ve sayfa eklenmediyse taslak silinir (deftere hiç yazmamış taslak; sunucu yalnız DRAFT'ı siler).
import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../../offline/attemptToken';
import { inboundDocService } from '../../../../services/inboundDoc.service';
import { errorText } from './woFromDoc';

type Note = { id: string; noteNo: string };

export function useManualDraft(enabled: boolean, onReady: (note: Note) => void) {
  const attempt = useAttemptToken();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const noteRef = useRef<Note | null>(null);
  const keepRef = useRef(false);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  const start = useCallback(async () => {
    setBusy(true);
    setFailed(false);
    try {
      const created = await inboundDocService.createDraftNote({ clientToken: attempt.token(), sourceKind: 'MANUAL', ownerCustomerId: null, senderDocNo: null });
      attempt.onSuccess();
      noteRef.current = { id: created.id, noteNo: created.noteNo };
      keepRef.current = false;
      readyRef.current(noteRef.current);
    } catch (e) {
      attempt.onFailure(e);
      setFailed(true);
      Toast.show({ type: 'error', text1: 'Belgesiz form açılamadı', text2: errorText(e) });
    } finally {
      setBusy(false);
    }
  }, [attempt]);

  const started = useRef(false);
  useEffect(() => {
    if (!enabled) {
      // Kendi üretime geçildi: belgesiz taslak artık gereksiz — tutulmayan taslak silinir, geri dönünce yeniden doğar.
      const n = noteRef.current;
      if (n && !keepRef.current) void inboundDocService.deleteDraftNote(n.id).catch(() => undefined);
      if (!keepRef.current) noteRef.current = null;
      started.current = false;
      return;
    }
    if (started.current) return;
    started.current = true;
    void start();
  }, [enabled, start]);

  useEffect(
    () => () => {
      const n = noteRef.current;
      if (n && !keepRef.current) void inboundDocService.deleteDraftNote(n.id).catch(() => undefined);
    },
    [],
  );

  return {
    busy,
    failed,
    start: () => void start(),
    /** Kaydedildi / taslak bırakıldı / sayfa eklendi: çıkışta silinmez. */
    keep: () => { keepRef.current = true; },
    /** Taslak kullanıcı tarafından iptal edildi: yeniden başlatılabilir. */
    forget: () => { noteRef.current = null; },
  };
}
