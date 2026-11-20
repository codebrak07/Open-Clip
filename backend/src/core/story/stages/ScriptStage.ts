import { WorkflowTask } from '../../workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../../storage/VersionedArtifactStore';
import { StoryProviderManager } from '../providers/StoryProviderManager';
import { ScriptResult, ScriptPrompt } from '../../contracts';
import { LeakageValidator } from '../satire/LeakageValidator';
import { Logger } from '../../../utils/Logger';

export function createScriptTask(providerManager: StoryProviderManager): WorkflowTask {
  return {
    id: 'ScriptStage',
    name: '4-Pass Script Generation (Writer + Critic + Punch-Up + Extend & Leakage Check)',
    dependencies: [],
    execute: async (context: Record<string, any>) => {
      const jobId = context.jobId || `story_${Date.now()}`;
      const cached = VersionedArtifactStore.load<ScriptResult>(jobId, 'script');
      if (cached && !context.forceRefresh) {
        Logger.info(`[ScriptStage] Found cached script artifact for job ${jobId}`);
        return { script: cached.data };
      }

      const durationSec = context.durationSec || 60;
      const prompt: ScriptPrompt = {
        idea: context.idea || 'A funny everyday situation turns into an epic anime battle',
        durationSec,
        tone: context.tone || 'humorous',
        characterCount: context.characterCount || 2,
        seed: context.seed || 42,
      };

      Logger.info(`[ScriptStage] Generating 4-pass script for: "${prompt.idea}" (${prompt.durationSec}s, ${prompt.tone})`);

      // Pass 1: Writer Pass
      const rawScript = await providerManager.runWriterPass(prompt);

      // Pass 2: Critic Pass
      const refinedScript = await providerManager.runCriticPass(rawScript);

      // Pass 3: Comedic Punch-Up Pass
      const punchedScript = await providerManager.runPunchUpPass(refinedScript);

      // Pass 4: Extend & Duration Calibration Pass (ensure full target duration, friend quirks)
      const finalScript = await providerManager.runExtendPass(punchedScript, durationSec);

      // 5. Few-Shot Leakage Rejection Test (4-gram overlap <= 12%)
      const fullScriptText = finalScript.beats.map(b => b.text).join(' ');
      const leakage = LeakageValidator.checkLeakage(fullScriptText, 0.12);
      Logger.info(`[ScriptStage] Few-shot 4-gram leakage audit: ${leakage.details}`);

      if (!leakage.passed) {
        Logger.warn(`[ScriptStage] Leakage threshold exceeded (${(leakage.overlapRatio * 100).toFixed(1)}% > 12%). Sanitizing leaking n-grams...`);
        finalScript.beats.forEach(b => {
          b.text = LeakageValidator.sanitizeLeakage(b.text);
        });
      }

      // Save versioned artifact
      VersionedArtifactStore.save(jobId, finalScript, 'script', finalScript);

      return { script: finalScript };
    },
  };
}
