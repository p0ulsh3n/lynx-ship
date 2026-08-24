import { useQuery } from "@tanstack/react-query";
import { Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";
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
import { formatDate } from "../../lib/utils";

export function UpdatesPage() {
  const query = useQuery({
    queryKey: ["releases", "uninitialized"],
    queryFn: () => api.releases("uninitialized"),
  });
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock message={query.error.message} />;
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle>OTA updates</CardTitle>
            <CardDescription>
              Signed releases, runtime compatibility and guarded rollout state.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {query.data.toReversed().map((release) => (
            <div
              key={release.id}
              className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:flex-row sm:items-center"
            >
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-400/10 text-cyan-300">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    Release #{release.manifest.sequence}
                  </span>
                  <Badge tone="neutral">{release.manifest.platform}</Badge>
                  <Badge tone={release.paused ? "warning" : "success"}>
                    {release.paused ? "Paused" : `${release.rollout}% rollout`}
                  </Badge>
                </div>
                <div className="mt-1 text-sm text-slate-400">
                  {release.message || "No release message"}
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  {release.id} · runtime {release.manifest.runtimeVersion} ·{" "}
                  {formatDate(release.createdAt)}
                </div>
              </div>
              <Button variant="outline" size="sm">
                {release.paused ? (
                  <Play className="h-3.5 w-3.5" />
                ) : (
                  <Pause className="h-3.5 w-3.5" />
                )}
                {release.paused ? "Resume" : "Pause"}
              </Button>
            </div>
          ))}
          {!query.data.length && (
            <div className="p-10 text-center text-sm text-slate-500">
              No OTA releases found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
