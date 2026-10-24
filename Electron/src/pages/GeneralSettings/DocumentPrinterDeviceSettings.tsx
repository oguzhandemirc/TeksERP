import { useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DocPrinterInfo } from "@shared/doc-print";
import { FlagToggle } from "./SettingRow";
import { useDeviceDraft } from "./useDeviceDraft";
import { useRegisterSettingsDirty } from "./settings-dirty";
import { SettingsSaveBar } from "./SettingsSaveBar";

const NONE = "__none__";

/**
 * Belge yazıcısı — bu bilgisayara özel YEREL tercih (sunucu bayrağı yok). Varsayılan bugünkü
 * davranış: her basımda sistem yazdırma penceresi. Sessiz basım yalnız bir yazıcı seçiliyken
 * açılır; seçilen yazıcı silinirse basım HATA döner ve yazdırma geçmişine düşer.
 */
export function DocumentPrinterDeviceSettings() {
  const draft = useDeviceDraft("documentPrinter");
  const cfg = draft.draft;
  useRegisterSettingsDirty(draft.dirty);

  const docPrint = typeof window !== "undefined" ? window.api?.docPrint : undefined;
  const [printers, setPrinters] = useState<DocPrinterInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [listErr, setListErr] = useState(false);

  if (!docPrint) {
    return (
      <p className="text-xs text-muted-foreground">
        Belge yazıcısı yalnız masaüstü uygulamasında ayarlanabilir.
      </p>
    );
  }

  const load = async () => {
    setLoading(true);
    setListErr(false);
    try {
      setPrinters(await docPrint.printers());
    } catch {
      setListErr(true);
      setPrinters([]);
    } finally {
      setLoading(false);
    }
  };

  const deviceName = cfg.deviceName?.trim() || "";

  return (
    <div className="space-y-4">
      <PrinterPicker
        deviceName={deviceName}
        printers={printers}
        listErr={listErr}
        loading={loading}
        onLoad={() => void load()}
        onPick={(v) => (v === NONE ? draft.patch({ deviceName: undefined, silent: false }) : draft.patch({ deviceName: v }))}
      />

      <FlagToggle
        title="Sessiz basım (yazdırma penceresi açılmaz)"
        desc={
          deviceName
            ? "Açıkken belgeler yazdırma penceresi açılmadan seçili yazıcıya gider. Kapalıyken bugünkü gibi her basımda yazdırma penceresi açılır."
            : "Önce bir belge yazıcısı seçin. Yazıcı seçilmeden sessiz basım açılamaz; her basımda yazdırma penceresi açılır."
        }
        checked={Boolean(cfg.silent && deviceName)}
        disabled={!deviceName}
        onChange={(v) => draft.patch({ silent: v })}
      />

      <p className="text-xs text-muted-foreground">
        Bu ayar yalnız bu bilgisayarı etkiler. Etiket yazıcısı ayrı ayarlanır (Yazıcı sekmesi).
      </p>

      <SettingsSaveBar
        dirty={draft.dirty}
        saving={false}
        onSave={() => {
          draft.save();
          toast.success("Belge yazıcısı ayarı kaydedildi.");
        }}
        onReset={draft.reset}
      />
    </div>
  );
}

interface PickerProps {
  deviceName: string;
  printers: DocPrinterInfo[] | null;
  listErr: boolean;
  loading: boolean;
  onLoad: () => void;
  onPick: (value: string) => void;
}

/** OS yazıcı listesi + seçim; kayıtlı yazıcı listede yoksa da seçili görünür (uyarıyla). */
function PrinterPicker({ deviceName, printers, listErr, loading, onLoad, onPick }: PickerProps) {
  const known = printers?.some((p) => p.name === deviceName) ?? true;
  const options = printers ?? [];
  return (
    <>
    <div className="flex flex-wrap items-end gap-3">
      <label className="block text-xs">
        <span className="block text-muted-foreground">Belge yazıcısı</span>
        <Select
          value={deviceName || NONE}
          onValueChange={onPick}
        >
          <SelectTrigger className="mt-1 w-[22rem] max-w-full" aria-label="Belge yazıcısı">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Seçilmedi — yazdırma penceresinde seçilir</SelectItem>
            {deviceName && !options.some((p) => p.name === deviceName) && (
              <SelectItem value={deviceName}>{deviceName}</SelectItem>
            )}
            {options.map((p) => (
              <SelectItem key={p.name} value={p.name}>
                {p.displayName || p.name}
                {p.isDefault ? " (varsayılan)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Button type="button" variant="outline" size="sm" onClick={onLoad} disabled={loading}>
        {loading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
        Yazıcıları Listele
      </Button>
    </div>

    {printers !== null && options.length === 0 && (
      <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {listErr ? "Yazıcı listesi okunamadı." : "Bu bilgisayarda tanımlı yazıcı bulunamadı."}
      </p>
    )}
    {printers !== null && deviceName && !known && (
      <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Seçili yazıcı ({deviceName}) bu bilgisayarda artık görünmüyor; sessiz basım hata verir.
      </p>
    )}
    </>
  );
}
