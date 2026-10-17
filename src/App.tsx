import { Component, Suspense, useRef, useState, type ReactNode } from 'react';
import { Globe, type GlobeHandle } from './components/Globe';

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
  return <main className="app">
    <header className="header"><a className="brand" href="./" aria-label="World Lens home"><span>World Lens</span><small>News in a global context</small></a><nav aria-label="Main navigation"><span className="phase"><i/> Globe preview</span><button className={!about ? 'nav-active' : ''} onClick={() => {setAbout(false); globe.current?.reset();}}>Map</button><button className={about ? 'nav-active' : ''} onClick={() => setAbout(true)}>About</button></nav></header>
    <section className="map" aria-label="Interactive world globe">
      <div className="map-heading"><span className="eyebrow">A GLOBAL PERSPECTIVE</span><h1>The world, in view.</h1><p>Every story starts somewhere.</p></div>
      <SceneBoundary><Suspense fallback={null}><Globe ref={globe} onReady={() => setReady(true)}/></Suspense></SceneBoundary>
      {!ready && <div className="loading" role="status"><span/> Preparing your perspective</div>}
      <div className="controls" aria-label="Globe controls"><div className="zoom-group"><button aria-label="Zoom in" title="Zoom in" onClick={() => globe.current?.zoom(0.84)}><Icon type="plus"/></button><button aria-label="Zoom out" title="Zoom out" onClick={() => globe.current?.zoom(1.19)}><Icon type="minus"/></button></div><button className="reset" aria-label="Reset view" title="Reset view" onClick={() => globe.current?.reset()}><Icon type="reset"/></button></div>
      <footer className="map-footer"><span><i/> EXPLORE THE GLOBE</span><p>Drag to rotate <b>·</b> Scroll to zoom</p><span className="phase-label">WORLD LENS <b>/</b> PHASE 01</span></footer>
    </section>
    {about && <div className="modal-backdrop" onClick={() => setAbout(false)}><section className="about" role="dialog" aria-modal="true" aria-labelledby="about-title" onClick={e => e.stopPropagation()} onKeyDown={e => {if(e.key==='Escape')setAbout(false);}}><button autoFocus className="close" aria-label="Close about" onClick={() => setAbout(false)}>×</button><span className="eyebrow">WORLD LENS / PHASE 01</span><h2 id="about-title">A world of context.</h2><p>A new perspective on our connected world. Explore an interactive Earth, from national borders to the lights of our cities.</p><p>This first chapter is the foundation for a future global news map. News and international relationships will follow in later phases.</p><button className="explore-button" onClick={() => setAbout(false)}>Explore the globe <span>↗</span></button></section></div>}
  </main>;
}
