// Katalog değerinin "varsayılan" işareti — gramaj, kat tipi ve benzeri seçenek çiplerinde TEK biçim: "<ad> ★" +
// ekran okuyucuya "<ad>, varsayılan". Her alan kendi yıldızını çizince biri unutuluyordu (kat tipinde ★ yoktu).

export interface DefaultChoiceText {
  label: string;
  a11y: string;
}

export function defaultChoiceText(name: string, isDefault?: boolean | null): DefaultChoiceText {
  return isDefault === true ? { label: `${name} ★`, a11y: `${name}, varsayılan` } : { label: name, a11y: name };
}
