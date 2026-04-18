export function nowFrozen(): Date {
  const mode =
    process.env.DEMO_FROZEN_MODE ?? process.env.NEXT_PUBLIC_DEMO_FROZEN_MODE;
  const frozen =
    process.env.DEMO_FROZEN_NOW ?? process.env.NEXT_PUBLIC_DEMO_FROZEN_NOW;
  if (mode === "true" && frozen) return new Date(frozen);
  return new Date();
}

export function isFrozenMode(): boolean {
  return (
    (process.env.DEMO_FROZEN_MODE ?? process.env.NEXT_PUBLIC_DEMO_FROZEN_MODE) ===
    "true"
  );
}

export const EASTERN_TZ = "America/New_York";
