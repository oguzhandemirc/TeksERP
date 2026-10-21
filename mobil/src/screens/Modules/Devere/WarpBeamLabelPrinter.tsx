// =============================================================================
// LEVENT ETİKETİ POMPASI — `beamLabelQueue`dan sırayla basar (çuval `SackLabelPrinter` emsali)
// =============================================================================
// İki yol: (A) oturumun yerine bağlı BT SPP yazıcı çözülürse `/native` ham gönderim;
// (B) yoksa `/html` + expo-print. Devere ekranı OTURUMSUZDUR → BT çözümü fail-closed boş
// döner ve (B) yolu çalışır; oturum varsa (A). Yazıcı dili PPLA/PPLB/ZPL değilse hata,
// şablon yoksa sunucunun 400 mesajı olduğu gibi kuyrukta kalır. İz yalnız gerçek baskıdan sonra.
// Bileşen yalnız Devere ekranında mount'tur — kuyruk başka ekranda basmaya kalkmaz.
// =============================================================================
import { useEffect, useRef } from 'react';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { printHtml } from '../../../services/printHtml';
import { warpBeamService } from '../../../services/warpBeam.service';
import { peripheralService } from '../../../services/peripheral.service';
import { useSessionStore } from '../../../store/sessionStore';
import { ensurePrinterPaired, isBtPrinterSupported, printRaw, printRawBytes } from '../../../services/btPrinter.service';
import { useMobileRasterEnabled } from '../../../hooks/useFeatureFlags';
import { nextPending, useBeamLabelQueue, type BeamLabelJob } from './beamLabelQueue';

async function resolveBtPrinter(): Promise<string | null> {
  if (!isBtPrinterSupported() || useSessionStore.getState().active == null) return null;
  try {
    const printers = await peripheralService.getForSession('LABEL_PRINTER');
    return printers.find((p) => p.connectionType === 'BLUETOOTH_SPP' && !!p.address && !p.simulate)?.address ?? null;
  } catch {
    return null; // çözüm hatası → HTML yolu
  }
}

/** Tek işi basar; hata fırlatır (mesaj Türkçe, sunucununki olduğu gibi). */
async function printBeamLabel(job: BeamLabelJob, raster: boolean): Promise<void> {
  const bt = await resolveBtPrinter();
  if (bt) {
    const native = await warpBeamService.labelNative(job.beamId, raster);
    if (!['PPLA', 'PPLB', 'ZPL'].includes(native.language) || !native.content) {
      throw new Error('Yazıcının dili çözülemedi — Tanımlar → Donanım’da bu yerin yazıcısını ve dilini kontrol edin.');
    }
    await ensurePrinterPaired(bt);
    if (native.encoding === 'base64') await printRawBytes(bt, atob(native.content));
    else await printRaw(bt, native.content);
    return;
  }
  const html = await warpBeamService.labelHtml(job.beamId);
  if (!html.startsWith('<')) throw new Error('Etiket HTML alınamadı');
  await printHtml({ html, margins: { left: 0, top: 0, right: 0, bottom: 0 } });
}

/** 404 = sunucuda levent etiketi ucu yok (S1b öncesi sürüm) — operatöre yol söylenir. */
function failureText(err: unknown): string {
  const e = err as { message?: string; status?: number; response?: { status?: number } };
  if ((e.status ?? e.response?.status) === 404) return 'Sunucu levent etiketini tanımıyor — sunucu güncellenince Tekrar bas.';
  return e.message?.trim() || 'Yazıcıya gönderilemedi';
}

export default function WarpBeamLabelPrinter() {
  const raster = useMobileRasterEnabled();
  const rasterRef = useRef(raster);
  rasterRef.current = raster;
  const jobs = useBeamLabelQueue((s) => s.jobs);
  const activeId = useBeamLabelQueue((s) => s.activeId);
  const hydrated = useBeamLabelQueue((s) => s.hydrated);

  useEffect(() => {
    void useBeamLabelQueue.getState().hydrate();
  }, []);

  useEffect(() => {
    if (!hydrated || activeId) return;
    const job = nextPending(jobs);
    if (!job) return;
    const q = useBeamLabelQueue.getState();
    q.setActive(job.beamId);
    void (async () => {
      try {
        await printBeamLabel(job, rasterRef.current);
        warpBeamService.labelPrintEvent(job.beamId).catch(() => {}); // iz best-effort
        useBeamLabelQueue.getState().done(job.beamId);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({ type: 'success', text1: 'Levent etiketi basıldı', text2: job.beamNo });
      } catch (err) {
        const msg = failureText(err);
        const cancelled = /did not complete|cancel/i.test(msg);
        useBeamLabelQueue.getState().fail(job.beamId, cancelled ? 'Yazdırma iptal edildi' : msg);
        void Haptics.notificationAsync(cancelled ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error);
        Toast.show({ type: cancelled ? 'info' : 'error', text1: `${job.beamNo} etiketi basılmadı`, text2: cancelled ? 'Listeden Tekrar bas' : msg, visibilityTime: 8000 });
      }
    })();
  }, [hydrated, activeId, jobs]);

  return null;
}
