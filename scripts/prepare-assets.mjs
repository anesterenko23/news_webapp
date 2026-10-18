import { mkdir, access, writeFile, rename, rm, readFile } from 'node:fs/promises';
const directory = new URL('../public/textures/', import.meta.url);
await mkdir(directory, { recursive: true });
// The licensed 8K city-light atlas is versioned with the app: no upstream
// anti-bot page or availability change can break this essential texture.
await access(new URL('earth-lights-8k.jpg', directory));
const sources = {
  'flag-us.png': 'https://flagcdn.com/w40/us.png',
  'flag-ua.png': 'https://flagcdn.com/w40/ua.png',
  'flag-ru.png': 'https://flagcdn.com/w40/ru.png',
  'flag-cn.png': 'https://flagcdn.com/w40/cn.png',
  'flag-de.png': 'https://flagcdn.com/w40/de.png',
  'flag-fr.png': 'https://flagcdn.com/w40/fr.png',
  'flag-sa.png': 'https://flagcdn.com/w40/sa.png',
  'flag-jp.png': 'https://flagcdn.com/w40/jp.png',
  'flag-au.png': 'https://flagcdn.com/w40/au.png',
  'flag-in.png': 'https://flagcdn.com/w40/in.png',
  'flag-br.png': 'https://flagcdn.com/w40/br.png',
  'demo-city.jpg': 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=240&h=240&fit=crop&q=80&fm=jpg',
  'demo-trade.jpg': 'https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=240&h=240&fit=crop&q=80&fm=jpg',
  'demo-diplomacy.jpg': 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?w=240&h=240&fit=crop&q=80&fm=jpg',
  'demo-energy.jpg': 'https://images.unsplash.com/photo-1513828583688-c52646db42da?w=240&h=240&fit=crop&q=80&fm=jpg',
  'demo-ocean.jpg': 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=240&h=240&fit=crop&q=80&fm=jpg',
  'demo-climate.jpg': 'https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?w=240&h=240&fit=crop&q=80&fm=jpg',
  'earth-day.jpg': 'https://raw.githubusercontent.com/turban/webgl-earth/master/images/2_no_clouds_4k.jpg',
  'earth-bump.jpg': 'https://raw.githubusercontent.com/turban/webgl-earth/master/images/elev_bump_4k.jpg',
};
for (const [filename, source] of Object.entries(sources)) {
  const destination = new URL(filename, directory);
  try { await access(destination); continue; } catch {}
  const temporary = new URL(filename + '.tmp', directory);
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const valid = filename.endsWith('.png') ? bytes[0] === 0x89 && bytes[1] === 0x50 : bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!valid) throw new Error('Expected a valid image asset');
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
    console.log(`Prepared ${filename}`);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error(`Could not prepare ${filename}. Check your internet connection and run npm run assets again.`, { cause: error });
  }
}

// Profile flags are static presentation assets, not news or external metrics.
// Missing optional flags fall back to their ISO label without breaking setup.
const catalogue = JSON.parse(await readFile(new URL('../src/data/country-catalogue.json', import.meta.url), 'utf8'));
const flags = [...new Set(Object.values(catalogue).map(country => country.flag).filter(Boolean))];
for (let i = 0; i < flags.length; i += 8) await Promise.all(flags.slice(i, i + 8).map(async code => {
  const destination = new URL(`flag-${code}.png`, directory);
  try { await access(destination); return; } catch {}
  try {
    const response = await fetch(`https://flagcdn.com/w40/${code}.png`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] === 0x89 && bytes[1] === 0x50) await writeFile(destination, bytes);
  } catch { /* Optional flag: the profile has an ISO fallback. */ }
}));
