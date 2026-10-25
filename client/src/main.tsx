import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "./api/http";
import { AuthProvider } from "./auth/AuthContext";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  // An expired session on any request sends the user back to sign in.
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) window.location.assign("/login");
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Real-time updates come over SSE; this is only a safety net.
      refetchOnWindowFocus: true,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
