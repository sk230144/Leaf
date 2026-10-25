import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useUser, useAuth } from "../auth/AuthContext";
import { useTicketEvents, type ConnectionState } from "../lib/useTicketEvents";

const AUTHOR_NAV = [
  { to: "/books", label: "My Books" },
  { to: "/tickets", label: "My Tickets" },
  { to: "/tickets/new", label: "Get Help" },
];

const ADMIN_NAV = [{ to: "/admin/tickets", label: "Ticket Queue" }];

function LiveIndicator({ state }: { state: ConnectionState }) {
  const styles = {
    live: ["bg-emerald-500", "Live"],
    connecting: ["bg-amber-400", "Connecting"],
    offline: ["bg-slate-400", "Reconnecting"],
  }[state];
  return (
    <span className="hidden items-center gap-1.5 text-xs text-brand-100 sm:inline-flex" title="Real-time updates">
      <span className={`h-2 w-2 rounded-full ${styles[0]}`} />
      {styles[1]}
    </span>
  );
}

export function Layout() {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const connection = useTicketEvents(true);
  const nav = user.role === "ADMIN" ? ADMIN_NAV : AUTHOR_NAV;

  return (
    <div className="min-h-screen">
      <header className="bg-brand-600 text-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-white/15">🍃</span>
            BookLeaf
            <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider">
              {user.role === "ADMIN" ? "Ops" : "Authors"}
            </span>
          </div>
          <nav className="flex gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium transition ${isActive ? "bg-white/20 text-white" : "text-brand-100 hover:bg-white/10"}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <LiveIndicator state={connection} />
            <span className="hidden text-sm text-brand-100 md:inline">{user.name}</span>
            <button
              className="rounded-md px-2.5 py-1.5 text-sm text-brand-100 hover:bg-white/10"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
