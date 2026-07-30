import { useEffect, useRef } from 'react';
import { printHtml } from '../../services/printHtml';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { labelService } from '../../services/label.service';
import { peripheralService } from '../../services/peripheral.service';
import { useSessionStore } from '../../store/sessionStore';
import {
  isBtPrinterSupported,
  printRaw,
  printRawBytes,
  ensurePrinterPaired,
} from '../../services/btPrinter.service';
import { useMobileRasterEnabled } from '../../hooks/useFeatureFlags';

/** Basılacak çuval etiketi işi. null → hiçbir şey yapılmaz. */
export interface SackLabelJob {
  sackId: string;
  /** Toast'ta gösterilecek insan-okur ad (çuval no). */
  label: string;
}

interface Props {
  job: SackLabelJob | null;
  /** Print akışı bittiğinde (başarılı / hatalı) parent slotunu temizler. */
  onDone: () => void;
}

/**
 * Çuval etiketi basma — `StandaloneLabelPrinter`'ın çuval karşılığı.
 *
 * Neden LabelPrinter (roll) genelleştirilmedi: o bileşen `seedSnapshot` +
 * müşteri/sipariş bağlamı + ROLL_RAW/ROLL_FINISHED kind ayrımı taşıyor; hiçbiri
 * çuvalda yok. Klonlamak, roll baskı yolunu riske atmadan ilerlemenin yolu.
 *
 * İki fiziksel yol (roll ile aynı): (A) oturumun yerine bağlı BLUETOOTH_SPP
 * yazıcı çözülürse native ham gönderim; (B) BT yazıcı yoksa HTML + expo-print.
 * FAIL-CLOSED iki kere: (1) yazıcı dili PPLA/PPLB/ZPL değilse diyaloğa düşmez,
 * (2) backend SACK şablonu atanmamışsa 400 döner ve mesajı olduğu gibi gösterilir.
 * Baskı izi yalnız GERÇEK baskıdan sonra yazılır.
 */
export function SackLabelPrinter({ job, onDone }: Props) {
  // Seri baskı kuyruğu — BT yazıcıya eşzamanlı iki gönderim olmasın, iş düşmesin.
  const lastJobRef = useRef<SackLabelJob | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  const rasterEnabled = useMobileRasterEnabled();
  const rasterEnabledRef = useRef(rasterEnabled);
  rasterEnabledRef.current = rasterEnabled;

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!job) {
      lastJobRef.current = null;
      return;
    }
    if (lastJobRef.current === job) return;
    lastJobRef.current = job;
    const current = job;
    chainRef.current = chainRef.current.then(async () => {
      const { sackId, label } = current;

      // Yazıcı OPERATÖR SEÇİMİ DEĞİL — aktif oturumun YERİNE bağlı BT yazıcı
      // backend'den çözülür (fail-closed: oturum/SPP yoksa BT yolu denenmez).
      let btPrinterAddr: string | null = null;
      if (isBtPrinterSupported() && useSessionStore.getState().active != null) {
        try {
          const printers = await peripheralService.getForSession('LABEL_PRINTER');
          const spp = printers.find(
            (p) => p.connectionType === 'BLUETOOTH_SPP' && !!p.address && !p.simulate,
          );
          btPrinterAddr = spp?.address ?? null;
        } catch {
          btPrinterAddr = null; // çözüm hatası → HTML yoluna düş
        }
      }
      const viaBt = btPrinterAddr != null;
      // Yerde BT yazıcı varsa diyalogsuz baskı beklenir — HTML diyaloğuna ASLA düşme.
      const directOnly = viaBt;
      let usedBt = false;
      try {
        if (viaBt && btPrinterAddr) {
          const native = await labelService.getSackNative(sackId, rasterEnabledRef.current);
          if (!['PPLA', 'PPLB', 'ZPL'].includes(native.language) || !native.content) {
            throw new Error(
              'Yazıcının dili çözülemedi — Tanımlar → Donanım’da bu yerin yazıcısını ve dilini kontrol edin.',
            );
          }
          await ensurePrinterPaired(btPrinterAddr);
          if (native.encoding === 'base64') {
            await printRawBytes(btPrinterAddr, atob(native.content));
          } else {
            await printRaw(btPrinterAddr, native.content);
          }
          usedBt = true;
        }
        if (!usedBt && !directOnly) {
          const html = await labelService.getSackHtml(sackId);
          if (!html.startsWith('<')) throw new Error('Etiket HTML alınamadı');
          await printHtml({ html, margins: { left: 0, top: 0, right: 0, bottom: 0 } });
        }
        // Baskı izi — yalnız gerçek baskıdan SONRA (önizleme iz bırakmaz).
        try {
          await labelService.recordSackPrintEvent(sackId);
        } catch {
          // İz yazımı best-effort: baskı gerçekleşti, audit hatası akışı düşürmez.
        }
        if (!mountedRef.current) return;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({ type: 'success', text1: 'Çuval etiketi basıldı', text2: label });
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = (err as Error).message ?? '';
        // İptal yalnız HTML (expo-print) yolunda olur; BT'ye gittiyse her hata gerçek.
        const isCancel = !usedBt && /did not complete|cancel/i.test(msg);
        void Haptics.notificationAsync(
          isCancel ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Error,
        );
        Toast.show({
          type: isCancel ? 'info' : 'error',
          text1: isCancel ? 'Yazdırma iptal edildi' : 'Etiket basılamadı',
          // Backend'in "şablon tanımlı değil" yönlendirmesi olduğu gibi görünsün.
          text2: isCancel ? 'Etiket basılmadı' : msg || 'Yazıcıya gönderilemedi',
          visibilityTime: isCancel ? 3000 : 9000,
        });
      } finally {
        if (mountedRef.current) onDoneRef.current();
      }
    });
  }, [job]);

  return null;
}
