import { mkdir, access, writeFile, rename, rm } from 'node:fs/promises';
const directory = new URL('../public/textures/', import.meta.url);
await mkdir(directory, { recursive: true });
const sources = {
  'earth-day.jpg': 'https://raw.githubusercontent.com/turban/webgl-earth/master/images/2_no_clouds_4k.jpg',
  'earth-bump.jpg': 'https://raw.githubusercontent.com/turban/webgl-earth/master/images/elev_bump_4k.jpg',
  'earth-night.jpg': 'https://raw.githubusercontent.com/vasturiano/three-globe/master/example/img/earth-night.jpg',
};
for (const [filename, source] of Object.entries(sources)) {
  const destination = new URL(filename, directory);
  try { await access(destination); continue; } catch {}
  const temporary = new URL(filename + '.tmp', directory);
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Expected a JPEG texture');
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
    console.log(`Prepared ${filename}`);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new Error(`Could not prepare ${filename}. Check your internet connection and run npm run assets again.`, { cause: error });
  }
}
