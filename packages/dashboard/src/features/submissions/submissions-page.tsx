import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { formatDate, titleCase } from "../../lib/utils";

export function SubmissionsPage() {
  const query = useQuery({
    queryKey: ["submissions"],
    queryFn: api.submissions,
  });
  if (query.isPending) return <LoadingBlock />;
  if (query.isError) return <ErrorBlock message={query.error.message} />;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Store submissions</CardTitle>
          <CardDescription>
            Track remote processing without losing the LynxShip job record.
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
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Submission</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Remote reference</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data.toReversed().map((submission) => (
              <TableRow key={submission.id}>
                <TableCell className="font-medium text-slate-100">
                  {submission.id}
                </TableCell>
                <TableCell>
                  <Badge tone="neutral">{submission.platform}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    tone={
                      submission.status === "submitted" ||
                      submission.status === "accepted"
                        ? "success"
                        : submission.status === "failed"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {titleCase(submission.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-500">
                  {submission.remoteId ? (
                    <span className="inline-flex items-center gap-1">
                      {submission.remoteId}
                      <ExternalLink className="h-3 w-3" />
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-slate-500">
                  {formatDate(submission.createdAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!query.data.length && (
          <div className="p-10 text-center text-sm text-slate-500">
            No submission jobs found.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
