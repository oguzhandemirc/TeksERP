// =============================================================================
// Gelen belge OKUMA işi (D3b) — DB'deki PENDING taramaları sidecar'a okutur, DRAFT taslağa yazar
// =============================================================================
// Backend sürecinin İÇİNDE (ikinci Node süreci yok); `cloud-inbox.job.ts` kalıbı: `running` koruması (tek tur),
// turlar arası zamanlayıcı, `requestImmediateReaderRun` ile dürtme (okut ucu). İşleme sırası DB'deki atomik claim
// (`claimNextScan`): iki süreç/iki tur aynı taramayı alamaz. Polling yasağı (`kesif-cihaz.md`) seri port içindir;
// burası DB kuyruğudur. Ön koşul fail-closed: modül (emanet + gelenBelge) kapalı ya da adres yoksa HİÇBİR dış istek atılmaz.
// =============================================================================
import { reportJobFailure } from "./job-failure";
import { bilgi, uyari } from "../lib/logger";
import { getReaderUrl } from "../lib/gelen-belge/url";
import { effectiveIncomingDocsEnabled } from "../services/system-setting.service";
import { claimNextScan, processClaimedScan, type ProcessOutcome } from "../services/gelen-belge-okuma.service";

const STARTUP_DELAY_MS = 30 * 1000;
/** Kuyruk boşken ne sıklıkla bakılır (yeni tarama `requestImmediateReaderRun` ile dürter). */
const IDLE_INTERVAL_MS = 20 * 1000;
/** Dürtme yağmurunda iki tur arası en az bu kadar. */
const MIN_RUN_GAP_MS = 1000;
/** Tek turda en fazla bu kadar tarama (sidecar tek sayfa kilidi; uzun tur kapanışı geciktirmesin). */
const MAX_PER_RUN = 5;

export type ReaderRunOutcome = "MESGUL" | "KAPALI" | "ADRES_YOK" | "BOS" | "BASARILI" | "BASARISIZ";

export interface ReaderRunResult {
  readonly outcome: ReaderRunOutcome;
  readonly processed: number;
  readonly outcomes: readonly ProcessOutcome[];
}

let started = false;
let stopped = false;
let running = false;
let again = false;
let timer: NodeJS.Timeout | null = null;
let lastRunAt = 0;
let lastResult: ReaderRunResult | null = null;

export async function readerPreconditions(): Promise<{ ok: true; url: string } | { ok: false; outcome: "KAPALI" | "ADRES_YOK" }> {
  if (!(await effectiveIncomingDocsEnabled())) return { ok: false, outcome: "KAPALI" };
  const url = getReaderUrl().url;
  if (!url) return { ok: false, outcome: "ADRES_YOK" };
  return { ok: true, url };
}

/** Tek tur: ön koşul → claim → oku → (en çok MAX_PER_RUN) — bir taramanın hatası diğerlerini durdurmaz. */
export async function runReaderOnce(): Promise<ReaderRunResult> {
  if (running) {
    again = true;
    return { outcome: "MESGUL", processed: 0, outcomes: [] };
  }
  running = true;
  lastRunAt = Date.now();
  const outcomes: ProcessOutcome[] = [];
  try {
    const pre = await readerPreconditions();
    if (!pre.ok) return (lastResult = { outcome: pre.outcome, processed: 0, outcomes });
    let races = 0;
    const tried: string[] = [];
    while (outcomes.length < MAX_PER_RUN && !stopped) {
      const claim = await claimNextScan(new Date(), tried);
      if (claim.kind === "NONE") break;
      if (claim.kind === "RACED") {
        if (++races > 3) break;
        continue;
      }
      tried.push(claim.id);
      outcomes.push(await processClaimedScan(claim.id, pre.url));
    }
    return (lastResult = { outcome: outcomes.length ? "BASARILI" : "BOS", processed: outcomes.length, outcomes });
  } catch (err) {
    reportJobFailure("gelen-belge-okuma", err);
    return (lastResult = { outcome: "BASARISIZ", processed: outcomes.length, outcomes });
  } finally {
    running = false;
  }
}

function schedule(delayMs: number): void {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runReaderOnce().finally(() => {
      const rerun = again || (lastResult?.processed ?? 0) >= MAX_PER_RUN;
      again = false;
      schedule(rerun ? MIN_RUN_GAP_MS : IDLE_INTERVAL_MS);
    });
  }, delayMs);
  timer.unref();
}

/** Yeni tarama geldi / okut dendi: beklemeden tur (yağmur korumalı). */
export function requestImmediateReaderRun(): void {
  if (!started || stopped) return;
  if (running) {
    again = true;
    return;
  }
  schedule(Math.max(0, MIN_RUN_GAP_MS - (Date.now() - lastRunAt)));
}

export function startDocumentReader(): void {
  if (started) return;
  started = true;
  schedule(STARTUP_DELAY_MS);
  const u = getReaderUrl();
  if (u.source === "gecersiz") uyari("gelen-belge", "GELEN_BELGE_OKUMA_URL geçersiz (yalnız HTTPS, döngü adresi ya da noktasız compose servisi) — okuma kapalı");
  else if (!u.url) bilgi("gelen-belge", "okuma servisi adresi yok (GELEN_BELGE_OKUMA_URL boş) — taramalar PENDING bekler, taslak elle sürer");
}

/** Kapanış: zamanlayıcı iptal; süren tur tarama arasında durur (claim'li tarama bayat READING olarak 10 dk sonra geri alınır). */
export function stopDocumentReader(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function readerJobStatus(): { started: boolean; running: boolean; lastRunAt: number; last: ReaderRunResult | null } {
  return { started, running, lastRunAt, last: lastResult };
}

/** Test-only. */
export function __resetDocumentReaderForTests(): void {
  stopDocumentReader();
  started = false;
  stopped = false;
  running = false;
  again = false;
  lastResult = null;
}
