// Belge Tara ekran durumu: sayfalar, başlık, gönderim ilerlemesi (online-only; token `useAttemptToken`).
import { useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../offline/attemptToken';
import { inboundDocService } from '../../../services/inboundDoc.service';
import { EMPTY_PROGRESS, MAX_PAGES, SubmitError, addPage, barcodeToDocNo, submitDocScan, type ScanPage, type SubmitProgress } from './docScan';
import type { Owner } from './DocHeader';

export function useDocScan() {
  const attempt = useAttemptToken();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<SubmitProgress>(EMPTY_PROGRESS);
  const [done, setDone] = useState<{ noteNo: string; pages: number } | null>(null);
  const senderDocNo = barcodeToDocNo(barcode);

  const reset = () => {
    setPages([]);
    setBarcode(null);
    setProgress(EMPTY_PROGRESS);
    attempt.renew();
  };

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

  const send = async () => {
    if (sending || !pages.length) return;
    if (!onlineManager.isOnline()) {
      Toast.show({ type: 'error', text1: 'Sunucuya bağlantı yok', text2: 'Belge gönderimi çevrimiçi yapılır; bağlantı gelince yeniden deneyin.' });
      return;
    }
    setSending(true);
    try {
      const input = { pages, ownerCustomerId: owner?.id ?? null, senderDocNo, barcodeText: barcode };
      // Deneme nesnesi birimden çıkmaz (test_istemci_token_uretimi): yalnız üç yöntem sarılarak verilir.
      const binding = { token: () => attempt.token(), onFailure: (e: unknown) => attempt.onFailure(e), onSuccess: () => attempt.onSuccess() };
      const r = await submitDocScan(inboundDocService, input, binding, progress);
      setDone({ noteNo: r.note.noteNo, pages: r.uploaded });
      reset();
      Toast.show({ type: 'success', text1: `Taslak ${r.note.noteNo} oluşturuldu`, text2: 'Onay panelden (Gelen Belgeler) yapılır.' });
    } catch (e) {
      if (e instanceof SubmitError) setProgress(e.progress);
      Toast.show({ type: 'error', text1: 'Gönderilemedi', text2: e instanceof Error ? e.message : undefined });
    } finally {
      setSending(false);
    }
  };

  return {
    pages, setPages, owner, setOwner: changeOwner, setBarcode: changeBarcode, senderDocNo, sending, progress, done, reset, capture, send,
    // Taslak doğduktan sonra başlık kilitlenir (yeniden deneme aynı taslağa sayfa yükler).
    headerLocked: progress.note !== null,
    remaining: pages.filter((p) => !progress.uploaded.has(p.sha256)).length,
  };
}
