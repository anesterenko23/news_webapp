import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CountryExplorer } from './components/CountryExplorer';
import { buildRelationshipIndex, countryRelationships, visibleRelationships } from './lib/relationships';
import type { CameraFocus, GlobeSelection, ViewMode } from './data/explorer';
import { GlobeScene, type GlobeHandle } from './components/Globe';
import { NewsFeed } from './components/NewsFeed';
import { NewsDetails } from './components/NewsDetails';
import { RelationshipLegend } from './components/RelationshipLegend';
import { COUNTRY_CODES } from './data/countries';
import { DEMO_EVENTS } from './data/events';
import type { NewsEvent, NewsFilter, RelationshipType } from './data/types';
const relationshipIndex = buildRelationshipIndex(DEMO_EVENTS);
function Icon({ type }: { type: 'plus' | 'minus' | 'reset' }) {
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">{type === 'reset' ? <><circle cx="12" cy="12" r="6.5"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/></> : <><path d="M5 12h14"/>{type === 'plus' && <path d="M12 5v14"/>}</>}</svg>;
}
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-message" role="alert">The globe couldn’t load.<small>Check that WebGL is enabled, then reload the page.</small><button onClick={() => location.reload()}>Reload</button></div> : this.props.children; }
}
export default function App() {
  const globe = useRef<GlobeHandle>(null);
  const [about, setAbout] = useState(false);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<NewsEvent | null>(null);
  const [filter, setFilter] = useState<NewsFilter>('all');
  const [feedOpen, setFeedOpen] = useState(false);
  const aboutPanel = useRef<HTMLElement>(null);
  const onReady = useCallback(() => setReady(true), []);
  const [mode, setMode] = useState<ViewMode>('news');
  const [country, setCountry] = useState<string | null>(null);
  const [relationship, setRelationship] = useState<string | null>(null);
  const [relationFilter, setRelationFilter] = useState<'all' | RelationshipType>('all');
  const [focus, setFocus] = useState<CameraFocus | null>(null);
  const links = useMemo(() => country ? countryRelationships(country, relationshipIndex.relationships) : [], [country]);
  const visible = useMemo(() => visibleRelationships(links, relationFilter, relationship), [links, relationFilter, relationship]);
  const selection = useMemo<GlobeSelection | null>(() => selected ? { ...selected, primaryCountry: mode === 'explorer' ? country ?? undefined : undefined } : country ? { id: `country:${country}`, primaryCountry: country, countries: [...new Set([country, ...visible.flatMap(link => [link.from, link.to])])], relationships: visible } : null, [selected, country, visible, mode]);
  const selectCountry = useCallback((code: string | null) => {
    if (country === code) return;
    setCountry(code); setSelected(null); setRelationship(null); setRelationFilter('all');
    setFocus(code ? { key: `country:${code}`, kind: 'country', code } : null); setFeedOpen(false);
  }, [country]);
  const selectRelationship = useCallback((id: string) => {
    const link = relationshipIndex.byId.get(id); if (!link) return;
    setRelationship(id); setSelected(null);
    setFocus(previous => previous?.key === id ? previous : { key: id, kind: 'relationship', relationship: link }); setFeedOpen(false);
  }, []);
  const switchMode = (next: ViewMode) => {
    if (next === mode) return;
    setMode(next); setSelected(null); setCountry(null); setRelationship(null); setFocus(null); setRelationFilter('all'); setFeedOpen(false);
  };
  const selectEvent = useCallback((event: NewsEvent) => {
    setSelected(previous => previous?.id === event.id ? previous : event);
    setFocus(previous => previous?.key === `event:${event.id}` ? previous : { key: `event:${event.id}`, kind: 'event', event });
    setFeedOpen(false);
  }, []);
  useEffect(() => {
    if (!about) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = aboutPanel.current;
    const buttons = () => panel?.querySelectorAll<HTMLElement>('button,a[href]');
    buttons()?.[0]?.focus();
    const keyboard = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbout(false);
      if (e.key === 'Tab') {
        const focusables = buttons(); if (!focusables?.length) return;
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus(); };
  }, [about]);
  return <main className="app" onKeyDown={e => { if (e.key === 'Escape') { setFeedOpen(false); setSelected(null); } }}>
    <header className="header"><a className="brand" href="./" aria-label="World Lens home"><span>World Lens</span><small>News in a global context</small></a><nav aria-label="Main navigation"><div className="mode-switch" aria-label="View mode"><button aria-pressed={mode === 'news'} onClick={() => switchMode('news')}>News</button><button aria-pressed={mode === 'explorer'} onClick={() => switchMode('explorer')}>Country Explorer</button></div><span className="phase"><i/> Demo preview</span><button className={!about ? 'nav-active' : ''} onClick={() => { setAbout(false); globe.current?.reset(); }}>Map</button><button className={about ? 'nav-active' : ''} onClick={() => setAbout(true)}>About</button></nav></header>
    <div className="workspace">
      {feedOpen && <button className="feed-backdrop" aria-label="Dismiss news feed" onClick={() => setFeedOpen(false)}/>}
      {mode === 'explorer' ? <CountryExplorer country={country} relationships={links} events={DEMO_EVENTS} selectedId={relationship} selectedEventId={selected?.id ?? null} filter={relationFilter} onFilter={value => { setRelationFilter(value); setRelationship(null); setSelected(null); }} onCountry={selectCountry} onRelationship={selectRelationship} onEvent={selectEvent} open={feedOpen} onClose={() => setFeedOpen(false)}/> : <NewsFeed events={DEMO_EVENTS} selectedId={selected?.id ?? null} filter={filter} onFilter={setFilter} onSelect={selectEvent} open={feedOpen} onClose={() => setFeedOpen(false)}/>}
      <section className={`map ${selected ? 'has-selection' : ''}`} aria-label="Interactive world globe">
        <div className="globe-stage">
        <button className="feed-toggle" aria-expanded={feedOpen} aria-controls="news-feed" onClick={() => setFeedOpen(!feedOpen)}><span aria-hidden="true">☰</span> {mode === 'explorer' ? 'Countries' : 'Latest News'} <span className="toggle-count">{String(mode === 'explorer' ? COUNTRY_CODES.length : DEMO_EVENTS.length).padStart(2, '0')}</span></button>
        <div className="map-heading"><span className="eyebrow">{selected ? 'CONNECTED WORLD' : 'A GLOBAL PERSPECTIVE'}</span>{!selected && <><h2>{mode === 'explorer' ? 'Explore a country.' : 'The world, in view.'}</h2><p>{mode === 'explorer' ? 'Click a territory to discover its connections.' : 'Select a story. Discover its connections.'}</p></>}</div>
        <SceneBoundary><Suspense fallback={null}><GlobeScene ref={globe} selected={selected} selection={selection} focus={focus} explorer={mode === 'explorer'} paused={!!selected || !!country} relationships={relationshipIndex.relationships} selectedRelationshipId={relationship} onCountrySelect={selectCountry} onRelationshipSelect={selectRelationship} onReady={onReady}/></Suspense></SceneBoundary>
        {!ready && <div className="loading" role="status"><span/> Preparing your perspective</div>}
        <RelationshipLegend/>
        <div className="controls" aria-label="Globe controls"><div className="zoom-group"><button aria-label="Zoom in" title="Zoom in" onClick={() => globe.current?.zoom(.84)}><Icon type="plus"/></button><button aria-label="Zoom out" title="Zoom out" onClick={() => globe.current?.zoom(1.19)}><Icon type="minus"/></button></div><button className="reset" aria-label="Reset view" title="Reset view" onClick={() => globe.current?.reset()}><Icon type="reset"/></button></div>
        {!selected && <footer className="map-footer"><span><i/> EXPLORE THE GLOBE</span><p>Drag to rotate <b>·</b> Scroll to zoom</p><span className="phase-label">PHASE 3</span></footer>}
        </div>
        {selected && <NewsDetails event={selected} onClose={() => setSelected(null)} onFocus={() => globe.current?.focus(selected)}/>}
        <span className="sr-only" role="status">{selected ? `Showing ${selected.title}. ${selected.countries.length} countries and ${selected.relationships.length} ${selected.relationships.length === 1 ? 'relationship' : 'relationships'}.` : country ? `Exploring ${country}. ${links.length} relationships. Globe rotation paused.` : mode === 'explorer' ? 'Select a country on the globe or use search.' : 'No event selected. Globe rotates automatically.'}</span>
      </section>
    </div>
    {about && <div className="modal-backdrop" onClick={() => setAbout(false)}><section ref={aboutPanel} className="about" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={e => e.stopPropagation()}><button className="close" aria-label="Close about" onClick={() => setAbout(false)}>×</button><span className="eyebrow">WORLD LENS / PHASE 03</span><h2 id="about-title">A world of connections.</h2><p>Explore the geographic context of world events. Choose a story to see its countries and international relationships on a living globe.</p><p>This prototype uses illustrative demonstration scenarios, not live news. Source links provide institutional background. No news API is connected.</p><button className="explore-button" onClick={() => setAbout(false)}>Explore the globe <span>↗</span></button></section></div>}
  </main>;
}
