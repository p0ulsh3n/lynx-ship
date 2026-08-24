import { useQuery } from "@tanstack/react-query";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { ErrorBlock, LoadingBlock } from "../../components/ui/loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { api } from "../../api/client";
import { formatDate, titleCase } from "../../lib/utils";

export function BuildsPage() {
  const query = useQuery({ queryKey: ["builds"], queryFn: api.builds });
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock message={query.error.message} />;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Builds</CardTitle>
          <CardDescription>
            Persistent jobs, artifacts and reproducible build metadata.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filter
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Build</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.toReversed().map((build) => (
              <TableRow key={build.id}>
                <TableCell>
                  <div className="font-medium text-slate-100">{build.id}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {build.artifact?.name ?? "Artifact pending"}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge tone="neutral">{build.platform}</Badge>
                </TableCell>
                <TableCell>{build.profile}</TableCell>
                <TableCell>
                  <Status status={build.state} />
                </TableCell>
                <TableCell>{build.attempts}</TableCell>
                <TableCell className="text-slate-500">
                  {formatDate(build.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!query.data.length && (
          <div className="p-10 text-center text-sm text-slate-500">
            No builds found.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Status({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "success"
      : status === "failed" || status === "canceled"
        ? "danger"
        : status === "building"
          ? "info"
          : "warning";
  return <Badge tone={tone}>{titleCase(status)}</Badge>;
}
