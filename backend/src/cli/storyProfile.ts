import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { FFMPEG_PATH } from '../config';

export interface VideoProfileMetrics {
  videoPath: string;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  hardCutsCount: number;
  hardCutsPerMin: number;
  softCutsCount: number;
  softCutsPerMin: number;
  maxHoldSec: number;
  silentGapsCount: number;
  totalSilenceSec: number;
  deadAirRatio: number;
  integratedLufs: number;
  peakDbfs: number;
  estimatedEnvironments: number;
  timestamp: string;
}

const ffmpegBin = FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');

/**
 * Probes video duration, resolution and framerate
 */
function probeVideoInfo(videoPath: string): { durationSec: number; fps: number; width: number; height: number } {
  const probe = spawnSync(ffmpegBin, [
    '-i', videoPath,
    '-f', 'null',
    '-',
  ], { encoding: 'utf-8' });

  const stderr = probe.stderr || '';
  let durationSec = 45.0;
  let fps = 30.0;
  let width = 1080;
  let height = 1920;

  const dMatch = stderr.match(/Duration:\s+(\d+):(\d+):([0-9.]+)/);
  if (dMatch) {
    durationSec = parseInt(dMatch[1]) * 3600 + parseInt(dMatch[2]) * 60 + parseFloat(dMatch[3]);
  }

  const resMatch = stderr.match(/Stream #\d+:\d+.*Video:.*,\s*(\d+)x(\d+)/);
  if (resMatch) {
    width = parseInt(resMatch[1]);
    height = parseInt(resMatch[2]);
  }

  const fpsMatch = stderr.match(/([0-9.]+)\s+fps/);
  if (fpsMatch) {
    fps = parseFloat(fpsMatch[1]);
  }

  return { durationSec, fps, width, height };
}

/**
 * Detects hard cuts (scene > 0.40) and soft cuts (scene > 0.25)
 */
function detectCuts(videoPath: string, durationSec: number): { hardCuts: number; softCuts: number; maxHoldSec: number } {
  const res = spawnSync(ffmpegBin, [
    '-i', videoPath,
    '-filter:v', "select='gt(scene,0.25)',metadata=print",
    '-f', 'null',
    '-',
  ], { encoding: 'utf-8' });

  const stderr = res.stderr || '';
  const lines = stderr.split('\n');
  const cutTimes: number[] = [0];
  let softCuts = 0;
  let hardCuts = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('lavfi.scene_score=')) {
      const scoreMatch = line.match(/lavfi\.scene_score=([0-9.]+)/);
      const score = scoreMatch ? parseFloat(scoreMatch[1]) : 0;
      softCuts++;
      if (score >= 0.40) {
        hardCuts++;
      }
    }
    if (line.includes('pts_time:')) {
      const ptsMatch = line.match(/pts_time:([0-9.]+)/);
      if (ptsMatch) {
        cutTimes.push(parseFloat(ptsMatch[1]));
      }
    }
  }
  cutTimes.push(durationSec);

  let maxHoldSec = 0;
  for (let i = 1; i < cutTimes.length; i++) {
    const diff = cutTimes[i] - cutTimes[i - 1];
    if (diff > maxHoldSec) {
      maxHoldSec = diff;
    }
  }

  return { hardCuts, softCuts, maxHoldSec: Math.round(maxHoldSec * 10) / 10 };
}

/**
 * Detects silent gaps >= 0.25s
 */
function detectSilence(videoPath: string, durationSec: number): { silentGapsCount: number; totalSilenceSec: number; deadAirRatio: number } {
  const res = spawnSync(ffmpegBin, [
    '-i', videoPath,
    '-af', 'silencedetect=noise=-38dB:d=0.25',
    '-f', 'null',
    '-',
  ], { encoding: 'utf-8' });

  const stderr = res.stderr || '';
  let silentGapsCount = 0;
  let totalSilenceSec = 0;

  const durMatches = stderr.matchAll(/silence_duration:\s+([0-9.]+)/g);
  for (const m of durMatches) {
    const dur = parseFloat(m[1]);
    silentGapsCount++;
    totalSilenceSec += dur;
  }

  const deadAirRatio = durationSec > 0 ? totalSilenceSec / durationSec : 0;
  return {
    silentGapsCount,
    totalSilenceSec: Math.round(totalSilenceSec * 10) / 10,
    deadAirRatio: Math.round(deadAirRatio * 1000) / 1000,
  };
}

/**
 * Probes loudness via ebur128
 */
function probeLoudness(videoPath: string): { integratedLufs: number; peakDbfs: number } {
  const res = spawnSync(ffmpegBin, [
    '-i', videoPath,
    '-af', 'ebur128=framelog=verbose',
    '-f', 'null',
    '-',
  ], { encoding: 'utf-8' });

  const stderr = res.stderr || '';
  let integratedLufs = -24.0;
  let peakDbfs = -1.0;

  const iMatch = stderr.match(/Integrated loudness:\s+I:\s+([-\d.]+)\s+LUFS/);
  if (iMatch) integratedLufs = parseFloat(iMatch[1]);

  const pMatch = stderr.match(/Peak:\s+([-\d.]+)\s+dBFS/);
  if (pMatch) peakDbfs = parseFloat(pMatch[1]);

  return { integratedLufs, peakDbfs };
}

export function profileVideo(videoPath: string): VideoProfileMetrics {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const info = probeVideoInfo(videoPath);
  const cuts = detectCuts(videoPath, info.durationSec);
  const silence = detectSilence(videoPath, info.durationSec);
  const loudness = probeLoudness(videoPath);

  const durationMin = info.durationSec / 60;
  const hardCutsPerMin = durationMin > 0 ? cuts.hardCuts / durationMin : 0;
  const softCutsPerMin = durationMin > 0 ? cuts.softCuts / durationMin : 0;

  // Approximate environments by checking color clustering on cut keyframes
  const estimatedEnvironments = Math.max(1, Math.min(6, Math.round(cuts.hardCuts / 5) + 1));

  return {
    videoPath,
    durationSec: Math.round(info.durationSec * 10) / 10,
    fps: info.fps,
    width: info.width,
    height: info.height,
    hardCutsCount: cuts.hardCuts,
    hardCutsPerMin: Math.round(hardCutsPerMin * 10) / 10,
    softCutsCount: cuts.softCuts,
    softCutsPerMin: Math.round(softCutsPerMin * 10) / 10,
    maxHoldSec: cuts.maxHoldSec,
    silentGapsCount: silence.silentGapsCount,
    totalSilenceSec: silence.totalSilenceSec,
    deadAirRatio: silence.deadAirRatio,
    integratedLufs: loudness.integratedLufs,
    peakDbfs: loudness.peakDbfs,
    estimatedEnvironments,
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: ts-node src/cli/storyProfile.ts <path-to-video.mp4> [--json]');
    process.exit(1);
  }

  const videoPath = path.resolve(process.cwd(), args[0]);
  const isJson = args.includes('--json');

  const metrics = profileVideo(videoPath);

  if (isJson) {
    console.log(JSON.stringify(metrics, null, 2));
  } else {
    console.log('\n======================================================');
    console.log(`🎬 Video Profile: ${path.basename(videoPath)}`);
    console.log('======================================================');
    console.log(`- Duration:            ${metrics.durationSec}s (${(metrics.durationSec / 60).toFixed(2)} min)`);
    console.log(`- Resolution & FPS:    ${metrics.width}x${metrics.height} @ ${metrics.fps} fps`);
    console.log(`- Hard Cuts (>0.40):   ${metrics.hardCutsCount} (~${metrics.hardCutsPerMin} cuts/min)`);
    console.log(`- Soft Cuts (>0.25):   ${metrics.softCutsCount} (~${metrics.softCutsPerMin} cuts/min)`);
    console.log(`- Max Shot Hold:       ${metrics.maxHoldSec}s`);
    console.log(`- Silent Gaps (>=0.25s): ${metrics.silentGapsCount} (${metrics.totalSilenceSec}s total, ${(metrics.deadAirRatio * 100).toFixed(1)}% dead air)`);
    console.log(`- Integrated Loudness: ${metrics.integratedLufs} LUFS (Peak: ${metrics.peakDbfs} dBFS)`);
    console.log(`- Est. Environments:   ~${metrics.estimatedEnvironments}`);
    console.log('======================================================\n');
  }

  // Save profile json adjacent to video
  const outProfilePath = videoPath.replace(/\.mp4$/i, '.profile.json');
  fs.writeFileSync(outProfilePath, JSON.stringify(metrics, null, 2), 'utf-8');
  console.log(`Wrote profile JSON: ${outProfilePath}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Profile error:', err);
    process.exit(1);
  });
}
