import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../api/hooks";

export type ConnectionState = "connecting" | "live" | "offline";

/**
 * Subscribes to the server's SSE stream and refreshes affected queries when
 * a ticket changes, so replies/status updates appear without a page refresh.
 * EventSource reconnects automatically; on reconnect we refetch everything
 * in case events were missed while offline.
 */
export function useTicketEvents(enabled: boolean): ConnectionState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events", { withCredentials: true });
    let hasConnectedBefore = false;

    source.addEventListener("ready", () => {
      setState("live");
      if (hasConnectedBefore) void queryClient.invalidateQueries();
      hasConnectedBefore = true;
    });

    source.addEventListener("ticket", (event) => {
      const { type, ticketId } = JSON.parse((event as MessageEvent).data) as { type: string; ticketId: string };
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      void queryClient.invalidateQueries({ queryKey: keys.ticket(ticketId) });
      void queryClient.invalidateQueries({ queryKey: keys.stats });
      // A new message makes the cached draft stale; the server will regenerate it.
      if (type === "ticket.message") void queryClient.invalidateQueries({ queryKey: keys.draft(ticketId) });
    });

    source.onerror = () => setState("offline");
    return () => source.close();
  }, [enabled, queryClient]);

  return enabled ? state : "offline";
}
