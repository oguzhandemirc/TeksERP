// EŞİTLEME TURU (§2 akış ①…⑨): ön koşul → güvenli ufuk → kirli kökler → satır kurulumu →
// anlık kayıtlar → paket(ler) → imzalı POST → onaylanan filigranların TEK tx'te ilerletilmesi.
// Bir tur bitmeden ikincisi başlamaz (çağıran iş `running` korumasıyla). Filigran YALNIZ
// bulutun `kabul` listesiyle ilerler; onaysız paket sonraki turda aynı konumdan yeniden kurulur.
import { gzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import { readFinanceEnabled, readProductionEnabled } from "../services/system-setting.service";
import { appVersionForWire } from "../services/helpers/license-wire.helper";
import { cloudEligibility } from "./eligibility";
import { computeHorizon } from "./horizon";
import { cloudPost, type CloudCallContext, type CloudTransport } from "./cloud-client";
import { collectProjectionChanges } from "./change-scan";
import { buildRecords } from "./record-builder";
import { buildSnapshots } from "./snapshots";
import { membershipDigest } from "./reconcile";
import { chainOf, entryOf, needsFull, packDrafts, planFull, retentionOf, toUnits, withCompletion, type PacketDraft, type Unit } from "./packing";
import { RECORD_PROJECTIONS, SYNC_CONTRACT_VERSION, SYNC_ENVELOPE_VERSION, type ModuleKey, type SnapshotCadence } from "./projections";
import { FULL_RESEND_MARKER, formatRoundCounter, loadWatermarks, saveWatermarks, wmKey, type StoredWatermark, type WatermarkWrite } from "./watermarks";
import {
  CLOUD_ENDPOINTS,
  PACKET_MAX_GZIP_BYTES,
  PACKET_MAX_RAW_BYTES,
  SyncPacketSchema,
  SyncResponseSchema,
  type ReconcileEntry,
  type SyncPacket,
  type SyncResponse,
  type SyncRoundKind,
  type WireWatermark,
} from "./wire";


export interface RoundOptions {
  readonly kind: Extract<SyncRoundKind, "ARTIMLI" | "UZLASTIRMA">;
  readonly cadences: ReadonlySet<SnapshotCadence>;
  /** Yalnız anlık kayıtlar (zil `ozet`): kayıt projeksiyonları taranmaz. */
  readonly snapshotsOnly?: boolean;
}

export interface RoundDeps {
  readonly transport: CloudTransport;
  readonly nowMs?: () => number;
}

export interface RoundOutcome {
  readonly status: "GONDERILMEDI" | "TAMAM" | "KISMI" | "HATA";
  readonly reason: string | null;
  readonly packets: number;
  readonly accepted: string[];
  readonly rejected: Array<{ projection: string; code: string }>;
  readonly fullRequested: string[];
  readonly horizon: string | null;
  /** Tavana takılan kaynak var — iş beklemeden bir tur daha koşmalı. */
  readonly more: boolean;
  readonly contractWarning: string | null;
}

interface ModuleFlags {
  readonly production: boolean;
  readonly finance: boolean;
}

function moduleOn(m: ModuleKey | undefined, flags: ModuleFlags): boolean {
  if (m === "production.enabled") return flags.production;
  if (m === "finance.enabled") return flags.finance;
  return true;
}

/** ③–⑥ kayıt projeksiyonları: TAM gerekenler sayfalı, diğerleri (w, H] değişiklikleriyle. */
async function planRecordUnits(
  stored: ReadonlyMap<string, StoredWatermark>,
  horizon: Date,
  flags: ModuleFlags,
  nowMs: number,
): Promise<{ units: Unit[]; idle: WatermarkWrite[]; more: boolean }> {
  const units: Unit[] = [];
  const idle: WatermarkWrite[] = [];
  let more = false;
  for (const p of RECORD_PROJECTIONS) {
    if (!moduleOn(p.module, flags)) continue;
    const chain = stored.get(wmKey.chain(p.name));
    if (needsFull(p, chain)) {
      units.push(...(await planFull(p, chain, horizon, nowMs)));
      continue;
    }
    const changes = await collectProjectionChanges(p, stored, horizon);
    more ||= changes.truncated;
    if (changes.needsFull) {
      idle.push({ source: wmKey.chain(p.name), digest: FULL_RESEND_MARKER });
      continue;
    }
    // Değişikliği olmayan kaynaklar bulut onayı beklemeden ilerler (gönderilecek satır yok).
    if (changes.dirty.size === 0 && changes.deleted.size === 0) {
      idle.push(...changes.positions);
      continue;
    }
    const built = await buildRecords(p, [...changes.dirty], nowMs);
    const removed = [...built.removed, ...[...changes.deleted].map((id) => ({ id, neden: "SILINDI" as const }))];
    units.push(...withCompletion(toUnits({ projection: p, built: built.rows, removed, full: null }), changes.positions));
  }
  return { units, idle, more };
}

/** Günlük uzlaştırma (§4.4): son onaylı ufuktan ÖNCE doğmuş kümenin adedi + özeti. */
async function planReconcile(stored: ReadonlyMap<string, StoredWatermark>, flags: ModuleFlags): Promise<ReconcileEntry[]> {
  const out: ReconcileEntry[] = [];
  for (const p of RECORD_PROJECTIONS) {
    if (!moduleOn(p.module, flags)) continue;
    const chain = stored.get(wmKey.chain(p.name));
    if (needsFull(p, chain) || !chain?.at) continue;
    const d = await membershipDigest(p, { retentionFrom: retentionOf(p, chain), createdBefore: chain.at });
    out.push({ projeksiyon: p.name, adet: d.count, ozet: d.digest, ufukTarihi: retentionOf(p, chain)?.toISOString() ?? null });
  }
  return out;
}

interface SendState {
  readonly ctx: CloudCallContext;
  readonly kind: RoundOptions["kind"];
  readonly horizon: Date;
  counter: number;
  readonly chains: Map<string, WireWatermark | null>;
  readonly failed: Set<string>;
  readonly outcome: { packets: number; accepted: string[]; rejected: Array<{ projection: string; code: string }>; fullRequested: string[]; contractWarning: string | null };
}

/** Bulut yanıtını fabrikaya yansıtır — filigran YALNIZ kabul edilen birimde ilerler (tek tx). */
async function applyResponse(r: SyncResponse, draft: { units: Unit[]; snapshots: PacketDraft["snapshots"] }, yeni: WireWatermark, st: SendState): Promise<void> {
  const horizon = st.horizon;
  const acceptedNames = new Set(r.kabul.map((k) => k.projeksiyon));
  const rejectedNames = new Set(r.ret.map((x) => x.projeksiyon));
  const writes: WatermarkWrite[] = [{ source: wmKey.round, tie: [formatRoundCounter(st.counter)] }];
  for (const u of draft.units) {
    const name = u.projection.name;
    if (!u.entries.every((e) => acceptedNames.has(e.name))) {
      st.failed.add(name);
      continue;
    }
    st.chains.set(name, yeni);
    // TAM tamamlanana dek işaret kalır: yarıda kalan TAM sonraki turda baştan başlar.
    writes.push({ source: wmKey.chain(name), at: horizon, tie: [yeni.k], catalogVersion: u.projection.catalogVersion, digest: u.full && !u.onComplete ? FULL_RESEND_MARKER : null });
    if (u.onComplete) writes.push(...u.onComplete);
    if (!st.outcome.accepted.includes(name)) st.outcome.accepted.push(name);
  }
  for (const s of draft.snapshots) if (!rejectedNames.has(s.projection)) writes.push({ source: wmKey.snapshot(s.projection), digest: s.digest, at: horizon });
  for (const x of r.ret) st.outcome.rejected.push({ projection: x.projeksiyon, code: x.kod });
  for (const want of r.istenen) {
    const main = want.projeksiyon.split(".")[0]!;
    if (want.tur !== "TAM" || !RECORD_PROJECTIONS.some((p) => p.name === main)) continue;
    writes.push({ source: wmKey.chain(main), digest: FULL_RESEND_MARKER });
    if (!st.outcome.fullRequested.includes(main)) st.outcome.fullRequested.push(main);
  }
  for (const [name, iso] of Object.entries(r.ufukTarihi)) {
    if (RECORD_PROJECTIONS.some((p) => p.name === name)) writes.push({ source: wmKey.chain(name), retentionFrom: iso ? new Date(iso) : null });
  }
  if (r.sozlesmeUyarisi) st.outcome.contractWarning = r.sozlesmeUyarisi;
  await saveWatermarks(writes);
}

function buildPacket(draft: PacketDraft, units: Unit[], yeni: WireWatermark, st: SendState): SyncPacket {
  return {
    v: SYNC_ENVELOPE_VERSION,
    sozlesme: SYNC_CONTRACT_VERSION,
    paketId: randomUUID(),
    kurulumId: st.ctx.installationId,
    tur: st.kind,
    ufuk: st.horizon.toISOString(),
    uretimBilgisi: { uygulamaSurum: appVersionForWire(), katalogSurum: SYNC_CONTRACT_VERSION },
    kayitlar: units.flatMap((u) => u.entries.map((e) => entryOf(e, u, { onceki: u.startsChain ? null : (st.chains.get(u.projection.name) ?? null), yeni }))),
    anliklar: draft.snapshots.map((s) => ({ projeksiyon: s.projection, icerikOzeti: s.digest, veri: s.data })),
    uzlastirma: draft.reconcile,
  };
}

/** ⑧–⑨ paketleri sırayla gönderir; ağ/yanıt hatasında durur (sonraki tur aynı konumdan). */
async function sendDrafts(queue: PacketDraft[], st: SendState): Promise<{ status: RoundOutcome["status"]; reason: string | null }> {
  let status: RoundOutcome["status"] = "TAMAM";
  let reason: string | null = null;
  for (let qi = 0; qi < queue.length; qi++) {
    const draft = queue[qi]!;
    const live = draft.units.filter((u) => !st.failed.has(u.projection.name));
    st.counter++;
    const yeni: WireWatermark = { t: st.horizon.toISOString(), k: formatRoundCounter(st.counter) };
    // Sözleşmede olmayan anahtar dışarı çıkamaz: kendi ürettiğimizi de katı şemadan geçiririz.
    const checked = SyncPacketSchema.parse(buildPacket(draft, live, yeni, st));
    const raw = Buffer.from(JSON.stringify(checked), "utf8");
    if (raw.length > PACKET_MAX_RAW_BYTES || gzipSync(raw).length > PACKET_MAX_GZIP_BYTES) {
      st.counter--;
      if (live.length > 1) {
        const half = Math.ceil(live.length / 2);
        queue.splice(qi + 1, 0, { units: live.slice(0, half), snapshots: draft.snapshots, reconcile: draft.reconcile }, { units: live.slice(half), snapshots: [], reconcile: [] });
        continue;
      }
      status = "HATA";
      reason = "PAKET_BUYUK";
      for (const u of live) st.failed.add(u.projection.name);
      continue;
    }
    const res = await cloudPost(st.ctx, CLOUD_ENDPOINTS.SYNC, checked, { gzip: true });
    st.outcome.packets++;
    const parsed = res.ok ? SyncResponseSchema.safeParse(res.json) : null;
    if (!res.ok || !parsed?.success || parsed.data.paketId !== checked.paketId) {
      return { status: st.outcome.packets > 1 ? "KISMI" : "HATA", reason: res.ok ? "YANIT_GECERSIZ" : res.code };
    }
    await applyResponse(parsed.data, { units: live, snapshots: draft.snapshots }, yeni, st);
  }
  return { status, reason };
}

export async function runSyncRound(opts: RoundOptions, deps: RoundDeps): Promise<RoundOutcome> {
  const now = deps.nowMs ?? Date.now;
  const elig = cloudEligibility(now());
  const empty = { packets: 0, accepted: [], rejected: [], fullRequested: [], more: false, contractWarning: null };
  if (!elig.ok) return { ...empty, status: "GONDERILMEDI", reason: elig.reason, horizon: null };

  const ctx: CloudCallContext = { baseUrl: elig.baseUrl, installationId: elig.installationId, transport: deps.transport };
  const horizon = (await computeHorizon(now())).at;
  const stored = await loadWatermarks();
  const flags: ModuleFlags = { production: await readProductionEnabled(), finance: await readFinanceEnabled() };

  const plan = !opts.snapshotsOnly && opts.kind === "ARTIMLI" ? await planRecordUnits(stored, horizon, flags, now()) : { units: [], idle: [], more: false };
  await saveWatermarks(plan.idle);
  const snapshots =
    opts.kind === "ARTIMLI"
      ? (await buildSnapshots({ now: new Date(now()), productionOn: flags.production, financeOn: flags.finance, cadences: opts.cadences })).filter(
          (s) => stored.get(wmKey.snapshot(s.projection))?.digest !== s.digest,
        )
      : [];
  const reconcile = opts.kind === "UZLASTIRMA" ? await planReconcile(stored, flags) : [];

  const st: SendState = {
    ctx,
    kind: opts.kind,
    horizon,
    counter: Number(stored.get(wmKey.round)?.tie?.[0] ?? "0") || 0,
    chains: new Map(RECORD_PROJECTIONS.map((p) => [p.name, chainOf(stored.get(wmKey.chain(p.name)))])),
    failed: new Set(),
    outcome: { packets: 0, accepted: [], rejected: [], fullRequested: [], contractWarning: null },
  };
  const sent = await sendDrafts(packDrafts(plan.units, snapshots, reconcile), st);
  const status = sent.status === "TAMAM" && (st.failed.size > 0 || st.outcome.rejected.length > 0) ? "KISMI" : sent.status;
  return { ...st.outcome, more: plan.more, status, reason: sent.reason, horizon: horizon.toISOString() };
}
