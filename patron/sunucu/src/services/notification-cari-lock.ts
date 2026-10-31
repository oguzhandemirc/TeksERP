// CARİ KİLİDİ BİLDİRİMİ (D4-I6) — olgu fabrikanın `cari-hesap.kilit` alanıdır; bulut yalnız okur ve kimlik
// üretir: koyma `cari-kilit:<kilitId>`, açma `cari-kilit:<kilitId>:acildi` ⇒ aynı kilit için ikinci bildirim
// doğmaz. Açılış yalnız koyması o hesaba zaten doğmuş kilitte bildirilir (devreye alınışta eski açılışlar
// sessiz kalır). Tarih/sayı karşılaştırması yok.
import type { Tx } from "../lib/db";
import { CARI_LOCK_REASON_LABELS, CARI_LOCK_SCOPE_LABELS, type CariLock } from "../wire/api";

export const CARI_LOCK_SOURCE = "cari-hesap";
/** Bildirim türü; bakım budaması bu türü dışlar (tekrar kimliği satırın kendisi). */
export const CARI_LOCK_KIND = "cari-kilit";
/** Bildirim metnindeki cari adı kaynağı (izni `bulut:oturum`; her hesap okur). */
export const CARI_NAME_SOURCE = "cari-kart";

export interface CariLockFact {
  readonly kilit: CariLock;
  readonly cariKartId: string | null;
  readonly ad: string | null;
}

export interface LockText {
  readonly dedupKey: string;
  readonly title: string;
  readonly body: string;
  readonly route: string | null;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const placedKey = (k: CariLock): string => `cari-kilit:${k.kilitId}`;

/** Fabrika alanının biçimi tutmuyorsa (eski/bozuk) olay yok — bulut tahmin etmez. */
export function asCariLock(v: unknown): CariLock | null {
  const o = obj(v);
  if ((o.durum !== "AKTIF" && o.durum !== "ACILDI") || typeof o.kilitId !== "string" || !Array.isArray(o.kapsam) || typeof o.sebepKodu !== "string") return null;
  return o as unknown as CariLock;
}

/** Hesaba göre aday: AKTİF → koyma; ACILDI → koyması bu hesaba doğmuşsa açılış. */
export function cariLockText(f: CariLockFact, accountId: string, seen: ReadonlySet<string>): LockText | null {
  const who = f.ad ?? "Bir cari";
  const route = f.cariKartId ? `/cariler/${f.cariKartId}` : null;
  if (f.kilit.durum === "AKTIF") {
    const scope = f.kilit.kapsam.map((s) => CARI_LOCK_SCOPE_LABELS[s] ?? s).join(" · ");
    const reason = CARI_LOCK_REASON_LABELS[f.kilit.sebepKodu] ?? f.kilit.sebepKodu;
    return { dedupKey: placedKey(f.kilit), title: "Cari kilitlendi", body: `${who}: ${scope} durduruldu (${reason})`.slice(0, 480), route };
  }
  if (!seen.has(`${accountId}|${placedKey(f.kilit)}`)) return null;
  return { dedupKey: `${placedKey(f.kilit)}:acildi`, title: "Cari kilidi açıldı", body: `${who}: kilit kaldırıldı`.slice(0, 480), route };
}

/** Kilit alanı dolu `cari-hesap` satırları + görünen ad + daha önce doğmuş koyma bildirimleri (hesap|anahtar). */
export async function loadCariLocks(tx: Tx, tesisId: string): Promise<{ facts: CariLockFact[]; seen: Set<string> }> {
  const rows = await tx.projectionRow.findMany({
    where: { tesisId, projection: CARI_LOCK_SOURCE, deletedAt: null, OR: [{ data: { path: ["kilit", "durum"], equals: "AKTIF" } }, { data: { path: ["kilit", "durum"], equals: "ACILDI" } }] },
    select: { data: true },
    orderBy: { recordId: "asc" },
  });
  const locks = rows.map((r) => ({ kilit: asCariLock(obj(r.data).kilit), cariKartId: typeof obj(r.data).cariKartId === "string" ? (obj(r.data).cariKartId as string) : null }))
    .filter((x): x is { kilit: CariLock; cariKartId: string | null } => x.kilit !== null);
  if (locks.length === 0) return { facts: [], seen: new Set() };
  const cardIds = [...new Set(locks.map((l) => l.cariKartId).filter((x): x is string => x !== null))];
  const cards = cardIds.length === 0 ? [] : await tx.projectionRow.findMany({ where: { tesisId, projection: CARI_NAME_SOURCE, recordId: { in: cardIds }, deletedAt: null }, select: { recordId: true, data: true } });
  const names = new Map(cards.map((c) => [c.recordId, typeof obj(c.data).ad === "string" ? (obj(c.data).ad as string) : null]));
  const released = locks.filter((l) => l.kilit.durum === "ACILDI").map((l) => placedKey(l.kilit));
  const prior = released.length === 0 ? [] : await tx.notification.findMany({ where: { tesisId, kind: CARI_LOCK_KIND, dedupKey: { in: released } }, select: { accountId: true, dedupKey: true } });
  return {
    facts: locks.map((l) => ({ ...l, ad: l.cariKartId ? (names.get(l.cariKartId) ?? null) : null })),
    seen: new Set(prior.map((p) => `${p.accountId}|${p.dedupKey}`)),
  };
}
