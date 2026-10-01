// =============================================================================
// KISA KİMLİK ARACI — hızlı PIN / QR kart özetli saklama (G21)
// =============================================================================
// Kaynak: npx tsx scripts/kisa-kimlik.ts <komut>   ·   Paket: node dist/tools/kisa-kimlik.cjs <komut>
// Uygulama dizininden koşulur (LICENSE_DIR varsayılanı ../lisans, sunucuyla aynı).
//
//   durum                         anahtar halkası, düz/özet/uyuşmayan sayıları, emanet (değer basmaz)
//   donustur                      KURU: düz PIN/kartı olan HER kullanıcıyı listeler (değer basmaz)
//   donustur --apply [--canli-onay]   düz değerleri özete çevirir, düz kolonu NULL'lar (kolon silinmez);
//                                 ikinci koşum 0 değişiklik vermeli (idempotency kanıtı)
//   anahtar-geri-yukle [--anahtar=<dosya>]
//                                 başka makineden gelen özetlerin anahtarını emanetten açar; dosya
//                                 `tksec1:` kâğıt anahtarı ya da `.tkkey` (parola sorulur). Verilmezse
//                                 BACKUP_KEY_DIR/yerel.tkkey. Parola argümandan ALINMAZ.
//
// Geri alınamaz adım `donustur --apply`dır: geri dönüş yolu yalnız premigrate/gece yedeğinden
// restore'dur (düz değerleri o yedek taşır). Sıra: kuru → kullanıcı onayı → --apply → ikinci koşum 0.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import fs from "node:fs";
import path from "node:path";
import { LOCAL_KEY_FILE, privateKeyFromRaw, privateRawFromText, readBackupCryptoConfig } from "../src/lib/backup-crypto";
import { ShortCredentialService } from "../src/services/short-credential.service";
import { ShortCredentialAdminService } from "../src/services/short-credential-admin.service";
import { getShortCredentialKeyRing } from "../src/lib/short-credential/keyring";
import { args, askPassword, CliError } from "./lib/cli-girdi";
import { fixtureHedefEngeli, hedefDbAdi } from "./lib/hedef-db-kapisi";

const APPLY = process.argv.includes("--apply");
const CANLI_ONAY = process.argv.includes("--canli-onay");

async function durum(): Promise<void> {
  const s = await ShortCredentialService.status();
  console.log(`Anahtar halkası : ${s.key.ok ? `hazır — etkin ${s.key.activeKid}, ${s.key.kids.length} anahtar` : `KULLANILAMIYOR (${s.key.problem}: ${s.key.detail})`}`);
  console.log(`Hızlı PIN       : özet ${s.pin.digest} · düz ${s.pin.legacyPlain} · anahtarı uyuşmayan ${s.pin.foreign}`);
  console.log(`Kart            : özet ${s.card.digest} (eski biçim ${s.card.legacyFormat}) · düz ${s.card.legacyPlain} · anahtarı uyuşmayan ${s.card.foreign}`);
  console.log(`Yedek şifreleme : ${s.escrow.backupCrypto ?? "okunamadı"} · emanetli anahtar ${s.escrow.sealedKids.length} · emaneti eksik ${s.escrow.unsealedRingKids.length}`);
  for (const f of s.foreignKids) {
    console.log(`  • yabancı anahtar ${f.kid}: ${f.pin} PIN, ${f.card} kart — emanet ${f.escrow ? "VAR (anahtar-geri-yukle)" : "YOK (toplu sıfırlama)"}`);
  }
}

async function donustur(): Promise<void> {
  const satirlar = await ShortCredentialAdminService.previewConversion();
  console.log(`\nDüz değeri olan kullanıcı: ${satirlar.length}`);
  for (const r of satirlar) {
    console.log(`  ${r.username.padEnd(24)} ${r.fullName.padEnd(28)} ${r.pin ? "PIN" : "   "} ${r.card ? "KART" : "    "}${r.isActive ? "" : "  (pasif)"}`);
  }
  if (!APPLY) {
    console.log("\nKURU KOŞUM — hiçbir şey yazılmadı. Uygulamak için: donustur --apply");
    return;
  }
  const ring = getShortCredentialKeyRing();
  if (!ring.ok) throw new CliError(`Anahtar halkası kullanılamıyor (${ring.problem}: ${ring.detail}) — dönüşüm yapılamaz.`);
  const sonuc = await ShortCredentialAdminService.applyConversion();
  console.log(`\n✓ dönüştürüldü: ${sonuc.pin} PIN, ${sonuc.card} kart (anahtar ${sonuc.kid})`);
  for (const k of sonuc.skipped) console.log(`  ⚠ atlandı ${k.userId}: ${k.reason}`);
  console.log(`Kalan düz: ${sonuc.remaining.pin} PIN, ${sonuc.remaining.card} kart${sonuc.remaining.pin + sonuc.remaining.card === 0 ? " ✓" : " — yeniden koşun"}`);
  const esc = await ShortCredentialAdminService.syncEscrow();
  console.log(`Emanet: ${esc.state === "acik" ? `güncel (${[...esc.sealed, ...esc.current].length} anahtar)` : `YOK — yedek şifrelemesi ${esc.state}`}`);
}

async function anahtarGeriYukle(flags: Map<string, string>): Promise<void> {
  let yol = flags.get("anahtar") || null;
  if (!yol) {
    const cfg = await readBackupCryptoConfig();
    yol = cfg.dir ? path.join(cfg.dir, LOCAL_KEY_FILE) : null;
  }
  if (!yol) throw new CliError("--anahtar=<dosya> verin (kâğıt `tksec1:` satırı ya da `.tkkey`); BACKUP_KEY_DIR da tanımlı değil.");
  const metin = await fs.promises.readFile(yol, "utf8");
  const raw = await privateRawFromText(metin, async () => (await askPassword("Yedek parolası: ")).toString("utf8"));
  const kimlik = privateKeyFromRaw(raw);
  raw.fill(0);
  const sonuc = await ShortCredentialAdminService.restoreKeysFromEscrow([kimlik]);
  console.log(`Gerekli: ${sonuc.needed.join(", ") || "yok"}`);
  console.log(`Geri kondu: ${sonuc.restored.join(", ") || "—"}`);
  if (sonuc.failed.length) console.log(`AÇILAMADI (bu anahtar o emaneti açamıyor): ${sonuc.failed.join(", ")}`);
  if (sonuc.notEscrowed.length) console.log(`Emaneti YOK (toplu PIN sıfırlama gerekir): ${sonuc.notEscrowed.join(", ")}`);
}

async function main(): Promise<void> {
  const { command, flags } = args(process.argv.slice(2).filter((a) => a !== "--apply" && a !== "--canli-onay"));
  console.log(`🎯 Hedef veritabanı: ${hedefDbAdi()}`);
  const yazar = (command === "donustur" && APPLY) || command === "anahtar-geri-yukle";
  const fixtureDisi = fixtureHedefEngeli();
  if (yazar && fixtureDisi && !CANLI_ONAY) {
    throw new CliError(`Hedef fixture kalıbında değil — fabrikada bilerek koşuyorsan --canli-onay ekle.\n   ${fixtureDisi}`);
  }
  if (command === "durum" || command === "") await durum();
  else if (command === "donustur") await donustur();
  else if (command === "anahtar-geri-yukle") await anahtarGeriYukle(flags);
  else throw new CliError(`Tanınmayan komut: ${command} (durum | donustur | anahtar-geri-yukle)`);
}

main()
  .then(() => 0, (e: unknown) => {
    console.error(`\n⛔ ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  })
  .then(async (code) => {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(code);
  });
