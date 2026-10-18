import {readFileSync}from 'node:fs';
import type {Extracted,ArticleInputType}from '../src/schemas.js';
export interface BenchmarkCase{id:string;article:ArticleInputType;expected:Extracted[]}
export const BENCHMARK:BenchmarkCase[]=JSON.parse(readFileSync(new URL('../benchmark/cases.json',import.meta.url),'utf8')).cases;
