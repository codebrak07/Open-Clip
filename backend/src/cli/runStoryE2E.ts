import dotenv from 'dotenv';
dotenv.config();

import { StoryStudioService } from '../core/story/StoryStudioService';
import { StoryVerifyHarness } from './storyVerify';
import { resolveStoryFile } from '../core/story/StoryPaths';
import { Logger } from '../utils/Logger';

async function main() {
  const idea = "A kid discovers his cat sneezes a puff of smoke every time someone lies and his friend tests it";
  const durationSec = 45;
  const tone = 'humorous' as const;
  const characterCount = 2;
  const seed = 42;
  const jobId = `cat_smoke_${Date.now()}`;

  Logger.info(`[E2E] Starting Story Studio test run for Job: ${jobId}`);
  const service = new StoryStudioService();

  const result = await service.generateStoryVideo({
    jobId,
    idea,
    durationSec,
    tone,
    characterCount,
    seed,
    ttsProvider: 'auto',
    forceRefresh: true,
  });

  const mp4Path = resolveStoryFile(jobId, '.mp4');
  const sbPath = resolveStoryFile(jobId, '.storyboard.json');

  Logger.info(`[E2E] Generation complete. Running verification harness on: ${mp4Path}`);
  const verifier = new StoryVerifyHarness();
  const verifyResult = await verifier.verifyVideo(mp4Path, sbPath);

  console.log('\n========================================');
  console.log(`STORY VERIFICATION REPORT: ${verifyResult.passed ? 'PASSED ✅' : 'FAILED ❌'}`);
  console.log('========================================');
  for (const check of verifyResult.checks) {
    console.log(`- [${check.passed ? 'PASS ✅' : 'FAIL ❌'}] ${check.name}`);
    console.log(`    Target: ${check.target}`);
    console.log(`    Actual: ${check.actual}`);
  }
  console.log('========================================\n');

  if (!verifyResult.passed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
