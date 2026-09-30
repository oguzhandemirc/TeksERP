// İMZA KAPSAMI — parolalı anahtarla imza HANGİ yoldan istenebilir (tek kaynak). Kök parolası Cloudflare'den geçmez:
// KÖK yalnız tailnet portalından ve CLI'dan, BAYİ yalnız bayi portalından (GENEL) ve CLI'dan; kapsam yoksa RED.
// İki boğaz aynı kuralı çağırır: portal imza kapısı (`withSigningPasswordGuard`, sayaçlara dokunmadan) ve imza alt
// sürecini başlatan TEK fonksiyon (`signWithWrappedKey`, anahtar türünü DOSYADAN okur — rota beyanına güvenmez).
import { VendorError } from "../lib/errors";
import { currentScope, type ScopeOrigin } from "../lib/request-scope";
import type { WrappedKeyType } from "./key-files";

export type SigningKeyKind = "KOK" | "BAYI";

export const SIGNING_ORIGINS: Readonly<Record<SigningKeyKind, readonly ScopeOrigin[]>> = {
  KOK: ["TAILNET", "CLI"],
  BAYI: ["GENEL", "CLI"],
};

export function signingKindOf(tur: WrappedKeyType): SigningKeyKind {
  return tur === "tekserp-kok-anahtar" ? "KOK" : "BAYI";
}

/** Kapsamsız istek 500 (programlama hatası, imza yok); izinsiz dinleyici 404 (ERİŞİM'de rota yokmuş gibi). */
export function assertSigningScope(kind: SigningKeyKind): void {
  const scope = currentScope();
  if (!scope) {
    console.error(`[satici] imza: ${kind} anahtarı kapsamsız istendi — RED`);
    throw new VendorError(500, "SUNUCU_HATASI", "İmza isteğinin geldiği yol belirlenemedi; imza reddedildi");
  }
  if (!SIGNING_ORIGINS[kind].includes(scope.origin)) {
    console.error(`[satici] imza: ${kind} anahtarı ${scope.origin} yolundan istendi — RED`);
    throw new VendorError(404, "BULUNAMADI", "Bulunamadı");
  }
}
