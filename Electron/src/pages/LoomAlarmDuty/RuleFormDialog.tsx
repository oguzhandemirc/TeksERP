// Kademe kuralı formu — alıcı türü: holün vardiya sorumlusu · belirli kişi · belirli yetkiye sahip herkes.
// "Rol" alıcısı = yetki (programda kalıcı rol üyeliği yok; şablonlar kişiye kopyalanır).
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RULE_KIND_LABEL, ruleBodyError, toRuleBody, type PersonOption } from "./duty-model";
import { OptionPickerField } from "./OptionPickerModal";
import { TierToggle } from "./TierToggle";
import type { DutyPermissionOption, DutyRuleKind, DutyTier, RuleBody } from "./types";

interface Props {
  onOpenChange: (open: boolean) => void;
  people: readonly PersonOption[];
  permissions: readonly DutyPermissionOption[];
  busy: boolean;
  onSubmit: (body: RuleBody) => Promise<boolean>;
}

const KINDS: readonly DutyRuleKind[] = ["HALL_SHIFT", "USER", "PERMISSION"];

export function RuleFormDialog({ onOpenChange, people, permissions, busy, onSubmit }: Props) {
  const [tier, setTier] = useState<DutyTier>(1);
  const [kind, setKind] = useState<DutyRuleKind>("HALL_SHIFT");
  const [userId, setUser] = useState<string | null>(null);
  const [permissionCode, setPermission] = useState<string | null>(null);
  const body = toRuleBody({ tier, kind, userId, permissionCode });
  const error = ruleBodyError(body);
  const submit = async () => {
    if (await onSubmit(body)) onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Kademe kuralı</DialogTitle>
          <DialogDescription>Kademe çaldığında bildirimin kime gideceği. Bildirilen kişi alarmları görme yetkisine de sahip olmalı.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Kademe</Label>
            <TierToggle value={tier} onChange={setTier} />
          </div>
          <div className="space-y-1">
            <Label>Kime gider</Label>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <Button key={k} type="button" size="sm" variant={kind === k ? "default" : "outline"} onClick={() => setKind(k)}>{RULE_KIND_LABEL[k]}</Button>
              ))}
            </div>
          </div>
          {kind === "USER" && <OptionPickerField value={userId} onChange={setUser} title="Kişi seç" placeholder="Kişi seç" options={people} />}
          {kind === "PERMISSION" && (
            <OptionPickerField value={permissionCode} onChange={setPermission} title="Yetki seç" placeholder="Yetki seç"
              options={permissions.map((p) => ({ id: p.code, label: p.code, subLabel: p.description }))} />
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Vazgeç</Button>
          <Button type="button" disabled={error !== null || busy} onClick={() => void submit()}>Ekle</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
