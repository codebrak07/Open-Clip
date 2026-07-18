import { StudioCore } from '../src/studio/StudioCore';
import { RuntimeRegistry } from '../src/core/registry/RuntimeRegistry';
import { SpeechProvider, VisionProvider, RenderProvider } from '../src/core/contracts';
import { MediaTimeline } from '../src/core/timeline/MediaTimeline';
import { CreativeDirectorEngine } from '../src/core/reasoning/CreativeDirectorEngine';
import { WorkflowEngine, WorkflowTask } from '../src/core/workflow/WorkflowEngine';
import { VersionedArtifactStore } from '../src/core/storage/VersionedArtifactStore';
import { JobScheduler } from '../src/core/scheduler/JobScheduler';
import { StorageManager } from '../src/core/storage/StorageManager';
import fs from 'fs';

describe('OpenClip V8 Enterprise Architecture & Studio Core Test Suite', () => {
  beforeAll(async () => {
    await StudioCore.bootstrap();
  });

  describe('Studio Core & RuntimeRegistry', () => {
    it('bootstraps StudioCore and registers default providers', () => {
      const status = StudioCore.getStatus();
      expect(status.initialized).toBe(true);
      expect(status.providers.length).toBeGreaterThan(0);
    });

    it('resolves provider contracts by capability from RuntimeRegistry', () => {
      const speechProvider = RuntimeRegistry.getProviderByCapability<SpeechProvider>('SpeechRecognition');
      expect(speechProvider).toBeDefined();
      expect(speechProvider?.id).toBe('whisper-provider');

      const visionProvider = RuntimeRegistry.getProviderByCapability<VisionProvider>('FaceDetection');
      expect(visionProvider).toBeDefined();
      expect(visionProvider?.id).toBe('mediapipe-provider');
    });
  });

  describe('MediaTimeline & Hierarchical Creative Director', () => {
    it('indexes timestamped elements and runs top-down agent reasoning', async () => {
      const timeline = new MediaTimeline('vid_v8_1');
      timeline.addElement({ id: 'w1', type: 'word', startTime: 0.5, endTime: 1.2, data: { word: 'Hello' } });
      timeline.addElement({ id: 'f1', type: 'face', startTime: 0.5, endTime: 5.0, data: { faceCount: 1 } });

      const result = await CreativeDirectorEngine.executeHierarchicalReasoning(timeline, 0.5, 5.0);
      expect(result.finalDecision).toContain('Approved');
      expect(result.agentTrace.length).toBe(7);
      expect(result.agentTrace[0].agentName).toBe('Research Agent');
      expect(result.agentTrace[6].agentName).toBe('Reviewer Agent');
    });
  });

  describe('Deterministic WorkflowEngine', () => {
    it('executes task graphs in dependency order', async () => {
      const tasks: WorkflowTask[] = [
        {
          id: 'probe',
          name: 'Probe Metadata',
          dependencies: [],
          execute: async () => ({ fps: 30, duration: 60 }),
        },
        {
          id: 'transcribe',
          name: 'Transcribe Audio',
          dependencies: ['probe'],
          execute: async (ctx) => ({ text: 'Podcast transcript', fpsUsed: ctx.probe.fps }),
        },
      ];

      const res = await WorkflowEngine.executeWorkflow('job_wf_1', tasks);
      expect(res.transcribe.text).toBe('Podcast transcript');
      expect(res.transcribe.fpsUsed).toBe(30);
    });
  });

  describe('VersionedArtifactStore & JobScheduler', () => {
    it('persists artifacts with versioning and hash metadata', () => {
      const artifact = VersionedArtifactStore.save('transcript_1', 'raw text content', '1.0.0', { count: 50 });
      expect(artifact.hash).toBeDefined();
      expect(artifact.pipelineVersion).toBe('8.0.0');

      const loaded = VersionedArtifactStore.load('transcript_1', '1.0.0');
      expect(loaded).not.toBeNull();
      expect(loaded?.data.count).toBe(50);
    });

    it('enqueues tasks into designated worker groups', () => {
      JobScheduler.enqueueTask({ id: 'j1', group: 'Analysis', payload: {} });
      const stats = JobScheduler.getStats();
      const analysisStat = stats.find(s => s.group === 'Analysis');
      expect(analysisStat?.queued).toBeGreaterThan(0);

      const dequeued = JobScheduler.processNext('Analysis');
      expect(dequeued?.id).toBe('j1');
    });
  });

  describe('StorageManager', () => {
    it('creates predictable storage directory paths under storage/', () => {
      const uploadPath = StorageManager.getPath('uploads', 'sample.mp4');
      expect(uploadPath).toContain('storage/uploads/sample.mp4');
    });
  });
});
