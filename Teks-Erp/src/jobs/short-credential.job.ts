// Kısa kimlik boot uzlaştırması: anahtar halkasını hazırla, emaneti tazele, durumu bildir.
// Düz PIN/kart dönüşümü burada YAPILMAZ — o geri alınamaz veri adımıdır, `scripts/kisa-kimlik.ts`.
import { getShortCredentialKeyRing } from "../lib/short-credential/keyring";
import { ShortCredentialService, type ShortCredentialStatus } from "../services/short-credential.service";
import { ShortCredentialAdminService } from "../services/short-credential-admin.service";
import { reportJobFailure } from "./job-failure";
import { bilgi, uyari } from "../lib/logger";

const STARTUP_DELAY_MS = 4 * 1000;
const RETRY_DELAY_MS = 15 * 1000;
const MAX_ATTEMPTS = 5;

function announce(status: ShortCredentialStatus): void {
  if (status.pin.legacyPlain > 0 || status.card.legacyPlain > 0) {
    uyari(
      "kisa-kimlik",
      `${status.pin.legacyPlain} hızlı PIN ve ${status.card.legacyPlain} kart hâlâ DÜZ METİN — ` +
        "dönüşüm: `kisa-kimlik donustur` (önce kuru, sonra --apply).",
    );
  }
  if (status.foreignKids.length > 0) {
    uyari(
      "kisa-kimlik",
      `${status.pin.foreign} PIN ve ${status.card.foreign} kart bu sunucunun anahtarıyla doğrulanamıyor ` +
        "(başka makineden geri yükleme) — anahtarı yedek parolasıyla geri koyun ya da PIN'leri toplu sıfırlayın.",
    );
  }
  if (status.escrow.backupCrypto !== "acik") {
    uyari(
      "kisa-kimlik",
      "yedek şifrelemesi açık değil — kısa kimlik anahtarı yedeğe GİRMİYOR; yeni makineye geri yüklemede PIN/kartlar yeniden verilmeli.",
    );
  }
}

export function startShortCredentialJob(): void {
  const attempt = (n: number): void => {
    void (async () => {
      const ring = getShortCredentialKeyRing();
      if (!ring.ok) {
        uyari("kisa-kimlik", `anahtar halkası kullanılamıyor (${ring.problem}: ${ring.detail}) — yeni PIN/kart verilemez.`);
      } else {
        bilgi("kisa-kimlik", `anahtar halkası hazır (${ring.ring.keys.length} anahtar)`);
      }
      const sync = await ShortCredentialAdminService.syncEscrow();
      if (sync.sealed.length > 0) bilgi("kisa-kimlik", `${sync.sealed.length} anahtar yedek alıcılarına mühürlendi`);
      announce(await ShortCredentialService.status());
    })().catch((err: unknown) => {
      if (n < MAX_ATTEMPTS) {
        setTimeout(() => attempt(n + 1), RETRY_DELAY_MS).unref();
        return;
      }
      reportJobFailure("short-credential", err);
    });
  };
  setTimeout(() => attempt(1), STARTUP_DELAY_MS).unref();
}
