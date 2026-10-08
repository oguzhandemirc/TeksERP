// =============================================================================
// GÜNCELLEME DURUMU (Dağıtım v2 — docs/design/GUNCELLEYICI.md §3.1 · §3.2 · §5.2)
// =============================================================================
// Panelin `GET /api/guncelleme/durum`u ile yoklamanın `guncelleme` raporu TEK eşlemeden doğar:
// kiradaki politika (satıcı imzalı) + güncelleyicinin durum/geçmiş dosyaları (D2 §5). Karar ve sonuç
// güncelleyicinindir: `bekleyen` · `son` · `karar` durum dosyasından DOĞRUDAN okunur (sezgisel çeviri
// yok); güncelleyicinin canlılığı kalp atışından (`sonCanlilik` + `canlilikEsigiSn`). Rapor KATI şemadan
// geçmezse GÖNDERİLMEZ — yoklama hiçbir zaman bu rapor yüzünden düşmez; güncelleyici yoksa alan hiç gitmez.
// =============================================================================
import prisma from "../lib/prisma";
import { APP_VERSION } from "../lib/app-version";
import { getFactoryTimezone } from "../constants/time";
import {
  IsoTimeSchema,
  ReleaseVersionSchema,
  UpdateReportSchema,
  UpdateResultSchema,
  UuidSchema,
  VersionTextSchema,
  WINDOWS_PLATFORM,
  backendDownloadPrefix,
  effectiveUpdatePolicy,
  isoToMs,
  type LeaseDoc,
  type LeaseUpdatePolicy,
  type UpdateDecisionKind,
  type UpdateReport,
  type UpdatePlatform,
  type UpdateResult,
  type UpdateWindowRule,
  type UPDATER_STATES,
} from "../lib/license/protocol";
import { getDownloadTokens, getLicenseSnapshot } from "../lib/license/runtime";
import { updateGroupOf, type UpdateGroup } from "../lib/license/update-group";
import {
  UPDATER_HISTORY_LIMIT,
  UpdaterDecisionBlockSchema,
  UpdaterLastDetailSchema,
  UpdaterNoticeSchema,
  UpdaterPendingBlockSchema,
  ownUpdatePlatform,
  readUpdater,
  type UpdaterHistoryLine,
  type UpdaterLastDetail,
  type UpdaterNotice,
  type UpdaterRead,
  type UpdaterStatusDoc,
} from "../lib/license/updater-ipc";
import { decideDownloadToken } from "./license-view.service";
import { approvalActions, type UpdateActions, type UpdateApprovalView } from "./helpers/update-approval-rules.helper";

type UpdaterState = (typeof UPDATER_STATES)[number];

const CODE = /^[A-Z0-9_]{2,40}$/;
/** Canlılık eşiğinin tavanı (sn): biçimli ama uçuk bir eşik güncelleyiciyi sonsuza dek "canlı" gösteremez. */
export const LIVENESS_THRESHOLD_MAX_S = 24 * 60 * 60;
/** Kalp atışı gelecekteyse (saat sapması) bu kadarı hoş görülür; ötesi ölçülemedi sayılır. */
export const LIVENESS_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/** Geçmişteki sonuç → raporun sonucu (güncelleyicinin HATA'sı insan gerektiren başarısızlıktır). */
const RESULT_OF: Readonly<Record<string, UpdateResult["sonuc"]>> = { BASARILI: "BASARILI", GERI_DONDU: "GERI_DONDU", HATA: "BASARISIZ" };

const valid = <T>(schema: { safeParse: (v: unknown) => { success: boolean } }, v: T | null | undefined): T | null =>
  v !== null && v !== undefined && schema.safeParse(v).success ? v : null;
const code = (v: string | null | undefined): string | null => (v && CODE.test(v) ? v : null);

export interface UpdaterProcessView {
  readonly durum: UpdaterState;
  readonly surum: string | null;
}
export interface PendingUpdateView {
  readonly surum: string;
  readonly karar: UpdateDecisionKind;
  readonly neden: string | null;
}
/** Panelin bekleyen görünümü: raporun üçlüsü + adayın bildirimi (kritik mi, özet) ve karar aralığı. */
export interface PendingUpdateDetail extends PendingUpdateView {
  readonly zorunlu: boolean;
  readonly ozet: string | null;
  readonly aralik: { readonly baslangic: string; readonly bitis: string } | null;
  readonly pgGuncellemesi: boolean;
}
export interface UpdaterLiveness {
  readonly sonCanlilik: string | null;
  readonly esikSn: number | null;
  /** Son kalp atışından bu yana geçen süre (sn); ölçülemiyorsa null. */
  readonly gecikmeSn: number | null;
  /** Eşik aşıldı ya da kalp atışı okunamıyor: güncelleyici yanıt vermiyor. */
  readonly yanitVermiyor: boolean;
}

/** Kalp atışı (§5.2): `şimdi − sonCanlilik ≤ canlilikEsigiSn` ⇒ canlı; alan yok/biçimsiz ⇒ ölçülemedi (canlı DEĞİL). */
export function updaterLiveness(d: UpdaterStatusDoc, nowMs: number): UpdaterLiveness {
  const beat = d.sonCanlilik && IsoTimeSchema.safeParse(d.sonCanlilik).success ? isoToMs(d.sonCanlilik) : Number.NaN;
  const threshold = typeof d.canlilikEsigiSn === "number" ? Math.min(d.canlilikEsigiSn, LIVENESS_THRESHOLD_MAX_S) : null;
  if (!Number.isFinite(beat) || threshold === null) {
    return { sonCanlilik: d.sonCanlilik ?? null, esikSn: threshold, gecikmeSn: null, yanitVermiyor: true };
  }
  const age = nowMs - beat;
  return {
    sonCanlilik: d.sonCanlilik ?? null,
    esikSn: threshold,
    gecikmeSn: Math.max(0, Math.round(age / 1000)),
    yanitVermiyor: age > threshold * 1000 || age < -LIVENESS_FUTURE_TOLERANCE_MS,
  };
}

/** Güncelleyici süreci: dosya yok → YOK · okunamıyor ya da kalp atışı eşiği aştı → OLCULEMEDI · HATA (insan gerekir) → DURDU. */
export function updaterProcess(read: UpdaterRead, nowMs: number): UpdaterProcessView {
  if (read.status.kind === "missing") return { durum: "YOK", surum: null };
  if (read.status.kind === "invalid") return { durum: "OLCULEMEDI", surum: null };
  const d = read.status.doc;
  const version = valid(VersionTextSchema, d.guncelleyiciSurum);
  if (d.durum === "HATA") return { durum: "DURDU", surum: version };
  return { durum: updaterLiveness(d, nowMs).yanitVermiyor ? "OLCULEMEDI" : "CALISIYOR", surum: version };
}

/** Güncelleyicinin kesin `bekleyen`i (§5.2) — geri dönmüş aday yeni onay yoksa zaten ONAY_BEKLIYOR yazılır. */
export function pendingUpdate(d: UpdaterStatusDoc): PendingUpdateDetail | null {
  const b = UpdaterPendingBlockSchema.safeParse(d.bekleyen);
  if (!b.success) return null;
  const p = b.data;
  return {
    surum: p.surum,
    karar: p.karar,
    neden: p.neden,
    zorunlu: p.zorunlu === true,
    ozet: p.ozet ?? null,
    aralik: p.aralik ?? null,
    pgGuncellemesi: p.pgGuncellemesi === true,
  };
}

/** Güncelleyicinin son kararı (aday olmasa da: DONDURULDU/KIRA_YOK gibi). */
export function currentDecision(d: UpdaterStatusDoc): { readonly karar: UpdateDecisionKind; readonly neden: string | null } | null {
  const k = UpdaterDecisionBlockSchema.safeParse(d.karar);
  return k.success ? { karar: k.data.karar, neden: k.data.neden } : null;
}

/** Son TAMAMLANAN deneme — durum dosyasının `son`u, sözleşmenin KATI şemasıyla (başarısız PG adımı dahil). */
export function lastResult(d: UpdaterStatusDoc): UpdateResult | null {
  const r = UpdateResultSchema.safeParse(d.son);
  return r.success ? r.data : null;
}

export function lastDetail(d: UpdaterStatusDoc): UpdaterLastDetail | null {
  const r = UpdaterLastDetailSchema.safeParse(d.sonAyrinti);
  return r.success ? r.data : null;
}

/** `bilgi` (sorun değil): biçimsizse yalnız kendisi düşer. */
export function updaterNotice(d: UpdaterStatusDoc): UpdaterNotice | null {
  const r = UpdaterNoticeSchema.safeParse(d.bilgi);
  return r.success ? r.data : null;
}

/** Panel geçmişi satırı: sonuç (rapor biçimi) + ürün, iç kod, PG sürümü ve tetikleyen onay. */
export interface UpdateHistoryItem extends UpdateResult {
  readonly urun: "backend" | "pg";
  readonly ayrintiKodu: string | null;
  /** PG satırında kurulmak istenen PostgreSQL sürümü; `hedefSurum` o adımın ön koşul olduğu backend sürümüdür. */
  readonly pgSurum: string | null;
  readonly onayId: string | null;
}

/** Geçmiş satırı → panel satırı; biçimsiz, UUID'siz ya da ters zamanlı satır atlanır. */
export function historyItem(h: UpdaterHistoryLine): UpdateHistoryItem | null {
  const outcome = RESULT_OF[h.sonuc];
  const product = h.urun === "backend" || h.urun === "pg" ? h.urun : null;
  if (!outcome || !product) return null;
  const r = {
    kayitId: h.islemId,
    hedefSurum: product === "pg" ? (h.hedefBackend ?? "") : h.surum,
    kaynakSurum: valid(VersionTextSchema, h.kaynakSurum),
    sonuc: outcome,
    kod: outcome === "BASARILI" ? null : (code(h.hataKodu) ?? "BILINMEYEN"),
    baslangic: h.basladi,
    bitis: h.bitti,
    veriGeriYuklendi: h.veriGeriYuklendi === true,
  };
  if (!UpdateResultSchema.safeParse(r).success) return null;
  return {
    ...r,
    urun: product,
    ayrintiKodu: code(h.ayrintiKodu),
    pgSurum: product === "pg" ? h.surum : null,
    onayId: valid(UuidSchema, h.onayId),
  };
}

/** Yoklama raporu (§3.1): güncelleyici yoksa ya da KATI şemadan geçmezse null (alan gönderilmez). */
export function buildUpdateReport(read: UpdaterRead, saatDilimi: string, nowMs: number = Date.now()): UpdateReport | null {
  if (read.status.kind === "missing") return null;
  const d = read.status.kind === "ok" ? read.status.doc : null;
  const p = d ? pendingUpdate(d) : null;
  const report = {
    saatDilimi,
    guncelleyici: updaterProcess(read, nowMs),
    bekleyen: p ? { surum: p.surum, karar: p.karar, neden: p.neden } : null,
    son: d ? lastResult(d) : null,
  };
  const parsed = UpdateReportSchema.safeParse(report);
  return parsed.success ? parsed.data : null;
}

/** Yoklama gövdesinin `guncelleme` alanı — rapor yoksa alan HİÇ yok. */
export function updateReportField(read: UpdaterRead = readUpdater()): { guncelleme?: UpdateReport } {
  const report = buildUpdateReport(read, getFactoryTimezone());
  return report ? { guncelleme: report } : {};
}

// ── Panel ucu: GET /api/guncelleme/durum ────────────────────────────────────────
export interface UpdateStatus {
  readonly kuruluSurum: string;
  readonly kanal: string | null;
  /** Güncelleme grubu — kira kanalı üç gruptan biriyse; pasif/eski kanal ve kira yok → null. */
  readonly grup: UpdateGroup | null;
  readonly politika: (Omit<LeaseUpdatePolicy, "araliklar"> & { readonly pencere: UpdateWindowRule | null; readonly kaynak: "KIRA" | "VARSAYILAN" }) | null;
  readonly donuk: boolean;
  readonly sonrakiPencere: { readonly baslangic: string; readonly bitis: string } | null;
  readonly indirmeBelirteci: boolean;
  readonly guncelleyici: UpdaterProcessView;
  readonly bekleyen: PendingUpdateDetail | null;
  readonly son: UpdateResult | null;
  /** Güncelleyicinin yerel durumu (ilerleme, adım, ileti, son sonucun iç ayrıntısı) — dosya okunamıyorsa null. */
  readonly yerel: {
    readonly durum: string;
    readonly surum: string | null;
    readonly kuruluSurum: string | null;
    readonly urun: string | null;
    readonly adim: string | null;
    readonly hataKodu: string | null;
    readonly mesaj: string | null;
    readonly ilerleme: { readonly indirilen: number; readonly toplam: number } | null;
    readonly planlanan: string | null;
    readonly zaman: string | null;
    readonly sonAyrinti: UpdaterLastDetail | null;
    /** Bu turun bilgisi (sorun DEĞİL; ör. `SEMA_OLCULEMEDI` — güncelleme durmadı). */
    readonly bilgi: UpdaterNotice | null;
  } | null;
  /** Son denemeler (backend + PG adımları), en yeni önce. */
  readonly gecmis: UpdateHistoryItem[];
  // sözleşme sürümü 4 (yalnız EKLER):
  /** Güncelleyicinin son kararı (aday olmasa da). */
  readonly karar: { readonly karar: UpdateDecisionKind; readonly neden: string | null } | null;
  readonly canlilik: UpdaterLiveness | null;
  /** Yürürlükteki panel onayı (son kayıt geri alma değilse). */
  readonly onay: UpdateApprovalView | null;
  readonly eylemler: UpdateActions;
}

/** Saf: kira (imzalı, doğrulanmış) + indirme belirteçleri + güncelleyici dosyaları + panel onayı → panel görünümü. */
export function updateStatusFrom(g: {
  readonly lease: LeaseDoc | null;
  readonly tokens: ReadonlyArray<{ yolOneki: string; belirtec: string }>;
  readonly read: UpdaterRead;
  readonly kuruluSurum: string;
  readonly nowMs: number;
  readonly approval?: Omit<UpdateApprovalView, "kullanildi"> | null;
  /** Bu backend'in paket platformu (belirteç öneki); verilmezse Windows. */
  readonly platform?: UpdatePlatform;
}): UpdateStatus {
  const { lease, read, nowMs } = g;
  const kanal = lease?.kanal.kod ?? null;
  const eff = effectiveUpdatePolicy(lease, nowMs);
  const next = eff?.politika.araliklar.find((a) => isoToMs(a.bitis) > nowMs) ?? null;
  const prefix = kanal ? backendDownloadPrefix(kanal, g.platform ?? WINDOWS_PLATFORM) : null;
  const token = decideDownloadToken({ updatesAllowed: true, prefix, tokens: g.tokens, nowMs });
  const d = read.status.kind === "ok" ? read.status.doc : null;
  const attempts = read.history.map(historyItem).filter((a): a is UpdateHistoryItem => a !== null).reverse().slice(0, UPDATER_HISTORY_LIMIT);
  const approval = g.approval ? { ...g.approval, kullanildi: read.history.some((h) => h.onayId === g.approval!.onayId) } : null;
  const updater = updaterProcess(read, nowMs);
  const policy = eff ? { kip: eff.politika.kip, pencere: eff.politika.pencere, hedefSurum: eff.politika.hedefSurum, kaynak: eff.kaynak } : null;
  const frozen = lease?.yaptirim.guncellemeDonuk === true;
  const pending = d ? pendingUpdate(d) : null;
  const last = d ? lastResult(d) : null;
  const nextWindow = next ? { baslangic: next.baslangic, bitis: next.bitis } : null;
  return {
    kuruluSurum: g.kuruluSurum,
    kanal,
    grup: updateGroupOf(kanal),
    politika: policy,
    donuk: frozen,
    sonrakiPencere: nextWindow,
    indirmeBelirteci: token.kind === "ok",
    guncelleyici: updater,
    bekleyen: pending,
    son: last,
    yerel: d
      ? {
          durum: d.durum,
          surum: valid(ReleaseVersionSchema, d.surum),
          kuruluSurum: valid(VersionTextSchema, d.kuruluSurum),
          urun: d.urun ?? null,
          adim: d.adim ?? null,
          hataKodu: code(d.hataKodu),
          mesaj: d.mesaj ?? null,
          ilerleme: d.ilerleme ?? null,
          planlanan: valid(IsoTimeSchema, d.planlanan),
          zaman: d.zaman ?? null,
          sonAyrinti: lastDetail(d),
          bilgi: updaterNotice(d),
        }
      : null,
    gecmis: attempts,
    karar: d ? currentDecision(d) : null,
    canlilik: d ? updaterLiveness(d, nowMs) : null,
    onay: approval,
    eylemler: approvalActions({
      guncelleyici: updater,
      politika: policy,
      donuk: frozen,
      bekleyen: pending,
      yerelDurum: d?.durum ?? null,
      yerelHataKodu: d ? code(d.hataKodu) : null,
      son: last,
      sonrakiPencere: nextWindow,
      onay: approval,
    }),
  };
}

/** Yürürlükteki panel onayı: EN SON kayıt; o bir geri almaysa onay yok. */
export async function activeUpdateApproval(): Promise<Omit<UpdateApprovalView, "kullanildi"> | null> {
  const row = await prisma.updateApproval.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, version: true, choice: true, approverName: true, createdAt: true, approvedById: true },
  });
  if (!row || (row.choice !== "HEMEN" && row.choice !== "PENCERE")) return null;
  return {
    onayId: row.id,
    surum: row.version,
    zamanlama: row.choice,
    onaylayan: { id: row.approvedById, ad: row.approverName },
    zaman: row.createdAt.toISOString(),
  };
}

export async function getUpdateStatus(nowMs: number = Date.now()): Promise<UpdateStatus> {
  const lease = getLicenseSnapshot(nowMs).lease?.document ?? null;
  const approval = await activeUpdateApproval();
  return updateStatusFrom({ lease, tokens: getDownloadTokens(), read: readUpdater(), kuruluSurum: APP_VERSION, nowMs, approval, platform: ownUpdatePlatform() });
}
