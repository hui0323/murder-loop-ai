// Install audio system into a target project
// Usage: node install.js <target-project-root>
//
// Copies:
//   audio-files/  → <target>/public/audio/repository/
//   engine/*.ts   → <target>/src/audio/
//   components/*.tsx → <target>/src/components/
//   scripts/*.mjs → <target>/scripts/
//
// Then runs scan to generate manifest.json

import { cpSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

const target = resolve(process.argv[2] || '.');

if (!existsSync(target)) {
  console.error(`ERROR: Target directory not found: ${target}`);
  console.error('Usage: node install.js <target-project-root>');
  process.exit(1);
}

const audioFilesSrc = join(import.meta.dirname, 'audio-files');
const audioFilesDest = join(target, 'public/audio/repository');
const engineSrc = join(import.meta.dirname, 'engine');
const engineDest = join(target, 'src/audio');
const componentsSrc = join(import.meta.dirname, 'components');
const componentsDest = join(target, 'src/components');
const scriptsSrc = join(import.meta.dirname, 'scripts');
const scriptsDest = join(target, 'scripts');

console.log('Installing audio system...\n');

// 1. Copy audio files
console.log(`[1/5] Copying audio files → ${audioFilesDest}`);
mkdirSync(audioFilesDest, { recursive: true });
cpSync(audioFilesSrc, audioFilesDest, { recursive: true });

// 2. Copy engine files
console.log(`[2/5] Copying engine → ${engineDest}`);
mkdirSync(engineDest, { recursive: true });
for (const f of readdirSync(engineSrc)) {
  cpSync(join(engineSrc, f), join(engineDest, f));
}

// 3. Copy components
console.log(`[3/5] Copying components → ${componentsDest}`);
mkdirSync(componentsDest, { recursive: true });
for (const f of readdirSync(componentsSrc)) {
  cpSync(join(componentsSrc, f), join(componentsDest, f));
}

// 4. Copy scripts
console.log(`[4/5] Copying scripts → ${scriptsDest}`);
mkdirSync(scriptsDest, { recursive: true });
for (const f of readdirSync(scriptsSrc)) {
  cpSync(join(scriptsSrc, f), join(scriptsDest, f));
}

// 5. Generate manifest
console.log(`[5/5] Generating manifest.json...`);
try {
  execSync(`node "${join(scriptsDest, 'scan-audio-repo.mjs')}" "${audioFilesDest}"`, {
    cwd: target,
    stdio: 'inherit',
  });
} catch {
  console.log('  (scan skipped — run manually: node scripts/scan-audio-repo.mjs public/audio/repository)');
}

console.log('\n=== Installation complete ===');
console.log('');
console.log('Next steps:');
console.log('  1. Install npm deps:  npm install howler');
console.log('  2. Install dev deps:   npm install -D @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe fluent-ffmpeg');
console.log('  3. Edit src/audio/engine.ts → set REPO_BASE to "/audio/repository" (or your static path)');
console.log('  4. Edit src/audio/mappings.ts → update sound IDs to match your game actions');
console.log('  5. Import RainPlayer in your App entry point');
console.log('  6. Import VolumeControl in your Header/toolbar');
console.log('  7. Import AudioGate as the first-interaction unlock gate');
