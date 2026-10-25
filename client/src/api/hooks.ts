import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { http } from "./http";
import type {
  AdminStats,
  AiStatus,
  AdminTicketDetail,
  AdminTicketSummary,
  Book,
  BookTotals,
  DraftResponse,
  Pagination,
  RoyaltySchedule,
  TicketCategory,
  TicketDetail,
  TicketPriority,
  TicketStatus,
  TicketSummary,
} from "./types";

export const keys = {
  books: ["books"] as const,
  tickets: (filters?: object) => ["tickets", filters ?? {}] as const,
  ticket: (id: string) => ["ticket", id] as const,
  draft: (id: string) => ["draft", id] as const,
  stats: ["stats"] as const,
  admins: ["admins"] as const,
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useBooks() {
  return useQuery({
    queryKey: keys.books,
    queryFn: () => http.get<{ data: Book[]; totals: BookTotals; royaltySchedule: RoyaltySchedule }>("/books"),
  });
}

export interface TicketFilters {
  status?: string;
  category?: string;
  priority?: string;
  assignee?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: string;
  page?: number;
}

export function useTickets<T extends TicketSummary = TicketSummary>(filters: TicketFilters = {}) {
  return useQuery({
    queryKey: keys.tickets(filters),
    queryFn: () => http.get<{ data: T[]; pagination: Pagination }>("/tickets", { ...filters }),
    placeholderData: keepPreviousData,
  });
}

export const useAdminTickets = (filters: TicketFilters) => useTickets<AdminTicketSummary>(filters);

export function useTicket<T extends TicketDetail = TicketDetail>(id: string) {
  return useQuery({
    queryKey: keys.ticket(id),
    queryFn: () => http.get<{ data: T }>(`/tickets/${id}`).then((res) => res.data),
  });
}

export const useAdminTicket = (id: string) => useTicket<AdminTicketDetail>(id);

export function useDraft(id: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.draft(id),
    queryFn: () => http.get<DraftResponse>(`/tickets/${id}/draft`),
    enabled,
    staleTime: Infinity, // server decides when a draft is stale; refetched on new messages
    retry: false,
  });
}

interface Health {
  realtime: "sse" | "poll";
  ai: AiStatus;
}

export function useHealth() {
  return useQuery({ queryKey: ["health"], queryFn: () => http.get<Health>("/health"), staleTime: 60_000 });
}

export function useAiStatus() {
  const health = useHealth();
  return { ...health, data: health.data?.ai };
}

export function useStats() {
  return useQuery({ queryKey: keys.stats, queryFn: () => http.get<{ data: AdminStats }>("/admin/stats").then((r) => r.data) });
}

export function useAdmins() {
  return useQuery({
    queryKey: keys.admins,
    queryFn: () => http.get<{ data: { id: string; name: string; email: string }[] }>("/admin/users").then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** After any ticket change, refresh the detail view and every list. */
function useTicketMutation<TVars>(
  ticketId: string,
  fn: (vars: TVars) => Promise<{ data: AdminTicketDetail | TicketDetail }>,
  alsoInvalidate: QueryKey[] = [],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (res) => {
      qc.setQueryData(keys.ticket(ticketId), res.data);
      for (const queryKey of [["tickets"], keys.stats, ...alsoInvalidate]) void qc.invalidateQueries({ queryKey });
    },
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => http.post<{ data: TicketDetail }>("/tickets", form),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useReply(ticketId: string) {
  // A reply changes the thread, so the cached draft is stale.
  return useTicketMutation(
    ticketId,
    (body: { body: string; status?: TicketStatus; fromAiDraft?: boolean }) => http.post(`/tickets/${ticketId}/messages`, body),
    [keys.draft(ticketId)],
  );
}

export function useUpdateTicket(ticketId: string) {
  return useTicketMutation(
    ticketId,
    (body: { status?: TicketStatus; category?: TicketCategory; priority?: TicketPriority; assigneeId?: string | null }) =>
      http.patch(`/tickets/${ticketId}`, body),
  );
}

export function useAddNote(ticketId: string) {
  return useTicketMutation(ticketId, (body: { body: string }) => http.post(`/tickets/${ticketId}/notes`, body));
}

export function useReclassify(ticketId: string) {
  return useTicketMutation(ticketId, () => http.post(`/tickets/${ticketId}/classify`));
}

export function useRegenerateDraft(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => http.post<DraftResponse>(`/tickets/${ticketId}/draft/regenerate`),
    onSuccess: (res) => qc.setQueryData(keys.draft(ticketId), res),
  });
}
