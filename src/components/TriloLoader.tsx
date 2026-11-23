/** Full-screen loading screen: Trilo emblem inside a spinning ring (styles in index.html). */
export default function TriloLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="trilo-loader" role="status" aria-label={label}>
      <div className="trilo-loader__box">
        <span className="trilo-loader__track" />
        <span className="trilo-loader__ring" />
        <img className="trilo-loader__logo" src="/loader-emblem.png" alt="Trilo" />
      </div>
      <div className="trilo-loader__text">{label}</div>
    </div>
  );
}
