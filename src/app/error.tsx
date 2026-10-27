"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="alert">
      <strong>This page failed to render.</strong>
      <div className="small">{error.message}</div>
      <button className="btn" style={{ marginTop: 10 }} onClick={reset}>
        Try again
      </button>
    </div>
  );
}
