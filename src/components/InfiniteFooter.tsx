import type { RefObject } from "react";

/** Sentinel + loading / retry / end-of-results states shared by every infinite list. */
export function InfiniteFooter({ sentinel, loading, error, hasMore, count, retry, endText = "You've reached the end." }: {
  sentinel: RefObject<HTMLDivElement | null>; loading: boolean; error: boolean; hasMore: boolean; count: number; retry: () => void; endText?: string;
}) {
  return (
    <>
      <div ref={sentinel} className="h-10" aria-hidden />
      {loading && <p className="py-4 text-center text-sm text-muted-foreground" role="status">Loading more…</p>}
      {error && count > 0 && (
        <div role="alert" className="py-4 text-center text-sm">
          <p className="text-muted-foreground">Couldn't load more.</p>
          <button onClick={retry} className="mt-2 rounded-full bg-primary px-4 py-1.5 text-primary-foreground">Retry</button>
        </div>
      )}
      {!hasMore && !error && !loading && count > 0 && <p className="py-6 text-center text-sm text-muted-foreground">{endText}</p>}
    </>
  );
}
