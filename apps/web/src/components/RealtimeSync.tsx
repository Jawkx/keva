import { useQueryClient } from "@tanstack/react-query";
import { subscribeToRealtime } from "../lib/realtime-client";
import { useMountEffect } from "../lib/useMountEffect";

export function RealtimeSync() {
  const queryClient = useQueryClient();
  useMountEffect(() => subscribeToRealtime(queryClient));
  return null;
}
