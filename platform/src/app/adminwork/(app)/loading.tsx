// Shown instantly while a page loads, in the shape of the page, so navigation never feels stuck.
export default function Loading() {
  const bar = "rounded-full bg-sunken";
  return (
    <div className="animate-fade" aria-busy="true" aria-label="Loading">
      <div className={`${bar} mb-3 h-3 w-28`} />
      <div className={`${bar} mb-8 h-9 w-72`} />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="h-64 animate-pulse rounded-card bg-tile/90 lg:col-span-8" />
        <div className="h-64 animate-pulse rounded-card bg-tile/80 lg:col-span-4" />
        {[0, 1, 2].map((i) => <div key={i} className="h-48 animate-pulse rounded-card bg-surface lg:col-span-4" />)}
      </div>
    </div>
  );
}
