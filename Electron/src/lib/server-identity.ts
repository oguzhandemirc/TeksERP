/**
 * Sunucu kimliğinin bu makineye sabitlenmesi.
 *
 * ⚠️ SABİTLEME ANI = İLK BAŞARILI GİRİŞ, keşif anı DEĞİL.
 *
 * Bir sunucuyu prob etmek onun doğru sunucu olduğunun beyanı değildir — ağdaki
 * herhangi bir makine prob'a cevap verebilir. Ama bir insan o sunucuya kullanıcı
 * adı ve şifresiyle GİRDİYSE, "evet bu benim sunucum" demiş olur. Kimliği o an
 * sabitlemek, korumayı gerçek bir insan kararına dayandırır.
 *
 * ⚠️ Kimliği OLMAYAN sunucuda hiçbir şey sabitlenmez (eski backend / boot'ta DB'si
 * hazır olmayan sunucu). Eski bir sürümü sahtekârlıkla suçlamak, uyarıyı
 * yanlış-pozitif üretir hale getirir.
 */
import { getActiveApiBaseUrl } from "./api-config";

/** Giriş başarılı olduktan sonra çağrılır. Best-effort — hatası girişi etkilemez. */
export async function pinServerIdentityAfterLogin(): Promise<void> {
  const api = window.api?.discovery;
  if (!api) return;
  try {
    const found = await api.probe(getActiveApiBaseUrl());
    const id = found?.identity?.installationId;
    if (!id) return; // kimlik yok → sabitleme YOK (yukarıdaki nota bak)
    await api.pin(id);
  } catch {
    /* sessiz geç — sabitleme bir kolaylık, giriş yolunu düşüremez */
  }
}
