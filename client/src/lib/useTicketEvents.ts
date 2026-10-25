import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../api/hooks";

export type ConnectionState = "connecting" | "live" | "offline";
export type RealtimeMode = "sse" | "poll";

/** Poll interval used where SSE isn't available (serverless deploys). */
const POLL_MS = 5_000;

/**
 * Keeps ticket data fresh so replies/status updates appear without a page
 * refresh.
 *
 * - "sse": subscribes to the server's event stream and refreshes only the
 *   affected queries. EventSource reconnects automatically; on reconnect we
 *   refetch everything in case events were missed while offline.
 * - "poll": on serverless hosts there is no long-lived process to push
 *   events, so ticket queries are refreshed every few seconds while the tab
 *   is visible.
 */
export function useTicketEvents(mode: RealtimeMode | undefined): ConnectionState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    if (mode !== "poll") return;
    setState("live");
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      for (const queryKey of [["tickets"], ["ticket"], keys.stats]) void queryClient.invalidateQueries({ queryKey });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [mode, queryClient]);

  useEffect(() => {
    if (mode !== "sse") return;
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
  }, [mode, queryClient]);

  return mode ? state : "connecting";
}
