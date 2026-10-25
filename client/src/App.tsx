import { Navigate, Route, Routes } from "react-router-dom";
import type { Role } from "./api/types";
import { useAuth } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { PageLoader } from "./components/ui";
import { LoginPage } from "./pages/LoginPage";
import { BooksPage } from "./pages/author/BooksPage";
import { MyTicketsPage } from "./pages/author/MyTicketsPage";
import { NewTicketPage } from "./pages/author/NewTicketPage";
import { AuthorTicketPage } from "./pages/author/AuthorTicketPage";
import { QueuePage } from "./pages/admin/QueuePage";
import { AdminTicketPage } from "./pages/admin/AdminTicketPage";

const homeFor = (role: Role) => (role === "ADMIN" ? "/admin/tickets" : "/books");

/** Route guard: the server enforces access too - this just avoids dead-end pages. */
function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <Layout />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={homeFor(user.role)} replace /> : <LoginPage />} />

      <Route element={<RequireRole role="AUTHOR" />}>
        <Route path="/books" element={<BooksPage />} />
        <Route path="/tickets" element={<MyTicketsPage />} />
        <Route path="/tickets/new" element={<NewTicketPage />} />
        <Route path="/tickets/:id" element={<AuthorTicketPage />} />
      </Route>

      <Route element={<RequireRole role="ADMIN" />}>
        <Route path="/admin/tickets" element={<QueuePage />} />
        <Route path="/admin/tickets/:id" element={<AdminTicketPage />} />
      </Route>

      <Route path="*" element={<Navigate to={user ? homeFor(user.role) : "/login"} replace />} />
    </Routes>
  );
}
