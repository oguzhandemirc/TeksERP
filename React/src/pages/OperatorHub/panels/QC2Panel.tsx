import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ScanLine,
  AlertTriangle,
  Ruler,
  Save,
  Delete as DeleteIcon,
  Shield,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { rollService } from "@/services/rollService";
import { productionService } from "@/services/productionService";
import type { Roll } from "@/types/models";

const errorTypeOptions = [
  { value: "LEKE", label: "Leke" },
  { value: "YIRTIK", label: "Yırtık" },
  { value: "DELIK", label: "Delik" },
  { value: "RENK_FARKI", label: "Renk Farkı" },
  { value: "ATKISI_HATASI", label: "Atkı Hatası" },
  { value: "DIGER", label: "Diğer" },
];

/** Numerik tuş — büyük dokunmatik tasarım. */
function Keypad({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const press = (key: string) => {
    if (key === "C") return onChange("");
    if (key === "←") return onChange(value.slice(0, -1));
    if (key === ".") {
      if (!value.includes(".")) onChange(value + ".");
      return;
    }
    onChange(value + key);
  };
  const btns = [
    "7",
    "8",
    "9",
    "4",
    "5",
    "6",
    "1",
    "2",
    "3",
    ".",
    "0",
    "←",
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {btns.map((b) => (
        <button
          key={b}
          type="button"
          onClick={() => press(b)}
          className="h-14 text-xl font-semibold rounded-md bg-muted hover:bg-muted/80 cursor-pointer"
        >
          {b}
        </button>
      ))}
      <button
        type="button"
        onClick={() => press("C")}
        className="col-span-3 h-11 rounded-md bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100 font-medium cursor-pointer hover:bg-amber-200"
      >
        <DeleteIcon className="h-4 w-4 inline mr-1" /> Temizle (C)
      </button>
    </div>
  );
}

export default function QC2Panel() {
  const qc = useQueryClient();
  const [barcode, setBarcode] = useState("");
  const [roll, setRoll] = useState<Roll | null>(null);
  const [active, setActive] = useState<"start" | "end">("start");
  const [startMeter, setStartMeter] = useState("");
  const [endMeter, setEndMeter] = useState("");
  const [errorType, setErrorType] = useState("DIGER");

  const { data: rollData } = useQuery({
    queryKey: ["roll-by-id", roll?.id],
    queryFn: () => rollService.getById(roll!.id),
    enabled: !!roll?.id,
    refetchInterval: 10000,
  });
  const freshRoll = rollData?.data ?? roll;

  const lookupMutation = useMutation({
    mutationFn: (bc: string) => rollService.getByBarcode(bc),
    onSuccess: (res) => {
      if (res.data) {
        setRoll(res.data);
      }
    },
    onError: (err: unknown) => {
      setRoll(null);
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "Top bulunamadı";
      toast.error(msg);
    },
  });

  const errorMutation = useMutation({
    mutationFn: () =>
      productionService.reportError({
        rollId: roll!.id,
        startMeter: Number(startMeter),
        endMeter: Number(endMeter),
        errorType,
      }),
    onSuccess: () => {
      toast.success(
        `Hata kaydı eklendi: ${startMeter}-${endMeter}m (${errorType})`,
      );
      setStartMeter("");
      setEndMeter("");
      setActive("start");
      qc.invalidateQueries({ queryKey: ["roll-by-id", roll?.id] });
      qc.invalidateQueries({ queryKey: ["rolls"] });
      qc.invalidateQueries({ queryKey: ["tambur-pending"] });
    },
    onError: () => toast.error("Hata raporlanamadı"),
  });

  const canSave =
    !!roll &&
    Number(startMeter) >= 0 &&
    Number(endMeter) > Number(startMeter) &&
    errorMutation.isPending === false;

  return (
    <div className="space-y-4">
      {/* Barkod Sorgu */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5" />
            Kurşun (Kalite Kontrol 2) — Hata Metrajı Girişi
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && barcode.trim()) {
                  e.preventDefault();
                  lookupMutation.mutate(barcode.trim());
                }
              }}
              placeholder="Top barkodu okutun…"
              className="h-12 font-mono"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!barcode.trim() || lookupMutation.isPending}
              onClick={() => lookupMutation.mutate(barcode.trim())}
              isLoading={lookupMutation.isPending}
            >
              <ScanLine className="h-4 w-4" /> Sorgula
            </Button>
          </div>

          {freshRoll && (
            <div className="rounded-md border p-3 bg-muted/30 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="default">{freshRoll.barcode}</Badge>
                <span className="text-sm font-semibold">
                  {freshRoll.item?.code}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {freshRoll.item?.name}
                </span>
                <span className="ml-auto flex items-center gap-1 text-sm">
                  <Ruler className="h-3.5 w-3.5" />
                  {freshRoll.currentQty.toFixed(1)}m
                </span>
              </div>
              {freshRoll.errors && freshRoll.errors.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {freshRoll.errors.map((e) => (
                    <Badge
                      key={e.id}
                      variant="outline"
                      className="text-[11px]"
                    >
                      <AlertTriangle className="h-3 w-3 mr-1" />
                      {e.startMeter}–{e.endMeter}m {e.errorType ?? ""}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hata Girişi */}
      {roll && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Yeni Hata Kaydı</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setActive("start")}
                className={`rounded-lg border p-3 text-left cursor-pointer ${
                  active === "start"
                    ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                    : "hover:border-primary/40"
                }`}
              >
                <p className="text-xs text-muted-foreground">Başlangıç (m)</p>
                <p className="text-2xl font-bold font-mono">
                  {startMeter || "0"}
                </p>
              </button>

              <button
                type="button"
                onClick={() => setActive("end")}
                className={`rounded-lg border p-3 text-left cursor-pointer ${
                  active === "end"
                    ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                    : "hover:border-primary/40"
                }`}
              >
                <p className="text-xs text-muted-foreground">Bitiş (m)</p>
                <p className="text-2xl font-bold font-mono">
                  {endMeter || "0"}
                </p>
              </button>
            </div>

            <Keypad
              value={active === "start" ? startMeter : endMeter}
              onChange={(v) =>
                active === "start" ? setStartMeter(v) : setEndMeter(v)
              }
            />

            <div className="space-y-1">
              <Label className="text-xs">Hata Türü</Label>
              <Select
                value={errorType}
                onChange={(e) => setErrorType(e.target.value)}
                options={errorTypeOptions}
              />
            </div>

            <Button
              type="button"
              disabled={!canSave}
              onClick={() => errorMutation.mutate()}
              isLoading={errorMutation.isPending}
              className="w-full h-12"
            >
              <Save className="h-4 w-4" /> Hatayı Kaydet
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
