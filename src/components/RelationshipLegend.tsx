import type { CSSProperties } from 'react';
import { RELATIONSHIP_STYLES } from '../data/types';
export function RelationshipLegend() {
  return <aside className="relationship-legend" aria-label="Relationship legend">{Object.entries(RELATIONSHIP_STYLES).map(([id, style]) => <div key={id}><span className={`legend-dot ${id === 'other' ? 'legend-other' : ''}`} style={{ '--category-color': style.color } as CSSProperties}/>{style.label}</div>)}</aside>;
}
