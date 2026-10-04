// İMZA KAPSAMI — parolalı anahtarla imza HANGİ yoldan istenebilir (tek kaynak). KÖK ve ARA (HAK ara imzacısı) satıcı
// portalının iki yolundan (tailnet · ERİŞİM) ve CLI'dan; bayi yolundan (GENEL) ASLA. BAYİ yalnız bayi portalından (GENEL)
// ve CLI'dan; kapsam yoksa RED.
// İki boğaz aynı kuralı çağırır: portal imza kapısı (`withSigningPasswordGuard`, sayaçlara dokunmadan) ve imza alt
// sürecini başlatan TEK fonksiyon (`signWithWrappedKey`, anahtar türünü DOSYADAN okur — rota beyanına güvenmez).
import { VendorError } from "../lib/errors";
import { currentScope, type ScopeOrigin } from "../lib/request-scope";
import type { WrappedKeyType } from "./key-files";

export type SigningKeyKind = "KOK" | "BAYI" | "ARA";

export const SIGNING_ORIGINS: Readonly<Record<SigningKeyKind, readonly ScopeOrigin[]>> = {
  KOK: ["TAILNET", "ERISIM", "CLI"],
  BAYI: ["GENEL", "CLI"],
  ARA: ["TAILNET", "ERISIM", "CLI"],
};

/** Tür → kapsam haritası AÇIK: tanınmayan tür (yeni anahtar türü, bozuk dosya, "__proto__") BAYİ SAYILMAZ, RED. */
const KIND_OF: Readonly<Record<WrappedKeyType, SigningKeyKind>> = {
  "tekserp-kok-anahtar": "KOK",
  "tekserp-bayi-anahtar": "BAYI",
  "tekserp-ara-anahtar": "ARA",
};

export function signingKindOf(tur: WrappedKeyType): SigningKeyKind {
  const kind = Object.hasOwn(KIND_OF, tur) ? KIND_OF[tur] : undefined;
  if (kind === "KOK" || kind === "BAYI" || kind === "ARA") return kind;
  console.error(`[satici] imza: tanınmayan anahtar türü (${String(tur).slice(0, 40)}) — RED`);
  throw new VendorError(500, "SUNUCU_HATASI", "Anahtar türü tanınmıyor; imza reddedildi");
}

/** Kapsamsız istek 500 (programlama hatası, imza yok); izinsiz dinleyici 404 (o yolda rota yokmuş gibi). */
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
