type Props<T extends string | number> = {
  title: string
  values: T[]
  selected: Set<T>
  onChange: (value: T) => void
  render?: (value: T) => string
}

export default function MultiFilter<T extends string | number>({ title, values, selected, onChange, render }: Props<T>) {
  return (
    <details className="filter-group" open>
      <summary>{title} <small>{selected.size ? `(${selected.size})` : '(todos)'}</small></summary>
      <div className="check-list">
        {values.map(v => (
          <label key={String(v)}>
            <input type="checkbox" checked={selected.has(v)} onChange={() => onChange(v)} />
            <span>{render ? render(v) : String(v)}</span>
          </label>
        ))}
      </div>
    </details>
  )
}
