import type { CSSProperties } from 'react';
import { publishedLabel, RELATIONSHIP_STYLES, type NewsEvent } from '../data/types';
export function NewsItem({ event, selected, onSelect }: { event: NewsEvent; selected: boolean; onSelect: (event: NewsEvent) => void }) {
  const types = [...new Set(event.relationships.map(link => link.type))];
  return <li><button className={`news-item ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => onSelect(event)}>
    <span className="thumbnail"><img src={event.image} alt={event.imageAlt} loading="lazy" onError={e => { e.currentTarget.style.opacity = '0'; }}/></span>
    <span className="news-item-content"><span className="news-time"><time dateTime={event.publishedAt}>{publishedLabel(event.publishedAt)}</time>{event.demo && <span>Demo</span>}</span><span className="news-title">{event.title}</span><span className="news-tags">{types.map(type => <span key={type} className="tag" style={{ '--category-color': RELATIONSHIP_STYLES[type].color } as CSSProperties}>{RELATIONSHIP_STYLES[type].label}</span>)}</span></span>
    <svg className="item-chevron" width="12" height="18" viewBox="0 0 12 18" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 3 6 6-6 6"/></svg>
  </button></li>;
}
