import { PluginRegistry, IntelligencePlugin } from '../src/plugins/PluginRegistry';
import { CapabilityRegistry } from '../src/services/CapabilityRegistry';
import { ModelRegistry } from '../src/services/ModelRegistry';
import { MediaKnowledgeGraph } from '../src/analysis/MediaKnowledgeGraph';
import { EventPipeline } from '../src/pipeline/EventPipeline';
import { ArtifactStore } from '../src/services/ArtifactStore';
import { DistributedWorkerPool } from '../src/services/DistributedWorkerPool';
import { MultiAgentEngine } from '../src/analysis/MultiAgentEngine';

describe('OpenClip V7 Autonomous Media Intelligence Platform Test Suite', () => {
  describe('Plugin Architecture & Capability Registry', () => {
    it('registers plugins and dispatches capabilities seamlessly', async () => {
      const mockPlugin: IntelligencePlugin = {
        metadata: {
          id: 'test-ocr-plugin',
          name: 'Test OCR Plugin',
          category: 'ocr',
          version: '1.0.0',
          capabilities: ['TextRecognition'],
          supportedFormats: ['mp4', 'png'],
          dependencies: ['tesseract'],
          latencyEstimateMs: 15,
          healthStatus: 'healthy',
          fallbackPriority: 1,
        },
        execute: async (input: any) => ({ text: 'Extracted text' }),
      };

      PluginRegistry.register(mockPlugin);
      expect(PluginRegistry.get('test-ocr-plugin')).toBeDefined();

      const capResult = await CapabilityRegistry.executeCapability('TextRecognition', { frame: 'img' });
      expect(capResult.provider).toBe('test-ocr-plugin');
      expect(capResult.result.text).toBe('Extracted text');
    });
  });

  describe('Model Registry', () => {
    it('retrieves active speech models', () => {
      const models = ModelRegistry.getModelsByCategory('speech');
      expect(models.length).toBeGreaterThan(0);
      expect(models[0].provider).toBeDefined();
    });
  });

  describe('Persistent MediaKnowledgeGraph', () => {
    it('links nodes with typed relationship edges', () => {
      const graph = new MediaKnowledgeGraph('job_v7_graph');
      graph.addNode({ id: 'face_1', type: 'face', data: { name: 'Alice' } });
      graph.addNode({ id: 'scene_1', type: 'scene', data: { startTime: 0 } });
      graph.addEdge({ sourceId: 'face_1', targetId: 'scene_1', relationship: 'appearsIn' });

      const connected = graph.getConnectedNodes('face_1', 'appearsIn');
      expect(connected.length).toBe(1);
      expect(connected[0].id).toBe('scene_1');
    });
  });

  describe('Event-Driven Pipeline', () => {
    it('publishes and receives pipeline events', (done) => {
      EventPipeline.subscribe('TranscriptionCompleted', (payload) => {
        expect(payload.jobId).toBe('job_event_1');
        done();
      });

      EventPipeline.publish('TranscriptionCompleted', 'job_event_1', { count: 10 });
    });
  });

  describe('Artifact Store & Fingerprinting', () => {
    it('saves and retrieves cached artifacts via content fingerprints', () => {
      const content = 'video_raw_transcript_data';
      const fp = ArtifactStore.computeFingerprint(content);
      ArtifactStore.saveArtifact(fp, 'transcript', { text: content });

      const cached = ArtifactStore.getArtifact(fp, 'transcript');
      expect(cached).not.toBeNull();
      expect(cached.text).toBe(content);
    });
  });

  describe('Distributed Worker Pool & Multi-Agent Reasoning', () => {
    it('dispatches tasks to dedicated worker capacity', async () => {
      const task = await DistributedWorkerPool.dispatchTask({ id: 't1', type: 'analysis', payload: {} });
      expect(task.success).toBe(true);
      expect(task.workerId).toContain('analysis-worker');
    });

    it('evaluates consensus opinions across specialized agents', async () => {
      const graph = new MediaKnowledgeGraph('job_agent');
      graph.addNode({ id: 'sp1', type: 'speech', data: {} });
      graph.addNode({ id: 'fc1', type: 'face', data: {} });

      const consensus = await MultiAgentEngine.evaluateConsensus(graph, 0, 10);
      expect(consensus.consensusScore).toBeGreaterThan(50);
      expect(consensus.opinions.length).toBe(3);
    });
  });
});
