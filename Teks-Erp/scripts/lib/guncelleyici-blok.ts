// =============================================================================
// İMZALI BİLDİRİMİN `guncelleyici` BLOĞU (sözleşme 5 · GUNCELLEYICI-SAGLAMLIK R15) — TEK KAYNAK
// =============================================================================
// Blok paketteki güncelleyici ikilisinden ÖLÇÜLÜR, elle verilmez: bayt biçimi bildirimin platformunun hedefi
// (Windows PE32+ x64 · Linux ELF64 x86-64), özet ikilinin kendisinden, sürüm paketleyicinin ikiliyi koşturup aldığı
// künyeden. İki platformun yayıncısı (`backend-bildirim.ts` zip · `oci-paket.ts` tar) ve yeniden imza bu dosyayı
// kullanır. DONDUR'daki kurulum yalnız bu blokla kendini yeniler (AK-3); blok yoksa ikili hiç yenilenmez.
// =============================================================================
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ReleaseUpdaterSchema, type ReleaseManifest, type ReleaseUpdater, type UpdatePlatform } from "../../src/lib/license/protocol";
import { CliError } from "./cli-girdi";

export type IkiliHedefi = "windows" | "linux";

/** Bildirim platformu → paketteki güncelleyicinin hedefi (`kunye.hedef`): kendini güncelleme platform geçmez (§4.6). */
export const PLATFORM_HEDEFI: Readonly<Record<UpdatePlatform, IkiliHedefi>> = Object.freeze({ "win32-x64": "windows", "linux-x64-oci": "linux" });

/** Windows paketinde güncelleyici ikilisinin yeri ve `PAKET.json` `hizmetIkilileri` anahtarı (`deploy/paketle.ps1`). */
export const WIN_GUNCELLEYICI = "tekserp-guncelleyici.exe";
export const WIN_GUNCELLEYICI_YOLU = `runtime/${WIN_GUNCELLEYICI}`;

/** Paketleyicinin ölçümü (`deploy/paketle.ps1` HizmetIkilisiOlc · CI `guncelleyici-kunye.json`); imzasız, yalnız beyan. */
export interface GuncelleyiciKunyesi {
  readonly surum?: unknown;
  readonly sha256?: unknown;
  readonly boyut?: unknown;
}

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** Baytların hedefi: PE32+ x64 (`paketle.ps1` HizmetIkilisiOlc ile aynı kural) · ELF64 LE x86-64; tanınmazsa null. */
export function ikiliHedefi(b: Buffer): IkiliHedefi | null {
  if (b.length >= 20 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46 && b[4] === 2 && b[5] === 1 && b.readUInt16LE(18) === 0x3e) return "linux";
  if (b.length < 1024 || b[0] !== 0x4d || b[1] !== 0x5a) return null;
  const pe = b.readInt32LE(0x3c);
  if (pe < 64 || pe + 6 > b.length || b[pe] !== 0x50 || b[pe + 1] !== 0x45 || b[pe + 2] !== 0 || b[pe + 3] !== 0) return null;
  return b.readUInt16LE(pe + 4) === 0x8664 ? "windows" : null;
}

/**
 * İkiliyi ve paketleyicinin künyesini ölçer → bildirim bloğu. Hedef platformun değilse, özet/boyut künyeyle tutmazsa,
 * sürüm sözleşme biçiminde değilse DUR. `yer` hata iletisindeki paket içi ad.
 */
export function guncelleyiciBlogu(g: { readonly ikili: string; readonly platform: UpdatePlatform; readonly kunye: GuncelleyiciKunyesi; readonly yer: string }): ReleaseUpdater {
  const b = fs.readFileSync(g.ikili);
  const hedef = ikiliHedefi(b);
  if (hedef !== PLATFORM_HEDEFI[g.platform]) throw new CliError(`${g.yer} ${hedef ?? "tanınmayan biçimde"} ikilisi — ${g.platform} paketi ${PLATFORM_HEDEFI[g.platform]} güncelleyicisi taşır`);
  const olcu = sha256(b);
  if (g.kunye.sha256 !== olcu) throw new CliError(`${g.yer} özeti künyeyle tutmuyor (künye ${String(g.kunye.sha256).slice(0, 16)}…, ikili ${olcu.slice(0, 16)}…)`);
  if (g.kunye.boyut !== undefined && g.kunye.boyut !== b.length) throw new CliError(`${g.yer} boyutu künyeyle tutmuyor (künye ${String(g.kunye.boyut)}, ikili ${b.length})`);
  const blok = ReleaseUpdaterSchema.safeParse({ surum: g.kunye.surum, sha256: olcu });
  if (!blok.success) throw new CliError(`${g.yer} künyesinin sürümü sözleşme biçiminde değil (${JSON.stringify(g.kunye.surum ?? null)}) — paketleyici ikiliyi koşturup künyesini alamadı mı?`);
  return blok.data;
}

/**
 * Windows paketi (açılmış zip kökü): ikili `runtime/tekserp-guncelleyici.exe`, künye `PAKET.json` `hizmetIkilileri`.
 * İkili imzalı kapsamdadır (`runtime`); çağıran bütünlüğü bundan ÖNCE TAM denetlemiş olmalı. İkili yoksa null.
 */
export function windowsGuncelleyiciOlc(kok: string, paketKunyesi: { readonly hizmetIkilileri?: unknown }): ReleaseUpdater | null {
  const ikili = path.join(kok, ...WIN_GUNCELLEYICI_YOLU.split("/"));
  if (!fs.existsSync(ikili)) return null;
  const tum = paketKunyesi.hizmetIkilileri;
  const kunye = tum !== null && typeof tum === "object" ? (tum as Record<string, unknown>)[WIN_GUNCELLEYICI] : undefined;
  if (kunye === null || typeof kunye !== "object") throw new CliError(`PAKET.json hizmetIkilileri["${WIN_GUNCELLEYICI}"] yok — paketleyici ikiliyi ölçmemiş`);
  return guncelleyiciBlogu({ ikili, platform: "win32-x64", kunye: kunye as GuncelleyiciKunyesi, yer: WIN_GUNCELLEYICI_YOLU });
}

/** İmza ÖNCESİ öz-denetim: yükün bloğu var ve paketteki ikiliyle (biçim + özet) hâlâ tutuyor. */
export function guncelleyiciOzDenetim(yuk: Pick<ReleaseManifest, "platform" | "guncelleyici">, ikili: string): void {
  const blok = yuk.guncelleyici;
  if (!blok) throw new Error(`öz-denetim: ${yuk.platform} bildiriminde guncelleyici bloğu yok`);
  const b = fs.readFileSync(ikili);
  if (ikiliHedefi(b) !== PLATFORM_HEDEFI[yuk.platform] || sha256(b) !== blok.sha256) throw new Error("öz-denetim: guncelleyici bloğu paketteki ikiliyle tutmuyor");
}

/** İmzalı belgeden geri okunan blok imzalanan blokla aynı mı (şema alanı atmadı mı). */
export function ayniBlok(a: ReleaseUpdater | undefined, b: ReleaseUpdater | undefined): boolean {
  return a?.surum === b?.surum && a?.sha256 === b?.sha256;
}
