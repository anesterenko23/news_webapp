import { useMemo } from 'react';
import { filterEvents, type NewsEvent, type NewsFilter } from '../data/types';
import { NewsFilters } from './NewsFilters';
import { NewsItem } from './NewsItem';
export function NewsFeed({ events, selectedId, filter, onFilter, onSelect, open, onClose }: { events: readonly NewsEvent[]; selectedId: string | null; filter: NewsFilter; onFilter: (filter: NewsFilter) => void; onSelect: (event: NewsEvent) => void; open: boolean; onClose: () => void }) {
  const filtered = useMemo(() => filterEvents(events, filter), [events, filter]);
  return <aside id="news-feed" className={`news-feed ${open ? 'feed-open' : ''}`} aria-label="Latest news">
    <div className="feed-heading"><h1>Latest News <span>{String(events.length).padStart(2, '0')}</span></h1><button className="feed-close" aria-label="Close news feed" onClick={onClose}>×</button></div>
    <NewsFilters value={filter} onChange={onFilter}/>
    {events.every(event => event.demo) && <div className="demo-notice"><span/> Demonstration events · Not live news</div>}
    <div className="feed-scroll"><ul className="news-list">{filtered.map(event => <NewsItem key={event.id} event={event} selected={event.id === selectedId} onSelect={onSelect}/>)}</ul>{filtered.length === 0 && <p className="empty-feed">No events in this category.</p>}</div>
    <div className="feed-footer"><span>{filtered.length} {filtered.length === 1 ? 'event' : 'events'}</span><span>Select a story to explore <b>↗</b></span></div>
  </aside>;
}
