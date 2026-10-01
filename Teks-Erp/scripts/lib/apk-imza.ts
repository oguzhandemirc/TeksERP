// TABLET APK KÜNYESİ — yayın makinesi tarafı (imza aracı `scripts/panel-imza.ts apk-imzala` + bekçisi `test_panel_imza` §4).
// Künyenin biçimi/doğrulaması TEK kaynaktan: `mobil/scripts/lib/apk-kunye.mjs` (yayın kapısı `deploy/mobil-yayinla.mjs`
// de onu okur; tabletin saf JS doğrulayıcısıyla eşdeğerliği mobil jest çapraz kâhininde). Anahtar açma panel aracıyla
// ORTAK (aynı anahtar kararı: PAKET ya da `panel-<yıl>`). Her imza YAZILMADAN ÖNCE geri doğrulanır.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AnchorKey } from "../../../Electron/electron/guncelleme/kunye-jws.mjs";
import { buildApkDoc, signApkDoc, verifyApkSurumJson, withApkBlock, type ApkDoc } from "../../../mobil/scripts/lib/apk-kunye.mjs";
import { git } from "./git";
import { DEPO_KOKU, type OpenedSigningKey } from "./panel-imza";

/** Tabletin JS paketine gömülü APK künyesi çapası — imza aracı da yayın kapısı da BU dosyayı okur. */
export const TABLET_ANCHOR_FILE = path.join(DEPO_KOKU, "mobil", "src", "lib", "apk-imza-capasi.json");

export interface ApkOlcum {
  readonly boyut: number;
  readonly sha256: string;
}

export async function apkOlc(apk: string): Promise<ApkOlcum> {
  const h = createHash("sha256");
  let boyut = 0;
  for await (const p of fs.createReadStream(apk)) {
    h.update(p as Buffer);
    boyut += (p as Buffer).length;
  }
  return { boyut, sha256: h.digest("hex") };
}

/** surum.json'ın (mobil-yayinla'nın yazdığı) imzaya giren alanları — eksik/tipsizse imza YAZILMAZ. */
function surumAlanlari(s: Record<string, unknown>): { versionCode: number; versionName: string; dosya: string; sha256: string; boyut: number } {
  const { versionCode, versionName, dosya, sha256, boyut } = s;
  if (typeof versionCode !== "number" || typeof versionName !== "string" || typeof dosya !== "string" || typeof sha256 !== "string" || typeof boyut !== "number") {
    throw new Error("surum.json versionCode · versionName · dosya · sha256 · boyut taşımıyor — mobil-yayinla'nın yazdığı dosya değil");
  }
  return { versionCode, versionName, dosya, sha256, boyut };
}

export interface ApkSignInput {
  readonly apk: string;
  readonly kunye: string;
  readonly kanal: string;
  readonly key: OpenedSigningKey;
  readonly anchor: readonly AnchorKey[];
  readonly commit?: string;
  readonly now?: Date;
}

/**
 * APK'yı ÖLÇER (boy + sha256), surum.json'daki kayıtla birebir olduğunu denetler, künyeyi kurar ve imzalar, yayın
 * kapısının doğrulayıcısıyla geri doğrular (çapa · kanal · surum.json bağı · dosya) ve ancak sonra surum.json'a yazar.
 */
export async function signApkPackage(g: ApkSignInput): Promise<{ readonly doc: ApkDoc; readonly token: string }> {
  if (!g.anchor.some((k) => k.kid === g.key.kid)) {
    throw new Error(`anahtar ${g.key.kid} tablet imza çapasında YOK — bununla imzalanan APK'yı hiçbir tablet kurmaz (önce guven-capasi-ekle.ts tablet)`);
  }
  const s = JSON.parse(fs.readFileSync(g.kunye, "utf8")) as Record<string, unknown>;
  const a = surumAlanlari(s);
  const olcum = await apkOlc(g.apk);
  if (a.sha256 !== olcum.sha256 || a.boyut !== olcum.boyut) {
    throw new Error(`surum.json APK dosyasıyla uyuşmuyor (boy/sha256) — başka bir APK'nın künyesi olabilir: ${g.apk}`);
  }
  const doc = buildApkDoc({
    kanal: g.kanal,
    versionCode: a.versionCode,
    versionName: a.versionName,
    commit: g.commit ?? git(["rev-parse", "HEAD"], { cwd: DEPO_KOKU }).trim(),
    yayinZamani: (g.now ?? new Date()).toISOString(),
    paket: { ad: a.dosya, boyut: olcum.boyut, sha256: olcum.sha256 },
    capa: g.anchor.map((k) => k.kid),
  });
  const token = signApkDoc({ doc, kid: g.key.kid, privateKey: g.key.privateKey });
  const next = withApkBlock(s, token);
  const check = await verifyApkPackage(next, g.apk, { kanal: g.kanal, anchor: g.anchor });
  if (!check.ok) throw new Error(`imzalanan künye geri doğrulanamadı (${check.code}): ${check.message} — surum.json'a YAZILMADI`);
  const tmp = `${g.kunye}.imza-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(tmp, g.kunye);
  return { doc, token };
}

export type ApkCheck =
  | { readonly ok: true; readonly doc: ApkDoc; readonly kid: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** surum.json nesnesi + APK dosyası → tabletin kabul edip etmeyeceği (yayın kapısının sorusu). */
export async function verifyApkPackage(s: unknown, apk: string, g: { readonly kanal: string; readonly anchor: readonly AnchorKey[] }): Promise<ApkCheck> {
  const r = verifyApkSurumJson(s, { keys: g.anchor, channel: g.kanal });
  if (!r.ok) return r;
  const olcum = await apkOlc(apk);
  if (olcum.boyut !== r.value.doc.paket.boyut || olcum.sha256 !== r.value.doc.paket.sha256) {
    return { ok: false, code: "DOSYA_OZETI", message: `APK dosyası künyedeki boy/sha256 ile uyuşmuyor: ${path.basename(apk)}` };
  }
  return { ok: true, doc: r.value.doc, kid: r.value.kid };
}
