export function Placeholder({ title }: { title: string }) {
  return (
    <div className="px-6 py-10">
      <h1 className="text-2xl font-bold mb-2">{title}</h1>
      <p className="text-text-muted">
        Coming soon — the web build currently mirrors the API but only Home is
        fully implemented. Open the Android TV / Apple TV / Roku apps for the
        full experience, or stick around as the rest of the surfaces land.
      </p>
    </div>
  );
}
