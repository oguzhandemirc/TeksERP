// =============================================================================
// H3 kurşun sayaç akışı — gramaj dokunuşu öncesi okuma, elle yol, sebep, sıfırlama
// =============================================================================
// OFF iken bu hook hiçbir şey yapmaz (`outOn=false`): useGramajTap eski gövdeyi yollar.
// Sıfırlama yalnız kuyruğa kalıcı yazım kanıtlandıktan sonra ve hiçbir sapma modalı
// açık değilken koşar (karar belgesi §6).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onlineManager, useMutation } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { generateClientUuid } from '../../../offline/barcode';
import { STATION_MUT, persistStationQueueNow } from '../../../offline/mutations';
import type { KursunMeterSummary, MeterReadingBody, MeterReadingRequest } from '../../../services/kursunQc.service';
import type { DevicePeripheral } from '../../../services/peripheral.service';
import type { KursunRollSummary, KursunStepSummary } from '../../../types/models';
import {
  buildMeterBody,
  inCaptureOn,
  localVariance,
  meterSettingsOf,
  normalizeReason,
  outCaptureOn,
  parseManualMeters,
  type MeterPolicy,
  type MeterSource,
} from './meterCapture';
import { readCounter, resetCounterAfterDurable, counterBaselineStore, unresetCounterStore, type CounterRead } from './meterDevice';
import type { MeterAcksState } from './useMeterAcks';

export type MeterRoll = Pick<KursunRollSummary, 'rollId'> & Partial<Pick<KursunRollSummary, 'barcode' | 'meter' | 'currentQty'>>;
type Value = Extract<CounterRead, { kind: 'VALUE' }>;

interface Pending {
  phase: 'IN' | 'OUT';
  roll: MeterRoll;
  stepId: string;
  enqueue?: (meterOut: MeterReadingBody) => void;
  abort?: () => void;
  value?: Value;
  /** Elle yola düşülen okumada sayaçtan okunan ham değer (iz) ve sıfırlama gereği. */
  manual?: Pick<Value, 'rawCounter' | 'peripheralId' | 'needsReset'>;
}

type ErrorDetails = { code?: string; diffMeters?: unknown; allowedMeters?: unknown };
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export type MeterModal = { kind: 'MANUAL'; hint: string; phase: 'IN' | 'OUT' } | { kind: 'REASON'; meters: number; diff: number | null; allowed: number | null } | null;

export interface MeterLast {
  rollId: string;
  barcode: string | null;
  inMeters: number | null;
  outMeters: number;
  diff: number | null;
  deviated: boolean;
  source: MeterSource;
}

/** Bekleyen sıfırlama: `ready` = yanıt beklemesi gerekmiyor ya da yanıt geldi. */
interface PendingReset {
  peripheral: DevicePeripheral;
  ready: boolean;
}

/** Değer kayıt kimliği — completeQc2 gövdesinde `meterOut.clientToken`, giriş okumasında `clientToken`. */
export function meterTokenOf(vars: unknown): string | null {
  const v = vars as { meterOut?: { clientToken?: string }; clientToken?: string; phase?: string } | null;
  return v?.meterOut?.clientToken ?? (v?.phase ? (v.clientToken ?? null) : null);
}

function toastReset(outcome: Awaited<ReturnType<typeof resetCounterAfterDurable>>): void {
  if (outcome === 'RESET') return;
  const text1 =
    outcome === 'NOT_DURABLE'
      ? 'Sayaç sıfırlanmadı — kayıt henüz diske yazılamadı'
      : outcome === 'VERIFY_FAILED'
        ? 'Sayaç sıfırlandı ama doğrulanamadı'
        : 'Sayaç sıfırlanamadı';
  Toast.show({ type: 'error', text1, text2: 'Sonraki topta sayacı kontrol edin', visibilityTime: 6000 });
}

function predictsPin(policy: MeterPolicy, pending: Pending, meters: number, measuredIn: number | null): boolean {
  if (pending.phase !== 'OUT' || policy.approvalMode !== 'SUPERVISOR_PIN') return false;
  const v = localVariance({ meter: { declaredIn: pending.roll.meter?.declaredIn ?? null, measuredIn } }, policy, meters);
  return v.needsAck && onlineManager.isOnline();
}

/**
 * Sunucu sayaç değerini reddetti mi (geç 4xx)? Simüle kapalı → elle metre; sebep gerekli → AYNI değerle
 * sebep modalı (sayaç zaten sıfırlandıysa ikinci sıfırlama yok — araya giren yeni metreyi silmesin).
 */
function recoveryFor(err: unknown, p: Pending, v: Value, notReset: boolean): { pending: Pending; modal: MeterModal; simulatedRejected?: boolean } | null {
  const details = (err as { details?: ErrorDetails } | null)?.details;
  if (details?.code === 'SIMULATED_METER_DISABLED') {
    const hint = 'Simüle sayaç kabul edilmiyor — metreyi elle girin';
    return { pending: { ...p, value: undefined, manual: undefined }, modal: { kind: 'MANUAL', hint, phase: 'OUT' }, simulatedRejected: true };
  }
  if (details?.code === 'KURSUN_METER_MISMATCH') {
    const modal: MeterModal = { kind: 'REASON', meters: v.meters, diff: numOrNull(details.diffMeters), allowed: numOrNull(details.allowedMeters) };
    return { pending: { ...p, value: { ...v, needsReset: v.needsReset && notReset } }, modal };
  }
  return null;
}

function useResetQueue(modalOpen: boolean, succeeded: React.MutableRefObject<Set<string>>) {
  const queue = useRef(new Map<string, PendingReset>());
  const started = useRef(new Set<string>());
  const dropped = useRef(new Set<string>());
  const running = useRef(false);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (modalOpen || running.current) return;
    const next = [...queue.current.entries()].find(([, r]) => r.ready);
    if (!next) return;
    const [token, r] = next;
    queue.current.delete(token);
    started.current.add(token);
    running.current = true;
    const durable = async () =>
      succeeded.current.has(token) || (await persistStationQueueNow((v) => meterTokenOf(v) === token));
    void resetCounterAfterDurable(r.peripheral, durable)
      .then(async (outcome) => {
        if (outcome === 'RESET') await unresetCounterStore.mark(r.peripheral.id, false);
        toastReset(outcome);
      })
      .finally(() => {
        running.current = false;
        bump();
      });
  }, [modalOpen, tick, bump, succeeded]);
  return {
    add: (token: string, peripheral: DevicePeripheral, ready: boolean) => {
      if (dropped.current.has(token)) {
        // Kayıt işaret yazımı sürerken düştü: sayaç bu değeri hâlâ taşır, işaret geri kalkar.
        void unresetCounterStore.mark(peripheral.id, false);
        return;
      }
      // Yanıt işaret yazımından önce geldiyse beklemeye gerek yok.
      queue.current.set(token, { peripheral, ready: ready || succeeded.current.has(token) });
      bump();
    },
    markReady: (token: string) => {
      const r = queue.current.get(token);
      if (r) r.ready = true;
      bump();
    },
    /** true: sıfırlama henüz koşmamıştı (iptal edildi) — sayaç bu okumanın değerini hâlâ taşır. */
    drop: (token: string): boolean => {
      queue.current.delete(token);
      dropped.current.add(token);
      return !started.current.has(token);
    },
  };
}

/** Giriş okuması sunucuya ulaştıysa kuyrukta artık yok: sıfırlama kalıcılığı buradan kanıtlanır. */
function useInReadingMutation(succeeded: React.MutableRefObject<Set<string>>, resets: ReturnType<typeof useResetQueue>) {
  return useMutation<unknown, Error, MeterReadingRequest>({
    mutationKey: STATION_MUT.KURSUN_METER_READING,
    onSuccess: (_d, vars) => {
      succeeded.current.add(vars.clientToken);
      resets.markReady(vars.clientToken);
    },
  });
}

export function useMeterCapture(input: {
  summary: KursunStepSummary | null;
  peripheral: DevicePeripheral | null;
  acks: MeterAcksState;
}) {
  const { capture, policy } = useMemo(() => meterSettingsOf(input.summary), [input.summary]);
  const [modal, setModal] = useState<MeterModal>(null);
  const [last, setLast] = useState<MeterLast | null>(null);
  const [inByRoll, setInByRoll] = useState<Record<string, number>>({});
  const pending = useRef<Pending | null>(null);
  const busy = useRef(false);
  const succeeded = useRef(new Set<string>());
  // Yolda olan çıkış okumaları: geç gelen 4xx'te aynı değerle kurtarma.
  const sent = useRef(new Map<string, { p: Pending; v: Value }>());
  const simulatedRejected = useRef(false);
  const resets = useResetQueue(modal != null || input.acks.pinTarget != null, succeeded);
  const inMutation = useInReadingMutation(succeeded, resets);
  const flow = useMeterFlow({ policy, peripheral: input.peripheral, inByRoll, setInByRoll, setModal, setLast, pending, resets, inMutation, sent });

  const start = useCallback(
    async (p: Pending) => {
      if (busy.current) return p.abort?.();
      busy.current = true;
      try {
        pending.current = p;
        const r: CounterRead =
          simulatedRejected.current && input.peripheral?.simulate
            ? { kind: 'MANUAL', hint: 'Simüle sayaç kabul edilmiyor — metreyi elle girin', warn: true }
            : await readCounter(input.peripheral, p.roll.currentQty ?? 0);
        if (r.kind === 'MANUAL') {
          if (r.warn) Toast.show({ type: 'info', text1: r.hint });
          pending.current = { ...p, manual: { rawCounter: r.rawCounter ?? null, peripheralId: r.peripheralId ?? null, needsReset: r.needsReset ?? false } };
          setModal({ kind: 'MANUAL', hint: r.hint, phase: p.phase });
          return;
        }
        if (r.source === 'SIMULATED') Toast.show({ type: 'error', text1: 'SİMÜLASYON', text2: 'Sayaç simüle — gerçek değer değil' });
        flow.proceed(p, r);
      } finally {
        busy.current = false;
      }
    },
    [input.peripheral, flow],
  );

  return {
    capture,
    outOn: outCaptureOn(capture),
    inOn: inCaptureOn(capture),
    modal,
    last,
    inMetersOf: (roll: MeterRoll | null) => (roll ? (inByRoll[roll.rollId] ?? roll.meter?.measuredIn ?? null) : null),
    declaredOf: (roll: MeterRoll | null) => roll?.meter?.declaredIn ?? null,
    captureOut: (roll: MeterRoll, stepId: string, enqueue: (m: MeterReadingBody) => void, abort: () => void) =>
      void start({ phase: 'OUT', roll, stepId, enqueue, abort }),
    readIn: (roll: MeterRoll, stepId: string) => void start({ phase: 'IN', roll, stepId }),
    submitManual: (text: string) => flow.submitManual(text),
    submitReason: (code: string | null, text: string) => flow.submitReason(code, text),
    cancelModal: () => flow.cancel(),
    /** completeQc2 yanıtı (hook-düzeyi onSuccess; kuyruktan dönen kayıt dahil). */
    onCompleteSuccess: (data: unknown, vars: { rollId: string; meterOut?: MeterReadingBody }) => {
      const token = vars.meterOut?.clientToken;
      if (!token) return;
      sent.current.delete(token);
      succeeded.current.add(token);
      const meter = (data as { data?: { meter?: KursunMeterSummary } } | null)?.data?.meter;
      input.acks.onReading(meter, vars.rollId);
      resets.markReady(token);
    },
    /** Kayıt düştü: sıfırlama iptal, sayaç değeri korunur; true = aynı değerle kurtarma modalı açıldı. */
    onCompleteError: (vars: { meterOut?: MeterReadingBody }, err?: unknown): boolean => {
      const token = vars.meterOut?.clientToken;
      if (!token) return false;
      const notReset = resets.drop(token);
      const { p, v } = sent.current.get(token) ?? {};
      sent.current.delete(token);
      // Sıfırlanmamış sayaç bu okumanın değerini hâlâ taşır: işaret kalkar, yeniden dokunuş makineden okur.
      if (notReset && v?.needsReset && v.peripheralId) void unresetCounterStore.mark(v.peripheralId, false);
      const r = p && v ? recoveryFor(err, p, v, notReset) : null;
      if (!r) return false;
      if (r.simulatedRejected) simulatedRejected.current = true;
      pending.current = r.pending;
      setModal(r.modal);
      return true;
    },
  };
}

export type MeterCaptureState = ReturnType<typeof useMeterCapture>;

interface FlowDeps {
  policy: MeterPolicy;
  peripheral: DevicePeripheral | null;
  inByRoll: Record<string, number>;
  setInByRoll: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setModal: (m: MeterModal) => void;
  setLast: (l: MeterLast) => void;
  pending: React.MutableRefObject<Pending | null>;
  resets: ReturnType<typeof useResetQueue>;
  inMutation: { mutate: (v: MeterReadingRequest) => void };
  sent: React.MutableRefObject<Map<string, { p: Pending; v: Value }>>;
}

function useMeterFlow(d: FlowDeps) {
  // Son okumanın token'ı (YENILEME biçimi: her okuma yeni mantıksal deneme).
  const attempt = useRef<string | null>(null);
  const commit = (p: Pending, v: Value, ack: { reasonCode: string | null; reasonText: string | null } | null) => {
    // Her okuma yeni bir mantıksal denemedir; yeniden deneme kuyruğun işidir (aynı gövde, aynı token).
    attempt.current = generateClientUuid();
    const token = attempt.current;
    // Bekleyen dokunuş gönderimden ÖNCE kapanır: anında dönen ret kurtarma dokunuşunu açabilsin.
    d.pending.current = null;
    const body = buildMeterBody({ meters: v.meters, source: v.source, peripheralId: v.peripheralId, rawCounter: v.rawCounter, clientToken: token, ack });
    const measuredIn = d.inByRoll[p.roll.rollId] ?? p.roll.meter?.measuredIn ?? null;
    if (p.phase === 'OUT') {
      d.sent.current.set(token, { p, v });
      p.enqueue?.(body);
      const variance = localVariance({ meter: { declaredIn: p.roll.meter?.declaredIn ?? null, measuredIn } }, d.policy, v.meters);
      d.setLast({ rollId: p.roll.rollId, barcode: p.roll.barcode ?? null, inMeters: measuredIn ?? p.roll.meter?.declaredIn ?? null, outMeters: v.meters, diff: variance.diffMeters, deviated: variance.deviated, source: v.source });
    } else {
      d.inMutation.mutate({ ...body, rollId: p.roll.rollId, stepId: p.stepId, phase: 'IN' });
      d.setInByRoll((m) => ({ ...m, [p.roll.rollId]: v.meters }));
    }
    if (v.baseline != null && v.peripheralId) void counterBaselineStore.set(v.peripheralId, v.baseline);
    // Sıfırlama kuyruğa yazımdan SONRA; PIN bekleyen okumada sunucu yanıtı da beklenir. "Sıfırlanmadı"
    // işareti sıfırlamadan ÖNCE kalıcıdır: uygulama arada kapanırsa sonraki okuma birikmiş değeri saymaz.
    const peripheral = d.peripheral;
    if (v.needsReset && peripheral) {
      const ready = !predictsPin(d.policy, p, v.meters, measuredIn);
      void unresetCounterStore.mark(peripheral.id, true).then(() => d.resets.add(token, peripheral, ready));
    }
  };
  const proceed = (p: Pending, v: Value) => {
    if (p.phase === 'OUT' && d.policy.approvalMode === 'OPERATOR_REASON') {
      const measuredIn = d.inByRoll[p.roll.rollId] ?? p.roll.meter?.measuredIn ?? null;
      const variance = localVariance({ meter: { declaredIn: p.roll.meter?.declaredIn ?? null, measuredIn } }, d.policy, v.meters);
      if (variance.needsAck) {
        d.pending.current = { ...p, value: v };
        d.setModal({ kind: 'REASON', meters: v.meters, diff: variance.diffMeters, allowed: variance.allowedMeters });
        return;
      }
    }
    commit(p, v, null);
  };
  const submitManual = (text: string): boolean => {
    const p = d.pending.current;
    const meters = parseManualMeters(text);
    if (!p) return false;
    if (meters == null) {
      Toast.show({ type: 'error', text1: 'Geçerli bir metre girin' });
      return false;
    }
    d.setModal(null);
    const m = p.manual;
    proceed(p, { kind: 'VALUE', meters, source: 'OPERATOR', rawCounter: m?.rawCounter ?? null, peripheralId: m?.peripheralId ?? null, needsReset: m?.needsReset ?? false });
    return true;
  };
  const submitReason = (code: string | null, text: string): boolean => {
    const p = d.pending.current;
    const ack = normalizeReason(code, text);
    // Sebepsiz kayıt kuyruğa GİRMEZ (sunucu da 409 KURSUN_METER_MISMATCH verirdi).
    if (!p?.value || !ack) return false;
    d.setModal(null);
    commit(p, p.value, ack);
    return true;
  };
  const cancel = () => {
    d.pending.current?.abort?.();
    d.pending.current = null;
    d.setModal(null);
  };
  return { proceed, submitManual, submitReason, cancel };
}
