export function LoadingBlock({
  label = "Loading LynxShip…",
}: {
  label?: string;
}) {
  return (
    <div className="flex min-h-40 items-center justify-center text-sm text-slate-500">
      <span className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-700 border-t-cyan-400" />
      {label}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4 text-sm text-rose-200">
      {message}
    </div>
  );
}
