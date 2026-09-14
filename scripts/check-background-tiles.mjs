import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = resolve(
  repositoryRoot,
  'img_assets/0000 BIG BACKGROUND STUFF/tiles/manifest.json',
);
const tileRoot = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.version !== 1 || manifest.layout !== 'deep-zoom') {
  throw new Error('Unsupported background tile manifest.');
}

const missing = [];
let expectedTileCount = 0;

for (const layer of manifest.layers || []) {
  let layerTileCount = 0;

  for (const level of layer.levels || []) {
    const calculatedLevelCount = level.columns * level.rows;
    if (level.tileCount !== calculatedLevelCount) {
      throw new Error(
        `${layer.id} level ${level.directoryLevel} declares ${level.tileCount} tiles; `
        + `${calculatedLevelCount} are expected from its grid.`,
      );
    }

    for (let column = 0; column < level.columns; column += 1) {
      for (let row = 0; row < level.rows; row += 1) {
        const relativePath = layer.urlTemplate
          .replace('{level}', String(level.directoryLevel))
          .replace('{column}', String(column))
          .replace('{row}', String(row));
        if (!existsSync(resolve(tileRoot, relativePath))) {
          missing.push(relativePath);
        }
      }
    }

    layerTileCount += calculatedLevelCount;
  }

  if (layer.tileCount !== layerTileCount) {
    throw new Error(
      `${layer.id} declares ${layer.tileCount} tiles; its levels declare ${layerTileCount}.`,
    );
  }
  expectedTileCount += layerTileCount;
}

if (missing.length) {
  console.error(`Missing ${missing.length} background tiles:`);
  for (const relativePath of missing.slice(0, 20)) console.error(`- ${relativePath}`);
  if (missing.length > 20) console.error(`- ...and ${missing.length - 20} more`);
  process.exitCode = 1;
} else {
  console.log(`Background tile manifest OK: ${expectedTileCount} runtime tiles found.`);
}
