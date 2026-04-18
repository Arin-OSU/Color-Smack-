"use client";
import { useEffect, useState } from "react";

function readNow(): Date {
  const frozen = process.env.NEXT_PUBLIC_DEMO_FROZEN_NOW;
  const mode = process.env.NEXT_PUBLIC_DEMO_FROZEN_MODE;
  if (mode === "true" && frozen) return new Date(frozen);
  return new Date();
}

// Ticks every second so the TopBar clock feels alive even in replay mode.
// In frozen mode the value is static unless we explicitly advance it (future work).
export function useFrozenClock(): Date {
  const [now, setNow] = useState<Date>(() => readNow());
  useEffect(() => {
    const t = setInterval(() => setNow(readNow()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}
