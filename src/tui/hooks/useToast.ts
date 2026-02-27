import { useState, useCallback, useRef } from "react";

export interface Toast {
  message: string;
  type: "info" | "success" | "error";
}

export function useToast(durationMs = 3000) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (message: string, type: Toast["type"] = "info") => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, type });
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, durationMs);
    },
    [durationMs],
  );

  return { toast, showToast } as const;
}
