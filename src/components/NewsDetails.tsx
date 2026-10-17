import type { CSSProperties } from 'react';
import { COUNTRIES } from '../data/countries';
import { publishedLabel, RELATIONSHIP_STYLES, type NewsEvent } from '../data/types';
export function NewsDetails({ event, onClose, onFocus }: { event: NewsEvent; onClose: () => void; onFocus: () => void }) {
  const types = [...new Set(event.relationships.map(link => link.type))];
  return <section className="news-details" aria-labelledby="selected-headline">
    <button className="details-close" aria-label="Close selected news" onClick={onClose}>×</button>
    <div className="details-main"><div className="details-meta"><time dateTime={event.publishedAt}>{publishedLabel(event.publishedAt)}</time><span>DEMO SCENARIO</span></div><h2 id="selected-headline">{event.title}</h2><p className="details-description">{event.description}</p>
      <div className="news-tags details-tags">{types.map(type => <span key={type} className="tag" style={{ '--category-color': RELATIONSHIP_STYLES[type].color } as CSSProperties}>{RELATIONSHIP_STYLES[type].label}</span>)}</div>
      <div className="details-actions"><button className="view-button" onClick={onFocus}>View on globe <span>→</span></button><a href={event.source.url} target="_blank" rel="noopener noreferrer">Background source <span aria-hidden="true">↗</span></a></div>
      <p className="source-note">Illustrative scenario. {event.source.name} link provides background, not a report of this event.</p>
    </div>
    <div className="details-countries"><h3>Countries involved</h3><ul>{event.countries.map(code => <li key={code}><span className="country-flag" aria-hidden="true"><img src={`${import.meta.env.BASE_URL}textures/flag-${COUNTRIES[code].flag}.png`} alt=""/></span>{COUNTRIES[code].name}</li>)}</ul></div>
    <div className="details-relationships"><h3>Relationships</h3><ul>{event.relationships.map(link => <li key={`${link.from}-${link.to}-${link.type}`}><span className={`relationship-swatch ${link.type === 'conflict' ? 'dashed' : ''}`} style={{ '--category-color': RELATIONSHIP_STYLES[link.type].color } as CSSProperties}/><span><strong>{RELATIONSHIP_STYLES[link.type].label}</strong><small>{COUNTRIES[link.from].name} {link.bidirectional ? '↔' : '→'} {COUNTRIES[link.to].name}</small></span></li>)}</ul></div>
  </section>;
}
