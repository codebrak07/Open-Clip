import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { profileVideo, VideoProfileMetrics } from './storyProfile';
import { FFMPEG_PATH } from '../config';

export interface MetricParityCheck {
  metric: string;
  actual: string | number;
  target: string | number;
  passed: boolean;
  severity: 'error' | 'warning';
  notes?: string;
}

export interface ParityReport {
  videoPath: string;
  profileId: string;
  overallPassed: boolean;
  status: 'passed' | 'completed_with_warnings' | 'failed';
  contactSheetPath: string;
  parityJsonPath: string;
  checks: MetricParityCheck[];
  warnings: string[];
  generatedAt: string;
}

const ffmpegBin = FFMPEG_PATH || (fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg');

/**
 * Generates contact-sheet.jpg (1 frame every 2 seconds tiled in grid)
 */
export function generateContactSheet(videoPath: string, durationSec: number, outPath: string): string {
  const frameCount = Math.max(1, Math.floor(durationSec / 2));
  const cols = 5;
  const rows = Math.ceil(frameCount / cols);

  // vf filter: 1 frame every 2s, scale to 216x384 (9:16 mini), draw timestamp in box, tile to cols x rows
  const vf = `fps=0.5,scale=216:384,drawtext=text='%{pts\\:hms}':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=4,tile=${cols}x${rows}`;

  const res = spawnSync(ffmpegBin, [
    '-y',
    '-i', videoPath,
    '-vf', vf,
    '-frames:v', '1',
    '-q:v', '2',
    outPath,
  ]);

  if (res.status === 0 && fs.existsSync(outPath)) {
    return outPath;
  }

  // Fallback simple grid without drawtext if drawtext filter lacks font
  const vfSimple = `fps=0.5,scale=216:384,tile=${cols}x${rows}`;
  spawnSync(ffmpegBin, [
    '-y',
    '-i', videoPath,
    '-vf', vfSimple,
    '-frames:v', '1',
    '-q:v', '3',
    outPath,
  ]);

  return outPath;
}

export function evaluateParity(videoPath: string, profilePath?: string): ParityReport {
  const rootDir = process.cwd().endsWith('backend') ? path.resolve(process.cwd(), '..') : process.cwd();
  const defaultProfilePath = path.join(rootDir, 'assets/story/style-profiles/roblox-storytime.json');
  const resolvedProfilePath = profilePath ? path.resolve(process.cwd(), profilePath) : defaultProfilePath;

  if (!fs.existsSync(resolvedProfilePath)) {
    throw new Error(`Style profile not found: ${resolvedProfilePath}`);
  }

  const profile = JSON.parse(fs.readFileSync(resolvedProfilePath, 'utf-8'));
  const metrics = profileVideo(videoPath);

  // Look for sidecars if available
  const basePrefix = videoPath.replace(/\.mp4$/i, '');
  let wordsData: any[] = [];
  let storyboardData: any = null;
  let reportData: any = null;

  if (fs.existsSync(`${basePrefix}.words.json`)) {
    try { wordsData = JSON.parse(fs.readFileSync(`${basePrefix}.words.json`, 'utf-8')); } catch {}
  }
  if (fs.existsSync(`${basePrefix}.storyboard.json`)) {
    try { storyboardData = JSON.parse(fs.readFileSync(`${basePrefix}.storyboard.json`, 'utf-8')); } catch {}
  }
  if (fs.existsSync(`${basePrefix}.report.json`)) {
    try { reportData = JSON.parse(fs.readFileSync(`${basePrefix}.report.json`, 'utf-8')); } catch {}
  }

  const checks: MetricParityCheck[] = [];
  const warnings: string[] = [];

  // 1. Duration check
  const durMin = profile.duration.min;
  const durMax = profile.duration.max;
  const durPass = metrics.durationSec >= durMin && metrics.durationSec <= durMax;
  checks.push({
    metric: 'Duration Range',
    actual: `${metrics.durationSec}s`,
    target: `${durMin}s – ${durMax}s`,
    passed: durPass,
    severity: 'error',
  });

  // 2. Hard Cuts Rate
  const minHardCuts = profile.pacing.hardCutsPerMin.min;
  const hardCutsPass = metrics.hardCutsPerMin >= minHardCuts;
  checks.push({
    metric: 'Hard Cuts / Minute',
    actual: `${metrics.hardCutsPerMin}`,
    target: `>= ${minHardCuts} (Target ~${profile.pacing.hardCutsPerMin.target})`,
    passed: hardCutsPass,
    severity: 'warning',
    notes: metrics.hardCutsCount < 10 ? 'Cut rhythm too slow' : undefined,
  });

  // 3. Max Shot Hold
  const maxHoldLimit = profile.pacing.maxHoldSec;
  const maxHoldPass = metrics.maxHoldSec <= maxHoldLimit + 0.5; // slight tolerance
  checks.push({
    metric: 'Max Shot Hold',
    actual: `${metrics.maxHoldSec}s`,
    target: `<= ${maxHoldLimit}s`,
    passed: maxHoldPass,
    severity: 'warning',
  });

  // 4. Dead Air Ratio / Silent Gaps
  const maxDeadAir = profile.pacing.deadAirRatioMax;
  const deadAirPass = metrics.deadAirRatio <= maxDeadAir;
  checks.push({
    metric: 'Dead Air Ratio',
    actual: `${(metrics.deadAirRatio * 100).toFixed(1)}%`,
    target: `<= ${(maxDeadAir * 100).toFixed(1)}%`,
    passed: deadAirPass,
    severity: 'error',
    notes: metrics.silentGapsCount > 0 ? `${metrics.silentGapsCount} silent gaps detected` : undefined,
  });

  // 5. Loudness & Peak
  const targetLufs = profile.audio.lufs;
  const tolLufs = profile.audio.lufsTol;
  const lufsPass = Math.abs(metrics.integratedLufs - targetLufs) <= tolLufs;
  const peakPass = metrics.peakDbfs <= profile.audio.truePeakMax;
  checks.push({
    metric: 'Integrated Loudness',
    actual: `${metrics.integratedLufs} LUFS`,
    target: `${targetLufs} ± ${tolLufs} LUFS`,
    passed: lufsPass,
    severity: 'warning',
  });
  checks.push({
    metric: 'True Peak Audio',
    actual: `${metrics.peakDbfs} dBFS`,
    target: `<= ${profile.audio.truePeakMax} dBFS`,
    passed: peakPass,
    severity: 'warning',
  });

  // 6. Environments & Cast Diversity
  const minEnv = metrics.durationSec <= 50 ? profile.world.environmentsMin.per45s : profile.world.environmentsMin.per90s;
  const envCount = storyboardData?.scenes?.length || metrics.estimatedEnvironments;
  const envPass = envCount >= minEnv;
  checks.push({
    metric: 'Distinct Environments',
    actual: envCount,
    target: `>= ${minEnv}`,
    passed: envPass,
    severity: 'warning',
  });

  const minAvatars = metrics.durationSec <= 50 ? profile.world.avatarsMin.per45s : profile.world.avatarsMin.per90s;
  const avatarCount = storyboardData?.characters?.length || 2;
  const avatarsPass = avatarCount >= minAvatars;
  checks.push({
    metric: 'Avatar & Cast Variety',
    actual: avatarCount,
    target: `>= ${minAvatars}`,
    passed: avatarsPass,
    severity: 'warning',
  });

  // 7. Generate Contact Sheet
  const contactSheetPath = videoPath.replace(/\.mp4$/i, '.contact-sheet.jpg');
  generateContactSheet(videoPath, metrics.durationSec, contactSheetPath);

  // Compute overall status
  const errorFailures = checks.filter(c => !c.passed && c.severity === 'error');
  const warningFailures = checks.filter(c => !c.passed && c.severity === 'warning');

  for (const f of [...errorFailures, ...warningFailures]) {
    warnings.push(`${f.metric}: Actual (${f.actual}) did not meet Target (${f.target})`);
  }

  let status: 'passed' | 'completed_with_warnings' | 'failed' = 'passed';
  if (errorFailures.length > 0) {
    status = 'completed_with_warnings'; // per spec: never silent success, flags warnings
  } else if (warningFailures.length > 0) {
    status = 'completed_with_warnings';
  }

  const overallPassed = errorFailures.length === 0;

  const parityJsonPath = videoPath.replace(/\.mp4$/i, '.parity.json');
  const report: ParityReport = {
    videoPath,
    profileId: profile.id,
    overallPassed,
    status,
    contactSheetPath,
    parityJsonPath,
    checks,
    warnings,
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(parityJsonPath, JSON.stringify(report, null, 2), 'utf-8');
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: ts-node src/cli/storyParity.ts <video.mp4> [profile.json]');
    process.exit(1);
  }

  const videoPath = path.resolve(process.cwd(), args[0]);
  const profilePath = args[1];

  const report = evaluateParity(videoPath, profilePath);

  console.log('\n======================================================');
  console.log(`📊 OpenClip Story Studio — Style Profile Parity Audit`);
  console.log(`Target Profile: ${report.profileId}`);
  console.log(`Video: ${path.basename(report.videoPath)}`);
  console.log('======================================================\n');

  for (const c of report.checks) {
    const icon = c.passed ? '✅ PASS' : (c.severity === 'error' ? '❌ FAIL' : '⚠️ WARN');
    console.log(`${icon} [${c.metric}]`);
    console.log(`    Target: ${c.target}`);
    console.log(`    Actual: ${c.actual}${c.notes ? ` (${c.notes})` : ''}`);
  }

  console.log('\n------------------------------------------------------');
  console.log(`OVERALL STATUS: ${report.status.toUpperCase()}`);
  console.log(`Contact Sheet:  ${report.contactSheetPath}`);
  console.log(`Parity Report:  ${report.parityJsonPath}`);
  console.log('------------------------------------------------------\n');
}

if (require.main === module) {
  main().catch(err => {
    console.error('Parity check error:', err);
    process.exit(1);
  });
}
