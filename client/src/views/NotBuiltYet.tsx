export function NotBuiltYet({ label }: { label: string }) {
  return (
    <div className="panel empty">
      <h2>{label} isn't rebuilt yet</h2>
      <p className="note" style={{ margin: '8px auto 0' }}>
        Until it is, use this screen in the prototype (legacy/Beaman-Console.html).
      </p>
    </div>
  )
}
