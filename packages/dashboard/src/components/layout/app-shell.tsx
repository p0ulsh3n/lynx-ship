import {
  Activity,
  ArrowUpRight,
  Boxes,
  CircleHelp,
  GitBranch,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  UploadCloud,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

const navigation: Array<{
  label: string;
  to: string;
  icon: LucideIcon;
  exact?: boolean;
}> = [
  { label: "Overview", to: "/", icon: LayoutDashboard, exact: true },
  { label: "Builds", to: "/builds", icon: Boxes },
  { label: "Submissions", to: "/submissions", icon: UploadCloud },
  { label: "OTA updates", to: "/updates", icon: ArrowUpRight },
  { label: "Workers", to: "/workers", icon: GitBranch },
  { label: "Team & access", to: "/team", icon: Users },
  { label: "Settings", to: "/settings", icon: Settings2 },
];

export function AppShell() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  return (
    <div className="min-h-screen bg-[#07111f] text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-800/80 bg-[#091525] lg:flex lg:flex-col">
        <div className="flex h-20 items-center gap-3 border-b border-slate-800/80 px-6">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-400 font-black text-slate-950">
            L
          </div>
          <div>
            <div className="font-semibold tracking-tight">LynxShip</div>
            <div className="text-[11px] text-slate-500">Control plane</div>
          </div>
        </div>
        <div className="px-4 py-5">
          <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
            Workspace
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-violet-400/15 text-sm font-bold text-violet-300">
              A
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">Acme Mobile</div>
              <div className="truncate text-xs text-slate-500">production</div>
            </div>
            <Activity className="h-4 w-4 text-emerald-400" />
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-4">
          {navigation.map(({ label, to, icon: Icon, exact }) => {
            const active = exact ? pathname === to : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                  active
                    ? "bg-cyan-400/10 font-semibold text-cyan-300"
                    : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-100",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
                {label === "Builds" && (
                  <Badge className="ml-auto px-2 py-0.5" tone="info">
                    3
                  </Badge>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-800/80 p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-amber-400/20 text-xs font-bold text-amber-300">
              JD
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm">Jordan Davis</div>
              <div className="truncate text-xs text-slate-500">Owner</div>
            </div>
          </div>
          <button className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-200">
            <CircleHelp className="h-4 w-4" />
            Help center
          </button>
        </div>
      </aside>
      <main className="lg:pl-64">
        <header className="flex h-20 items-center justify-between border-b border-slate-800/80 px-5 sm:px-8">
          <div>
            <div className="text-xs font-medium text-slate-500">
              Workspace / <span className="text-slate-300">Acme Mobile</span>
            </div>
            <div className="mt-1 text-lg font-semibold">
              {pageTitle(pathname)}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone="success">
              <ShieldCheck className="h-3.5 w-3.5" />
              All systems operational
            </Badge>
            <div className="hidden h-8 w-px bg-slate-800 sm:block" />
            <div className="grid h-9 w-9 place-items-center rounded-full bg-amber-400/20 text-xs font-bold text-amber-300">
              JD
            </div>
          </div>
        </header>
        <div className="p-5 sm:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function pageTitle(pathname: string) {
  if (pathname === "/") return "Overview";
  if (pathname.startsWith("/updates")) return "OTA updates";
  if (pathname.startsWith("/team")) return "Team & access";
  if (pathname.startsWith("/settings")) return "Settings";
  return pathname
    .slice(1)
    .replaceAll("-", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
