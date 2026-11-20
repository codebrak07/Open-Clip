import fs from 'fs';
import path from 'path';
import { WorkflowTask } from '../../workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../../storage/VersionedArtifactStore';
import { WhisperAlignmentEngine, AlignedBeat, AlignedWord } from '../audio/WhisperAlignmentEngine';
import { getStoryOutputsDir } from '../StoryPaths';
import { Logger } from '../../../utils/Logger';

export function createAlignmentTask(): WorkflowTask {
  return {
    id: 'AlignmentStage',
    name: 'Word-Level Alignment & Timing Anchor (Groq Whisper)',
    dependencies: ['VoiceStage'],
    execute: async (context: Record<string, any>) => {
      const jobId = context.jobId || `story_${Date.now()}`;
      const cached = VersionedArtifactStore.load<any>(jobId, 'alignment');
      if (cached && !context.forceRefresh) {
        Logger.info(`[AlignmentStage] Found cached alignment artifact for job ${jobId}`);
        return cached.data;
      }

      const voiceData = context.VoiceStage || context.voice;
      const storyboard = context.StoryboardStage?.storyboard || context.storyboard;
      if (!voiceData || !storyboard) {
        throw new Error('[AlignmentStage] Missing voice data or storyboard in context');
      }

      const alignmentEngine = new WhisperAlignmentEngine();
      const lineResults = voiceData.lineResults || [];
      const beats = storyboard.scenes.flatMap((s: any) => s.beats);

      const beatWordAlignments: AlignedWord[][] = [];
      const beatDurations: number[] = [];

      for (let i = 0; i < lineResults.length; i++) {
        const line = lineResults[i];
        const words = await alignmentEngine.alignAudioWords(line.wavPath, line.text);
        beatWordAlignments.push(words);
        beatDurations.push(line.durationSec);
      }

      const pauseSec = voiceData.pauseSec ?? 0.25;
      const introPauseSec = voiceData.introPauseSec ?? 0.0;

      const alignedBeats: AlignedBeat[] = alignmentEngine.mapBeatsToTimeline(
        beats,
        beatWordAlignments,
        beatDurations,
        pauseSec,
        introPauseSec
      );

      // Write aligned startSec & endSec back into storyboard beats
      let bIdx = 0;
      for (const scene of storyboard.scenes || []) {
        for (const beat of scene.beats || []) {
          if (alignedBeats[bIdx]) {
            beat.startSec = alignedBeats[bIdx].startSec;
            beat.endSec = alignedBeats[bIdx].endSec;
            bIdx++;
          }
        }
      }

      // Persist updated storyboard with timing anchors
      VersionedArtifactStore.save(jobId, storyboard, 'storyboard', storyboard);
      const outDir = getStoryOutputsDir();
      const sbDiskPath = path.join(outDir, `${jobId}.storyboard.json`);
      try {
        fs.writeFileSync(sbDiskPath, JSON.stringify(storyboard, null, 2), 'utf-8');
      } catch {}

      const allWords = alignedBeats.flatMap(b => b.words);
      const totalDurationSec = voiceData.totalDurationSec || (alignedBeats.length > 0 ? alignedBeats[alignedBeats.length - 1].endSec : 45);

      const outputData = {
        alignedBeats,
        allWords,
        totalDurationSec,
      };

      VersionedArtifactStore.save(jobId, outputData, 'alignment', outputData);
      return outputData;
    },
  };
}
