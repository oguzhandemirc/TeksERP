// YAZARAK ETKİNLEŞTİRME (geçici açılış kodu) — fabrika tarafı. İstek kodu kurulum anahtarına bağlıdır (anahtar özeti +
// rastgele ek); açılış kodu yalnız gömülü KÖKün imzasıyla geçerlidir ve imza istek kodunu kapsar: başka kurulumun ya da
// eski isteğin kodu imzadan geçmez. Kabul edilen kod her okumada yeniden doğrulanır; dosyayı kopyalamak yetki vermez.
import { randomBytes } from "node:crypto";
import { getLicenseCore } from "./native";
import type { JwsKey, LicenseCore } from "./license-core";
import {
  TYP_GECICI,
  b64uDecode,
  b64uEncode,
  buildTempRequestCode,
  decodeTempOpeningCode,
  formatTempRequestCode,
  msToIso,
  isoToMs,
  tempCodeDigest,
  tempCodeEndMs,
  tempOpeningSigningInput,
  tempRequestMatchesKid,
  type RootKey,
  type TempCodeRejection,
  type TempOpeningDoc,
} from "./protocol";
import { getLicenseStore } from "./store";
import {
  readTempConsumed,
  readTempOpeningFile,
  readTempRequestFile,
  writeTempConsumed,
  writeTempOpeningFile,
  writeTempRequestFile,
  type TempOpeningFile,
} from "./temp-opening-files";

export type TempCodeReason = TempCodeRejection | "IMZA" | "SURESI_GECMIS" | "TEKRAR";

export interface CheckedTempCode {
  readonly doc: TempOpeningDoc;
  readonly rootKid: string;
  readonly signature: string;
  readonly digest: string;
  readonly last4: string;
  readonly endMs: number;
}
export type TempCodeCheck = { readonly ok: true; readonly value: CheckedTempCode } | { readonly ok: false; readonly neden: TempCodeReason; readonly konum?: number };

/** Kabul edilmiş, imzası bugün de tutan geçici açılış. */
export interface ActiveTempOpening {
  readonly endMs: number;
  readonly kodId: number;
  readonly acceptedMs: number;
  readonly last4: string;
}

function currentKid(): string | null {
  const s = getLicenseStore();
  return s && !s.problem && s.key ? s.key.kid : null;
}

/** Geçici kodu yalnız üretim sınıfını imzalayabilen kök imzalar (dar test kökü fabrikayı açamaz). */
function signingKeys(roots: readonly RootKey[], kid: string): JwsKey[] {
  return roots.filter((r) => r.kid === kid && r.classes.includes("URETIM")).map((r) => ({ kid: r.kid, x: r.x }));
}

function freshRequest(kid: string, nowMs: number): { kid: string; ek: string; olusturuldu: string } {
  const f = { v: 1 as const, kid, ek: b64uEncode(randomBytes(5)), olusturuldu: msToIso(nowMs) };
  writeTempRequestFile(f);
  return f;
}

/** Ekrandaki istek kodu: bekleyen ek varsa O (telefonda okunan kod kaybolmasın), yoksa yenisi yazılır. */
export function currentTempRequest(nowMs: number = Date.now()): { istekKodu: string; gosterim: string; olusturuldu: string } | null {
  const kid = currentKid();
  if (!kid) return null;
  const stored = readTempRequestFile();
  const nonce = stored && stored.kid === kid ? b64uDecode(stored.ek) : null;
  const f = stored && nonce?.length === 5 ? stored : freshRequest(kid, nowMs);
  const body = buildTempRequestCode(kid, b64uDecode(f.ek) ?? Buffer.alloc(5));
  return { istekKodu: body, gosterim: formatTempRequestCode(body), olusturuldu: f.olusturuldu };
}

/** İstek kodunu yeniler (tüketimden sonra ya da yöneticinin isteğiyle); eski isteğe verilen kod artık imzadan geçmez. */
export function renewTempRequest(nowMs: number = Date.now()): void {
  const kid = currentKid();
  if (kid) freshRequest(kid, nowMs);
}

/**
 * Yazılan kodu bu kurulumun bekleyen istek koduna karşı denetler. Sıra: biçim/sağlama → tekrar (tüketilen özet) →
 * imza (kök; istek kodu imzanın parçası) → süre. Başka kurulumun kodu imzada düşer — istek kodu farklıdır.
 */
export function checkTempCode(raw: string, g: { readonly roots: readonly RootKey[]; readonly nowMs: number; readonly core?: LicenseCore }): TempCodeCheck {
  const req = currentTempRequest(g.nowMs);
  if (!req) return { ok: false, neden: "BICIM" };
  const d = decodeTempOpeningCode(raw, req.istekKodu);
  if (!d.ok) return d.konum === undefined ? { ok: false, neden: d.neden } : { ok: false, neden: d.neden, konum: d.konum };
  const digest = tempCodeDigest(d.value.normalized);
  if (readTempConsumed().some((r) => r.ozet === digest)) return { ok: false, neden: "TEKRAR" };
  const keys = signingKeys(g.roots, d.value.rootKid);
  if (keys.length === 0) return { ok: false, neden: "IMZACI" };
  if (!(g.core ?? getLicenseCore()).verifyJws(d.value.jws, TYP_GECICI, keys).ok) return { ok: false, neden: "IMZA" };
  const endMs = tempCodeEndMs(d.value.doc.bitisGunu);
  if (endMs <= g.nowMs) return { ok: false, neden: "SURESI_GECMIS" };
  const signature = d.value.jws.split(".")[2] ?? "";
  return { ok: true, value: { doc: d.value.doc, rootKid: d.value.rootKid, signature, digest, last4: d.value.normalized.slice(-4), endMs } };
}

/** Kabul: açılış kaydı → tüketilen özet (tek kullanım) → istek kodu yenilenir. Önceki geçici kaydın yerine geçer. */
export function storeTempOpening(c: CheckedTempCode, nowMs: number = Date.now()): void {
  const kabul = msToIso(nowMs);
  writeTempOpeningFile({
    v: 1,
    istekKodu: c.doc.istekKodu,
    kokKid: c.rootKid,
    kodId: c.doc.kodId,
    bitisGunu: c.doc.bitisGunu,
    imza: c.signature,
    ozet: c.digest,
    kodSonu: c.last4,
    kabul,
    kapandi: null,
    kapanisNedeni: null,
  });
  writeTempConsumed([...readTempConsumed().filter((r) => r.ozet !== c.digest), { ozet: c.digest, kabul, bildirildi: null }]);
  renewTempRequest(nowMs);
}

function verifyOpening(f: TempOpeningFile, kid: string, roots: readonly RootKey[], core: LicenseCore): boolean {
  try {
    if (!tempRequestMatchesKid(f.istekKodu, kid)) return false;
    const doc: TempOpeningDoc = { v: 1, istekKodu: f.istekKodu, kodId: f.kodId, bitisGunu: f.bitisGunu };
    const keys = signingKeys(roots, f.kokKid);
    return keys.length > 0 && core.verifyJws(`${tempOpeningSigningInput(doc, f.kokKid)}.${f.imza}`, TYP_GECICI, keys).ok;
  } catch {
    return false;
  }
}

/** Kapanmamış ve imzası bu kurulum anahtarına karşı tutan geçici açılış; yoksa null (süresi geçmiş olsa da döner). */
export function activeTempOpening(roots: readonly RootKey[], core: LicenseCore = getLicenseCore()): ActiveTempOpening | null {
  const kid = currentKid();
  if (!kid) return null;
  const f = readTempOpeningFile();
  if (!f || f.kapandi !== null || !verifyOpening(f, kid, roots, core)) return null;
  return { endMs: tempCodeEndMs(f.bitisGunu), kodId: f.kodId, acceptedMs: isoToMs(f.kabul), last4: f.kodSonu };
}

/** Tam etkinleştirme geçici kaydı kapatır (dosya silinmez; kapanış anı ve nedeni yazılır). Kapattıysa true. */
export function closeTempOpening(reason: string, nowMs: number = Date.now()): { last4: string; endMs: number } | null {
  const f = readTempOpeningFile();
  if (!f || f.kapandi !== null) return null;
  writeTempOpeningFile({ ...f, kapandi: msToIso(nowMs), kapanisNedeni: reason });
  return { last4: f.kodSonu, endMs: tempCodeEndMs(f.bitisGunu) };
}

/** Satıcıya henüz bildirilmemiş tüketim özetleri (en çok 20 — tel şeması sınırı). */
export function pendingTempConsumed(): string[] {
  return readTempConsumed()
    .filter((r) => r.bildirildi === null)
    .slice(0, 20)
    .map((r) => r.ozet);
}

export function markTempConsumedNotified(digests: readonly string[], nowMs: number = Date.now()): void {
  const set = new Set(digests);
  const at = msToIso(nowMs);
  writeTempConsumed(readTempConsumed().map((r) => (set.has(r.ozet) && r.bildirildi === null ? { ...r, bildirildi: at } : r)));
}
