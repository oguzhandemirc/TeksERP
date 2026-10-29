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
import { readCounter, resetCounterAfterDurable, type CounterRead } from './meterDevice';
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
}

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

function useResetQueue(modalOpen: boolean, succeeded: React.MutableRefObject<Set<string>>) {
  const queue = useRef(new Map<string, PendingReset>());
  const running = useRef(false);
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (modalOpen || running.current) return;
    const next = [...queue.current.entries()].find(([, r]) => r.ready);
    if (!next) return;
    const [token, r] = next;
    queue.current.delete(token);
    running.current = true;
    const durable = async () =>
      succeeded.current.has(token) || (await persistStationQueueNow((v) => meterTokenOf(v) === token));
    void resetCounterAfterDurable(r.peripheral, durable)
      .then(toastReset)
      .finally(() => {
        running.current = false;
        bump();
      });
  }, [modalOpen, tick, bump, succeeded]);
  return {
    add: (token: string, peripheral: DevicePeripheral, ready: boolean) => {
      queue.current.set(token, { peripheral, ready });
      bump();
    },
    markReady: (token: string) => {
      const r = queue.current.get(token);
      if (r) r.ready = true;
      bump();
    },
    drop: (token: string) => queue.current.delete(token),
  };
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
  const attempt = useRef<string | null>(null);
  const busy = useRef(false);
  const succeeded = useRef(new Set<string>());
  const resets = useResetQueue(modal != null || input.acks.pinTarget != null, succeeded);
  const inMutation = useMutation<unknown, Error, MeterReadingRequest>({ mutationKey: STATION_MUT.KURSUN_METER_READING });
  const flow = useMeterFlow({ policy, peripheral: input.peripheral, inByRoll, setInByRoll, setModal, setLast, pending, resets, inMutation, attempt });

  const start = useCallback(
    async (p: Pending) => {
      if (busy.current) return p.abort?.();
      busy.current = true;
      try {
        pending.current = p;
        const r = await readCounter(input.peripheral, p.roll.currentQty ?? 0);
        if (r.kind === 'MANUAL') {
          if (r.warn) Toast.show({ type: 'info', text1: r.hint });
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
      succeeded.current.add(token);
      const meter = (data as { data?: { meter?: KursunMeterSummary } } | null)?.data?.meter;
      input.acks.onReading(meter, vars.rollId);
      resets.markReady(token);
    },
    /** Kayıt düştü: bekleyen sıfırlama iptal — sayaç değeri korunur, yeniden okunur. */
    onCompleteError: (vars: { meterOut?: MeterReadingBody }) => {
      const token = vars.meterOut?.clientToken;
      if (token) resets.drop(token);
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
  attempt: React.MutableRefObject<string | null>;
}

function useMeterFlow(d: FlowDeps) {
  const commit = (p: Pending, v: Value, ack: { reasonCode: string | null; reasonText: string | null } | null) => {
    // Her okuma yeni bir mantıksal denemedir; yeniden deneme kuyruğun işidir (aynı gövde, aynı token).
    d.attempt.current = generateClientUuid();
    const token = d.attempt.current;
    const body = buildMeterBody({ meters: v.meters, source: v.source, peripheralId: v.peripheralId, rawCounter: v.rawCounter, clientToken: token, ack });
    const measuredIn = d.inByRoll[p.roll.rollId] ?? p.roll.meter?.measuredIn ?? null;
    if (p.phase === 'OUT') {
      p.enqueue?.(body);
      const variance = localVariance({ meter: { declaredIn: p.roll.meter?.declaredIn ?? null, measuredIn } }, d.policy, v.meters);
      d.setLast({ rollId: p.roll.rollId, barcode: p.roll.barcode ?? null, inMeters: measuredIn ?? p.roll.meter?.declaredIn ?? null, outMeters: v.meters, diff: variance.diffMeters, deviated: variance.deviated, source: v.source });
    } else {
      d.inMutation.mutate({ ...body, rollId: p.roll.rollId, stepId: p.stepId, phase: 'IN' });
      d.setInByRoll((m) => ({ ...m, [p.roll.rollId]: v.meters }));
    }
    d.pending.current = null;
    // Sıfırlama kuyruğa yazımdan SONRA; PIN bekleyen okumada sunucu yanıtı da beklenir.
    if (v.needsReset && d.peripheral) d.resets.add(token, d.peripheral, !predictsPin(d.policy, p, v.meters, measuredIn));
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
    proceed(p, { kind: 'VALUE', meters, source: 'OPERATOR', rawCounter: null, peripheralId: null, needsReset: false });
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
