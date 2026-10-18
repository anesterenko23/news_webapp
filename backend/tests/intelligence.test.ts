import { describe, it, expect } from 'vitest';
import { normalizeArticle } from '../src/normalization.js';
import { Extraction } from '../src/schemas-v1.js';
import { anchorEvidence, validateEvidence } from '../src/validation-v1.js';
import { findDuplicates, similarity } from '../src/deduplication.js';
import { publicationDecision } from '../src/verification.js';
import { loadConfig, pricing } from '../src/config.js';
import { FIXTURES } from './fixtures.js';

describe('22 manually authored publication scenarios (not model-quality assertions)',()=> {
  for (const fixture of FIXTURES) it(fixture.id,()=> {
    const normalized=normalizeArticle(fixture.article);
    const result=Extraction.parse({events:fixture.expected,diagnostics:[]});
    expect(normalized.language).toBe('en');
    for(const event of result.events) {
      const validation=validateEvidence(event,fixture.article.title+'\n'+fixture.article.content);
      expect(validation.rejected).toBe(false);
      expect(publicationDecision(false,[]).publicationStatus).toBe('NeedsReview');
      expect(publicationDecision(false,[]).verificationStatus).toBe('Unverified');
    }
  });
});
describe('validation boundaries',()=> {
  const base=FIXTURES[0].expected[0],text=FIXTURES[0].article.content;
  it('rejects invented quotations',()=>expect(validateEvidence({...base,evidence:[{text:'A quotation which never appeared in the article.'}]},text).rejected).toBe(true));
  it('anchors formatting-only differences to the exact original span, without accepting changed facts',()=> {
    const original='France and Germany\n\nheld diplomatic talks.';
    const anchored=anchorEvidence('France and Germany held diplomatic talks.',original);
    expect(anchored.text).toBe(original);expect(anchored.startOffset).toBe(0);expect(anchored.endOffset).toBe(original.length);
    expect(anchorEvidence('France and Germany held military talks.',original).startOffset).toBe(-1);
  });
  it('rejects invalid ISO codes',()=>expect(validateEvidence({...base,countries:[{code:'ZZ',role:'initiator'}]},text).rejected).toBe(true));
  it('rejects relationships built from a commentator',()=>expect(validateEvidence({...base,countries:[{code:'FR',role:'commentator'},{code:'DE',role:'target'}]},text).rejected).toBe(true));
  it('rejects evidence references outside the event',()=>expect(validateEvidence({...base,relationships:[{...base.relationships[0],evidence_refs:[5]}]},text).rejected).toBe(true));
  it('rejects self links and nonexistent participants',()=>expect(validateEvidence({...base,relationships:[{...base.relationships[0],source_country:'US',target_country:'US'}]},text).rejected).toBe(true));
  it('rejects unilateral roles disguised as mutual aid',()=> {const event=FIXTURES[3].expected[0];expect(validateEvidence({...event,relationships:[{...event.relationships[0],direction:'bidirectional'}]},FIXTURES[3].article.content).rejected).toBe(true);});
  it('rejects a multilateral clique inferred from one broad quotation',()=> {
    const event=FIXTURES[8].expected[0];
    const links=[['FR','DE'],['FR','JP'],['DE','JP']].map(([source_country,target_country])=>({source_country,target_country,type:'international_agreement' as const,direction:'bidirectional' as const,evidence_refs:[0],confidence:1}));
    expect(validateEvidence({...event,relationships:links},FIXTURES[8].article.content).rejected).toBe(true);
  });
  it('rejects planned evidence labelled completed',()=> {const event=FIXTURES[17].expected[0];expect(validateEvidence({...event,event_status:'completed'},FIXTURES[17].article.content).rejected).toBe(true);});
  it('validates UTC dates, URL credentials and article size',()=> {
    expect(normalizeArticle({...FIXTURES[0].article,publishedAt:'2026-10-18T12:00:00+02:00'}).publishedAt.toISOString()).toBe('2026-10-18T10:00:00.000Z');
    expect(()=>normalizeArticle({...FIXTURES[0].article,url:'https://user:secret@example.org'})).toThrow();
    expect(()=>normalizeArticle({...FIXTURES[0].article,content:'x'.repeat(30001)})).toThrow();
  });
  it('keeps raw input and normalizes tracking links deterministically',()=> {
    const raw={...FIXTURES[0].article,content:'France  and Germany held diplomatic talks.\r\nAdvertisement\r\nAdvertisement',url:'https://example.org/?utm_source=x'};
    const n=normalizeArticle(raw);expect(JSON.parse(n.originalJson)).toEqual(raw);expect(n.canonicalUrl).toBe('https://example.org/');expect(n.content.match(/Advertisement/g)).toHaveLength(1);
  });
  it('keeps uncertainty and negation visible in event data',()=> {
    expect(FIXTURES[11].expected[0].event_status).toBe('denied');
    expect(FIXTURES[12].expected[0].event_status).toBe('speculative');
    expect(FIXTURES[17].expected[0].occurred_at).toBeNull();
  });
  it('flags similar claims without merging or inferring corroboration',()=> {
    const event=FIXTURES[2].expected[0];
    const record={id:'existing',title:'Berlin introduces another sanctions package targeting Moscow.',summary:event.summary,eventType:'sanctions',eventStatus:'announced',occurredAt:null,publishedAt:new Date(FIXTURES[2].article.publishedAt),participants:event.countries.map(c=>({countryCode:c.code})),sources:[]};
    expect(findDuplicates(event,new Date(FIXTURES[2].article.publishedAt),undefined,[record])).toHaveLength(1);
    expect(findDuplicates({...event,event_type:'military_aid'},record.publishedAt,undefined,[record])).toHaveLength(0);
    expect(findDuplicates(event,new Date('2026-11-18'),undefined,[record])).toHaveLength(0);
    expect(similarity('Domestic education reform','Sanctions on Russia')).toBe(0);
  });
  it('requires auth in production and on non-loopback interfaces',()=> {
    expect(()=>loadConfig({NODE_ENV:'production'})).toThrow();expect(()=>loadConfig({HOST:'0.0.0.0'})).toThrow();
    expect(loadConfig({HOST:'0.0.0.0',ADMIN_API_TOKEN:'a'.repeat(32)}).HOST).toBe('0.0.0.0');
  });
  it('blocks unknown model pricing and stale rates',()=> {
    expect(()=>pricing(loadConfig({MISTRAL_MODEL:'different-model'}))).toThrow();
    expect(()=>pricing(loadConfig({LLM_PRICING_VERIFIED_AT:'2020-01-01'}))).toThrow();
    expect(pricing(loadConfig({}),new Date('2026-10-18')).input).toBe(.15);
  });
});
