// vitest-axe@0.1.0, tip artırımını eski `declare global { namespace Vi }` paterniyle
// yapar; Vitest 3 ise matcher tiplerini `declare module 'vitest'` üzerinden okur
// (bkz. @testing-library/jest-dom/types/vitest.d.ts). Bu yüzden a11y matcher'ını
// modern modül-artırımıyla yeniden bildiriyoruz ki `expect(...).toHaveNoViolations()`
// tsc altında da tip-güvenli olsun.
import "vitest";
import type { AxeMatchers } from "vitest-axe/matchers";

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- jest-dom artırımıyla aynı imzayı korumak için T parametresi şart
  interface Assertion<T = unknown> extends AxeMatchers {}
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
