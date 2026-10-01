// Durum kaydı katmanı: kurulum anahtarıyla imzalı monotonik birikim + son kabul edilen kira/HAK izi + kapalı süre
// kredisi + G12 merdiven alanları. Kaydın İKİ kopyası vardır (lisans v2 §3.1): `durum.json` ve fabrika DB'sindeki
// lisans izi (`trace-row.ts`); ikisi aynı imzalı JWS'i taşır, en yeni sıralı kopya esastır, birikim büyüğüdür. Kayıt
// YALNIZ bu lisans kimliğine aitse okunur; bozuk/silinmiş kayıt aynı kira için sıfırdan başlatılmaz (saat hilesini
// açardı) — ayakta kalan kopya sürdürür, hiçbiri yoksa kayıt KİRASIZ doğar (hiçbir kiranın monotoniğini taşımaz).
import { isoToMs, type LeaseDoc } from "./protocol";
import { accumulatedRuntime, signStateRecord, verifyStateRecordSignature, type RememberedAnchor, type StateRecord, type TraceKind } from "./saat";
import { getLicenseStore, saveStateRecord } from "./store";
import { bumpLicenseSnapshotVersion } from "./license-signals";
import { getLicenseTraceRow, markLicenseTraceUnknown, setLicenseTraceRow, type TraceRow } from "./trace-row";

export interface Accumulation {
  readonly fileJws: string | null;
  readonly traceJws: string | null;
  /** Kayıtları doğrulayan açık anahtar: kurulum anahtarı; o okunamıyorsa DB izinin taşıdığı (imza durur, kararlar sürer). */
  readonly keyX: string;
  /** İmzası doğrulanmış kopyalar (kurulum bağı `recordView`da). */
  readonly file: StateRecord | null;
  readonly trace: StateRecord | null;
  /** Monotonik birikimin aktığı kaydın JWS'i ve o kayda bu süreçte son dokunulan hrtime. */
  readonly newestJws: string | null;
  readonly baseHrNs: bigint;
  /** En yeni kayıt tutarlı saatle yazılmışsa, yazımdan bu yüklemeye dek duvarla gözlenen kapalı süre. */
  readonly creditMs: number;
}
let accumulation: Accumulation | null = null;

function verified(jws: string | null, keyX: string): StateRecord | null {
  if (!jws) return null;
  const v = verifyStateRecordSignature(jws, { publicKeyX: keyX });
  return v.ok ? v.value : null;
}

/** Kurulum anahtarının açık yarısı: dosyadan; okunamıyorsa bu lisans kimliğine ait DB izinden. */
export function installationPublicX(): string | null {
  const store = getLicenseStore();
  if (store?.key) return store.key.x;
  const trace = getLicenseTraceRow();
  const id = store?.identity?.kurulumId ?? null;
  return trace.durum === "VAR" && id !== null && trace.row.kurulumId === id ? trace.row.anahtar : null;
}

function newestOf(file: StateRecord | null, trace: StateRecord | null): StateRecord | null {
  if (!file) return trace;
  if (!trace) return file;
  return trace.sira > file.sira ? trace : file;
}

/** İki kopyayı (bir kez) doğrular; dosya, DB izi ya da anahtar değişince yeniden. */
export function currentAccumulation(): Accumulation | null {
  const store = getLicenseStore();
  const keyX = installationPublicX();
  if (!store || !keyX) return null;
  const row = getLicenseTraceRow();
  const fileJws = store.stateJws;
  const traceJws = row.durum === "VAR" ? row.row.durum : null;
  const prev = accumulation;
  if (prev && prev.fileJws === fileJws && prev.traceJws === traceJws && prev.keyX === keyX) return prev;
  const file = verified(fileJws, keyX);
  const trace = verified(traceJws, keyX);
  const newest = newestOf(file, trace);
  const newestJws = newest === null ? null : newest === file ? fileJws : traceJws;
  if (prev && prev.keyX === keyX && newestJws !== null && prev.newestJws === newestJws) {
    accumulation = { ...prev, fileJws, traceJws, file, trace };
    return accumulation;
  }
  const creditMs = newest?.duvarTutarli === true ? Math.max(0, Date.now() - isoToMs(newest.yazildi)) : 0;
  accumulation = { fileJws, traceJws, keyX, file, trace, newestJws, baseHrNs: process.hrtime.bigint(), creditMs };
  return accumulation;
}

/** Bu lisans kimliğinin kayıt görünümü: en yeni geçerli kopya + bütün geçerli kopyalar. */
export interface RecordView {
  readonly record: StateRecord | null;
  readonly copies: readonly StateRecord[];
  /** `durum.json` bu kuruluma ait ve imzası geçerli. */
  readonly fileValid: boolean;
  /** DB izindeki kopya bu kuruluma ait ve imzası geçerli. */
  readonly traceValid: boolean;
}

export function recordView(a: Accumulation | null, licenseId: string | null): RecordView {
  const mine = (r: StateRecord | null): StateRecord | null => (r && licenseId !== null && r.kurulumId === licenseId ? r : null);
  const file = mine(a?.file ?? null);
  const trace = mine(a?.trace ?? null);
  return {
    record: newestOf(file, trace),
    copies: [file, trace].filter((r): r is StateRecord => r !== null),
    fileValid: file !== null,
    traceValid: trace !== null,
  };
}

/** Geriye uyum: tek kayıt soran çağıranlar için en yeni kopya. */
export function recordFor(a: Accumulation | null, licenseId: string | null): StateRecord | null {
  return recordView(a, licenseId).record;
}

/** Aynı DÖNEMİN kopyaları (aynı kira ve son kira): birikimler yalnız onlar arasında birleşir, eski dönem yok sayılır. */
function sameEpoch(view: RecordView): StateRecord[] {
  const n = view.record;
  if (!n) return [];
  return view.copies.filter((c) => c.kiraId === n.kiraId && (c.sonKira?.kiraId ?? null) === (n.sonKira?.kiraId ?? null));
}

/** Dönem anahtarı (sayaçlar için): yeni kira kabulü dönemi değiştirir. */
export function epochOf(view: RecordView): string | null {
  const n = view.record;
  return n ? `${n.kiraId ?? "kirasiz"}:${n.sonKira?.kiraId ?? "-"}` : null;
}

export function mergedUncertaintyMs(view: RecordView): number {
  return Math.max(0, ...sameEpoch(view).map((c) => c.belirsizlik?.birikenMs ?? 0));
}

export function mergedFingerprintMs(view: RecordView): number {
  return Math.max(0, ...sameEpoch(view).map((c) => c.parmakIziUyusmazMs ?? 0));
}

export function mergedTraceLoss(view: RecordView): TraceKind[] {
  const all = new Set<TraceKind>(sameEpoch(view).flatMap((c) => c.izKaybi?.izler ?? []));
  return (["KIRA", "DURUM", "IZ"] as const).filter((k) => all.has(k));
}

/** Kopyaların hatırladığı süre çapaları (çelişki ve "en erken" kararı `state-rules-time`ta). */
export function rememberedAnchorsOf(view: RecordView): RememberedAnchor[] {
  return view.copies.map((c) => c.sureCapasi ?? null).filter((x): x is NonNullable<typeof x> => x !== null);
}

/** Son bilinen modül tavanı: en yeni kopyanın HAK pini, yoksa öteki kopyanınki. */
export function lastKnownCeiling(view: RecordView): readonly string[] | null {
  const ordered = view.record ? [view.record, ...view.copies.filter((c) => c !== view.record)] : [];
  for (const c of ordered) if (c.sonHak?.moduller) return c.sonHak.moduller;
  return null;
}

/** Bu kopyanın kiraya ait monotonik birikimi (hrtime ile ilerler). */
export function elapsedOf(a: Accumulation, record: StateRecord | null): number {
  if (!record) return 0;
  return accumulatedRuntime({ storedMs: record.birikenMs, loadHrNs: a.baseHrNs, nowHrNs: process.hrtime.bigint() });
}

/** Kapalı süre kredisi: kayıttaki birikmiş kredi + bu yüklemede duvarla gözlenen. */
export function downtimeCreditOf(a: Accumulation | null, record: StateRecord | null): number {
  return a && record ? (record.kapaliMs ?? 0) + a.creditMs : 0;
}

/**
 * HAK veriliş sınırının "şimdi" tabanı: duvar ∨ defter yüksek suyu ∨ durum kaydı kopyalarının yüksek suyu (bu kurulum
 * anahtarıyla imzalı; hepsi geçmişte gözlenmiş anlar) — saati geri alınmış fabrika taze HAK'ı ileri tarihli saymasın.
 */
export function verificationFloorOf(wallMs: number, ledgerHighWaterMs: number | null, a: Accumulation | null): number {
  const records = [a?.file, a?.trace].map((r) => (r ? isoToMs(r.yuksekSu) : 0));
  return Math.max(wallMs, ledgerHighWaterMs ?? 0, ...records);
}

export function highWaterOf(record: StateRecord | null, lease: LeaseDoc | null, ledgerHighWaterMs: number | null): number {
  return Math.max(ledgerHighWaterMs ?? 0, record ? isoToMs(record.yuksekSu) : 0, lease ? isoToMs(lease.sunucuSaati) : 0);
}

// ── Yazım: dosya senkron, DB kopyası sıralı kuyrukta (servis kaydeder; motor DB'ye inmez) ─────────────────
type TraceWriter = (row: TraceRow) => Promise<void>;
let traceWriter: TraceWriter | null = null;
let traceQueue: Promise<void> = Promise.resolve();

/** Lisans izi yazıcısı (`license-trail.service`); yoksa (test, betik) kopya yalnız dosyada kalır. */
export function registerLicenseTraceWriter(fn: TraceWriter | null): void {
  traceWriter = fn;
}

/** Sıradaki iz yazımları bitene dek bekler (kapanış ve bekçiler). */
export function flushLicenseTraceWrites(): Promise<void> {
  return traceQueue;
}

/**
 * Kaydı imzalar, `durum.json`a yazar ve AYNI JWS'i DB izine kuyruklar (yazım sırası korunur: son yazılan en yeni).
 * İz yazımı düşerse dosya yine geçerlidir; kayıt `izKurulu`yu yalnız iz okunup doğrulandıktan sonra taşır.
 */
export function writeRecord(record: StateRecord): string {
  const store = getLicenseStore();
  if (!store?.key) throw new Error("Lisans deposu hazır değil");
  const jws = signStateRecord(record, store.key.privateKey, store.key.x);
  saveStateRecord(jws);
  const prev = currentAccumulation();
  accumulation = {
    fileJws: jws,
    traceJws: prev?.traceJws ?? null,
    keyX: store.key.x,
    file: record,
    trace: prev?.trace ?? null,
    newestJws: jws,
    baseHrNs: process.hrtime.bigint(),
    creditMs: 0,
  };
  const writer = traceWriter;
  if (writer) {
    const row: TraceRow = { v: 1, kurulumId: record.kurulumId, anahtar: store.key.x, durum: jws };
    // Bellek hâli yazımla birlikte ilerler (yazım sürerken DB izi "kayıp" görünmesin); yazım düşerse BİLİNMİYOR'a döner.
    setLicenseTraceRow(row);
    traceQueue = traceQueue.then(() => writer(row)).catch(() => undefined);
  }
  bumpLicenseSnapshotVersion();
  return jws;
}

/** Yazıcının sonucu: başarıda okunan satır budur; düşerse iz BİLİNMİYOR (DB arızası iz kaybı sayılmaz, okuma tazeler). */
export function acknowledgeTraceWrite(row: TraceRow | null): void {
  if (row) setLicenseTraceRow(row);
  else markLicenseTraceUnknown();
}

/** Test-only. */
export function __resetAccumulationForTests(): void {
  accumulation = null;
  traceQueue = Promise.resolve();
}
