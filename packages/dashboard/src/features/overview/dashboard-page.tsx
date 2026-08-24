import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Cloud,
  Cpu,
  Plus,
  Rocket,
  Server,
  TrendingUp,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { api } from "../../api/client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { ErrorBlock, LoadingBlock } from "../../components/ui/loading";
import { formatDate, titleCase } from "../../lib/utils";

export function OverviewPage() {
  const builds = useQuery({ queryKey: ["builds"], queryFn: api.builds });
  const submissions = useQuery({
    queryKey: ["submissions"],
    queryFn: api.submissions,
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 30_000,
  });
  if (builds.isPending || submissions.isPending) return <LoadingBlock />;
  if (builds.isError) return <ErrorBlock message={builds.error.message} />;
  const buildItems = builds.data ?? [];
  const submissionItems = submissions.data ?? [];
  const successful = buildItems.filter(
    (build) => build.state === "success",
  ).length;
  return (
    <div className="space-y-8">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-sm text-slate-500">Sunday, August 23, 2026</p>
          <h1 className="text-3xl font-bold tracking-tight">
            Ship with confidence.
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">
            Build, submit and deliver LynxJS updates from one calm, auditable
            control plane.
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" asChild>
            <Link to="/updates">
              <Rocket className="h-4 w-4" />
              Publish update
            </Link>
          </Button>
          <Button asChild>
            <Link to="/builds">
              <Plus className="h-4 w-4" />
              New build
            </Link>
          </Button>
        </div>
      </section>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Build success rate"
          value={`${buildItems.length ? Math.round((successful / buildItems.length) * 100) : 100}%`}
          detail="Across recent builds"
          icon={TrendingUp}
          tone="cyan"
        />
        <MetricCard
          label="Active rollout"
          value="100%"
          detail="production · Android"
          icon={Rocket}
          tone="violet"
        />
        <MetricCard
          label="Build minutes"
          value="84 / 300"
          detail="Indie plan this month"
          icon={Clock3}
          tone="amber"
        />
        <MetricCard
          label="API status"
          value={health.data?.status === "ok" ? "Healthy" : "Checking"}
          detail="Persistent JSON state"
          icon={Cloud}
          tone="emerald"
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent builds</CardTitle>
              <CardDescription>
                The latest work across your mobile targets.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/builds">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <BuildList builds={buildItems.slice(-5).reverse()} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>System overview</CardTitle>
            <CardDescription>
              Runtime and worker readiness at a glance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <SystemRow
              icon={Server}
              label="Control plane"
              value="Ready"
              tone="success"
            />
            <SystemRow
              icon={Cpu}
              label="Android worker pool"
              value="1 ready"
              tone="success"
            />
            <SystemRow
              icon={Cloud}
              label="OTA service"
              value="Online"
              tone="success"
            />
            <SystemRow
              icon={CheckCircle2}
              label="Latest submission"
              value={
                submissionItems[0]?.status
                  ? titleCase(submissionItems[0].status)
                  : "No submissions"
              }
              tone="info"
            />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>What’s next</CardTitle>
          <CardDescription>
            Keep the release train moving without losing the audit trail.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <NextStep
            number="01"
            title="Run a preview build"
            description="Validate the current LynxJS bundle on an internal profile."
            to="/builds"
          />
          <NextStep
            number="02"
            title="Review the rollout"
            description="Check health signals before promoting a candidate release."
            to="/updates"
          />
          <NextStep
            number="03"
            title="Invite your team"
            description="Give contributors scoped access to the project."
            to="/team"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof TrendingUp;
  tone: "cyan" | "violet" | "amber" | "emerald";
}) {
  const colors = {
    cyan: "bg-cyan-400/10 text-cyan-300",
    violet: "bg-violet-400/10 text-violet-300",
    amber: "bg-amber-400/10 text-amber-300",
    emerald: "bg-emerald-400/10 text-emerald-300",
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="mt-3 text-2xl font-bold tracking-tight">{value}</div>
          <div className="mt-1 text-xs text-slate-500">{detail}</div>
        </div>
        <div
          className={`grid h-9 w-9 place-items-center rounded-xl ${colors[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </Card>
  );
}

function BuildList({
  builds,
}: {
  builds: Array<{
    id: string;
    platform: string;
    profile: string;
    state: string;
    createdAt?: string;
  }>;
}) {
  if (!builds.length)
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        No builds yet.
      </div>
    );
  return (
    <div className="divide-y divide-slate-800/80">
      {builds.map((build) => (
        <div
          key={build.id}
          className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
        >
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-800 text-xs font-bold text-slate-300">
            {build.platform === "ios" ? "iOS" : "A"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {build.profile} · {build.platform}
            </div>
            <div className="text-xs text-slate-500">
              {build.id} · {formatDate(build.createdAt)}
            </div>
          </div>
          <StatusBadge status={build.state} />
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "success" || status === "ready"
      ? "success"
      : status === "failed" || status === "canceled"
        ? "danger"
        : status === "building"
          ? "info"
          : "warning";
  return <Badge tone={tone}>{titleCase(status)}</Badge>;
}

function SystemRow({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Server;
  label: string;
  value: string;
  tone: "success" | "info";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-950/50 px-3 py-3">
      <Icon className="h-4 w-4 text-slate-500" />
      <span className="flex-1 text-sm text-slate-300">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

function NextStep({
  number,
  title,
  description,
  to,
}: {
  number: string;
  title: string;
  description: string;
  to: "/builds" | "/updates" | "/team";
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-slate-800 bg-slate-950/40 p-4 transition hover:border-cyan-400/30 hover:bg-slate-800/50"
    >
      <div className="mb-5 text-xs font-bold text-cyan-400">{number}</div>
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{description}</div>
    </Link>
  );
}
