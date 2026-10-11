import { useEffect, useState } from "react";
export function useNow(interval = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}
