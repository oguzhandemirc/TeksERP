import { useCallback, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isMeasuredUnit } from '../../../lib/item-unit';
import Toast from 'react-native-toast-message';

import { orderService, type CreatedOrder, type NewOrderPayload } from '../../../services/order.service';
import {
  IDLE_ATTEMPT,
  isAmbiguousFailure,
  isRetrying,
  onAttemptFailed,
  onAttemptSucceeded,
  tokenForSubmit,
  type EntryAttemptState,
} from '../../../offline/entryAttempt';

// =============================================================================
// Yeni Sipariş sihirbazının TÜM durumu ve kuralları. Ekran bileşenleri yalnız
// çizer (Hızlı İş Emri'ndeki `useQuickWorkOrder` ile aynı ayrım).
//
// ⚠️ ÇEVRİMİÇİ-ONLY: sipariş numarasını SUNUCU üretir (SIP+GGAAYY+NNNN), bu
// yüzden offline mutation kuyruğuna (`offline/mutations.ts`) girmez. Ekran
// çevrimdışıyken gönderimi kapatır; sessizce kuyruğa alıp "gönderildi" demek
// operatöre var olmayan bir sipariş numarası vaat etmek olurdu.
// =============================================================================

/** Sihirbazda düzenlenen kalem — henüz sunucuya gitmemiş taslak. */
export interface DraftLine {
  /** Yalnız istemci-içi kimlik (düzenle/sil/kopyala). Sunucuya GİTMEZ. */
  clientId: string;
  itemId: string;
  itemName: string;
  colorId: string | null;
  /** Gösterim için çözülmüş ad; null = ham (renksiz) talep. */
  colorName: string | null;
  /** Kalemin biriminde miktar (`unit`). */
  quantity: number;
  /** Kalem kartından; gösterim için. Sunucuya GİTMEZ — sunucu kalemden kopyalar. */
  unit?: string;
  /** İstenen en (cm) — opsiyonel. */
  width: number | null;
}

/** Termin kısayolları. `null` = "belirtme" → backend `order.defaultDeadlineDays` uygular. */
export const DEADLINE_CHOICES: readonly { days: number | null; label: string }[] = [
  { days: null, label: 'Varsayılan' },
  { days: 7, label: '1 hafta' },
  { days: 15, label: '15 gün' },
  { days: 30, label: '1 ay' },
];

let lineCounter = 0;
function nextLineId(): string {
  lineCounter += 1;
  return `l${lineCounter}`;
}

/** Aynı spec iki kez girilmiş mi (kumaş+renk+en). Backend bunu REDDETMEZ —
 *  meşru olabilir (aynı kumaştan iki ayrı teslimat) — o yüzden engel değil uyarı. */
function duplicateSpecCount(lines: DraftLine[]): number {
  const seen = new Set<string>();
  let dup = 0;
  for (const l of lines) {
    const key = `${l.itemId}|${l.colorId ?? ''}|${l.width ?? ''}`;
    if (seen.has(key)) dup += 1;
    else seen.add(key);
  }
  return dup;
}

export function useNewOrder() {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState('');
  const [deadlineDays, setDeadlineDays] = useState<number | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [result, setResult] = useState<CreatedOrder | null>(null);

  // İdempotency: token BASIŞIN değil, "bu sipariş denemesinin" kimliğidir.
  // Yalnız SONUCU BELİRSİZ bırakan hatadan sonra yapışır (ağ/timeout/5xx);
  // kesin 4xx'te tazelenir — yoksa "pasif ürün" gibi bir hatada operatör
  // kalemi düzeltince bile aynı token sonsuza dek geri gönderilirdi.
  const [attempt, setAttempt] = useState<EntryAttemptState>(IDLE_ATTEMPT);

  const selectCustomer = useCallback(
    (id: string, name: string) => {
      // Müşteri DEĞİŞTİYSE şube seçimi geçersizdir (şube müşteriye bağlıdır) —
      // temizlenmezse A müşterisinin şubesi B'nin siparişine yazılır ve backend
      // 400 döner (validateBranch), operatör sebebini göremez.
      //
      // ⚠️ `customerId` bağımlılık dizisinde OLMAK ZORUNDA: boş dizi ile
      // sarılsaydı closure ilk render'ın `null`'ını sonsuza dek taşır, koşul her
      // seferinde doğru çıkar ve müşteri DEĞİŞMESE bile şube sessizce silinirdi.
      if (id !== customerId) {
        setBranchId(null);
        setBranchName('');
      }
      setCustomerId(id);
      setCustomerName(name);
    },
    [customerId],
  );

  const selectBranch = useCallback((id: string | null, name: string) => {
    setBranchId(id);
    setBranchName(name);
  }, []);

  const addLine = useCallback((line: Omit<DraftLine, 'clientId'>) => {
    setLines((prev) => [...prev, { ...line, clientId: nextLineId() }]);
  }, []);

  const updateLine = useCallback((clientId: string, line: Omit<DraftLine, 'clientId'>) => {
    setLines((prev) => prev.map((l) => (l.clientId === clientId ? { ...line, clientId } : l)));
  }, []);

  const removeLine = useCallback((clientId: string) => {
    setLines((prev) => prev.filter((l) => l.clientId !== clientId));
  }, []);

  const duplicateLine = useCallback((clientId: string) => {
    setLines((prev) => {
      const src = prev.find((l) => l.clientId === clientId);
      if (!src) return prev;
      return [...prev, { ...src, clientId: nextLineId() }];
    });
  }, []);

  // Yalnız metre satırları toplanır: kg + m toplanamaz.
  const totalQty = useMemo(
    () => lines.filter((l) => isMeasuredUnit(l.unit)).reduce((s, l) => s + l.quantity, 0),
    [lines],
  );
  const duplicateSpecs = useMemo(() => duplicateSpecCount(lines), [lines]);

  /** Termin ISO damgası — `null` seçiliyse alan HİÇ gönderilmez (backend default'u koşsun). */
  const deadlineIso = useMemo(() => {
    if (deadlineDays == null) return undefined;
    const d = new Date();
    d.setDate(d.getDate() + deadlineDays);
    return d.toISOString();
  }, [deadlineDays]);

  const mutation = useMutation({
    mutationFn: (payload: NewOrderPayload) => orderService.create(payload),
    onSuccess: (res, vars) => {
      setAttempt((s) => onAttemptSucceeded(s, vars.clientToken));
      const created = res.data ?? null;
      setResult(created);
      Toast.show({
        type: 'success',
        text1: `Sipariş açıldı: ${created?.orderNumber ?? ''}`,
        text2: `${lines.length} kalem · ${totalQty.toLocaleString('tr-TR')} m`,
      });
    },
    onError: (err: Error, vars) => {
      // Yapışkanlık YALNIZ belirsiz hatada. Kesin 4xx'te token tazelenir ki
      // operatör payload'ı düzeltip yeniden gönderebilsin.
      setAttempt((s) => (isAmbiguousFailure(err) ? onAttemptFailed(s, vars.clientToken) : IDLE_ATTEMPT));
      Toast.show({ type: 'error', text1: 'Sipariş açılamadı', text2: err.message });
    },
  });

  /**
   * `branchesEnabled` ekrandan gelir (bayrak hook'u): kapalıysa `branchId` alanı
   * payload'a HİÇ konmaz. `null` göndermek "şubesiz sipariş" demek olurdu; alanı
   * hiç göndermemek "şube kavramı bu fabrikada yok" demek — ikisi ayrı cümledir.
   */
  const submit = useCallback(
    (branchesEnabled: boolean) => {
      if (!customerId || lines.length === 0 || mutation.isPending) return;
      const payload: NewOrderPayload = {
        customerId,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          colorId: l.colorId,
          quantity: l.quantity,
          width: l.width,
        })),
        clientToken: tokenForSubmit(attempt),
      };
      if (branchesEnabled) payload.branchId = branchId;
      if (deadlineIso) payload.deadline = deadlineIso;
      mutation.mutate(payload);
    },
    [customerId, branchId, deadlineIso, lines, attempt, mutation],
  );

  /** Başarıdan sonra "yeni sipariş" — müşteri KORUNUR (aynı müşteriye peş peşe
   *  sipariş girmek sahada olağan), kalemler ve sonuç sıfırlanır. */
  const startNext = useCallback(() => {
    setLines([]);
    setResult(null);
    setAttempt(IDLE_ATTEMPT);
  }, []);

  /** Adım ilerlemesini ENGELLEYEN sebep (null = ilerlenebilir). */
  const stepBlock = useCallback(
    (step: number): string | null => {
      if (step === 0) return customerId ? null : 'Önce müşteri seçin.';
      if (step === 1) return lines.length > 0 ? null : 'En az bir kalem ekleyin.';
      return null;
    },
    [customerId, lines.length],
  );

  return {
    customerId,
    customerName,
    branchId,
    branchName,
    deadlineDays,
    setDeadlineDays,
    lines,
    totalQty,
    duplicateSpecs,
    result,
    selectCustomer,
    selectBranch,
    addLine,
    updateLine,
    removeLine,
    duplicateLine,
    submit,
    startNext,
    stepBlock,
    submitting: mutation.isPending,
    /** Ortada tekrarlanmayı bekleyen bir deneme var → CTA "Tekrar Dene"ye döner. */
    retrying: isRetrying(attempt),
  };
}

export type NewOrderState = ReturnType<typeof useNewOrder>;
