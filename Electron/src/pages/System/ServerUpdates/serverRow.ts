import type { CalloutTone } from "@/components/ui/callout";
import type { UpdateSummary } from "@/types/server-update";
import { when } from "../License/LicenseParts";
import { decisionText, progressPercent } from "./labels";

// Güncellemeler sayfasının "Sunucu" satırı — durum TEK yerde türetilir. Girdi özet (`/ozet`) ya da tam durum
// (`/durum`, özetin üst kümesi); panel karar üretmez, güncelleyicinin yazdığını tek cümleye indirir.

/** Sorunun tek eylemi: durumu yeniden oku · destek iste (eylem yoksa null). */
export type ProblemAction = "retry" | "support" | null;

export interface ServerProblem {
  readonly text: string;
  readonly action: ProblemAction;
}

export interface ServerRowState {
  readonly label: string;
  readonly tone: CalloutTone;
  /** Yeni sürüm yetkili onayını bekliyor (yetkiliye "Şimdi kur"/"Bu gece kur", ötekine "Yöneticiniz onaylayacak"). */
  readonly awaitingApproval: boolean;
  /** Durumun kısa gerekçesi (ör. "Güncelleme penceresini bekliyor") — yalnız yeni sürüm varken. */
  readonly hint: string | null;
  readonly problem: ServerProblem | null;
}

const problem = (label: string, text: string, action: ProblemAction, tone: CalloutTone): ServerRowState => ({
  label,
  tone,
  awaitingApproval: false,
  hint: null,
  problem: { text, action },
});

/** Durum okunamadı (ağ · eski backend · yetki) — satır yine çizilir, tek eylem "Yeniden dene". */
export const UNREADABLE: ServerRowState = problem("Sorun", "Sunucunun güncelleme durumu okunamadı.", "retry", "warning");

/** Sıra yük taşır: müdahale isteyen sorun → yürüyen iş → bekleyen sürüm → güncel. */
export function serverRowState(s: UpdateSummary): ServerRowState {
  const g = s.guncelleyici.durum;
  if (g === "DURDU") return problem("Sorun", "Son güncelleme geri alınamadı — destekle görüşmeden yeniden denemeyin.", "support", "danger");
  if (s.donuk) return problem("Durduruldu", "Güncellemeler lisans nedeniyle durduruldu — satıcıyla görüşün.", "support", "warning");
  if (g === "OLCULEMEDI") return problem("Sorun", "Güncelleyici yanıt vermiyor — sunucuda “TeksERP-Guncelleyici” hizmetinin çalıştığını denetleyin.", "retry", "warning");
  if (g === "YOK") return problem("Güncelleyici yok", "Bu sunucuda güncelleyici kurulu değil — sunucu kurulum programıyla güncellenir.", null, "muted");
  const base = { awaitingApproval: false, hint: null, problem: null } as const;
  const y = s.yerel;
  if (y?.durum === "INDIRILIYOR") {
    const pct = progressPercent(y.ilerleme);
    return { ...base, label: pct === null ? "İndiriliyor" : `İndiriliyor %${pct}`, tone: "info" };
  }
  const newer = s.bekleyen && s.bekleyen.surum !== s.kuruluSurum ? s.bekleyen : null;
  if (y?.durum === "UYGULANIYOR" || newer?.karar === "KUR") return { ...base, label: "Kuruluyor", tone: "info" };
  if (newer?.karar === "ONAY_BEKLIYOR") return { ...base, label: `Onay bekliyor — ${newer.surum}`, tone: "warning", awaitingApproval: true };
  if (newer) return { ...base, label: `Yeni sürüm ${newer.surum}`, tone: "info", hint: decisionText(newer.karar, newer.neden) };
  return { ...base, label: "✓ Güncel", tone: "success" };
}

/** "Son güncelleme: 12.10.2026 03:10 · Sunucu 2.15.0 ✓" — saat fabrika diliminden (`when`). */
export function lastUpdateText(son: UpdateSummary["son"]): string {
  if (!son) return "Son güncelleme: henüz yok";
  return `Son güncelleme: ${when(son.bitis)} · Sunucu ${son.hedefSurum} ${son.sonuc === "BASARILI" ? "✓" : "✗"}`;
}
