import { cn } from "../lib/cn";

/** A placeholder block for content that is on its way. It pulses unless the person asked for less motion. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-md bg-[color-mix(in_srgb,var(--text)_8%,transparent)] motion-reduce:animate-none", className)} />;
}

/** Lines of text still loading. */
export function SkeletonLines({ rows = 3, className }: { rows?: number; className?: string }) {
  return <div role="status" aria-busy="true" aria-live="polite" className={cn("grid gap-2.5", className)}>{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className={cn("h-3.5", i === rows - 1 ? "w-2/3" : "w-full")} />)}</div>;
}

/** The frame of a screen while its content loads: a header and the raised surface, the same shape the screen will have, so nothing jumps when it arrives. */
export function StageSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="loading" className="flex h-full min-h-0 min-w-0 flex-col panels:rounded-lg panels:border panels:border-[var(--bc,transparent)] panels:bg-[var(--glass,var(--surface))] panels:shadow-1">
      <div className="flex min-h-10 items-center gap-2 px-3 pb-1 pt-1.5"><Skeleton className="size-[30px]" /><Skeleton className="h-4 w-40" /></div>
      <div className="min-h-0 flex-1 px-7 pt-3 max-md:px-4 workspace:rounded-lg workspace:bg-surface">
        <Skeleton className="mb-5 h-7 w-1/3" />
        <div className="grid gap-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-5/6" /></div>
      </div>
    </div>
  );
}
