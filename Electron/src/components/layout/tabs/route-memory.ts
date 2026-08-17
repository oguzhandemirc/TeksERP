// =============================================================================
// Rota hafızası — bir sayfaya geri dönüldüğünde SON DURUMUNDAN açılsın (2026-08-17)
// =============================================================================
// Liste sayfalarının durumu (arama, filtreler, sıralama, sayfa boyutu) o sekmenin
// URL'sinde yaşıyor (`useDataTable` → `useSearchParams`). Sekme açık kaldığı
// sürece durum zaten korunur; kaybolduğu yer sekmenin BAŞKA bir sayfaya
// taşınması: liste → detay → başka modül zincirinden sonra listeye dönen
// operatör filtrelerini sıfırlanmış, sayfayı en başa sarılmış buluyordu.
//
// Burada tutulan şey sayfanın verisi değil, yalnız SORGU DİZESİ — yani
// "operatörün kurduğu görünüm". Veri yeniden çekilir (taze olması istenir),
// görünüm korunur.
//
// KAPSAM: oturum boyu, yalnız BELLEKTE. Diske yazılmaz — dünkü filtresiyle
// açılan bir liste, filtresiz açılan listeden daha çok şaşırtır ("kayıtlar
// nerede?"). Uygulama kapanınca hafıza da gider.
// =============================================================================

/** pathname → en son görülen tam yol ("/x?filter[a]=b"). */
const memory = new Map<string, string>();

/** Hafızayı sınırla: menü + detay yolları büyüse de sınırsız büyümesin. */
const MAX_ENTRIES = 200;

export function rememberRoute(pathname: string, search: string): void {
  if (!pathname || pathname === "/") return;
  if (!search || search === "?") {
    // Sorgusuz ziyaret "filtreleri temizledim" demektir — eski görünümü
    // saklamaya devam etmek operatörün kararını geri alırdı.
    memory.delete(pathname);
    return;
  }
  if (!memory.has(pathname) && memory.size >= MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  memory.set(pathname, `${pathname}${search}`);
}

/**
 * Hatırlanan tam yolu döner. YALNIZ çağıran sorgusuz bir yol istediğinde
 * kullanılmalı: istemci açıkça `?filter[x]=y` gönderdiyse (ör. panodan gelen
 * daraltılmış bağlantı) o niyet hafızayı EZMELİ, tersi değil.
 */
export function recallRoute(pathname: string): string | null {
  return memory.get(pathname) ?? null;
}

/** Test/hata ayıklama için. */
export function clearRouteMemory(): void {
  memory.clear();
}
