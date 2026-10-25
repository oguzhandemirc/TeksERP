// =============================================================================
// BASIM RAPOR KUYRUĞU — tablet basımının sonucunu `POST /api/print-jobs`a taşır (izlenebilirlik A4)
// =============================================================================
// Tasarım: docs/design/IZLENEBILIRLIK-CIHAZ-PLAN.md §3.5. Bugüne dek BT/sistem penceresi
// hataları yalnız tablette (toast) kalıyordu; panel "Yazdırma geçmişi" onları göremiyordu.
//
//   • Kalıcı kuyruk (AsyncStorage, printQueue/failedOps deseni): çevrimdışında biriken rapor
//     bağlantı gelince gönderilir. TTL 48 saat, tavan 200 (en eski düşer, sayaçlı).
//   • `clientToken` MANTIKSAL DENEME (= tek basım sonucu) başına BİR KEZ üretilir ve kayıtla
//     saklanır: yeniden denemede AYNI token gider → sunucu replay eder, mükerrer satır doğmaz.
//   • Yalnız belirsiz hatada (ağ/zaman aşımı/5xx) bekler; 4xx'te düşer; 404 (eski backend,
//     uç yok) sessiz düşer. Rapor kişinin KENDİ basımıdır: başka kullanıcının kaydı onun
//     oturumu açılana dek bekler (yanlış kişiye yazılmasın), oturumsuzken hiç gönderilmez.
//   • İş ucu olan başarı (top/çuval/levent/refakat) buraya GELMEZ: o çağrıya `printJob` eki
//     gider (`printJobAttachment`) — iki yoldan aynı basıma iki satır doğmasın.
// =============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Dimensions } from 'react-native';
import { onlineManager } from '@tanstack/react-query';
import { create } from 'zustand';
import { apiClient } from './api';
import { generateClientUuid } from '../offline/barcode';
import { isAmbiguousFailure } from '../offline/entryAttempt';
import { useAuthStore } from '../store/authStore';
import type { DevicePeripheral } from './peripheral.service';

const STORAGE_KEY = 'TEKSERP_PRINT_REPORTS_V1';
export const PRINT_REPORT_TTL_MS = 48 * 60 * 60 * 1000;
export const PRINT_REPORT_MAX = 200;
/** useDeviceType ile aynı eşik — kaynak etiketi TABLET/TELEFON. */
const TABLET_SHORTEST_SIDE = 600;
const MESSAGE_MAX = 300;

export type PrintReportStatus = 'ILETILDI' | 'HATA' | 'IPTAL' | 'BELIRSIZ';
export type PrintReportTransport = 'BLUETOOTH' | 'SISTEM_PENCERESI';
export type PrintReportSubjectKind =
  | 'ETIKET_TOP'
  | 'ETIKET_CUVAL'
  | 'ETIKET_LEVENT'
  | 'ETIKET_SERBEST'
  | 'REFAKAT_KARTI'
  | 'FASON_CEKI'
  | 'BELGE';

/** Basılan şey — sunucu `subjectId`i `subjectTable`da doğrular (yoksa 400 → rapor düşer). */
export interface PrintSubject {
  subjectKind: PrintReportSubjectKind;
  subjectTable?: 'rolls' | 'sacks' | 'warp_beams' | 'label_templates' | 'traveler_cards' | 'subcontractor_dispatches';
  subjectId?: string;
  subjectNo?: string;
  docType?: string;
  copies?: number;
}

/** Hangi yazıcıya/yoldan basıldı. BT'de MAC + kayıtlı cihaz; başka cihaz içeriği gönderilmez. */
export interface PrintTarget {
  transport: PrintReportTransport;
  peripheralId?: string;
  printerName?: string;
  printerAddress?: string;
}

/** `POST /print-jobs` gövdesi (sunucu `printJobReportSchema` ile iki uçta aynı alanlar). */
export interface PrintReportBody extends PrintSubject, Partial<PrintTarget> {
  clientToken: string;
  status: PrintReportStatus;
  source: 'TABLET' | 'TELEFON';
  appVersion?: string;
  errorCode?: string;
  errorMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface QueuedPrintReport {
  body: PrintReportBody;
  /** Basımı yapan kullanıcı — rapor yalnız onun oturumuyla gönderilir. */
  userId: string | null;
  queuedAt: number;
}

export interface PrintReportDrops {
  /** 48 saati aşan (bağlantı hiç gelmedi). */
  ttl: number;
  /** 200 tavanında en eski düşen. */
  cap: number;
  /** Sunucunun kesin reddi (4xx). */
  rejected: number;
  /** Eski backend (uç yok, 404). */
  unsupported: number;
}

/** Bu oturumda gönderilen/düşürülen token'lar: geç biten hydrate onları diskten GERİ getirmesin. */
const settledTokens = new Set<string>();

const NO_DROPS: PrintReportDrops = { ttl: 0, cap: 0, rejected: 0, unsupported: 0 };

interface PrintReportState {
  items: QueuedPrintReport[];
  drops: PrintReportDrops;
  hydrated: boolean;
  lastSentAt: number | null;
}

export const usePrintReports = create<PrintReportState>(() => ({
  items: [],
  drops: { ...NO_DROPS },
  hydrated: false,
  lastSentAt: null,
}));

function persist(): void {
  const { items, drops } = usePrintReports.getState();
  // Fire-and-forget: basım akışını disk yazımı geciktirmesin (printQueue emsali).
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ items, drops })).catch(() => {});
}

/** TTL + tavan; düşenler sayaca yazılır (sessiz kayıp değil, ekranda görünür). */
export function prunePrintReports(
  items: QueuedPrintReport[],
  now = Date.now(),
): { items: QueuedPrintReport[]; ttl: number; cap: number } {
  const cutoff = now - PRINT_REPORT_TTL_MS;
  const alive = items.filter((i) => i.queuedAt >= cutoff);
  const ttl = items.length - alive.length;
  const cap = Math.max(0, alive.length - PRINT_REPORT_MAX);
  return { items: cap > 0 ? alive.slice(cap) : alive, ttl, cap };
}

function setItems(next: QueuedPrintReport[], extra: Partial<PrintReportDrops> = {}): void {
  const pruned = prunePrintReports(next);
  usePrintReports.setState((s) => ({
    items: pruned.items,
    drops: {
      ttl: s.drops.ttl + pruned.ttl + (extra.ttl ?? 0),
      cap: s.drops.cap + pruned.cap + (extra.cap ?? 0),
      rejected: s.drops.rejected + (extra.rejected ?? 0),
      unsupported: s.drops.unsupported + (extra.unsupported ?? 0),
    },
  }));
  persist();
}

export async function hydratePrintReports(): Promise<void> {
  if (usePrintReports.getState().hydrated) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = (raw ? JSON.parse(raw) : {}) as { items?: unknown; drops?: Partial<PrintReportDrops> };
    const loaded = (Array.isArray(parsed.items) ? parsed.items : []).filter(
      (i): i is QueuedPrintReport =>
        !!i && typeof (i as QueuedPrintReport).body?.clientToken === 'string' && typeof (i as QueuedPrintReport).queuedAt === 'number',
    );
    // MERGE: hydrate bitmeden düşen rapor bellekte ezilmesin (printQueue emsali).
    const mem = usePrintReports.getState().items;
    const tokens = new Set([...mem.map((i) => i.body.clientToken), ...settledTokens]);
    const d = parsed.drops ?? {};
    usePrintReports.setState((s) => ({
      hydrated: true,
      drops: {
        ttl: s.drops.ttl + (Number(d.ttl) || 0),
        cap: s.drops.cap + (Number(d.cap) || 0),
        rejected: s.drops.rejected + (Number(d.rejected) || 0),
        unsupported: s.drops.unsupported + (Number(d.unsupported) || 0),
      },
    }));
    setItems([...loaded.filter((i) => !tokens.has(i.body.clientToken)), ...mem]);
  } catch {
    usePrintReports.setState({ hydrated: true }); // bozuk disk verisi uygulamayı çökertmez
  }
}

function deviceSource(): 'TABLET' | 'TELEFON' {
  const { width, height } = Dimensions.get('window');
  return Math.min(width, height) >= TABLET_SHORTEST_SIDE ? 'TABLET' : 'TELEFON';
}

function appVersion(): string | undefined {
  const v = Constants.expoConfig?.version;
  return typeof v === 'string' && v ? v.slice(0, 32) : undefined;
}

function clip(v: string | undefined | null, max: number): string | undefined {
  if (!v) return undefined;
  const t = v.trim();
  return t.length > max ? t.slice(0, max) : t || undefined;
}

export type PrintReportInput = Omit<PrintReportBody, 'clientToken' | 'source' | 'appVersion'>;

/**
 * Bir basım sonucunu kuyruğa yazar ve çevrimiçiyse hemen gönderir. Token BURADA, bir kez
 * üretilir (mantıksal deneme = bu çağrı); yeniden denemeler kuyruktaki aynı token'ı taşır.
 */
export function reportPrintJob(input: PrintReportInput, gen: () => string = generateClientUuid): string {
  const body: PrintReportBody = {
    ...input,
    errorMessage: clip(input.errorMessage, MESSAGE_MAX),
    clientToken: gen(),
    source: deviceSource(),
    appVersion: appVersion(),
  };
  const item: QueuedPrintReport = {
    body,
    userId: useAuthStore.getState().user?.userId ?? null,
    queuedAt: Date.now(),
  };
  setItems([...usePrintReports.getState().items, item]);
  void flushPrintReports();
  return body.clientToken;
}

export type PrintReportSender = (body: PrintReportBody) => Promise<unknown>;

const defaultSender: PrintReportSender = (body) => apiClient.post('/print-jobs', body);

let flushing: Promise<{ sent: number; kept: number }> | null = null;

/**
 * Kuyruğu sırayla boşaltır. Tek uçuş: eşzamanlı çağrı aynı turu bekler (aynı rapor iki kez
 * uçmasın). Belirsiz hatada ya da 401'de tur DURUR (kayıt aynı token'la kalır).
 */
export function flushPrintReports(send: PrintReportSender = defaultSender): Promise<{ sent: number; kept: number }> {
  // Ön koşul eşzamanlı ölçülür: çevrimdışı/oturumsuz deneme uçuş kaydı bırakmasın.
  const auth = useAuthStore.getState();
  if (!auth.token || !onlineManager.isOnline()) {
    return Promise.resolve({ sent: 0, kept: usePrintReports.getState().items.length });
  }
  if (flushing) return flushing;
  const userId = auth.user?.userId ?? null;
  flushing = (async () => {
    let sent = 0;
    for (const item of [...usePrintReports.getState().items]) {
      if (item.userId !== userId) continue;
      try {
        await send(item.body);
        sent++;
        settledTokens.add(item.body.clientToken);
        setItems(usePrintReports.getState().items.filter((i) => i.body.clientToken !== item.body.clientToken));
        usePrintReports.setState({ lastSentAt: Date.now() });
      } catch (err) {
        const status = (err as { status?: number } | null)?.status;
        if (isAmbiguousFailure(err) || status === 401) break;
        const drop = status === 404 ? { unsupported: 1 } : { rejected: 1 };
        settledTokens.add(item.body.clientToken);
        setItems(usePrintReports.getState().items.filter((i) => i.body.clientToken !== item.body.clientToken), drop);
      }
    }
    return { sent, kept: usePrintReports.getState().items.length };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

let installed = false;
/** Uygulama açılışında bir kez: diskten yükle, çevrimiçi kenarında ve girişte boşalt. */
export function installPrintReportFlush(): void {
  if (installed) return;
  installed = true;
  void hydratePrintReports().then(() => flushPrintReports());
  onlineManager.subscribe((online) => {
    if (online) void flushPrintReports();
  });
  useAuthStore.subscribe((s, prev) => {
    if (s.token && s.token !== prev.token) void flushPrintReports();
  });
}

/** Test kancası. */
export function __resetPrintReportsForTests(): void {
  usePrintReports.setState({ items: [], drops: { ...NO_DROPS }, hydrated: false, lastSentAt: null });
  settledTokens.clear();
  flushing = null;
}

// ─── Basım akışı yardımcıları (etiket bileşenleri ortak kullanır) ────────────

/** Basım akışının hangi adımında düşüldü → `errorCode`. */
export type PrintStep = 'fetch' | 'lang' | 'pair' | 'send' | 'dialog';

const STEP_CODE: Record<PrintStep, string> = {
  fetch: 'ICERIK_ALINAMADI',
  lang: 'DIL_COZULEMEDI',
  pair: 'BT_ESLESME',
  send: 'BT_BAGLANTI',
  dialog: 'BILINMEYEN',
};

export function printErrorCode(step: PrintStep, err: unknown): string {
  const msg = String((err as Error | null)?.message ?? '');
  if (/zaman aşımı|timeout|timed out/i.test(msg) || (err as { code?: string } | null)?.code === 'ECONNABORTED') {
    return 'ZAMAN_ASIMI';
  }
  return STEP_CODE[step];
}

/** expo-print iptal mesajı ("did not complete") — yalnız sistem penceresi yolunda anlamlı. */
export function isPrintCancel(msg: string): boolean {
  return /did not complete|cancel/i.test(msg);
}

export function btTarget(p: Pick<DevicePeripheral, 'id' | 'name' | 'address'>): PrintTarget {
  return {
    transport: 'BLUETOOTH',
    peripheralId: p.id,
    printerName: p.name || undefined,
    printerAddress: p.address ?? undefined,
  };
}

export const DIALOG_TARGET: PrintTarget = { transport: 'SISTEM_PENCERESI' };

/** İş ucuna (print-event) eklenen künye — sunucu `printJobAttachmentSchema`. */
export interface PrintJobAttachment {
  clientToken: string;
  transport: PrintReportTransport;
  printerName?: string;
  printerAddress?: string;
  peripheralId?: string;
  durationMs?: number;
  copies?: number;
  appVersion?: string;
}

/** Künye basım sonucu başına BİR kez kurulur (iş ucu çağrısı yeniden denenmez) → token deneme başınadır. */
export function printJobAttachment(
  target: PrintTarget,
  startedAt: number,
  copies?: number,
  gen: () => string = generateClientUuid,
): PrintJobAttachment {
  return {
    clientToken: gen(),
    transport: target.transport,
    ...(target.printerName ? { printerName: target.printerName.slice(0, 120) } : {}),
    ...(target.printerAddress ? { printerAddress: target.printerAddress.slice(0, 128) } : {}),
    ...(target.peripheralId ? { peripheralId: target.peripheralId } : {}),
    durationMs: Math.max(0, Date.now() - startedAt),
    ...(copies && copies >= 1 ? { copies } : {}),
    ...(appVersion() ? { appVersion: appVersion() } : {}),
  };
}

/** Hata/iptal raporu: iş ucu yoktur, satır `/print-jobs`tan doğar. */
export function reportPrintOutcome(p: {
  subject: PrintSubject;
  target: PrintTarget;
  startedAt: number;
  status: PrintReportStatus;
  step?: PrintStep;
  error?: unknown;
}): void {
  const msg = p.error ? String((p.error as Error)?.message ?? p.error) : undefined;
  reportPrintJob({
    ...p.subject,
    ...p.target,
    status: p.status,
    ...(p.status === 'HATA'
      ? { errorCode: printErrorCode(p.step ?? 'dialog', p.error), errorMessage: msg || 'Yazdırma hatası' }
      : {}),
    startedAt: new Date(p.startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - p.startedAt),
  });
}
