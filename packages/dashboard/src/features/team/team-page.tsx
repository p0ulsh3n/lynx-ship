import { Mail, ShieldCheck, Users } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

export function TeamPage() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Team & access</CardTitle>
          <CardDescription>
            Organization membership and least-privilege roles.
          </CardDescription>
        </div>
        <Button>
          <Mail className="h-4 w-4" />
          Invite member
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {[
          ["Jordan Davis", "jordan@example.com", "owner"],
          ["Alex Chen", "alex@example.com", "developer"],
        ].map(([name = "", email, role]) => (
          <div
            key={email}
            className="flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4"
          >
            <div className="grid h-10 w-10 place-items-center rounded-full bg-amber-400/15 text-sm font-bold text-amber-300">
              {name
                .split(" ")
                .map((part) => part[0] ?? "")
                .join("")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium">{name}</div>
              <div className="text-xs text-slate-500">{email}</div>
            </div>
            <Badge tone={role === "owner" ? "info" : "neutral"}>
              <ShieldCheck className="h-3 w-3" />
              {role}
            </Badge>
          </div>
        ))}
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-800 p-4 text-xs text-slate-500">
          <Users className="h-4 w-4" />
          RBAC is enforced by the LynxShip API, not by this client.
        </div>
      </CardContent>
    </Card>
  );
}
