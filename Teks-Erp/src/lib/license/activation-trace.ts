// G2 KAYIP ↔ KOPYA: etkinleşmemiş görünen kurulumda DB'de BAŞKA bir anahtarın lisans izi var. Kayıp (LICENSE_DIR
// silindi, aynı makine ve veritabanı) bugünkü merdivenden gider; kopya (döküm başka PG kümesine yüklendi) kilitlenir.
// İz gerçek bir etkinleşmeden gelmeli (kira o anahtara bağlı ve satıcı imzalı, kayıt o anahtarla imzalı); kanıtsız iz
// kopya sayılır (DB'ye yazılan sahte iz kilidi açmaz). Kanıtlı izde PG kümesi: aynı → KAYIP, iki kimlik okundu ve farklı
// → kopya, biri okunamadı (yetkisiz rol, eski kayıt) → BELIRSIZ, kilit yok.
import type { ForeignTrace } from "./activation-lock";
import { coreVerifyLease } from "./core-bridge";
import type { LicenseCore } from "./license-core";
import { pgClusterDigest } from "./pg-cluster";
import { installationKeyId, type RootKey } from "./protocol";
import { verifyStateRecordSignature } from "./saat";
import { getLicenseTraceRow, type TraceRow } from "./trace-row";

/** Başka anahtarın izi: KAYIP (aynı küme) · BELIRSIZ (küme ölçülemedi) · YABANCI (farklı küme ya da kanıtsız iz). */
export function classifyForeignTrace(
  row: TraceRow,
  g: { readonly roots: readonly RootKey[]; readonly core?: LicenseCore },
): "KAYIP" | "BELIRSIZ" | "YABANCI" {
  if (!row.kira) return "YABANCI";
  const lease = coreVerifyLease(row.kira, g.roots, g.core);
  if (!lease.ok) return "YABANCI";
  const doc = lease.value.document;
  if (doc.kurulumAnahtarKimligi !== installationKeyId(row.anahtar) || doc.kurulumId !== row.kurulumId) return "YABANCI";
  const record = verifyStateRecordSignature(row.durum, { publicKeyX: row.anahtar });
  if (!record.ok || record.value.kurulumId !== row.kurulumId) return "YABANCI";
  const here = pgClusterDigest(row.kurulumId);
  const there = record.value.pgOzeti;
  if (here === null || there === undefined) return "BELIRSIZ";
  return there === here ? "KAYIP" : "YABANCI";
}

/** Etkinleşmemiş kurulumda DB izinin sınıfı (etkin kurulumda çağrılmaz). */
export function foreignTraceOf(g: { readonly roots: readonly RootKey[]; readonly core?: LicenseCore }): ForeignTrace {
  const t = getLicenseTraceRow();
  if (t.durum === "BILINMIYOR") return "BILINMIYOR";
  if (t.durum === "YOK") return "YOK";
  return classifyForeignTrace(t.row, g);
}
