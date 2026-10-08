// Aktarımda şifreleme (kullanıcı kararı K3, 2026-10-08): sürüm paketi sunucuya YALNIZ şifreli ve sabitli
// bağlanır (manifestte de cleartext kapalı — app.json). Şifresiz HTTP yalnız geliştirme (Metro) derlemesinde.
export function secureTransportOnly(): boolean {
  return !__DEV__;
}
