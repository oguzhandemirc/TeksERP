// =============================================================================
// KASA HAREKETLERİ FİLTRE ŞERİDİ
// =============================================================================
// ⚠️ Şerit `PageBody`'nin DIŞINDA ve `shrink-0` — içine konursa liste kaydıkça
// filtreler yukarı kaçar ve kullanıcı hangi daraltmaya baktığını göremez
// (`ChequeFilterBar` emsali).
//
// ⚠️ VARSAYILAN "TÜMÜ"dür, "yalnız aktifler" DEĞİL. Kasa defteri bir DEFTERDİR:
// iptal edilmiş fiş silinmez, iz olarak kalır ve tam da "bu para nereye gitti"
// sorusunda aranır. Varsayılan olarak gizlemek, kullanıcının aradığı kaydı
// "yok" sanmasına yol açardı; iptal satırları listede soluk + üstü çizili
// tutarla zaten ayrışıyor (çek portföyünde tersi bilinçliydi — orası "elimde ne
// var" sorusudur, defter değil).
//
// ⚠️ Hesap seçici KOPYALANMAZ: `PeriodClose/CashAccountPicker` import edilir.
// Kasa+banka tek listede, pasif hesap gizlenmez işaretlenir.
// =============================================================================

import { RotateCcw, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CashAccountPicker, type CashAccountOption } from "../PeriodClose/CashAccountPicker";
import { EMPTY_FILTERS, KIND_LABEL, isFilterDirty, type CashTxnFilterState } from "./cashTxnRules";

interface Props {
  value: CashTxnFilterState;
  /** Seçili hesap nesnesi — süzgeç durumu yalnız tür+id taşır (sorgu şekli). */
  account: CashAccountOption | null;
  onAccountChange: (account: CashAccountOption | null) => void;
  onChange: (next: CashTxnFilterState) => void;
}

export function CashTxnFilterBar({ value, account, onAccountChange, onChange }: Props) {
  const set = <K extends keyof CashTxnFilterState>(key: K, v: CashTxnFilterState[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-6 py-3">
      <div className="relative w-72">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Belge no / kategori / açıklama / referans ara…"
          value={value.search}
          onChange={(e) => set("search", e.target.value)}
        />
      </div>

      <CashAccountPicker
        className="w-64"
        nullable
        value={account}
        onChange={(a) => {
          onAccountChange(a);
          onChange({ ...value, account: a ? { kind: a.kind, id: a.id } : null });
        }}
      />

      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value.kind}
        onChange={(e) => set("kind", e.target.value)}
      >
        <option value="">Tüm türler</option>
        {/* Virmanın iki bacağı AYRI seçenektir: "virman" diye tek seçenek
            sunmak backend'de CSV desteği olmadığı için sessizce tek bacağı
            süzerdi (uç `where.kind = <tek değer>`). */}
        {(Object.keys(KIND_LABEL) as Array<keyof typeof KIND_LABEL>).map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>

      <select
        className="h-9 rounded-md border bg-background px-2 text-sm"
        value={value.status}
        onChange={(e) => set("status", e.target.value)}
      >
        <option value="">Aktif + iptal</option>
        <option value="ACTIVE">Yalnız aktif</option>
        <option value="CANCELLED">Yalnız iptal</option>
      </select>

      <span className="text-xs text-muted-foreground">Tarih</span>
      <Input
        type="date"
        className="w-36"
        title="İşlem tarihi başlangıcı"
        value={value.from}
        onChange={(e) => set("from", e.target.value)}
      />
      <Input
        type="date"
        className="w-36"
        title="İşlem tarihi bitişi"
        value={value.to}
        onChange={(e) => set("to", e.target.value)}
      />

      {/* Temizle YALNIZ bir şey seçiliyken çıkar — hep duran bir düğme, hiçbir
          filtre yokken de "bir şey açık" izlenimi verir. */}
      {isFilterDirty(value) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onAccountChange(null);
            onChange(EMPTY_FILTERS);
          }}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" />
          Filtreleri temizle
        </Button>
      )}
    </div>
  );
}
