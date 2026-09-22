import { useState } from "react";
import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { exportCodeVisible } from "./branch-schema";
import { Plus, Trash2, ChevronDown, ChevronRight, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/forms/FormField";
import { branchDraftDefaults, type CustomerFormValues } from "./schema";

interface Props {
  form: UseFormReturn<CustomerFormValues>;
}

const textareaClass =
  "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Tek-adım müşteri oluşturmada satır-içi (repeatable) şube editörü. Her satır kompakt
 * (Ad zorunlu + Şehir/İletişim/Telefon); "Detaylar" genişleticisi Kod/İlçe/Adres/Notlar'ı
 * açar. Kayıt YOK — form gönderilince müşteri + şubeler tek istekte atomik doğar.
 * Düzenleme modunda kullanılmaz (orada tam şube CRUD'ı ayrı sekmede).
 */
export function CustomerBranchesDraftField({ form }: Props) {
  const { control, register, formState } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "branches" });
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const branchErrors = formState.errors.branches;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Şubeler</span>
          <span className="text-xs text-muted-foreground">(opsiyonel — sevk noktaları)</span>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => append({ ...branchDraftDefaults })}
        >
          <Plus className="h-4 w-4" /> Şube ekle
        </Button>
      </div>

      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          İstersen şimdi sevk noktası (şube) ekle — müşteriyle birlikte tek seferde kaydedilir.
          Sonradan müşteriyi düzenleyerek de ekleyebilirsin.
        </p>
      ) : (
        <ul className="space-y-2">
          {fields.map((field, idx) => {
            const rowErr = branchErrors?.[idx];
            const isOpen = openRows[field.id] ?? false;
            return (
              <li key={field.id} className="space-y-2 rounded-md border p-3">
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="Şube Adı" required error={rowErr?.name}>
                    <Input
                      maxLength={100}
                      placeholder="Örn. Merkez Depo, Ankara Şubesi"
                      {...register(`branches.${idx}.name`)}
                    />
                  </FormField>
                  <FormField label="Şehir" error={rowErr?.city}>
                    <Input {...register(`branches.${idx}.city`)} />
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <FormField label="İletişim Kişisi" error={rowErr?.contactName}>
                    <Input {...register(`branches.${idx}.contactName`)} />
                  </FormField>
                  <FormField label="Telefon" error={rowErr?.contactPhone}>
                    <Input
                      inputMode="tel"
                      maxLength={40}
                      placeholder="0212 555 0000"
                      {...register(`branches.${idx}.contactPhone`)}
                    />
                  </FormField>
                </div>

                {isOpen && (
                  <div className="space-y-2 border-t pt-2">
                    <div className="grid grid-cols-2 gap-2">
                      <FormField label="Sevk yönü">
                        <Controller
                          control={control}
                          name={`branches.${idx}.defaultDestination`}
                          render={({ field: f }) => (
                            <Select value={f.value ?? "NONE"} onValueChange={(v) => f.onChange(v === "NONE" ? null : v)}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">Carinin yönü geçerli</SelectItem>
                                <SelectItem value="DOMESTIC">Yurtiçi</SelectItem>
                                <SelectItem value="EXPORT">Yurtdışı</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </FormField>
                      {exportCodeVisible(form.watch(`branches.${idx}.defaultDestination`), form.watch("defaultDestination")) && (
                        <FormField label="İhracat Kodu" error={rowErr?.code}>
                          <Input maxLength={50} placeholder="Opsiyonel" {...register(`branches.${idx}.code`)} />
                        </FormField>
                      )}
                      <FormField label="İlçe" error={rowErr?.district}>
                        <Input {...register(`branches.${idx}.district`)} />
                      </FormField>
                    </div>
                    <FormField label="Adres" error={rowErr?.address}>
                      <textarea rows={2} className={textareaClass} {...register(`branches.${idx}.address`)} />
                    </FormField>
                    <FormField label="Notlar" error={rowErr?.notes}>
                      <textarea rows={2} className={textareaClass} {...register(`branches.${idx}.notes`)} />
                    </FormField>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={() =>
                      setOpenRows((prev) => ({ ...prev, [field.id]: !isOpen }))
                    }
                  >
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    Detaylar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    title="Şubeyi kaldır"
                    onClick={() => remove(idx)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
