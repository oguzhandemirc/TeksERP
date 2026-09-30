// =============================================================================
// GÜNCELLEME DURUMU (Dağıtım v2 — docs/design/GUNCELLEYICI.md §3.1 · §3.2)
// =============================================================================
// Panelin `GET /api/guncelleme/durum`u ile yoklamanın `guncelleme` raporu TEK eşlemeden doğar:
// kiradaki politika (satıcı imzalı) + güncelleyicinin durum/geçmiş dosyaları (D2 §5). Güncelleyicinin
// kendi kodları raporun sözlüğüne burada çevrilir. Rapor KATI şemadan geçmezse GÖNDERİLMEZ — yoklama
// hiçbir zaman bu rapor yüzünden düşmez; güncelleyici yoksa alan hiç gitmez (eski satıcı uyumu).
// =============================================================================
import { APP_VERSION } from "../lib/app-version";
import { getFactoryTimezone } from "../constants/time";
import {
  IsoTimeSchema,
  ReleaseVersionSchema,
  UpdateReportSchema,
  UuidSchema,
  VersionTextSchema,
  effectiveUpdatePolicy,
  isoToMs,
  type LeaseDoc,
  type LeaseUpdatePolicy,
  type UpdateDecisionKind,
  type UpdateReport,
  type UpdateResult,
  type UpdateWindowRule,
  type UPDATER_STATES,
} from "../lib/license/protocol";
import { getDownloadTokens, getLicenseSnapshot } from "../lib/license/runtime";
import { UPDATER_HISTORY_LIMIT, readUpdater, type UpdaterHistoryLine, type UpdaterRead, type UpdaterStatusDoc } from "../lib/license/updater-ipc";
import { decideDownloadToken } from "./license-view.service";

type UpdaterState = (typeof UPDATER_STATES)[number];

const CODE = /^[A-Z0-9_]{2,40}$/;
/** Güncelleyicinin henüz sonuçlanmamış iş durumları: `surum` bekleyen adaydır. */
const PENDING_STATES: ReadonlySet<string> = new Set(["BEKLIYOR", "INDIRILIYOR", "HAZIR", "UYGULANIYOR"]);
/** Güncelleyici kodu → raporun karar sözlüğü (karar · neden); listede yoksa UYGUN_DEGIL + kodun kendisi. */
const BLOCK_REASONS: Readonly<Record<string, readonly [UpdateDecisionKind, string]>> = {
  POLITIKA_DONDUR: ["DONDURULDU", "POLITIKA"],
  YAPTIRIM_DONUK: ["DONDURULDU", "YAPTIRIM"],
  KIRA_YOK: ["DONDURULDU", "KIRA_YOK"],
  KIRA_GECERSIZ: ["DONDURULDU", "KIRA_YOK"],
  KIRA_SURESI_DOLDU: ["DONDURULDU", "KIRA_YOK"],
  SURUM_IZINSIZ: ["UYGUN_DEGIL", "HEDEF_DISI"],
  KAYNAK_SURUM_ESKI: ["UYGUN_DEGIL", "KAYNAK_SURUM_ESKI"],
  PG_SURUM_ESKI: ["UYGUN_DEGIL", "PG_SURUMU_ESKI"],
  PG_BUYUK_SURUM: ["UYGUN_DEGIL", "PG_ANA_SURUM"],
};
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

/** Güncelleyici süreci: dosya yok → YOK · okunamıyor → OLCULEMEDI · HATA (insan gerekir) → DURDU. */
export function updaterProcess(read: UpdaterRead): UpdaterProcessView {
  if (read.status.kind === "missing") return { durum: "YOK", surum: null };
  if (read.status.kind === "invalid") return { durum: "OLCULEMEDI", surum: null };
  const d = read.status.doc;
  return { durum: d.durum === "HATA" ? "DURDU" : "CALISIYOR", surum: valid(VersionTextSchema, d.guncelleyiciSurum) };
}

/** Bekleyen aday ve kararı — güncelleyicinin durumundan (karar onundur; burada yalnız sözlük çevrilir). */
export function pendingUpdate(d: UpdaterStatusDoc): PendingUpdateView | null {
  const version = valid(ReleaseVersionSchema, d.surum);
  if (!version || !PENDING_STATES.has(d.durum) || version === d.kuruluSurum) return null;
  if (d.durum === "UYGULANIYOR") return { surum: version, karar: "KUR", neden: null };
  const blocked = d.politika?.izin === false ? (code(d.politika.neden) ?? code(d.hataKodu) ?? "POLITIKA_DONDUR") : d.durum === "BEKLIYOR" ? code(d.hataKodu) : null;
  if (blocked) {
    const [decision, reason] = BLOCK_REASONS[blocked] ?? ["UYGUN_DEGIL", blocked];
    return { surum: version, karar: decision, neden: reason };
  }
  const awaitingApproval = d.politika?.kip === "ONAYLI" && !d.planlanan;
  return { surum: version, karar: awaitingApproval ? "ONAY_BEKLIYOR" : "PENCERE_BEKLIYOR", neden: null };
}

/** Geçmiş satırı → raporun sonucu; backend dışı (PG) ya da biçimsiz satır null. */
export function attemptOf(h: UpdaterHistoryLine): UpdateResult | null {
  const result = RESULT_OF[h.sonuc];
  if (h.urun !== "backend" || !result) return null;
  const r = {
    kayitId: h.islemId,
    hedefSurum: h.surum,
    kaynakSurum: valid(VersionTextSchema, h.kaynakSurum),
    sonuc: result,
    kod: result === "BASARILI" ? null : (code(h.hataKodu) ?? "BILINMEYEN"),
    baslangic: h.basladi,
    bitis: h.bitti,
    veriGeriYuklendi: h.veriGeriYuklendi === true,
  };
  const ok =
    UuidSchema.safeParse(r.kayitId).success && ReleaseVersionSchema.safeParse(r.hedefSurum).success &&
    IsoTimeSchema.safeParse(r.baslangic).success && IsoTimeSchema.safeParse(r.bitis).success && isoToMs(r.bitis) >= isoToMs(r.baslangic);
  return ok ? r : null;
}

/** Son TAMAMLANAN backend denemesi. */
export function lastAttempt(history: readonly UpdaterHistoryLine[]): UpdateResult | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const a = attemptOf(history[i]!);
    if (a) return a;
  }
  return null;
}

/** Yoklama raporu (§3.1): güncelleyici yoksa ya da KATI şemadan geçmezse null (alan gönderilmez). */
export function buildUpdateReport(read: UpdaterRead, saatDilimi: string): UpdateReport | null {
  if (read.status.kind === "missing") return null;
  const report = {
    saatDilimi,
    guncelleyici: updaterProcess(read),
    bekleyen: read.status.kind === "ok" ? pendingUpdate(read.status.doc) : null,
    son: lastAttempt(read.history),
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
  readonly politika: (Omit<LeaseUpdatePolicy, "araliklar"> & { readonly pencere: UpdateWindowRule | null; readonly kaynak: "KIRA" | "VARSAYILAN" }) | null;
  readonly donuk: boolean;
  readonly sonrakiPencere: { readonly baslangic: string; readonly bitis: string } | null;
  readonly indirmeBelirteci: boolean;
  readonly guncelleyici: UpdaterProcessView;
  readonly bekleyen: PendingUpdateView | null;
  readonly son: UpdateResult | null;
  /** Güncelleyicinin yerel durumu (ilerleme, adım, ileti) — dosya okunamıyorsa null. */
  readonly yerel: {
    readonly durum: string;
    readonly surum: string | null;
    readonly kuruluSurum: string | null;
    readonly adim: string | null;
    readonly hataKodu: string | null;
    readonly mesaj: string | null;
    readonly ilerleme: { readonly indirilen: number; readonly toplam: number } | null;
    readonly planlanan: string | null;
    readonly zaman: string | null;
  } | null;
  /** Son backend denemeleri, en yeni önce. */
  readonly gecmis: UpdateResult[];
}

/** Saf: kira (imzalı, doğrulanmış) + indirme belirteçleri + güncelleyici dosyaları → panel görünümü. */
export function updateStatusFrom(g: {
  readonly lease: LeaseDoc | null;
  readonly tokens: ReadonlyArray<{ yolOneki: string; belirtec: string }>;
  readonly read: UpdaterRead;
  readonly kuruluSurum: string;
  readonly nowMs: number;
}): UpdateStatus {
  const { lease, read, nowMs } = g;
  const kanal = lease?.kanal.kod ?? null;
  const eff = effectiveUpdatePolicy(lease, nowMs);
  const next = eff?.politika.araliklar.find((a) => isoToMs(a.bitis) > nowMs) ?? null;
  const token = decideDownloadToken({ updatesAllowed: true, prefix: kanal ? `/${kanal}/backend/` : null, tokens: g.tokens, nowMs });
  const d = read.status.kind === "ok" ? read.status.doc : null;
  const attempts = read.history.map(attemptOf).filter((a): a is UpdateResult => a !== null);
  return {
    kuruluSurum: g.kuruluSurum,
    kanal,
    politika: eff ? { kip: eff.politika.kip, pencere: eff.politika.pencere, hedefSurum: eff.politika.hedefSurum, kaynak: eff.kaynak } : null,
    donuk: lease?.yaptirim.guncellemeDonuk === true,
    sonrakiPencere: next ? { baslangic: next.baslangic, bitis: next.bitis } : null,
    indirmeBelirteci: token.kind === "ok",
    guncelleyici: updaterProcess(read),
    bekleyen: d ? pendingUpdate(d) : null,
    son: lastAttempt(read.history),
    yerel: d
      ? {
          durum: d.durum,
          surum: d.surum ?? null,
          kuruluSurum: d.kuruluSurum ?? null,
          adim: d.adim ?? null,
          hataKodu: d.hataKodu ?? null,
          mesaj: d.mesaj ?? null,
          ilerleme: d.ilerleme ?? null,
          planlanan: d.planlanan ?? null,
          zaman: d.zaman ?? null,
        }
      : null,
    gecmis: attempts.reverse().slice(0, UPDATER_HISTORY_LIMIT),
  };
}

export function getUpdateStatus(nowMs: number = Date.now()): UpdateStatus {
  const lease = getLicenseSnapshot(nowMs).lease?.document ?? null;
  return updateStatusFrom({ lease, tokens: getDownloadTokens(), read: readUpdater(), kuruluSurum: APP_VERSION, nowMs });
}
