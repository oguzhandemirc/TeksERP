import { useCallback, useRef, useState } from "react";
import { Printer, Scale, ScanLine, Server, type LucideIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabelPrinterDeviceSettings } from "./LabelPrinterDeviceSettings";
import { ScaleDeviceSettings } from "./ScaleDeviceSettings";
import { ScannerSettingsSection } from "./ScannerSettingsSection";
import { ApiEndpointSection } from "./ApiEndpointSection";
import { SettingsDirtyProvider, useSettingsDirtyRegister } from "./settings-dirty";

/**
 * "Bu Bilgisayar" sekmesinin cihazları — iç içe (segment) sekmeler. Hepsi bu PC'ye
 * özel yerel ayar; sekme başına tek cihaz gösterilir (uzun kaydırma yerine). Sekme
 * etiketi cihazı adlandırdığı için içeride ayrıca başlık tekrarı yapılmaz.
 */
const DEVICE_TABS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "printer", label: "Yazıcı", icon: Printer },
  { id: "scale", label: "Kantar", icon: Scale },
  { id: "scanner", label: "Tabanca", icon: ScanLine },
  { id: "server", label: "Sunucu", icon: Server },
];

export function WorkstationTabs() {
  const [device, setDevice] = useState("printer");

  // Aktif cihaz alt-sekmesinin kaydedilmemiş taslağını hem ÜST sekmeye ilet ("Bu
  // Bilgisayar"dan çıkışta uyarı) hem de kendi ref'imizde tut (cihazlar arası geçişte uyarı).
  const outerRegister = useSettingsDirtyRegister();
  const dirtyRef = useRef(false);
  const register = useCallback(
    (d: boolean) => {
      dirtyRef.current = d;
      outerRegister(d);
    },
    [outerRegister],
  );
  const changeDevice = (next: string) => {
    if (
      dirtyRef.current &&
      !window.confirm(
        "Bu cihazda kaydedilmemiş değişiklikler var. Kaydetmeden geçmek istiyor musunuz?",
      )
    ) {
      return;
    }
    dirtyRef.current = false;
    outerRegister(false);
    setDevice(next);
  };

  return (
    <SettingsDirtyProvider value={register}>
    <Tabs value={device} onValueChange={changeDevice}>
      <TabsList className="mb-4">
        {DEVICE_TABS.map(({ id, label, icon: Icon }) => (
          <TabsTrigger key={id} value={id} className="gap-1.5">
            <Icon className="h-3.5 w-3.5" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="printer" className="mt-0">
        <LabelPrinterDeviceSettings />
      </TabsContent>
      <TabsContent value="scale" className="mt-0">
        <ScaleDeviceSettings />
      </TabsContent>
      <TabsContent value="scanner" className="mt-0">
        <ScannerSettingsSection />
      </TabsContent>
      <TabsContent value="server" className="mt-0">
        <ApiEndpointSection />
      </TabsContent>
    </Tabs>
    </SettingsDirtyProvider>
  );
}
