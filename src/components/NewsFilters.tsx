import { NEWS_FILTERS, type NewsFilter } from '../data/types';
export function NewsFilters({ value, onChange }: { value: NewsFilter; onChange: (filter: NewsFilter) => void }) {
  return <div className="news-filters" aria-label="News categories">{NEWS_FILTERS.map(filter => <button key={filter.id} aria-pressed={value === filter.id} onClick={() => onChange(filter.id)}>{filter.label}</button>)}</div>;
}
