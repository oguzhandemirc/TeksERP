// Belge Tara ekran durumu: sayfalar, başlık, gönderim ilerlemesi (online-only; token `useAttemptToken`).
import { useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { useAttemptToken } from '../../../offline/attemptToken';
import { inboundDocService, type SameDocumentMatch } from '../../../services/inboundDoc.service';
import { prefetchPageText } from '../../../services/deviceOcr';
import { EMPTY_PROGRESS, MAX_PAGES, SameDocumentFound, SubmitError, addPage, addPages, barcodeToDocNo, submitDocScan, type ScanPage, type SubmitProgress } from './docScan';
import type { Owner } from './DocHeader';
import { rememberLocalPages } from './tanit/localPages';
import { bindLiveLocks } from './live/liveLocks';

/** Cihazda OCR (S16c) çekim anında başlar: eklenen İLK yeni sayfa (ekleme listenin sonuna) önden okunur. */
function withPrefetch(prev: readonly ScanPage[], next: ScanPage[]): ScanPage[] {
  prefetchPageText(next[prev.length]);
  return next;
}

/** `successHint`: gönderim bildiriminin alt satırı (belgeden iş emri akışı onay panelden demez). */
/** Çok sayfalı eklemenin özet notları (atlanan sayfalar). */
function captureNotes(r: { duplicates: number; tooLarge: number; overflow: number }): string[] {
  return [
    r.duplicates ? `${r.duplicates} sayfa zaten ekliydi` : '',
    r.tooLarge ? `${r.tooLarge} sayfa 5 MB sınırını aştı` : '',
    r.overflow ? `en çok ${MAX_PAGES} sayfa; ${r.overflow} sayfa alınmadı` : '',
  ].filter(Boolean);
}

const sentOf = (ps: readonly ScanPage[]) => ps.map(({ sha256, uri }) => ({ sha256, uri }));

const reopened = (note: { id: string; noteNo: string }, sent: readonly ScanPage[], prev: { runKey: number } | null) =>
  ({ note, pages: sent.length, runKey: (prev?.runKey ?? 0) + 1, sent: sentOf(sent) });

/** Aynı belge: taslak → o taslak forma açılır (yeni kayıt yok); işlenmiş/iptal → kısayol kartı. */
function onSameDocument(
  match: SameDocumentMatch,
  list: readonly ScanPage[],
  h: { openNote: (n: { id: string; noteNo: string }, sent: readonly ScanPage[]) => void; reset: () => void; setSameDoc: (m: SameDocumentMatch) => void },
): void {
  const { note, state } = match;
  if (state === 'DRAFT') {
    h.openNote({ id: note.id, noteNo: note.noteNo }, list);
    Toast.show({ type: 'info', text1: `Bu belge zaten ${note.noteNo} taslağında`, text2: 'Yeni kayıt açılmadı; o taslak açıldı.' });
    return;
  }
  h.reset();
  h.setSameDoc(match);
}

export function useDocScan(opts: { successHint?: string } = {}) {
  const attempt = useAttemptToken();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<SubmitProgress>(EMPTY_PROGRESS);
  // Son gönderilen taslak: okuma sonucu bunun için izlenir; `runKey` aynı taslağa yeni sayfa gidince artar.
  // `sent`: gönderilen sayfaların yerel kopyası (sha256 + uri) — tanıtma ekranı (S1b) okunmuş taramayı bu fotoğrafla gösterir.
  const [done, setDone] = useState<{ note: { id: string; noteNo: string }; pages: number; runKey: number; sent: { sha256: string; uri: string }[] } | null>(null);
  // "Yeni sayfa çek": sayfalar YENİ taslak değil, `done` taslağına eklenir (sayfa no kaldığı yerden).
  const [continuing, setContinuing] = useState(false);
  // Aynı belge daha önce işlenmiş/iptal: kısayol kartı (taslak açılmadı). Taslak eşleşmesi kart değil, o taslak açılır.
  const [sameDoc, setSameDoc] = useState<SameDocumentMatch | null>(null);
  const senderDocNo = barcodeToDocNo(barcode);

  const reset = () => {
    setPages([]); setBarcode(null); setProgress(EMPTY_PROGRESS); setContinuing(false);
    attempt.renew();
  };

  const addToNote = () => {
    if (!done) return;
    setPages([]);
    setProgress({ note: done.note, uploaded: new Set() });
    setContinuing(true);
  };

  const finish = () => { reset(); setDone(null); };

  /** Var olan belgeyi forma aç (taslak eşleşmesi ya da kart "Bu belgeden yeni iş emri"); yeni taslak açılmaz. */
  const openNote = (note: { id: string; noteNo: string }, sent: readonly ScanPage[] = []) => { setSameDoc(null); setDone(reopened(note, sent, done)); reset(); };

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
    setPages(withPrefetch(pages, r.pages));
    if (r.kind === 'duplicate') Toast.show({ type: 'info', text1: `Bu fotoğraf zaten Sayfa ${r.pageNo} olarak ekli` });
    else if (r.kind === 'too-large') Toast.show({ type: 'error', text1: 'Fotoğraf 5 MB sınırını aşıyor; yeniden çekin' });
    else if (r.kind === 'full') Toast.show({ type: 'error', text1: `Bir belgede en çok ${MAX_PAGES} sayfa` });
  };

  // Tarayıcının çok sayfalı sonucu: tek özet bildirimi (sayfa başına toast yağdırmaz). Dönüş: sayfa eklendiyse yeni liste
  // (kendiliğinden gönderim aynı listeyi kullanır), yoksa null.
  const captureMany = (incoming: ScanPage[]): ScanPage[] | null => {
    const r = addPages(pages, incoming);
    setPages(withPrefetch(pages, r.pages));
    const notes = captureNotes(r);
    if (notes.length) Toast.show({ type: r.added ? 'info' : 'error', text1: `${r.added} sayfa eklendi`, text2: notes.join(' · ') });
    return r.added ? r.pages : null;
  };

  const send = async (list: ScanPage[] = pages) => {
    if (sending || !list.length) return;
    if (!onlineManager.isOnline()) {
      Toast.show({ type: 'error', text1: 'Sunucuya bağlantı yok', text2: 'Belge gönderimi çevrimiçi yapılır; bağlantı gelince yeniden deneyin.' });
      return;
    }
    setSending(true);
    try {
      const pageBase = continuing && done ? done.pages : 0;
      const input = { pages: list, ownerCustomerId: owner?.id ?? null, senderDocNo, barcodeText: barcode, pageBase };
      // Deneme nesnesi birimden çıkmaz (test_istemci_token_uretimi): yalnız üç yöntem sarılarak verilir.
      const binding = { token: () => attempt.token(), onFailure: (e: unknown) => attempt.onFailure(e), onSuccess: () => attempt.onSuccess() };
      const r = await submitDocScan(inboundDocService, input, binding, progress);
      rememberLocalPages(list);
      bindLiveLocks(r.note.id, list.map((p) => p.sha256));
      setDone({ note: r.note, pages: pageBase + r.uploaded, runKey: (done?.runKey ?? 0) + 1, sent: [...(continuing && done ? done.sent : []), ...sentOf(list)] });
      reset();
      const text1 = continuing ? `${r.uploaded} sayfa ${r.note.noteNo} taslağına eklendi` : `Taslak ${r.note.noteNo} oluşturuldu`;
      Toast.show({ type: 'success', text1, text2: opts.successHint ?? 'Okuma sonucu ekranda; onay panelden (Gelen Belgeler) yapılır.' });
    } catch (e) {
      if (e instanceof SameDocumentFound) return onSameDocument(e.match, list, { openNote, reset, setSameDoc });
      if (e instanceof SubmitError) setProgress(e.progress);
      Toast.show({ type: 'error', text1: 'Gönderilemedi', text2: e instanceof Error ? e.message : undefined });
    } finally {
      setSending(false);
    }
  };

  return {
    pages, setPages, owner, setOwner: changeOwner, setBarcode: changeBarcode, senderDocNo, sending, progress, done, reset, capture, captureMany, send,
    continuing, addToNote, finish, sameDoc, clearSameDoc: () => setSameDoc(null), openNote,
    // Taslak doğduktan sonra başlık kilitlenir (yeniden deneme aynı taslağa sayfa yükler).
    headerLocked: progress.note !== null,
    remaining: pages.filter((p) => !progress.uploaded.has(p.sha256)).length,
  };
}
