import { useQuery } from "@tanstack/react-query";
import { Cpu, RefreshCw } from "lucide-react";
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

export function WorkersPage() {
  const query = useQuery({
    queryKey: ["workers", "local_org"],
    queryFn: () => api.workers("local_org"),
  });
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock message={query.error.message} />;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Workers</CardTitle>
          <CardDescription>
            Registered BYOW and managed execution capacity.
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
      <CardContent className="grid gap-3 md:grid-cols-2">
        {query.data.map((worker) => (
          <div
            key={worker.id}
            className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4"
          >
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-400/10 text-violet-300">
              <Cpu className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{worker.name}</div>
              <div className="mt-1 text-xs text-slate-500">
                {worker.platform} · {worker.id}
              </div>
            </div>
            <Badge tone={worker.status === "ready" ? "success" : "warning"}>
              {worker.status}
            </Badge>
          </div>
        ))}
        {!query.data.length && (
          <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500 md:col-span-2">
            No workers registered for this organization.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
