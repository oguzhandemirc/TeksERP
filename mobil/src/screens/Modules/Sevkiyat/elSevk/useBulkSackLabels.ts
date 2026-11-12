// Sevk sonrası baskılar: tüm dolu çuvalların etiketi (sırayla) ve sevk irsaliyesi.
// Etiket yolu `SackLabelPrinter` ile aynıdır: yerin BT yazıcısı varsa ham gönderim (diyaloğa düşmez), yoksa
// çuval HTML'leri TEK sistem penceresinde birleşir. Baskı izi yalnız gerçek baskıdan sonra; hata Yazdırma geçmişine.
import { useCallback, useRef, useState } from 'react';
import Toast from 'react-native-toast-message';
import { useMobileRasterEnabled } from '../../../../hooks/useFeatureFlags';
import { ensurePrinterPaired, printRaw, printRawBytes } from '../../../../services/btPrinter.service';
import { labelService } from '../../../../services/label.service';
import { printHtml } from '../../../../services/printHtml';
import { DIALOG_TARGET, btTarget, isPrintCancel, printJobAttachment, reportPrintOutcome, type PrintStep } from '../../../../services/printJob.service';
import { resolveBtPrinter } from '../../../../services/resolveBtPrinter';
import { getShipmentDispatchHtml } from '../../../../services/shipmentDispatchPrint';
import { mergeLabelHtml, type LabelTarget } from './bulkLabel';

const NO_MARGIN = { left: 0, top: 0, right: 0, bottom: 0 };
type Target = ReturnType<typeof btTarget> | typeof DIALOG_TARGET;

function report(t: LabelTarget, p: { target: Target; startedAt: number; step: PrintStep; err: unknown; cancel: boolean }) {
  reportPrintOutcome({
    subject: { subjectKind: 'ETIKET_CUVAL', subjectTable: 'sacks', subjectId: t.sackId, subjectNo: t.label },
    target: p.target,
    startedAt: p.startedAt,
    status: p.cancel ? 'IPTAL' : 'HATA',
    step: p.step,
    error: p.err,
  });
}

async function recordPrinted(sackId: string, target: Target, startedAt: number) {
  try {
    await labelService.recordSackPrintEvent(sackId, printJobAttachment(target, startedAt));
  } catch {
    // İz best-effort: baskı gerçekleşti.
  }
}

async function printOneBt(t: LabelTarget, addr: string, target: Target, raster: boolean): Promise<boolean> {
  const startedAt = Date.now();
  let step: PrintStep = 'fetch';
  try {
    const native = await labelService.getSackNative(t.sackId, raster);
    step = 'lang';
    if (!['PPLA', 'PPLB', 'ZPL'].includes(native.language) || !native.content) {
      throw new Error('Yazıcının dili çözülemedi — Tanımlar → Donanım’da bu yerin yazıcısını kontrol edin.');
    }
    step = 'pair';
    await ensurePrinterPaired(addr);
    step = 'send';
    if (native.encoding === 'base64') await printRawBytes(addr, atob(native.content));
    else await printRaw(addr, native.content);
    await recordPrinted(t.sackId, target, startedAt);
    return true;
  } catch (err) {
    report(t, { target, startedAt, step, err, cancel: false });
    return false;
  }
}

/** HTML yolu: hepsi tek pencerede; iptal/hata tümünü "kalan" bırakır. */
async function printAllDialog(targets: LabelTarget[]): Promise<LabelTarget[]> {
  const startedAt = Date.now();
  let step: PrintStep = 'fetch';
  try {
    const htmls: string[] = [];
    for (const t of targets) {
      const html = await labelService.getSackHtml(t.sackId);
      if (!html.startsWith('<')) throw new Error('Etiket HTML alınamadı');
      htmls.push(html);
    }
    step = 'dialog';
    await printHtml({ html: mergeLabelHtml(htmls), margins: NO_MARGIN });
    for (const t of targets) await recordPrinted(t.sackId, DIALOG_TARGET, startedAt);
    return [];
  } catch (err) {
    const cancel = step === 'dialog' && isPrintCancel(String((err as Error)?.message ?? ''));
    for (const t of targets) report(t, { target: DIALOG_TARGET, startedAt, step, err, cancel });
    if (!cancel) Toast.show({ type: 'error', text1: 'Etiket basılamadı', text2: (err as Error)?.message || 'Yazıcıya gönderilemedi', visibilityTime: 9000 });
    return targets;
  }
}

export function useBulkSackLabels() {
  const raster = useMobileRasterEnabled();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState<LabelTarget[]>([]);
  const busy = useRef(false);

  const run = useCallback(
    async (targets: LabelTarget[]) => {
      if (busy.current || targets.length === 0) return;
      busy.current = true;
      setRunning(true);
      setDone(0);
      setTotal(targets.length);
      try {
        const bt = await resolveBtPrinter();
        const addr = bt?.address ?? null;
        let left: LabelTarget[] = [];
        if (bt && addr) {
          const target = btTarget(bt);
          for (const t of targets) {
            if (!(await printOneBt(t, addr, target, raster))) left.push(t);
            setDone((n) => n + 1);
          }
          if (left.length > 0) Toast.show({ type: 'error', text1: `${left.length} etiket basılamadı`, text2: left.map((t) => t.label).join(', '), visibilityTime: 9000 });
        } else {
          left = await printAllDialog(targets);
          setDone(targets.length);
        }
        setFailed(left);
        if (left.length === 0) Toast.show({ type: 'success', text1: `${targets.length} çuval etiketi basıldı` });
      } finally {
        busy.current = false;
        setRunning(false);
      }
    },
    [raster],
  );

  return { run, running, done, total, failed };
}

/** Sevk irsaliyesi (backend'in tek kaynak HTML'i); iptal sessiz, hata toast. */
export function usePrintDispatchNote(shipmentId: string) {
  const [printing, setPrinting] = useState(false);
  const print = useCallback(async () => {
    setPrinting(true);
    try {
      const html = await getShipmentDispatchHtml(shipmentId);
      await printHtml({ html, margins: NO_MARGIN });
    } catch (e) {
      const msg = (e as Error)?.message ?? '';
      if (!isPrintCancel(msg)) Toast.show({ type: 'error', text1: 'İrsaliye yazdırılamadı', text2: msg });
    } finally {
      setPrinting(false);
    }
  }, [shipmentId]);
  return { print, printing };
}
