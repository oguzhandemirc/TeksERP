// Belge Tara ekran durumu: sayfalar, başlık, gönderim ilerlemesi (online-only; token `useAttemptToken`).
import { useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../offline/attemptToken';
import { inboundDocService } from '../../../services/inboundDoc.service';
import { EMPTY_PROGRESS, MAX_PAGES, SubmitError, addPage, addPages, barcodeToDocNo, submitDocScan, type ScanPage, type SubmitProgress } from './docScan';
import type { Owner } from './DocHeader';

export function useDocScan() {
  const attempt = useAttemptToken();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<SubmitProgress>(EMPTY_PROGRESS);
  // Son gönderilen taslak: okuma sonucu bunun için izlenir; `runKey` aynı taslağa yeni sayfa gidince artar.
  const [done, setDone] = useState<{ note: { id: string; noteNo: string }; pages: number; runKey: number } | null>(null);
  // "Yeni sayfa çek": sayfalar YENİ taslak değil, `done` taslağına eklenir (sayfa no kaldığı yerden).
  const [continuing, setContinuing] = useState(false);
  const senderDocNo = barcodeToDocNo(barcode);

  const reset = () => {
    setPages([]);
    setBarcode(null);
    setProgress(EMPTY_PROGRESS);
    setContinuing(false);
    attempt.renew();
  };

  const addToNote = () => {
    if (!done) return;
    setPages([]);
    setProgress({ note: done.note, uploaded: new Set() });
    setContinuing(true);
  };

  const finish = () => { reset(); setDone(null); };

  // Başlık girdisi değişince deneme de yenidir (kk1): yapışık token farklı yükle gidip 409 + sayfasız taslak bırakmaz.
  const changeOwner = (o: Owner | null) => {
    if (o?.id !== owner?.id) attempt.renew();
    setOwner(o);
  };
  const changeBarcode = (b: string | null) => {
    if (b !== barcode) attempt.renew();
    setBarcode(b);
  };

  const capture = (page: ScanPage) => {
    const r = addPage(pages, page);
    setPages(r.pages);
    if (r.kind === 'duplicate') Toast.show({ type: 'info', text1: `Bu fotoğraf zaten Sayfa ${r.pageNo} olarak ekli` });
    else if (r.kind === 'too-large') Toast.show({ type: 'error', text1: 'Fotoğraf 5 MB sınırını aşıyor; yeniden çekin' });
    else if (r.kind === 'full') Toast.show({ type: 'error', text1: `Bir belgede en çok ${MAX_PAGES} sayfa` });
  };

  // Tarayıcının çok sayfalı sonucu: tek özet bildirimi (sayfa başına toast yağdırmaz).
  const captureMany = (incoming: ScanPage[]) => {
    const r = addPages(pages, incoming);
    setPages(r.pages);
    const notes = [
      r.duplicates ? `${r.duplicates} sayfa zaten ekliydi` : '',
      r.tooLarge ? `${r.tooLarge} sayfa 5 MB sınırını aştı` : '',
      r.overflow ? `en çok ${MAX_PAGES} sayfa; ${r.overflow} sayfa alınmadı` : '',
    ].filter(Boolean);
    if (notes.length) Toast.show({ type: r.added ? 'info' : 'error', text1: `${r.added} sayfa eklendi`, text2: notes.join(' · ') });
  };

  const send = async () => {
    if (sending || !pages.length) return;
    if (!onlineManager.isOnline()) {
      Toast.show({ type: 'error', text1: 'Sunucuya bağlantı yok', text2: 'Belge gönderimi çevrimiçi yapılır; bağlantı gelince yeniden deneyin.' });
      return;
    }
    setSending(true);
    try {
      const pageBase = continuing && done ? done.pages : 0;
      const input = { pages, ownerCustomerId: owner?.id ?? null, senderDocNo, barcodeText: barcode, pageBase };
      // Deneme nesnesi birimden çıkmaz (test_istemci_token_uretimi): yalnız üç yöntem sarılarak verilir.
      const binding = { token: () => attempt.token(), onFailure: (e: unknown) => attempt.onFailure(e), onSuccess: () => attempt.onSuccess() };
      const r = await submitDocScan(inboundDocService, input, binding, progress);
      setDone({ note: r.note, pages: pageBase + r.uploaded, runKey: (done?.runKey ?? 0) + 1 });
      reset();
      const text1 = continuing ? `${r.uploaded} sayfa ${r.note.noteNo} taslağına eklendi` : `Taslak ${r.note.noteNo} oluşturuldu`;
      Toast.show({ type: 'success', text1, text2: 'Okuma sonucu ekranda; onay panelden (Gelen Belgeler) yapılır.' });
    } catch (e) {
      if (e instanceof SubmitError) setProgress(e.progress);
      Toast.show({ type: 'error', text1: 'Gönderilemedi', text2: e instanceof Error ? e.message : undefined });
    } finally {
      setSending(false);
    }
  };

  return {
    pages, setPages, owner, setOwner: changeOwner, setBarcode: changeBarcode, senderDocNo, sending, progress, done, reset, capture, captureMany, send,
    continuing, addToNote, finish,
    // Taslak doğduktan sonra başlık kilitlenir (yeniden deneme aynı taslağa sayfa yükler).
    headerLocked: progress.note !== null,
    remaining: pages.filter((p) => !progress.uploaded.has(p.sha256)).length,
  };
}
