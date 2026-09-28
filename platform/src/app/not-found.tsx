// Shown for any unknown address, including website pages that don't exist.
export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div>
        <div className="figure text-[120px] text-ink-4">404</div>
        <h1 className="mt-2 text-[24px] font-[400] tracking-[-0.02em]">Page not found · الصفحة غير موجودة</h1>
        {/* A plain link on purpose: "/" is the public website, outside this app. */}
        <a href="/adminwork" className="mt-6 inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14px] text-bg">Mada Trips</a>
      </div>
    </main>
  );
}
