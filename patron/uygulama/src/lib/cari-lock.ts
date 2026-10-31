// Cari kilidi görünümü (D4-I6): `cari-hesap.kilit` fabrikadan gelir; uygulama yalnız etiketler, karar vermez.
// Alan YOKSA fabrika eski sürümdedir ("güncellenince gelir"); null ya da ACILDI → rozet yok.
import { CARI_LOCK_REASON_LABELS, CARI_LOCK_SCOPE_LABELS } from "../api/wire";
import { fmtFactoryDateTime } from "./factory-time";

export type CariLockView =
  | { readonly state: "BILINMIYOR"; readonly text: string }
  | { readonly state: "YOK" }
  | { readonly state: "KILITLI"; readonly label: string; readonly text: string };

export function cariLockView(kayit: Readonly<Record<string, unknown>>): CariLockView {
  if (!("kilit" in kayit)) return { state: "BILINMIYOR", text: "Kilit bilgisi fabrika güncellenince gelir" };
  const k = kayit.kilit;
  if (!k || typeof k !== "object" || Array.isArray(k)) return { state: "YOK" };
  const o = k as Record<string, unknown>;
  if (o.durum !== "AKTIF") return { state: "YOK" };
  const scope = (Array.isArray(o.kapsam) ? o.kapsam : []).map((s) => CARI_LOCK_SCOPE_LABELS[String(s)] ?? String(s)).join(" · ");
  const reason = typeof o.sebepKodu === "string" ? (CARI_LOCK_REASON_LABELS[o.sebepKodu] ?? o.sebepKodu) : null;
  const parts = [scope ? `Durdurulan: ${scope}` : null, reason ? `Sebep: ${reason}` : null, typeof o.baslangic === "string" ? `${fmtFactoryDateTime(o.baslangic)} itibarıyla` : null];
  return { state: "KILITLI", label: "Kilitli", text: parts.filter(Boolean).join(" · ") };
}
