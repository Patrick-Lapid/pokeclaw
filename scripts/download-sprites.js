#!/usr/bin/env node
// Downloads PMD sprite assets from SpriteCollab for all 24 species
// Usage: node scripts/download-sprites.js

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SPECIES = [
  '0001', '0004', '0007', '0025', '0039', '0052', '0054', '0066',
  '0074', '0133', '0058', '0063', '0092', '0123', '0143', '0147',
  '0175', '0246', '0006', '0094', '0149', '0248', '0150', '0151'
];

const SPRITES_DIR = path.join(__dirname, '..', 'public', 'assets', 'sprites');
const PORTRAITS_DIR = path.join(__dirname, '..', 'public', 'assets', 'portraits');

// Actions we need for the game
const NEEDED_ACTIONS = [
  'Walk', 'Idle', 'Attack', 'Pose', 'Eat', 'Hop', 'Hurt', 'Sleep', 'Shock'
];

function download(url) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          get(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

function parseAnimDataXml(xml) {
  const result = {};

  // Parse ShadowSize from root (outside Anim blocks)
  const shadowSizeMatch = xml.match(/<ShadowSize>(\d+)<\/ShadowSize>/);
  const shadowSize = shadowSizeMatch ? parseInt(shadowSizeMatch[1]) : 2;
  result._shadowSize = shadowSize;

  const animRegex = /<Anim>([\s\S]*?)<\/Anim>/g;
  let match;

  while ((match = animRegex.exec(xml)) !== null) {
    const block = match[1];
    const name = (block.match(/<Name>([^<]+)<\/Name>/) || [])[1];
    if (!name) continue;

    const copyOf = (block.match(/<CopyOf>([^<]+)<\/CopyOf>/) || [])[1];
    if (copyOf) {
      // Will resolve after all anims are parsed
      result[name] = { copyOf };
      continue;
    }

    const frameWidth = parseInt((block.match(/<FrameWidth>([^<]+)<\/FrameWidth>/) || [])[1]) || 0;
    const frameHeight = parseInt((block.match(/<FrameHeight>([^<]+)<\/FrameHeight>/) || [])[1]) || 0;

    const durations = [];
    const durRegex = /<Duration>(\d+)<\/Duration>/g;
    let dm;
    while ((dm = durRegex.exec(block)) !== null) {
      durations.push(parseInt(dm[1]));
    }

    result[name] = { frameWidth, frameHeight, numFrames: durations.length, durations };
  }

  // Resolve CopyOf references
  for (const [name, data] of Object.entries(result)) {
    if (name === '_shadowSize') continue;
    if (data.copyOf && result[data.copyOf] && !result[data.copyOf].copyOf) {
      result[name] = { ...result[data.copyOf] };
    }
  }

  // Remove unresolved copies
  for (const [name, data] of Object.entries(result)) {
    if (name === '_shadowSize') continue;
    if (data.copyOf) delete result[name];
  }

  return result;
}

async function processSpecies(dexNum) {
  const speciesDir = path.join(SPRITES_DIR, dexNum);
  fs.mkdirSync(speciesDir, { recursive: true });

  // Check if already downloaded
  if (fs.existsSync(path.join(speciesDir, 'anim-data.json')) &&
      fs.existsSync(path.join(speciesDir, 'Idle-Anim.png'))) {
    console.log(`  ✓ ${dexNum} (cached)`);
    return;
  }

  try {
    // 1. Download and parse AnimData.xml
    console.log(`  ↓ ${dexNum} downloading AnimData.xml...`);
    const xmlBuf = await download(
      `https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite/${dexNum}/AnimData.xml`
    );
    const animData = parseAnimDataXml(xmlBuf.toString('utf8'));
    fs.writeFileSync(
      path.join(speciesDir, 'anim-data.json'),
      JSON.stringify(animData, null, 2)
    );

    // 2. Download sprites.zip and extract needed action sheets
    console.log(`  ↓ ${dexNum} downloading sprites.zip...`);
    const zipBuf = await download(
      `https://spriteserver.pmdcollab.org/assets/${dexNum}/sprites.zip`
    );
    const zipPath = path.join(speciesDir, 'sprites.zip');
    fs.writeFileSync(zipPath, zipBuf);

    // Extract only the action sheets we need
    const filesToExtract = [];
    for (const action of NEEDED_ACTIONS) {
      if (animData[action]) {
        filesToExtract.push(`${action}-Anim.png`, `${action}-Shadow.png`);
      }
    }

    try {
      execSync(
        `unzip -o -j "${zipPath}" ${filesToExtract.join(' ')} -d "${speciesDir}" 2>/dev/null`,
        { stdio: 'pipe' }
      );
    } catch (e) {
      // Some files may not exist in the zip, that's OK
    }

    // Clean up zip
    fs.unlinkSync(zipPath);

    // 3. Download portrait sheet
    console.log(`  ↓ ${dexNum} downloading portrait...`);
    const portraitBuf = await download(
      `https://spriteserver.pmdcollab.org/assets/portrait-${dexNum}.png`
    );
    fs.writeFileSync(path.join(PORTRAITS_DIR, `${dexNum}.png`), portraitBuf);

    console.log(`  ✓ ${dexNum} done`);
  } catch (err) {
    console.error(`  ✗ ${dexNum} failed: ${err.message}`);
  }
}

async function main() {
  console.log('pokeclaw sprite downloader');
  console.log('Source: PMD SpriteCollab (sprites.pmdcollab.org) — CC-BY-NC 4.0');
  console.log('');

  fs.mkdirSync(SPRITES_DIR, { recursive: true });
  fs.mkdirSync(PORTRAITS_DIR, { recursive: true });

  // Process 3 at a time to avoid overwhelming the server
  for (let i = 0; i < SPECIES.length; i += 3) {
    const batch = SPECIES.slice(i, i + 3);
    await Promise.all(batch.map(processSpecies));
  }

  console.log('');
  console.log('Done! Sprite assets saved to public/assets/sprites/ and public/assets/portraits/');
}

main().catch(console.error);
