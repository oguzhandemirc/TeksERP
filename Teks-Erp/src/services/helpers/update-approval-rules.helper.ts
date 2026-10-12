// =============================================================================
// GÜNCELLEME ONAYI KURALLARI (Dağıtım v2 — docs/design/GUNCELLEYICI.md §3 madde 2 · §5.1) — SAF
// =============================================================================
// Hangi panel onayının verilebileceği TEK yüklemdir: panelin düğmeleri (`UpdateStatus.eylemler`) ve
// `POST /api/guncelleme/onay`ın kapısı aynı fonksiyondan okur. Onay yetki değildir: DONDUR · K1 · kira yok
// hâlinde verilmez; güncelleyici onu yalnız AYNI sürümün imzalı adayına sayar.
// =============================================================================
import { msToIso, type ApprovalTiming, type LeaseUpdatePolicy, type UpdateResult } from "../../lib/license/protocol";
import type { PendingUpdateView, UpdaterProcessView } from "../update-status.service";

export const UPDATE_APPROVAL_CHOICES = ["HEMEN", "PENCERE", "GERI_AL"] as const;
export type UpdateApprovalChoice = (typeof UPDATE_APPROVAL_CHOICES)[number];

export interface UpdateApprovalView {
  readonly onayId: string;
  readonly surum: string;
  readonly zamanlama: ApprovalTiming;
  readonly onaylayan: { readonly id: string; readonly ad: string };
  readonly zaman: string;
  /** Onayın güncelleyiciye ulaştığı an (`zaman` + ön duyuru): o ana dek niyete yazılmaz, ekranlar uyarılır. */
  readonly yururluk: string;
  /** Bu onayla başlamış bir işlem sonuçlandı mı — sonuçlandıysa aynı onay bir daha sayılmaz. */
  readonly kullanildi: boolean;
}

/** Satırdan okunan onay (türetilen alanlar — `kullanildi`, `yururluk` — yok). */
export type UpdateApprovalRecord = Omit<UpdateApprovalView, "kullanildi" | "yururluk">;

/** Onaydan kuruluma dek ön duyuru: panel ve tablet ekranları kaydedilmemiş işi bu sürede kaydeder. */
export const UPDATE_APPROVAL_NOTICE_MS = 5 * 60 * 1000;
/** Planlanan an bu kadar geçtiyse ve kurulum başlamadıysa duyuru bayattır (güncelleyici beklemede/arızada). */
export const UPDATE_OUTAGE_STALE_MS = 15 * 60 * 1000;

/** Onayın yürürlüğe girdiği an (ms) — şemasız, satırın `createdAt`inden türer. */
export function approvalEffectiveAtMs(zaman: string): number {
  return Date.parse(zaman) + UPDATE_APPROVAL_NOTICE_MS;
}

/** Ekranlara duyurulan kesinti: `planlanan` mutlak an, `kalanSn` istemcinin yerel saatine çevirdiği süre (saat sapmasından bağımsız). */
export interface PlannedOutage {
  readonly planlanan: string | null;
  readonly kalanSn: number;
  readonly suruyor: boolean;
}

export interface PlannedOutageInput {
  readonly onay: UpdateApprovalView | null;
  readonly bekleyen: PendingUpdateView | null;
  readonly yerel: { readonly durum: string; readonly planlanan: string | null; readonly zaman: string | null } | null;
  readonly sonrakiPencere: { readonly baslangic: string } | null;
  readonly nowMs: number;
}

function outageStartMs(g: PlannedOutageInput): number | null {
  const o = g.onay && !g.onay.kullanildi && (g.bekleyen === null || g.bekleyen.surum === g.onay.surum) ? g.onay : null;
  const effective = o ? Date.parse(o.yururluk) : null;
  const windowStart = g.yerel?.planlanan ?? g.sonrakiPencere?.baslangic ?? null;
  if (o && o.zamanlama === "HEMEN") return effective;
  if (o && o.zamanlama === "PENCERE") return windowStart === null ? null : Math.max(effective!, Date.parse(windowStart));
  if (g.bekleyen?.karar === "PENCERE_BEKLIYOR" && g.yerel?.planlanan) return Date.parse(g.yerel.planlanan);
  return null;
}

/**
 * Sunucunun ne zaman kesileceği (SAF): HEMEN → yürürlük; PENCERE → max(yürürlük, pencere başı); onaysız pencere →
 * güncelleyicinin `planlanan`ı; uygulanıyor → sürüyor. Kullanılmış onay, başka sürüme ait onay ve bayat an → yok.
 */
export function plannedOutage(g: PlannedOutageInput): PlannedOutage | null {
  if (g.yerel?.durum === "UYGULANIYOR") {
    const at = g.yerel.zaman ? Date.parse(g.yerel.zaman) : NaN;
    return Number.isFinite(at) && g.nowMs - at > UPDATE_OUTAGE_STALE_MS ? null : { planlanan: null, kalanSn: 0, suruyor: true };
  }
  const start = outageStartMs(g);
  if (start === null || !Number.isFinite(start) || g.nowMs - start > UPDATE_OUTAGE_STALE_MS) return null;
  return { planlanan: msToIso(start), kalanSn: Math.max(0, Math.ceil((start - g.nowMs) / 1000)), suruyor: false };
}

export interface UpdateActions {
  readonly hemen: boolean;
  readonly pencere: boolean;
  readonly geriAl: boolean;
  /** Onayın bağlanacağı sürüm: güncelleyicinin doğruladığı aday (insan gerektiren hatada son denemenin hedefi). */
  readonly hedefSurum: string | null;
  /** Onay verilemiyorsa neden (ekranda gösterilir). */
  readonly neden: string | null;
}

export interface ApprovalActionInput {
  readonly guncelleyici: UpdaterProcessView;
  readonly politika: { readonly kip: LeaseUpdatePolicy["kip"] } | null;
  readonly donuk: boolean;
  readonly bekleyen: PendingUpdateView | null;
  readonly yerelDurum: string | null;
  /** Güncelleyicinin şu anki sorunu (`durum.hataKodu`; ör. DISK_DOLU) — onaylı sürüm neden kurulmuyor. */
  readonly yerelHataKodu?: string | null;
  readonly son: UpdateResult | null;
  readonly sonrakiPencere: { readonly baslangic: string; readonly bitis: string } | null;
  readonly onay: UpdateApprovalView | null;
}

/**
 * Güncelleyicinin KENDİSİ çalışmıyor (`onar`ın görünür arızaları, plan GUNCELLEYICI-SAGLAMLIK §4.7): onay verilse de
 * okuyacak süreç yok — "son denemenin sürümüne yeni onay" (insan gerektiren HATA) bu durumda sunulmaz.
 */
const UPDATER_DOWN_REASONS: Readonly<Record<string, string>> = {
  ONARIM_TAVANI: "Güncelleme programı 24 saat içinde tekrar tekrar bozuldu; otomatik onarım durdu — müdahale gerekiyor.",
  ONARIM_KAYNAK_YOK: "Güncelleme programının dosyası eksik ya da bozuk ve onarmak için doğrulanmış kopya yok — yeniden kurulum gerekiyor.",
  GUNCELLEYICI_KAPALI: "Güncelleme programı hizmeti kapatılmış ya da kaldırılmış — yeniden açılmadıkça güncelleme yapılmaz.",
};

/** `durum.hataKodu` güncelleyicinin kendisinin çalışmadığını mı söylüyor (tek kaynak: `UPDATER_DOWN_REASONS`). */
export function updaterDownReason(hataKodu: string | null | undefined): string | null {
  return hataKodu ? (UPDATER_DOWN_REASONS[hataKodu] ?? null) : null;
}

/**
 * Karar KUR ama uygulama başlamadı: güncelleyici yerel bir engeli bekliyor (D8b: disk doluyken HEMEN onayından
 * sonra "şu an kuruluyor" denirdi). Uygulanıyorsa bu yola gelinmez (approvalActions önce keser).
 */
function installWaitingReason(surum: string, onayli: boolean, yerelDurum: string | null, hataKodu: string | null): string {
  const bas = `${surum} ${onayli ? "onaylandı" : "kurulacak"};`;
  if (hataKodu === "DISK_DOLU") return `${bas} diskte yer olmadığı için bekliyor — yer açılınca kendiliğinden kurulur.`;
  if (hataKodu === "SEMA_ILERIDE") return `${bas} veritabanı bu sürümün tanımadığı göçler taşıdığı için kurulmuyor (paket şemanın gerisinde, geri indirme yapılmaz) — bu göçleri taşıyan daha yeni bir sürüm gerekir.`;
  if (hataKodu === "DOSYA_KILITLI") return `${bas} bir dosya başka bir program tarafından kullanıldığı için bekliyor — kilit kalkınca kendiliğinden sürer.`;
  if (hataKodu) return `${bas} güncelleyici bekliyor (${hataKodu}) — sorun giderilince kendiliğinden kurulur.`;
  if (yerelDurum === "INDIRILIYOR") return `${bas} paket indiriliyor.`;
  return `${bas} kurulum birazdan başlar.`;
}

function noTargetReason(p: PendingUpdateView | null, onayli: boolean, yerelDurum: string | null, hataKodu: string | null): string {
  if (p === null) return "Kurulacak yeni sürüm yok.";
  switch (p.karar) {
    case "GUNCEL":
      return "Kurulu sürüm güncel.";
    case "KUR":
      return installWaitingReason(p.surum, onayli, yerelDurum, hataKodu);
    case "DONDURULDU":
      return `Güncelleme durduruldu${p.neden ? ` (${p.neden})` : ""}.`;
    case "UYGUN_DEGIL":
      return `${p.surum} bu kuruluma uygun değil${p.neden ? ` (${p.neden})` : ""}.`;
    default:
      return "Onay beklenmiyor.";
  }
}

/**
 * Hangi onaylar verilebilir (SAF; panel düğmeleri ve POST kapısı aynı yüklemden). Onay yetki DEĞİLDİR — yalnız
 * güncelleyicinin doğruladığı adayın zamanlamasını seçer; DONDUR · K1 · kira yok hâlinde hiç verilmez.
 */
export function approvalActions(s: ApprovalActionInput): UpdateActions {
  const active = s.onay && !s.onay.kullanildi ? s.onay : null;
  const withdraw = active !== null && s.yerelDurum !== "UYGULANIYOR";
  const none = (neden: string, geriAl = false): UpdateActions => ({ hemen: false, pencere: false, geriAl, hedefSurum: null, neden });
  if (s.guncelleyici.durum === "YOK") return none("Bu sunucuda güncelleyici kurulu değil.");
  const down = updaterDownReason(s.yerelHataKodu);
  if (down !== null) return none(down, withdraw);
  if (s.yerelDurum === "UYGULANIYOR") return none("Güncelleme şu an uygulanıyor.");
  if (s.politika === null) return none("Geçerli kira yok; güncelleme kapalı.", withdraw);
  if (s.donuk) return none("Güncellemeler lisans yaptırımıyla durduruldu.", withdraw);
  if (s.politika.kip === "DONDUR") return none("Güncellemeler satıcı tarafından donduruldu.", withdraw);
  const awaiting = s.bekleyen !== null && (s.bekleyen.karar === "ONAY_BEKLIYOR" || s.bekleyen.karar === "PENCERE_BEKLIYOR");
  // Geri dönüş de tamamlanamadıysa (HATA) güncelleyici yeni bir panel onayı gelene dek hiçbir şey yapmaz (§5.1).
  const humanRetry = !awaiting && s.yerelDurum === "HATA" && s.son !== null;
  const target = awaiting ? s.bekleyen!.surum : humanRetry ? s.son!.hedefSurum : null;
  if (target === null) {
    const onayli = active !== null && active.surum === s.bekleyen?.surum;
    return none(noTargetReason(s.bekleyen, onayli, s.yerelDurum, s.yerelHataKodu ?? null), withdraw);
  }
  const already = (t: ApprovalTiming) => active !== null && active.surum === target && active.zamanlama === t;
  const needsApproval = humanRetry || s.bekleyen?.karar === "ONAY_BEKLIYOR";
  return {
    hemen: !already("HEMEN"),
    pencere: needsApproval && s.sonrakiPencere !== null && !already("PENCERE"),
    geriAl: withdraw,
    hedefSurum: target,
    neden: null,
  };
}
