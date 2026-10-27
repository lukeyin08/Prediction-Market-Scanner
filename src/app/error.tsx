"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="notice warn">
      <strong>Something went wrong rendering this page.</strong>
      <div className="small">{error.message}</div>
      <button className="btn" style={{ marginTop: 10 }} onClick={reset}>
        Try again
      </button>
    </div>
  );
}
