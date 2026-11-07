import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScanField } from "@/components/scanner/ScanField";
import { classifyBarcode, matchesFullFormat } from "@/lib/scanner/barcode-kind";
import { useScanSeed } from "@/hooks/useScanSeed";
import { usePreferences } from "@/providers/PreferencesProvider";

interface Props {
  /** Tam-format top barkodunda detay panelini açar (scanLookup + sheet çağıran'da). */
  openDetail: (code: string) => void;
  /** scanLookup.isPending — "Aç" butonu için. */
  scanPending: boolean;
}

/**
 * Perf: okut/ara input'u + "Aç" + "okutunca aç" toggle'ı kendi state'inde tutan
 * izole alt bileşen. Daha önce `scanBarcode` RollsPage state'indeydi → her tuş
 * vuruşu 100 satırlık tabloyu (RollsTableBody → DataTable) yeniden render
 * ediyordu. Artık tuş vuruşu yalnız bu bileşeni günceller; tablo yalnız
 * debounce'lı URL `search` yazımında (300ms) tazelenir. (Prefs aboneliği de
 * buraya taşındı — RollsPage artık prefs değişiminde re-render olmaz.)
 */
export function RollScanBar({ openDetail, scanPending }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  // Birleşik "okut/ara" input'u: yazınca listeyi süzer (URL search), okut/Enter'da
  // (ROLL barkodu ise) detay panelini açar. Açılışta URL'deki search ile senkron.
  const [scanBarcode, setScanBarcode] = useState(() => searchParams.get("search") ?? "");

  // Okutunca detay panelini otomatik aç mı? — iş istasyonu tercihi (default açık).
  const { prefs, setPreference } = usePreferences();
  const openOnScan = prefs.rolls?.openDetailOnScan ?? true;
  const setOpenOnScan = (v: boolean) =>
    setPreference({ rolls: { ...prefs.rolls, openDetailOnScan: v } });

  // TAZE URL: zamanlayıcı mount anındaki kopyayı yazsa arada geri yüklenen filtre kaydı düşerdi
  // (useDataTable'daki aynı ders); arama değişmediyse hiç yazmaz.
  const spRef = useRef(searchParams);
  spRef.current = searchParams;

  // Yazma → URL `search` (debounce). useDataTable urlParams.search okur → liste süzülür.
  useEffect(() => {
    const h = setTimeout(() => {
      const v = scanBarcode.trim();
      if (v === (spRef.current.get("search") ?? "")) return;
      const next = new URLSearchParams(spRef.current);
      if (v) next.set("search", v);
      else next.delete("search");
      setSearchParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanBarcode]);

  const canOpen = matchesFullFormat("ROLL", classifyBarcode(scanBarcode).code);

  // Okut/Enter → her zaman listeyi süz; detay yalnız toggle AÇIK ise açılır.
  const handleScan = (code: string) => {
    setScanBarcode(code); // input + liste süzme senkron
    if (openOnScan) openDetail(code);
  };

  // Başka sayfadan "bu topu aç" niyetiyle gelindi → toggle'dan bağımsız aç.
  useScanSeed("scanBarcode", (code: string) => {
    setScanBarcode(code);
    openDetail(code);
  });

  return (
    // Tek satır filtre çubuğunun başında (arama kutusunun yeri): sarmaz, dar ekranda alan küçülür.
    <div className="flex min-w-0 shrink items-center gap-2">
      <ScanField
        className="w-44 min-w-[8rem] shrink 2xl:w-72"
        inputClassName="h-8 text-sm"
        value={scanBarcode}
        onChange={setScanBarcode}
        onScan={handleScan}
        placeholder="Barkod okut · kumaş / renk ara"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-8 shrink-0"
        onClick={() => openDetail(scanBarcode.trim())}
        disabled={!canOpen || scanPending}
        title={canOpen ? "Bu barkodun detayını aç" : "Tam bir top barkodu okut/yaz"}
      >
        {scanPending ? "…" : "Aç"}
      </Button>
      <label className="flex shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground" title="Okutunca paneli aç">
        <Checkbox
          checked={openOnScan}
          onCheckedChange={(v) => setOpenOnScan(v === true)}
        />
        <span>Okutunca <span className="hidden 2xl:inline">paneli </span>aç</span>
      </label>
    </div>
  );
}
