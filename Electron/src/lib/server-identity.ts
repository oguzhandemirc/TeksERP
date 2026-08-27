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
import type { DiscoveredServer } from "@shared/ipc-contract";
import {
  applyApiBaseUrl,
  getActiveApiBaseUrl,
  pushRecentApiBaseUrl,
  setStoredApiBaseUrl,
} from "./api-config";

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

/**
 * Keşfedilen bir sunucuyu AKTİF sunucu yapar (adres + kimlik, tek hamlede).
 *
 * ⚠️ TEK KAYNAK — iki çağıranı var ve ayrışmaları saha hatasına yol açtı:
 * "uyuşmayan" adayı seçen kullanıcı `ServerIdentityMismatchDialog`ta "güven ve
 * bağlan" deyince YALNIZ kimlik sabitleniyor, adres UYGULANMIYORDU. Sonuç:
 * buton basılıyor, uygulama eski (ölü) adresi yeniden prob ediyor, aynı
 * "Sunucuya ulaşılamadı" ekranı geri geliyor — kullanıcıya modal hiçbir şey
 * yapmıyor gibi görünüyor ve ekrandan ÇIKIŞ YOLU KALMIYOR. Yeni bir "şu sunucuya
 * bağlan" yüzeyi eklerken adresi elle uygulama, bunu çağır.
 *
 * `trustIdentity` yalnız uyuşmazlık onayından gelir: insan "bu benim sunucum"
 * dediği için kimlik ŞİMDİ sabitlenir (normalde sabitleme ilk başarılı girişte
 * olur — yukarıdaki nota bak).
 */
export async function connectToDiscoveredServer(
  candidate: DiscoveredServer,
  opts: { trustIdentity?: boolean } = {},
): Promise<void> {
  if (opts.trustIdentity) {
    // Kimlik önce sabitlenir: adres uygulandıktan sonraki ilk prob'un yeniden
    // "uyuşmazlık" demesini önler.
    try {
      await window.api?.discovery?.pin(candidate.identity?.installationId ?? null);
    } catch {
      /* sessiz geç — sabitleme kolaylıktır, bağlanma yolunu düşüremez */
    }
  }
  applyApiBaseUrl(candidate.baseUrl);
  await setStoredApiBaseUrl(candidate.baseUrl);
  await pushRecentApiBaseUrl(candidate.baseUrl);
}
