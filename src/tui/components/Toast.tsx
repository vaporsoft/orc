import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";
import type { Toast as ToastData } from "../hooks/useToast.js";

interface ToastProps {
  toast: ToastData;
}

const TYPE_CONFIG = {
  info: { symbol: "›" },
  success: { symbol: "✓" },
  error: { symbol: "✗" },
} as const;

export function Toast({ toast }: ToastProps) {
  const theme = useTheme();
  const config = TYPE_CONFIG[toast.type];
  const color =
    toast.type === "error" ? theme.error :
    toast.type === "success" ? theme.accent :
    theme.muted;

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border}
      borderTop={false}
      borderBottom={false}
      paddingX={1}
      justifyContent="center"
    >
      <Text color={color} bold>{config.symbol} </Text>
      <Text color={color}>{toast.message}</Text>
    </Box>
  );
}
