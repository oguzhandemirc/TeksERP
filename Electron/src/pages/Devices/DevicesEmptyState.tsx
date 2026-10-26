/** Cihaz listesi boşken açıklama (sayfa dosyası satır tavanı için ayrıldı). */
export function DevicesEmptyState() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <div className="mb-2 text-lg font-medium">Henüz cihaz yok</div>
      <p className="text-sm text-muted-foreground">
        Tablet ilk açıldığında kendini otomatik bildirir ve burada "Onay bekliyor" olarak listelenir.
        Onaylayıp bir makineye atayınca tablet çalışmaya başlar.
      </p>
    </div>
  );
}
