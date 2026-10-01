/**
 * The current time, refreshed every minute — enough for list labels such as
 * "today hh:mm / 어제 / date" to roll over at midnight without a reload.
 */
import { useEffect, useState } from 'react';

const CLOCK_TICK_MS = 60_000;

export function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}
