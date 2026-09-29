// Tek palet; büyük dokunma hedefi (≥ 48 pt) ve okunur yazı ("basit olan fazladır").
export const color = {
  bg: "#F4F5F7",
  card: "#FFFFFF",
  text: "#1B1F24",
  muted: "#5E6773",
  line: "#DDE1E6",
  primary: "#1F5FAD",
  primaryText: "#FFFFFF",
  danger: "#B42318",
  warn: "#8A5A00",
  warnBg: "#FFF4D6",
  offBg: "#E8EAED",
  ok: "#1E7B34",
} as const;

export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const;
export const TOUCH = 48;
export const WIDE_MIN = 768;
