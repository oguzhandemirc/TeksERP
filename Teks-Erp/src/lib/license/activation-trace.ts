// G2 KAYIP ↔ KOPYA: etkinleşmemiş görünen kurulumda DB'de BAŞKA bir anahtarın lisans izi var. Kayıp (LICENSE_DIR
// silindi, aynı makine ve veritabanı) bugünkü merdivenden gider; kopya (döküm başka PG kümesine yüklendi) kilitlenir.
// İz gerçek bir etkinleşmeden gelmeli (kira o anahtara bağlı ve satıcı imzalı, kayıt o anahtarla imzalı); kanıtsız iz
// kopya sayılır (DB'ye yazılan sahte iz kilidi açmaz). Kanıtlı izde PG kümesi: aynı → KAYIP, iki kimlik okundu ve farklı
// → kopya, biri okunamadı (yetkisiz rol, eski kayıt) → BELIRSIZ, kilit yok. KAYIP/BELIRSIZ izin kipi `zorla` ise
// merdiven etkinleşmemiş kurulumda da akar (B6/G3: `runtime.ts` yabancı iz merdiveni); gözlemde süre sınırı yok.
import type { ForeignTrace } from "./activation-lock";
import { coreVerifyLease } from "./core-bridge";
import type { LicenseCore } from "./license-core";
import { pgClusterDigest } from "./pg-cluster";
import { installationKeyId, type LicenseMode, type RootKey } from "./protocol";
import { verifyStateRecordSignature } from "./saat";
import { getLicenseTraceRow, type TraceRow } from "./trace-row";

/** Başka anahtarın izinin sınıfı ve o kurulumun İZİN KİPİ (kira `zorlama` ∨ durum kaydının HAK pini `kipAltSiniri`). */
export interface ForeignTraceDetail {
  readonly sinif: "KAYIP" | "BELIRSIZ" | "YABANCI";
  /** Kanıtlı izin kipi; kanıtsız (YABANCI) izde gözlem — kilit zaten KOPYA. */
  readonly kip: LicenseMode;
  readonly izKurulumId: string;
}

export function classifyForeignTraceDetail(
  row: TraceRow,
  g: { readonly roots: readonly RootKey[]; readonly core?: LicenseCore },
): ForeignTraceDetail {
  const foreign = { sinif: "YABANCI", kip: "gozlem", izKurulumId: row.kurulumId } as const;
  if (!row.kira) return foreign;
  const lease = coreVerifyLease(row.kira, g.roots, g.core);
  if (!lease.ok) return foreign;
  const doc = lease.value.document;
  if (doc.kurulumAnahtarKimligi !== installationKeyId(row.anahtar) || doc.kurulumId !== row.kurulumId) return foreign;
  const record = verifyStateRecordSignature(row.durum, { publicKeyX: row.anahtar });
  if (!record.ok || record.value.kurulumId !== row.kurulumId) return foreign;
  const kip: LicenseMode = doc.zorlama || record.value.sonHak?.kipAltSiniri === "zorla" ? "zorla" : "gozlem";
  const here = pgClusterDigest(row.kurulumId);
  const there = record.value.pgOzeti;
  if (here === null || there === undefined) return { sinif: "BELIRSIZ", kip, izKurulumId: row.kurulumId };
  return { sinif: there === here ? "KAYIP" : "YABANCI", kip, izKurulumId: row.kurulumId };
}

/** Başka anahtarın izi: KAYIP (aynı küme) · BELIRSIZ (küme ölçülemedi) · YABANCI (farklı küme ya da kanıtsız iz). */
export function classifyForeignTrace(
  row: TraceRow,
  g: { readonly roots: readonly RootKey[]; readonly core?: LicenseCore },
): ForeignTraceDetail["sinif"] {
  return classifyForeignTraceDetail(row, g).sinif;
}

/** Etkinleşmemiş kurulumda DB izinin sınıfı (etkin kurulumda çağrılmaz). */
export function foreignTraceOf(g: { readonly roots: readonly RootKey[]; readonly core?: LicenseCore }): ForeignTrace {
  const t = getLicenseTraceRow();
  if (t.durum === "BILINMIYOR") return "BILINMIYOR";
  if (t.durum === "YOK") return "YOK";
  return classifyForeignTrace(t.row, g);
}

/** Etkinleşmemiş kurulumda iz satırı varsa ayrıntılı sınıf (kip dahil); satır yok/okunmadıysa null. */
export function foreignTraceDetailOf(g: { readonly roots: readonly RootKey[]; readonly core?: LicenseCore }): ForeignTraceDetail | null {
  const t = getLicenseTraceRow();
  return t.durum === "VAR" ? classifyForeignTraceDetail(t.row, g) : null;
}
