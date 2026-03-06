#!/usr/bin/env node
/**
 * build-site.mjs
 * Copies site/ and data/*.json into dist/ for static deployment.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const ROOT = new URL('..', import.meta.url).pathname;
const SITE = join(ROOT, 'site');
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

function cp(src, dest) {
  console.log(`  copy ${src.replace(ROOT, '')} → ${dest.replace(ROOT, '')}`);
  copyFileSync(src, dest);
}

console.log('Building site into dist/...\n');

// ensure dist/ and dist/data/ exist
mkdirSync(DIST, { recursive: true });
mkdirSync(join(DIST), { recursive: true });

// copy all site/ files flat into dist/
for (const file of readdirSync(SITE)) {
  const src = join(SITE, file);
  if (statSync(src).isFile()) cp(src, join(DIST, file));
}

// copy data json files into dist/ (same dir, loaded as ./clubs.json etc.)
for (const file of readdirSync(DATA)) {
  if (file.endsWith('.json')) {
    cp(join(DATA, file), join(DIST, file));
  }
}

console.log('\nDone. Serve with: npx serve dist');
