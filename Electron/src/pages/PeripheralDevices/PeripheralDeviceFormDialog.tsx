import { Controller, useWatch, type Control } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Input } from "@/components/ui/input";
import { Callout } from "@/components/ui/callout";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { stationService } from "@/pages/Stations/service";
import { loadAllForPicker } from "@/lib/picker-loader";
import { deviceService } from "@/pages/Devices/service";
import { peripheralService } from "./service";
import { useFoldValues } from "@/hooks/useFoldValues";
import { PrinterSettingsFields } from "./PrinterSettingsFields";
import {
  peripheralFormDefaults,
  peripheralFormSchema,
  type PeripheralFormValues,
} from "./schema";
import { connectionTypeLabels, peripheralKindLabels, peripheralReadModeLabels, type PeripheralDevice, type RouteLabelKind } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PeripheralDevice | null;
  onSubmit: (values: PeripheralFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

const SELECT_CLS = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

// Metre/kantar "rol" ayrımı — mobil HAL bunu BİREBİR string eşleştirir
// (Tambur foldType→kat kodu, tek-metre istasyonu→PRIMARY). Serbest metin +
// typo = sahada sessiz "yanlış/eksik cihaz" hatası olduğundan seçenekli;
// kayıtta bulunan bilinmeyen değer "(özel)" olarak korunur.
//
// ⚠️ Kat rolleri KATALOGDAN gelir (2026-08-10). Sabit ["2-KAT","4-KAT"] listesi,
// panelden 6-KAT eklendiğinde o kata METRE ATANMASINI imkânsız kılardı — ve
// metresiz kat, mobilde elle girişe düşer (eskiden sessizce 2-KAT metresini
// kullanıyordu, yani YANLIŞ ÖLÇERDİ).
const STATIC_ROLE_OPTIONS = ["PRIMARY"] as const;

function routeTemplateId(initial: PeripheralDevice | null | undefined, kind: RouteLabelKind): string {
  return initial?.templateRoutes?.find((r) => r.kind === kind)?.templateId ?? "";
}

export function PeripheralDeviceFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  // Tablet sahibi seçimi (deviceService createCrudService değil → ayrı query).
  const devicesQuery = useQuery({
    queryKey: ["admin-devices", "picker"],
    queryFn: () => deviceService.list(),
    enabled: open,
  });
  const devices = devicesQuery.data?.data ?? [];

  // Rol seçenekleri = kat katalogu + PRIMARY. Yeni bir kat tanımlandığı an o
  // kata metre atanabilir olmalı; aksi halde katalog büyür, donanım büyümez.
  const { values: foldValues } = useFoldValues();
  const roleOptions: string[] = [...foldValues.map((v) => v.code), ...STATIC_ROLE_OPTIONS];

  // MAKİNESİZ istasyonlar (SHIPPING gibi) — istasyona-sabit donanım yalnız bunlara
  // bağlanabilir (backend enforce; liste baştan filtreli sunulur).
  const stationsQuery = useQuery({
    queryKey: ["stations", "picker", "machineless"],
    queryFn: () => loadAllForPicker(stationService),
    enabled: open,
  });
  const machinelessStations = (stationsQuery.data?.data ?? []).filter((st) => {
    const machines = (st as unknown as { machines?: Array<{ isActive?: boolean }> }).machines ?? [];
    return st.isActive && machines.filter((m) => m.isActive !== false).length === 0;
  });

  // Çapraz-kontrol için tüm cihazlar (aynı-MAC / çift-rol korkulukları). Donanım
  // sayısı düşük → picker helper yeterli. Uyarılar leaf-callout'ta (useWatch) —
  // liste değişse de yalnız ilgili kutu render olur.
  const peripheralsQuery = useQuery({
    queryKey: ["peripherals", "guard-list"],
    queryFn: () => loadAllForPicker(peripheralService),
    enabled: open,
  });
  const peripherals = peripheralsQuery.data?.data ?? [];

  const defaults: PeripheralFormValues = initial
    ? {
        code: initial.code,
        name: initial.name,
        kind: initial.kind,
        connectionType: initial.connectionType,
        address: initial.address ?? "",
        port: initial.port != null ? String(initial.port) : "",
        identifyPattern: initial.identifyPattern ?? "",
        readMode: initial.readMode ?? "POLL",
        pollCommand: initial.pollCommand ?? "",
        terminator: initial.terminator ?? "",
        decimals: initial.decimals != null ? String(initial.decimals) : "",
        scale: initial.scale != null ? String(initial.scale) : "",
        unit: initial.unit ?? "",
        timeoutMs: initial.timeoutMs != null ? String(initial.timeoutMs) : "",
        role: initial.role ?? "",
        simulate: initial.simulate ?? false,
        owner: initial.machineId
          ? "machine"
          : initial.stationId
            ? "station"
            : initial.deviceId
              ? "device"
              : "none",
        machineId: initial.machineId ?? "",
        stationId: initial.stationId ?? "",
        deviceId: initial.deviceId ?? "",
        languageOverride: initial.languageOverride ?? "",
        mediaType: initial.mediaType ?? "",
        rasterMode: initial.rasterMode ?? false,
        labelWidthMm: initial.labelWidthMm != null ? String(initial.labelWidthMm) : "",
        labelHeightMm: initial.labelHeightMm != null ? String(initial.labelHeightMm) : "",
        labelDpi: initial.labelDpi != null ? String(initial.labelDpi) : "",
        labelGapMm: initial.labelGapMm != null ? String(initial.labelGapMm) : "",
        templateRawId: routeTemplateId(initial, "ROLL_RAW"),
        templateFinishedId: routeTemplateId(initial, "ROLL_FINISHED"),
        templateSwatchId: routeTemplateId(initial, "SWATCH"),
        templateSackId: routeTemplateId(initial, "SACK"),
        notes: initial.notes ?? "",
      }
    : peripheralFormDefaults;

  return (
    <EntityFormDialog<PeripheralFormValues>
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? "Cihazı Düzenle" : "Yeni Cihaz"}
      schema={peripheralFormSchema}
      defaultValues={defaults}
      onSubmit={onSubmit}
      isSubmitting={isSubmitting}
    >
      {(form) => {
        const owner = form.watch("owner");
        const kind = form.watch("kind");
        const isInput = kind === "SCALE" || kind === "METER";
        const isPrinter = kind === "LABEL_PRINTER";
        const roleVal = form.watch("role");
        const readMode = form.watch("readMode");
        return (
          <>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Kod" error={form.formState.errors.code} required>
                <Input className="font-mono" {...form.register("code")} placeholder="BT-ARGOX-01" />
              </FormField>
              <FormField label="Ad" error={form.formState.errors.name} required>
                <Input {...form.register("name")} placeholder="Tambur Argox" />
              </FormField>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Tür">
                <select className={SELECT_CLS} {...form.register("kind")}>
                  {Object.entries(peripheralKindLabels).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Bağlantı">
                <select className={SELECT_CLS} {...form.register("connectionType")}>
                  {Object.entries(connectionTypeLabels).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </FormField>
            </div>

            {/* Adres/Port yalnız anlamlı olduğu bağlantıda: TCP=IP+port, BT=MAC,
                BLE=UUID, Seri=COM yolu. USB'de HİÇ gösterilmez — USB cihazın gerçek
                hedefi (kuyruk/port) basan bilgisayarda seçilir (Genel Ayarlar →
                Bu Bilgisayar), cihaz kartında adres tutulmaz. */}
            {(() => {
              const ct = form.watch("connectionType");
              if (ct === "USB") {
                return (
                  <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    USB cihazda adres gerekmez — hangi bilgisayardan kullanılacaksa
                    kuyruk/port orada seçilir (Genel Ayarlar → Bu Bilgisayar).
                  </p>
                );
              }
              const meta = {
                NETWORK_TCP: { label: "IP Adresi", hint: "Yazıcının sabit IP'si", ph: "192.168.1.50" },
                BLUETOOTH_SPP: { label: "MAC Adresi", hint: "BT Classic (HC-05/06)", ph: "00:23:09:01:05:5E" },
                BLE: { label: "BLE UUID", hint: "Cihazın servis UUID'si", ph: "0000ffe0-0000-1000-..." },
                SERIAL_COM: { label: "COM Yolu", hint: "Bilgi amaçlı — gerçek port basan PC'de seçilir", ph: "COM5 / /dev/tty.usbserial" },
              } as const;
              const m = meta[ct];
              return (
                <div className="grid grid-cols-3 gap-3">
                  <FormField label={m.label} hint={m.hint} className="col-span-2">
                    <Input className="font-mono" {...form.register("address")} placeholder={m.ph} />
                  </FormField>
                  {ct === "NETWORK_TCP" && (
                    <FormField label="Port" hint="boş → 9100">
                      <Input {...form.register("port")} placeholder="9100" />
                    </FormField>
                  )}
                </div>
              );
            })()}

            <SharedMacCallout
              control={form.control}
              peripherals={peripherals}
              currentId={initial?.id}
            />

            {/* Giriş cihazı (SCALE/METER) okuma protokolü */}
            {isInput && (
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Okuma Protokolü (kantar/metre)
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <FormField
                    label="Okuma Modu"
                    hint="Kantar genelde Yayın · metre Sorgu"
                    className="col-span-3"
                  >
                    <select className={SELECT_CLS} {...form.register("readMode")}>
                      {Object.entries(peripheralReadModeLabels).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </FormField>
                  <FormField
                    label="Sorgu Komutu"
                    hint={
                      readMode === "STREAM"
                        ? "Yayın modunda kullanılmaz"
                        : "TAM gönderilir · escape: \\r \\n \\xNN"
                    }
                  >
                    <Input
                      className="font-mono"
                      disabled={readMode === "STREAM"}
                      {...form.register("pollCommand")}
                      placeholder="TTTTTT"
                    />
                  </FormField>
                  <FormField label="Satır Sonu" hint="boş → CR/LF">
                    <Input className="font-mono" {...form.register("terminator")} placeholder={"\\r\\n"} />
                  </FormField>
                  <FormField label="Rol" hint="Tambur: kat kodu · tek metre: PRIMARY">
                    <select className={SELECT_CLS} {...form.register("role")}>
                      <option value="">— (yok)</option>
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                      {roleVal && !roleOptions.includes(roleVal) && (
                        <option value={roleVal}>{roleVal} (özel)</option>
                      )}
                    </select>
                  </FormField>
                  <FormField label="Ondalık" hint="0-4 (boş→1)">
                    <Input {...form.register("decimals")} placeholder="1" />
                  </FormField>
                  <FormField label="Ölçek" hint="cm→m: 0.01">
                    <Input {...form.register("scale")} placeholder="1" />
                  </FormField>
                  <FormField label="Birim">
                    <Input {...form.register("unit")} placeholder="m / kg" />
                  </FormField>
                  <FormField label="Zaman Aşımı (ms)" hint="boş→2500">
                    <Input {...form.register("timeoutMs")} placeholder="2500" />
                  </FormField>
                  <FormField
                    label="Veri Deseni (regex)"
                    hint="1. grup = değer · sabit-satır için: (\d+\.\d+)B"
                    className="col-span-2"
                  >
                    <Input className="font-mono text-xs" {...form.register("identifyPattern")} placeholder="(\d+(?:\.\d+)?)" />
                  </FormField>
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" {...form.register("simulate")} /> Simülasyon (sahte değer)
                  </label>
                  {/* Perf: address/simulate aboneliği form kökünden leaf'e taşındı —
                      Adres yazarken tüm form değil yalnız bu uyarı re-render olur. */}
                  <SimWarnCallout control={form.control} />
                  <RoleConflictCallout
                    control={form.control}
                    peripherals={peripherals}
                    currentId={initial?.id}
                  />
                </div>
              </div>
            )}

            {/* Sahiplik: serbest / makineye-sabit / makinesiz-istasyona-sabit.
                Çalışma oturumu modeli: donanım YERE bağlanır (makine, o yoksa
                makinesiz istasyon); tablete-bağlı seçenek yalnız ESKİ kayıtların
                round-trip'i için görünür (yeni seçim sunulmaz, Faz 6'da kalkar). */}
            <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/20 p-3">
              <FormField label="Sahip">
                <select className={SELECT_CLS} {...form.register("owner")}>
                  <option value="none">— (serbest)</option>
                  <option value="machine">Makineye sabit</option>
                  <option value="station">Makinesiz istasyona sabit</option>
                  {defaults.owner === "device" && (
                    <option value="device">Tablete bağlı (eski)</option>
                  )}
                </select>
              </FormField>
              {owner === "machine" && (
                <FormField label="Makine" className="col-span-2">
                  <Controller
                    control={form.control}
                    name="machineId"
                    render={({ field }) => (
                      <ReferenceSelect<Machine>
                        value={field.value || null}
                        onChange={(v) => field.onChange(v ?? "")}
                        service={machineService}
                        queryKey="machines"
                        getLabel={(m) => `${m.code} — ${m.name}`}
                        placeholder="Makine seç..."
                      />
                    )}
                  />
                </FormField>
              )}
              {owner === "station" && (
                <FormField
                  label="İstasyon"
                  hint="Yalnız makinesiz istasyonlar (örn. Sevkiyat)"
                  className="col-span-2"
                >
                  <select className={SELECT_CLS} {...form.register("stationId")}>
                    <option value="">İstasyon seç...</option>
                    {machinelessStations.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.code} — {st.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
              {owner === "device" && (
                <FormField label="Tablet" className="col-span-2">
                  <select className={SELECT_CLS} {...form.register("deviceId")}>
                    <option value="">Tablet seç...</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}{d.machine ? ` (${d.machine.code})` : ""}
                      </option>
                    ))}
                  </select>
                </FormField>
              )}
            </div>

            {/* Yazıcı dili/medyası + şablon yönlendirme — YALNIZ yazıcıda (metre/
                kantar'da gizli). Ayarların hepsi CİHAZA özeldir; medya (mm/dpi)
                doğrudan cihazda, şablonlar tek havuzdan seçilir + varyant
                uyumsuzluk hint'i (PrinterSettingsFields). */}
            {isPrinter && <PrinterSettingsFields form={form} />}

            {/* Aktiflik formdan YÖNETİLMEZ — yalnız listedeki Pasife Al / Aktifleştir /
                Kalıcı Sil aksiyonlarından (users kalıbı). */}
            <FormField label="Not">
              <Input {...form.register("notes")} placeholder="örn. seri hatta HC-06 lehimli" />
            </FormField>
          </>
        );
      }}
    </EntityFormDialog>
  );
}

/**
 * Perf: Gerçek adres tanımlı AMA simülasyon açık uyarısı. address/simulate'i
 * form kökünde form.watch ile okumak Adres alanına her tuş vuruşunda tüm formu
 * (Okuma Protokolü grid'i vb.) render ediyordu; useWatch'la bu leaf'e taşındı.
 * Yalnız SCALE/METER (isInput) bloğunda render edilir, ayrı kind kontrolü gerekmez.
 */
function SimWarnCallout({ control }: { control: Control<PeripheralFormValues> }) {
  const [address, simulate] = useWatch({ control, name: ["address", "simulate"] });
  if (!address?.trim() || !simulate) return null;
  return (
    <div className="col-span-3">
      <Callout tone="warning" title="Simülasyon açık — cihaz gerçekten okunmayacak">
        Bu cihazın adresi tanımlı ama <strong>Simülasyon</strong> işaretli:
        sahada gerçek okuma yapılmaz, sahte değer üretilir. Kurulum
        bittiyse kapatın.
      </Callout>
    </div>
  );
}

/**
 * Aynı makinede AYNI rol (2-KAT/4-KAT/PRIMARY) iki METRE/kantar cihazında
 * tanımlıysa uyar: mobil `meterPeripheralFor` kata göre okurken aynı rolden yalnız
 * İLKİNİ seçer → belirsiz/yanlış cihaz okunur. Leaf useWatch — rol/makine/tür/sahip
 * değişince yalnız bu kutu render olur.
 */
function RoleConflictCallout({
  control,
  peripherals,
  currentId,
}: {
  control: Control<PeripheralFormValues>;
  peripherals: PeripheralDevice[];
  currentId?: string;
}) {
  const [owner, machineId, role, kind] = useWatch({
    control,
    name: ["owner", "machineId", "role", "kind"],
  });
  const isInput = kind === "SCALE" || kind === "METER";
  const want = (role ?? "").trim();
  if (!isInput || owner !== "machine" || !machineId || !want) return null;
  const clash = peripherals.filter(
    (p) =>
      p.id !== currentId &&
      p.machineId === machineId &&
      (p.kind === "SCALE" || p.kind === "METER") &&
      (p.role ?? "").trim() === want,
  );
  if (clash.length === 0) return null;
  const names = clash.map((p) => p.name || p.code).join(", ");
  return (
    <div className="col-span-3">
      <Callout tone="warning" title={`Bu makinede "${want}" rolü zaten tanımlı`}>
        {names} aynı makinede aynı rolü taşıyor. Mobil, kata göre okurken bu rolden
        yalnız <strong>ilk</strong> cihazı seçer → belirsiz/yanlış okuma. Rolleri
        farklılaştır (örn. 2-KAT / 4-KAT).
      </Callout>
    </div>
  );
}

/**
 * Bu MAC (Bluetooth) başka cihaz kaydında da tanımlıysa BİLGİ ver: tek fiziksel
 * bağlantı (tek RFCOMM soketi) paylaşılır — DESTEKLENEN kurulum (tek kabloyla
 * 2-KAT + 4-KAT metre). Her kayıt farklı Rol + farklı Sorgu Komutu taşımalı; aksi
 * halde ikisi aynı değeri okur. Yalnız BLUETOOTH_SPP'de anlamlı (TCP multiplekslenir).
 */
function SharedMacCallout({
  control,
  peripherals,
  currentId,
}: {
  control: Control<PeripheralFormValues>;
  peripherals: PeripheralDevice[];
  currentId?: string;
}) {
  const [address, connectionType] = useWatch({ control, name: ["address", "connectionType"] });
  const mac = (address ?? "").trim().toUpperCase();
  if (!mac || connectionType !== "BLUETOOTH_SPP") return null;
  const peers = peripherals.filter(
    (p) => p.id !== currentId && (p.address ?? "").trim().toUpperCase() === mac,
  );
  if (peers.length === 0) return null;
  const names = peers.map((p) => `${p.name || p.code}${p.role ? ` (${p.role})` : ""}`).join(", ");
  return (
    <Callout tone="info" title="Bu MAC başka cihazla paylaşılıyor — tek fiziksel bağlantı">
      {names} ile aynı MAC. Bu <strong>desteklenen</strong> kurulumdur (örn. tek kabloyla
      2-KAT + 4-KAT metre): tek Bluetooth soketi paylaşılır. Her kayıt{" "}
      <strong>farklı Rol + farklı Sorgu Komutu</strong> taşımalı; aksi halde ikisi aynı
      değeri okur.
    </Callout>
  );
}
