/**
 * "Bu makinede en son hangi sürüm notu gösterildi" işareti.
 *
 * ⚠️ MAKİNE başına saklanır (kullanıcı başına DEĞİL — kullanıcı kararı):
 * sürüm notu "bu bilgisayarda kurulan sürüm" hakkındadır. Kullanıcı tercihine
 * yazılsaydı, aynı kişi eski sürümlü ikinci bir makineye girdiğinde pencere hiç
 * çıkmazdı — oysa o makinede o sürüm gerçekten yeni.
 *
 * `localStorage` seçildi çünkü bu repoda makineye/tarayıcı profiline ait UI
 * durumu orada yaşıyor (`sidebar.collapsed`, `notifications.lastSeen`);
 * `UserPreference` kullanıcıyı takip eder, secure-store ise donanım ayarları
 * içindir.
 */
export const SON_GORULEN_ANAHTAR = "surumNotlari.sonGorulen";

export function sonGorulenOku(): string | null {
  try {
    return localStorage.getItem(SON_GORULEN_ANAHTAR);
  } catch {
    // Depolama kapalıysa pencere her açılışta çıkar — sessizce yutmaktan iyidir.
    return null;
  }
}

export function sonGorulenYaz(id: string): void {
  try {
    localStorage.setItem(SON_GORULEN_ANAHTAR, id);
  } catch {
    /* sessiz geç */
  }
}
