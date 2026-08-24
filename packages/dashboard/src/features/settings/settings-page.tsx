import { CheckCircle2, Database, LockKeyhole, Server } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";

export function SettingsPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Project settings</CardTitle>
          <CardDescription>
            Runtime and release defaults for the current project.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow label="Project ID" value="Not initialized" />
          <SettingRow label="OTA policy" value="Fingerprint runtime" />
          <SettingRow label="Production channel" value="production" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Deployment health</CardTitle>
          <CardDescription>
            Current local control-plane profile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <HealthRow icon={Server} label="API" value="Persistent JSON" />
          <HealthRow
            icon={Database}
            label="Storage profile"
            value="S3-compatible ready"
          />
          <HealthRow
            icon={LockKeyhole}
            label="Manifest signing"
            value="Ed25519"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 pb-3 text-sm last:border-0 last:pb-0">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-200">{value}</span>
    </div>
  );
}

function HealthRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Server;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-slate-950/50 p-3">
      <Icon className="h-4 w-4 text-cyan-300" />
      <span className="flex-1 text-sm">{label}</span>
      <Badge tone="success">
        <CheckCircle2 className="h-3 w-3" />
        {value}
      </Badge>
    </div>
  );
}
