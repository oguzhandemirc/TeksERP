import { useEffect, useRef } from 'react';
import { printHtml } from '../../services/printHtml';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { labelTemplateService } from '../../services/labelTemplate.service';
import { resolveBtPrinter } from '../../services/resolveBtPrinter';
import {
  printRaw,
  printRawBytes,
  ensurePrinterPaired,
} from '../../services/btPrinter.service';
import { useMobileRasterEnabled } from '../../hooks/useFeatureFlags';
import {
  DIALOG_TARGET,
  btTarget,
  reportPrintOutcome,
  type PrintStep,
} from '../../services/printJob.service';

/** Basılacak serbest etiket işi. null → hiçbir şey yapılmaz. */
export interface StandaloneLabelJob {
  templateId: string;
  copies: number;
}

interface Props {
  /** Serbest etiket baskı işi. null ise no-op. */
  job: StandaloneLabelJob | null;
  /** Print akışı bittiğinde (başarılı / hatalı) parent slotunu temizler. */
  onDone: () => void;
  /** Sonuç bildirimi (opsiyonel): ok=false + cancelled=false → GERÇEK hata. */
  onResult?: (r: { ok: boolean; cancelled: boolean; error?: string }) => void;
}

/**
 * Serbest (topa bağlı OLMAYAN) etiket basma — LabelPrinter'ın birebir klonu.
 * İki fiziksel yol: (A) oturumun yerine bağlı BLUETOOTH_SPP yazıcı çözülürse
 * getStandaloneNative → printRawBytes/printRaw ile ham gönderim; (B) BT yazıcı
 * yoksa getStandaloneHtml → expo-print HTML fallback. Roll YOK: seedSnapshot /
 * print-audit çağrıları düşürüldü. copies backend'e verilir (N kez gönderim yok).
 */
export function StandaloneLabelPrinter({ job, onDone, onResult }: Props) {
  // SERİ BASKI KUYRUĞU: her yeni iş promise zincirine eklenir — BT yazıcıya
  // eşzamanlı iki gönderim olmaz, hiçbir iş düşmez. Parent iş bitince slotu
  // null'lar, yeni "Bas" taze bir job objesi üretir → referans kimliğiyle ayrılır.
  const lastJobRef = useRef<StandaloneLabelJob | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());

  // Mobil raster (HC-06'ya GW bitmap) açık mı — admin flag. Ref'le: baskı effect'i
  // flag değişince yeniden tetiklenmesin, ama her baskıda güncel değeri okusun.
  const rasterEnabled = useMobileRasterEnabled();
  const rasterEnabledRef = useRef(rasterEnabled);
  rasterEnabledRef.current = rasterEnabled;

  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // Async print akışı saniyeler sürer; bu sırada parent unmount olursa side-effect
  // (onDone/Toast/Haptic) anlamsız → mounted bayrağı.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!job) {
      // Slot boşaldı → aynı iş ileride yeniden basılabilsin (bilinçli re-print).
      lastJobRef.current = null;
      return;
    }
    // Aynı iş nesnesi zaten kuyrukta/basıldı — yeniden tetiklenmesin.
    if (lastJobRef.current === job) return;
    lastJobRef.current = job;
    const current = job;
    chainRef.current = chainRef.current.then(async () => {
      const { templateId, copies } = current;
      const subject = { subjectKind: 'ETIKET_SERBEST' as const, subjectTable: 'label_templates' as const, subjectId: templateId, copies };
      // Yazıcı OPERATÖR SEÇİMİ DEĞİL — aktif oturumun YERİNE bağlı BT yazıcı
      // backend'den çözülür (fail-closed: oturum yoksa / SPP yoksa BT yolu
      // denenmez). Yalnız BLUETOOTH_SPP device-direct; NETWORK_TCP bu yoldan basmaz.
      const btPrinter = await resolveBtPrinter();
      const btPrinterAddr = btPrinter?.address ?? null;
      const viaBt = btPrinterAddr != null;
      // Yazdırma geçmişi künyesi: hangi yazıcı (BT: kayıt + MAC) ve akışın hangi adımı.
      const target = btPrinter && btPrinterAddr ? btTarget(btPrinter) : DIALOG_TARGET;
      const startedAt = Date.now();
      let step: PrintStep = 'fetch';
      // Yerde BT yazıcı tanımlıysa diyalogsuz baskı beklenir — expo-print/HTML
      // diyaloğuna ASLA düşme; başarısızlık GÖRÜNÜR hata olsun.
      const directOnly = viaBt;
      let usedBt = false;
      try {
        if (viaBt && btPrinterAddr) {
          // Cihazın diline göre native (PPLA/PPLB/ZPL). rasterCapable=flag →
          // açıkken backend cihazın rasterMode'unu onurlandırır (base64 byte).
          const native = await labelTemplateService.getStandaloneNative(
            templateId,
            copies,
            rasterEnabledRef.current,
          );
          // FAIL-CLOSED: yalnız bilinen native dil ham gönderilir. RASTER_HTML/boş/
          // bilinmeyen → diyaloğa düşmek yerine NET hata.
          step = 'lang';
          if (!['PPLA', 'PPLB', 'ZPL'].includes(native.language) || !native.content) {
            throw new Error(
              'Yazıcının dili çözülemedi — Tanımlar → Donanım’da bu makinenin yazıcısını ve dilini kontrol edin.',
            );
          }
          step = 'pair';
          await ensurePrinterPaired(btPrinterAddr);
          step = 'send';
          if (native.encoding === 'base64') {
            // Raster: base64 → ham byte (atob = latin1 binary string) → chunk'lı gönderim.
            await printRawBytes(btPrinterAddr, atob(native.content));
          } else {
            await printRaw(btPrinterAddr, native.content);
          }
          usedBt = true;
        }
        if (!usedBt && !directOnly) {
          const html = await labelTemplateService.getStandaloneHtml(templateId, copies);
          if (!html.startsWith('<')) {
            throw new Error('Etiket HTML alınamadı');
          }
          // margins: 0 → expo-print default kenar payını sıfırlar (fiziksel yazıcı
          // yine de küçük donanım payı bırakabilir).
          step = 'dialog';
          await printHtml({
            html,
            margins: { left: 0, top: 0, right: 0, bottom: 0 },
          });
        }
        // Serbest etiketin iş ucu yok: sonuç doğrudan Yazdırma geçmişine (BT kabul etti →
        // ILETILDI; sistem penceresi "tamamlandı" kâğıdı kanıtlamaz → BELIRSIZ).
        reportPrintOutcome({ subject, target, startedAt, status: usedBt ? 'ILETILDI' : 'BELIRSIZ' });
        if (!mountedRef.current) return;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onResultRef.current?.({ ok: true, cancelled: false });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        // İptal yalnız expo-print (HTML) yolunda olur; BT'ye gittiyse her hata gerçek.
        const isCancel = !usedBt && /did not complete|cancel/i.test(msg);
        reportPrintOutcome({ subject, target, startedAt, status: isCancel ? 'IPTAL' : 'HATA', step, error: err });
        if (!mountedRef.current) return;
        console.warn('[StandaloneLabelPrinter] print failed:', msg, err);
        onResultRef.current?.({ ok: false, cancelled: isCancel, error: msg });
        void Haptics.notificationAsync(
          isCancel
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Error,
        );
        Toast.show({
          type: isCancel ? 'info' : 'error',
          text1: isCancel ? 'Yazdırma iptal edildi' : 'Yazdırma hatası',
          text2: isCancel ? 'Etiket basılmadı' : msg || 'Yazıcıya gönderilemedi',
          visibilityTime: isCancel ? 3000 : 8000,
        });
      } finally {
        if (mountedRef.current) onDoneRef.current();
      }
    });
  }, [job]);

  return null;
}
