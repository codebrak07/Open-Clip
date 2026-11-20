import { WorkflowTask } from '../../workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../../storage/VersionedArtifactStore';
import { StoryProviderManager } from '../providers/StoryProviderManager';
import { ValidatedStory } from '../StorySchema';
import { Logger } from '../../../utils/Logger';

export function createStoryboardTask(providerManager: StoryProviderManager): WorkflowTask {
  return {
    id: 'StoryboardStage',
    name: 'Closed-Vocabulary Storyboard Generation & Zod Validation',
    dependencies: ['ScriptStage'],
    execute: async (context: Record<string, any>) => {
      const jobId = context.jobId || `story_${Date.now()}`;
      const cached = VersionedArtifactStore.load<ValidatedStory>(jobId, 'storyboard');
      if (cached && !context.forceRefresh) {
        Logger.info(`[StoryboardStage] Found cached storyboard artifact for job ${jobId}`);
        return { storyboard: cached.data };
      }

      const script = context.ScriptStage?.script || context.script;
      if (!script) {
        throw new Error('[StoryboardStage] Missing script in workflow context');
      }

      Logger.info(`[StoryboardStage] Generating closed-vocabulary storyboard for "${script.title}"`);
      const storyboard: ValidatedStory = await providerManager.runStoryboardPass(script);

      // Enforce globally unique beat IDs across all scenes
      let beatCounter = 1;
      for (const scene of storyboard.scenes) {
        for (const beat of scene.beats) {
          beat.id = `beat_${beatCounter++}`;
        }
      }

      // Save versioned artifact
      VersionedArtifactStore.save(jobId, storyboard, 'storyboard', storyboard);

      return { storyboard };
    },
  };
}
