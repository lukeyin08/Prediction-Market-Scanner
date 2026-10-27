"use client";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div>
      <p className="error">This page broke: {error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
