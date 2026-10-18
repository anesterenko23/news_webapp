import { useState } from 'react';
import { COUNTRIES, searchCountries } from '../data/countries';
import { RELATIONSHIP_STYLES, type NewsEvent, type RelationshipType } from '../data/types';
import { MAX_VISIBLE_RELATIONSHIPS, type CountryRelationship } from '../lib/relationships';
import { NewsItem } from './NewsItem';

export function CountryExplorer({ country, relationships, events, selectedId, selectedEventId, filter, onFilter, onCountry, onRelationship, onEvent, open, onClose }: {
  country: string | null; relationships: CountryRelationship[]; events: readonly NewsEvent[]; selectedId: string | null; selectedEventId: string | null;
  filter: 'all' | RelationshipType; onFilter: (value: 'all' | RelationshipType) => void; onCountry: (code: string | null) => void;
  onRelationship: (id: string) => void; onEvent: (event: NewsEvent) => void; open: boolean; onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const profile = country ? COUNTRIES[country] : null;
  const matching = searchCountries(query);
  const filtered = relationships.filter(link => filter === 'all' || link.type === filter);
  const active = relationships.find(link => link.id === selectedId);
  const countryEvents = events.filter(event => country && event.countries.includes(country));
  const related = active ? countryEvents.filter(event => active.relatedEventIds.includes(event.id)) : countryEvents;
  const partners = new Set(relationships.map(link => link.from === country ? link.to : link.from));
  return <aside id="news-feed" className={`news-feed explorer-panel ${open ? 'feed-open' : ''}`} aria-label="Country Explorer">
    <div className="feed-heading"><h1>Country Explorer</h1><button className="feed-close" aria-label="Close explorer" onClick={onClose}>×</button></div>
    <div className="country-search"><label htmlFor="country-search">Find a country</label><input id="country-search" type="search" placeholder="Search name or country code…" value={query} onChange={event => setQuery(event.target.value)}/></div>
    <div className="feed-scroll explorer-scroll">
      {(query || !profile) ? <>{!query && <h2 className="explorer-intro">Explore the World</h2>}{!query && <div className="quick-countries" aria-label="Quick countries">{['USA','CHN','DEU','FRA','IND','JPN'].map(code => <button key={code} onClick={() => onCountry(code)}>{COUNTRIES[code].name}</button>)}</div>}<p className="explorer-hint">Select a territory on the globe or choose a country below.</p><div className="country-results">{matching.map(item => <button key={item.code} onClick={() => { onCountry(item.code); setQuery(''); }}><span>{item.name}</span><small>{item.alpha3 ?? 'Territory'} ↗</small></button>)}{matching.length === 0 && <p>No countries found.</p>}</div></> : <>
        <button className="country-back" onClick={() => onCountry(null)}>← All countries</button>
        <div className="country-profile"><span className="eyebrow">{profile.region}</span><h2>{profile.flag && <img src={`${import.meta.env.BASE_URL}textures/flag-${profile.flag}.png`} alt="" onError={event => { event.currentTarget.hidden = true; }}/>} {profile.name}</h2><div className="country-stats"><span><strong>{countryEvents.length}</strong> events</span><span><strong>{partners.size}</strong> partners</span></div></div>
        <h3 className="explorer-section">Relationships <span>{relationships.length}</span></h3>
        <div className="relationship-filters" aria-label="Filter country relationships">{(['all', ...Object.keys(RELATIONSHIP_STYLES)] as ('all' | RelationshipType)[]).map(type => <button key={type} aria-pressed={filter === type} onClick={() => onFilter(type)}>{type === 'all' ? 'All' : RELATIONSHIP_STYLES[type].label}</button>)}</div>
        <p className="explorer-hint">Showing {Math.min(MAX_VISIBLE_RELATIONSHIPS, filtered.length)} of {filtered.length} on globe · ranked by event evidence</p>
        <div className="country-relationships">{filtered.map(link => { const partner = COUNTRIES[link.from === country ? link.to : link.from]; return <button key={link.id} aria-pressed={selectedId === link.id} onClick={() => onRelationship(link.id)}><i style={{ background: RELATIONSHIP_STYLES[link.type].color }}/><span>{partner.name}<small>{link.bidirectional ? '↔' : link.from === country ? '→' : '←'} {RELATIONSHIP_STYLES[link.type].label}</small></span><small>{link.relatedEventIds.length} events</small></button>; })}{!filtered.length && <p className="explorer-hint">No recorded relationships in this category.</p>}</div>
        <h3 className="explorer-section">{active ? 'Evidence for selected relationship' : 'Related events'} <span>{related.length}</span></h3>
        <ul className="news-list">{related.map(event => <NewsItem key={event.id} event={event} selected={event.id === selectedEventId} onSelect={onEvent}/>)}</ul>
        {!related.length && <p className="explorer-hint">No demonstration events recorded for this country.</p>}
      </>}
    </div>
    <div className="explorer-disclaimer">Demo evidence only. Missing data does not imply an absence of real relationships.</div>
  </aside>;
}
