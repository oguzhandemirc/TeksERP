// =============================================================================
// SİSTEM KOŞUL KAYNAKLARI — bildirim kataloğu tür 1–4 (plan §4, §7 N1-KOSUL-SIS)
// =============================================================================
// Her kaynak MEVCUT sağlık/durum okuyucusunu çağırır (yüklemi kopyalamaz) ve "şu an doğru olan konu
// kümesini" döner; aç/kapa, tekrar bastırma ve kilit `notification-condition.job.ts`te.
// Ölçülemeyen kaynak (süreç yeni açıldı, dosya okunamadı) açık koşulu KORUR: sahte "Çözüldü" yok.
// Lisans/yedek/eşitleme/güncelleme davranışına dokunulmaz — yalnız okunur; payload yalnız görüntü dizesi.
// =============================================================================
import prisma from "../../lib/prisma";
import { getNotificationEntry, type NotificationKind } from "../../constants/notification-catalog";
import { factoryDateTimeTr, factoryDateTr } from "../../constants/time";
import { backupHealth } from "../../lib/health-snapshot";
import { lastOffsiteSweep } from "../helpers/offsite-backup.helper";
import { getCloudSyncStatus } from "../../jobs/cloud-sync.job";
import { getLicenseSnapshot } from "../../lib/license/runtime";
import { getUpdateStatus } from "../update-status.service";
import { registerConditionSource, type ConditionSubject } from "../../jobs/notification-condition.job";

export const SYSTEM_CONDITION_PERIOD_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const SYSTEM_CONDITION_KINDS = [
  "sistem.yedek-basarisiz",
  "sistem.esitleme-gecikti",
  "sistem.lisans-uyarisi",
  "sistem.guncelleme-onay-bekliyor",
] as const satisfies readonly NotificationKind[];

/** Okuyucuların kaynak için gereken dar yüzü — bekçi sahteyle değiştirir. */
export interface SystemSourceDeps {
  backupHealth: () => { verdict: string; reason: string };
  offsiteSweep: () => { configured: boolean; ok: boolean; missing: readonly string[] } | null;
  cloudSyncStatus: () => {
    eligible: boolean;
    blockReason: string | null;
    lastRoundAt: number | null;
    lastOutcome: { status: string } | null;
  };
  licenseSnapshot: () => {
    durumHazir: boolean;
    state: { uygulananKademe: string; nedenler: readonly { kod: string }[]; odenmisTarih: { tarihMs: number | null } | null };
  };
  updateStatus: () => Promise<{
    guncelleyici: { durum: string };
    bekleyen: { surum: string; karar: string } | null;
    onay: { surum: string } | null;
  }>;
  /** Türün katalog parametreleri (fabrika varsayılanı tablosu N4'te gelir; o zamana dek katalog varsayılanı). */
  params: (kind: NotificationKind) => Record<string, unknown>;
  now: () => number;
}

function catalogParams(kind: NotificationKind): Record<string, unknown> {
  const schema = getNotificationEntry(kind).paramSemasi;
  return schema ? (schema.parse({}) as Record<string, unknown>) : {};
}

const REAL_DEPS: SystemSourceDeps = {
  backupHealth,
  offsiteSweep: lastOffsiteSweep,
  cloudSyncStatus: getCloudSyncStatus,
  licenseSnapshot: () => getLicenseSnapshot(),
  updateStatus: () => getUpdateStatus(),
  params: catalogParams,
  now: Date.now,
};

let deps: SystemSourceDeps = REAL_DEPS;

/** Bekçi enjeksiyonu: verilen okuyucuları değiştirir, geri alma fonksiyonu döner. */
export function overrideSystemSourceDeps(p: Partial<SystemSourceDeps>): () => void {
  const previous = deps;
  deps = { ...deps, ...p };
  return () => {
    deps = previous;
  };
}

/** Ölçülemeyen konu: yalnız ŞU AN AÇIKSA doğru sayılır (açık kalır; kapalıysa açılmaz). */
async function keepIfOpen(kind: NotificationKind, keys: string[]): Promise<ConditionSubject[]> {
  const rows = await prisma.notificationCondition.findMany({
    where: { kind, resolvedAt: null, subjectKey: { in: keys } },
    select: { subjectKey: true, subjectType: true, subjectId: true, payload: true },
  });
  return rows.map((r) => ({
    key: r.subjectKey,
    type: r.subjectType,
    id: r.subjectId,
    payload: (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<string, unknown>,
  }));
}

function subject(key: string, payload: Record<string, string>): ConditionSubject {
  return { key, type: "sistem", id: null, payload };
}

// ── 1 · Yedek alınamadı ─────────────────────────────────────────────────────────────────────────
export async function backupSubjects(): Promise<ConditionSubject[]> {
  const out: ConditionSubject[] = [];
  const h = deps.backupHealth();
  if (h.verdict === "uyari" || h.verdict === "kritik") {
    out.push(subject("gece", { kaynak: "gece", kaynakAd: "Gece", neden: h.reason }));
  }
  const o = deps.offsiteSweep();
  if (o === null) {
    out.push(...(await keepIfOpen("sistem.yedek-basarisiz", ["offsite"])));
  } else if (o.configured && !o.ok) {
    const reason = o.missing.length > 0 ? `${o.missing.length} yedek dosyası uzak hedefe kopyalanmamış` : "uzak hedefe kopyalama başarısız";
    out.push(subject("offsite", { kaynak: "offsite", kaynakAd: "Makine dışı", neden: reason }));
  }
  return out;
}

// ── 2 · Eşitleme late ────────────────────────────────────────────────────────────────────────
// Durum anlık görüntüdür ("son tur"); "son başarılı" ve ardışık hata sayısı turlar izlenerek tutulur.
interface SyncTrace {
  ilkUygunMs: number | null;
  sonTurMs: number | null;
  sonBasariliMs: number | null;
  ardisikHata: number;
}
let trace: SyncTrace = { ilkUygunMs: null, sonTurMs: null, sonBasariliMs: null, ardisikHata: 0 };
export function resetSyncTrace(): void {
  trace = { ilkUygunMs: null, sonTurMs: null, sonBasariliMs: null, ardisikHata: 0 };
}

const ROUND_STATUS_TEXT: Record<string, string> = {
  HATA: "son eşitleme turu hata verdi",
  KISMI: "son eşitleme turu kısmen kabul edildi",
  TAMAM: "son tur başarılı, ancak yeni tur yapılmadı",
  GONDERILMEDI: "eşitleme turu gönderilemedi",
};

export async function syncSubjects(): Promise<ConditionSubject[]> {
  const kind = "sistem.esitleme-gecikti";
  const st = deps.cloudSyncStatus();
  // Açılıştaki ilk ölçümden önce `eligible:false` + neden yok: bilinmiyor, "bulut kapalı" değil.
  if (!st.eligible && st.blockReason === null) return keepIfOpen(kind, ["bulut"]);
  if (!st.eligible) {
    resetSyncTrace();
    return [];
  }
  const now = deps.now();
  if (trace.ilkUygunMs === null) trace.ilkUygunMs = now;
  if (st.lastRoundAt !== null && st.lastRoundAt !== trace.sonTurMs) {
    trace.sonTurMs = st.lastRoundAt;
    const s = st.lastOutcome?.status;
    if (s === "TAMAM") {
      trace.sonBasariliMs = st.lastRoundAt;
      trace.ardisikHata = 0;
    } else if (s === "HATA" || s === "KISMI") {
      trace.ardisikHata++;
    }
  }
  const thresholdMs = Number(deps.params(kind).dakika ?? 30) * 60_000;
  const late = now - (trace.sonBasariliMs ?? trace.ilkUygunMs) > thresholdMs;
  // Tek hatalı tur geçici olabilir; "sürüyor" = art arda iki tur.
  const failing = trace.ardisikHata >= 2;
  if (!late && !failing) return [];
  const lastStatus = st.lastOutcome?.status;
  return [subject("bulut", {
    sonBasarili: trace.sonBasariliMs === null ? "bu açılıştan beri yok" : factoryDateTimeTr(new Date(trace.sonBasariliMs)),
    durum: (lastStatus && ROUND_STATUS_TEXT[lastStatus]) ?? "henüz eşitleme turu yapılmadı",
  })];
}

// ── 3 · Lisans uyarısı ──────────────────────────────────────────────────────────────────────────
// Panel `Electron/src/pages/System/License/labels.ts` REASON_LABEL'ın aynası (istemci kodu sunucuya alınamaz).
const LICENSE_REASON_TEXT: Record<string, string> = {
  HAK_YOK: "Lisans hakkı yok",
  HAK_GECERSIZ: "Lisans hakkı doğrulanamadı",
  HAK_KURULUM_UYUSMAZ: "Lisans hakkı başka bir kuruluma ait",
  KIRA_YOK: "Kira yok (kurulum etkinleşmemiş)",
  KIRA_GECERSIZ: "Kira doğrulanamadı",
  KIRA_BAG_UYUSMAZ: "Kira bu kuruluma/hakka bağlı değil",
  PARMAK_IZI_UYUSMAZ: "Makine parmak izi uyuşmuyor",
  PARMAK_IZI_OLCULEMEDI: "Makine parmak izi ölçülemedi",
  BUTUNLUK_GECERSIZ: "Program bütünlüğü bozuk",
  BUTUNLUK_OLCULEMEDI: "Program bütünlüğü ölçülemedi",
  SAAT_ILERI: "Sistem saati ileri",
  SAAT_GERI: "Sistem saati geri",
  DURUM_DOSYASI: "Durum kaydı okunamadı",
  ILK_ACILIS_BILINMIYOR: "İlk açılış tarihi bilinmiyor",
  KIRA_SURESI_DOLDU: "Kira süresi doldu",
  VADE_DOLDU: "Vade doldu",
  ODENMIS_TARIH_DOLDU: "Ödenmiş lisans süresi doldu",
  ODEME_YAKLASIYOR: "Ödenmiş lisans süresi bitiyor",
  KIRASIZ_EK_SURE: "Kirasız ek süre",
  ETKINLESTIRME_EK_SURESI: "Etkinleştirme ek süresi",
  EK_SURE_BITTI: "Ek süre bitti",
  YAPTIRIM: "Satıcı yaptırımı",
  MODUL_DONDURULDU: "Modül donduruldu",
  GUNCELLEME_DONDURULDU: "Güncellemeler donduruldu",
  DEVREDILDI: "Üretim DR sunucusuna devredildi",
  BAKIM_BITIYOR: "Bakım süresi bitiyor",
  BAKIM_BITTI: "Bakım süresi bitti",
  BAKIM_IHLALI: "Bakım sonrası derlenmiş sürüm",
  DERLEME_TARIHI_YOK: "Derleme tarihi yok (bakım değerlendirilmedi)",
  KIRA_GERI_ALINDI: "Lisans dosyaları eski bir kopyayla değiştirilmiş (geri alma)",
  DEPO_OKUNAMADI: "Lisans dosyası okunamadı",
  SAAT_KAYIK: "Sistem saati lisans sunucusundan kayık",
  LISANS_IZI_KAYIP: "Lisans izlerinden biri kayıp",
  LISANS_IZI_CELISKI: "Lisans izleri birbiriyle çelişiyor",
  BELIRSIZLIK_SURUYOR: "Lisans durumu uzun süredir ölçülemiyor",
  IPTAL_BELGESI_KAYIP: "İptal belgesi kayıp",
  GECICI_KOD_BITIYOR: "Geçici açılış kodu bitiyor",
  GECICI_KOD_BITTI: "Geçici açılış kodunun süresi doldu",
};

export async function licenseSubjects(): Promise<ConditionSubject[]> {
  const kind = "sistem.lisans-uyarisi";
  const snap = deps.licenseSnapshot();
  if (!snap.durumHazir) {
    const openRows = await prisma.notificationCondition.findMany({ where: { kind, resolvedAt: null }, select: { subjectKey: true } });
    return keepIfOpen(kind, openRows.map((r) => r.subjectKey));
  }
  const out: ConditionSubject[] = [];
  const tier = snap.state.uygulananKademe;
  if (tier !== "NORMAL") {
    const codes = [...new Set(snap.state.nedenler.map((n) => n.kod))];
    if (codes.length === 0) codes.push(`KADEME_${tier}`);
    for (const k of codes) out.push(subject(k, { nedenKodu: k, neden: LICENSE_REASON_TEXT[k] ?? `Lisans kademesi: ${tier}` }));
  }
  const endMs = snap.state.odenmisTarih?.tarihMs ?? null;
  const days = Number(deps.params(kind).gun ?? 14);
  const now = deps.now();
  if (endMs !== null && endMs - now <= days * DAY_MS) {
    const dateText = factoryDateTr(new Date(endMs));
    out.push(subject("bitis-yakin", {
      nedenKodu: "bitis-yakin",
      neden: endMs > now ? `Lisans süresi ${dateText} tarihinde bitiyor` : `Lisans süresi ${dateText} tarihinde bitti`,
    }));
  }
  return out;
}

// ── 4 · Güncelleme onay bekliyor ────────────────────────────────────────────────────────────────
export async function updateSubjects(): Promise<ConditionSubject[]> {
  const kind = "sistem.guncelleme-onay-bekliyor";
  const u = await deps.updateStatus();
  const b = u.bekleyen;
  if (b === null) {
    if (u.guncelleyici.durum !== "OLCULEMEDI") return [];
    const openRows = await prisma.notificationCondition.findMany({ where: { kind, resolvedAt: null }, select: { subjectKey: true } });
    return keepIfOpen(kind, openRows.map((r) => r.subjectKey));
  }
  if (b.karar !== "ONAY_BEKLIYOR" || u.onay?.surum === b.surum) return [];
  return [subject(b.surum, { surum: b.surum })];
}

export const SYSTEM_SOURCE_EVALUATORS: Record<(typeof SYSTEM_CONDITION_KINDS)[number], () => Promise<ConditionSubject[]>> = {
  "sistem.yedek-basarisiz": backupSubjects,
  "sistem.esitleme-gecikti": syncSubjects,
  "sistem.lisans-uyarisi": licenseSubjects,
  "sistem.guncelleme-onay-bekliyor": updateSubjects,
};

/** Dört kaynağı tarayıcıya kaydeder (tekrar çağrı aynı kaydı yeniler). */
export function registerSystemConditionSources(): void {
  for (const kind of SYSTEM_CONDITION_KINDS) {
    registerConditionSource({ kind, periodMs: SYSTEM_CONDITION_PERIOD_MS, evaluate: () => SYSTEM_SOURCE_EVALUATORS[kind]() });
  }
}
