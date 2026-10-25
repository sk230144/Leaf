import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api/http";
import { useAuth } from "../auth/AuthContext";
import { Spinner } from "../components/ui";

const DEMO_ACCOUNTS = [
  { label: "Admin (Ops team)", email: "admin@bookleaf.com", password: "Admin@123" },
  { label: "Author · Ananya Reddy", email: "ananya.reddy@email.com", password: "Author@123" },
  { label: "Author · Sneha Kulkarni", email: "sneha.kulkarni@email.com", password: "Author@123" },
  { label: "Author · Arjun Malhotra (no tickets)", email: "arjun.malhotra@email.com", password: "Author@123" },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const user = await login(email, password);
      navigate(user.role === "ADMIN" ? "/admin/tickets" : "/books", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-2xl">🍃</div>
          <h1 className="text-2xl font-semibold text-slate-900">BookLeaf Support</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your author or team account</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting && <Spinner />} Sign in
          </button>
        </form>

        <div className="card mt-4 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Demo accounts</p>
          <div className="grid gap-1.5">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.email}
                type="button"
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                }}
              >
                <span className="text-slate-700">{account.label}</span>
                <span className="text-xs text-slate-400">{account.email}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">All 10 authors from the dataset can sign in with password Author@123.</p>
        </div>
      </div>
    </div>
  );
}
