import { Controller } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { EntityFormDialog } from "@/components/forms/EntityFormDialog";
import { FormField } from "@/components/forms/FormField";
import { ReferenceSelect } from "@/components/forms/ReferenceSelect";
import { Input } from "@/components/ui/input";
import { machineService } from "@/pages/Machines/service";
import type { Machine } from "@/pages/Machines/types";
import { printerModelService } from "@/pages/PrinterModels/service";
import type { PrinterModel } from "@/pages/PrinterModels/types";
import { labelFormatProfileService } from "@/pages/LabelFormatProfiles/service";
import type { LabelFormatProfile } from "@/pages/LabelFormatProfiles/types";
import { labelTemplateService } from "@/services/labelTemplateService";
import { deviceService } from "@/pages/Devices/service";
import {
  peripheralFormDefaults,
  peripheralFormSchema,
  type PeripheralFormValues,
} from "./schema";
import { connectionTypeLabels, peripheralKindLabels, type PeripheralDevice, type RouteLabelKind } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: PeripheralDevice | null;
  onSubmit: (values: PeripheralFormValues) => void | Promise<void>;
  isSubmitting?: boolean;
}

const SELECT_CLS = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

const LANGS = ["RASTER_HTML", "PPLA", "PPLB", "ZPL"] as const;
const ROUTE_KINDS: { key: RouteLabelKind; label: string; field: "templateRawId" | "templateFinishedId" | "templateSwatchId" }[] = [
  { key: "ROLL_RAW", label: "Ham Top (KK1)", field: "templateRawId" },
  { key: "ROLL_FINISHED", label: "Bitmiş Top (Tambur)", field: "templateFinishedId" },
  { key: "SWATCH", label: "Kartela", field: "templateSwatchId" },
];

function routeTemplateId(initial: PeripheralDevice | null | undefined, kind: RouteLabelKind): string {
  return initial?.templateRoutes?.find((r) => r.kind === kind)?.templateId ?? "";
}

export function PeripheralDeviceFormDialog({ open, onOpenChange, initial, onSubmit, isSubmitting }: Props) {
  // Şablon yönlendirme select'leri için tüm şablonlar (kind'a göre gruplanır).
  const templatesQuery = useQuery({
    queryKey: ["label-templates", "all"],
    queryFn: () => labelTemplateService.list(),
    enabled: open,
  });
  const templates = templatesQuery.data?.data ?? [];

  // Tablet sahibi seçimi (deviceService createCrudService değil → ayrı query).
  const devicesQuery = useQuery({
    queryKey: ["admin-devices", "picker"],
    queryFn: () => deviceService.list(),
    enabled: open,
  });
  const devices = devicesQuery.data?.data ?? [];

  const defaults: PeripheralFormValues = initial
    ? {
        code: initial.code,
        name: initial.name,
        kind: initial.kind,
        connectionType: initial.connectionType,
        address: initial.address ?? "",
        port: initial.port != null ? String(initial.port) : "",
        identifyPattern: initial.identifyPattern ?? "",
        pollCommand: initial.pollCommand ?? "",
        terminator: initial.terminator ?? "",
        decimals: initial.decimals != null ? String(initial.decimals) : "",
        scale: initial.scale != null ? String(initial.scale) : "",
        unit: initial.unit ?? "",
        timeoutMs: initial.timeoutMs != null ? String(initial.timeoutMs) : "",
        role: initial.role ?? "",
        simulate: initial.simulate ?? false,
        owner: initial.machineId ? "machine" : initial.deviceId ? "device" : "none",
        machineId: initial.machineId ?? "",
        deviceId: initial.deviceId ?? "",
        printerModelId: initial.printerModelId ?? "",
        formatProfileId: initial.formatProfileId ?? "",
        languageOverride: initial.languageOverride ?? "",
        templateRawId: routeTemplateId(initial, "ROLL_RAW"),
        templateFinishedId: routeTemplateId(initial, "ROLL_FINISHED"),
        templateSwatchId: routeTemplateId(initial, "SWATCH"),
        notes: initial.notes ?? "",
        isActive: initial.isActive,
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

            <div className="grid grid-cols-3 gap-3">
              <FormField label="Adres" hint="IP / MAC / COM / UUID" className="col-span-2">
                <Input className="font-mono" {...form.register("address")} placeholder="192.168.1.50 / 00:23:09:..." />
              </FormField>
              <FormField label="Port" hint="TCP (boş→9100)">
                <Input {...form.register("port")} placeholder="9100" />
              </FormField>
            </div>

            <FormField label="Veri Deseni (regex)" hint="Kantar/metraj cihazı için (yazıcıda boş).">
              <Input className="font-mono text-xs" {...form.register("identifyPattern")} placeholder="(\d+(?:\.\d+)?)" />
            </FormField>

            {/* Giriş cihazı (SCALE/METER) okuma protokolü */}
            {isInput && (
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Okuma Protokolü (kantar/metre)
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="Sorgu Komutu" hint="İstek-cevap (boş=dinle)">
                    <Input className="font-mono" {...form.register("pollCommand")} placeholder="R" />
                  </FormField>
                  <FormField label="Satır Sonu" hint="boş → CR/LF">
                    <Input className="font-mono" {...form.register("terminator")} placeholder={"\\r\\n"} />
                  </FormField>
                  <FormField label="Rol" hint="2-KAT / 4-KAT / PRIMARY">
                    <Input {...form.register("role")} placeholder="2-KAT" />
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
                  <label className="col-span-2 flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" {...form.register("simulate")} /> Simülasyon (sahte değer)
                  </label>
                </div>
              </div>
            )}

            {/* Sahiplik: serbest / makineye-sabit / tablete-bağlı */}
            <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/20 p-3">
              <FormField label="Sahip">
                <select className={SELECT_CLS} {...form.register("owner")}>
                  <option value="none">— (serbest)</option>
                  <option value="machine">Makineye sabit</option>
                  <option value="device">Tablete bağlı</option>
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

            {/* Yazıcı dili/profili */}
            <div className="grid grid-cols-3 gap-3 rounded-md border bg-muted/20 p-3">
              <FormField label="Yazıcı Modeli" hint="Dil buradan (Argox=PPLA).">
                <Controller
                  control={form.control}
                  name="printerModelId"
                  render={({ field }) => (
                    <ReferenceSelect<PrinterModel>
                      value={field.value || null}
                      onChange={(v) => field.onChange(v ?? "")}
                      service={printerModelService}
                      queryKey="printer-models"
                      getLabel={(m) => `${m.code} — ${m.name}`}
                      placeholder="Model seç..."
                      nullable
                      noneLabel="— (tanımsız)"
                    />
                  )}
                />
              </FormField>
              <FormField label="Format Profili" hint="Boş → model default.">
                <Controller
                  control={form.control}
                  name="formatProfileId"
                  render={({ field }) => (
                    <ReferenceSelect<LabelFormatProfile>
                      value={field.value || null}
                      onChange={(v) => field.onChange(v ?? "")}
                      service={labelFormatProfileService}
                      queryKey="label-format-profiles"
                      getLabel={(p) => `${p.code} — ${p.name}`}
                      placeholder="Profil seç..."
                      nullable
                      noneLabel="— (model default)"
                    />
                  )}
                />
              </FormField>
              <FormField label="Dil (override)" hint="Boş → model/global.">
                <select className={SELECT_CLS} {...form.register("languageOverride")}>
                  <option value="">— (model/global)</option>
                  {LANGS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </FormField>
            </div>

            {/* Şablon yönlendirme (per-kind; boş → kind varsayılanı) */}
            <div className="rounded-md border bg-muted/20 p-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">
                Şablon Yönlendirme (boş → tür varsayılanı)
              </div>
              <div className="grid grid-cols-1 gap-2">
                {ROUTE_KINDS.map((r) => (
                  <FormField key={r.key} label={r.label}>
                    <select className={SELECT_CLS} {...form.register(r.field)}>
                      <option value="">— (varsayılan)</option>
                      {templates
                        .filter((t) => t.kind === r.key)
                        .map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                  </FormField>
                ))}
              </div>
            </div>

            <FormField label="Not">
              <Input {...form.register("notes")} placeholder="örn. seri hatta HC-06 lehimli" />
            </FormField>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" {...form.register("isActive")} /> Aktif
            </label>
          </>
        );
      }}
    </EntityFormDialog>
  );
}
