import { Router } from 'express';
import { db, Job, Clip } from '../../models/db';
import { PluginRegistry } from '../../plugins/PluginRegistry';
import { ModelRegistry } from '../../services/ModelRegistry';
import { HardwareDetector } from '../../services/hardwareDetector';
import { DependencyRegistry } from '../../services/DependencyRegistry';
import { SemanticEngine } from '../../services/SemanticEngine';
import { ProductionRenderEngine } from '../../renderers/ProductionRenderEngine';
import { DistributedWorkerPool } from '../../services/DistributedWorkerPool';
import { CreatorExperienceService } from '../../core/creator/CreatorExperienceService';
import { CreatorEditingEngine, InstructionPreset } from '../../core/creator/CreatorEditingEngine';
import { ViralityMatrixEngine } from '../../core/reasoning/ViralityMatrixEngine';
import { MediaTimeline } from '../../core/timeline/MediaTimeline';
import { UPLOADS_DIR, OUTPUTS_DIR } from '../../config';
import path from 'path';
import fs from 'fs';

const v1Router = Router();

// GET /v1/system / /v1/diagnostics
v1Router.get('/diagnostics', async (req, res) => {
  try {
    const hardware = HardwareDetector.getDiagnostics();
    const dependencies = await DependencyRegistry.verifyAll();
    const workerStats = DistributedWorkerPool.getWorkerStats();
    res.json({
      status: 'healthy',
      hardware,
      dependencies: Object.values(dependencies),
      workerStats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /v1/plugins
v1Router.get('/plugins', (req, res) => {
  res.json({ plugins: PluginRegistry.getAll() });
});

// GET /v1/models
v1Router.get('/models', (req, res) => {
  res.json({ models: ModelRegistry.getAll() });
});

// GET /v1/creator/alternate-edits/:clipId
v1Router.get('/creator/alternate-edits/:clipId', (req, res) => {
  const edits = CreatorExperienceService.getAlternateEdits(req.params.clipId);
  res.json({ alternateEdits: edits });
});

// POST /v1/creator/natural-language-edit
v1Router.post('/creator/natural-language-edit', (req, res) => {
  const { clipId, prompt } = req.body;
  if (!clipId || !prompt) return res.status(400).json({ error: 'clipId and prompt required' });
  const result = CreatorExperienceService.applyNaturalLanguageEdit(clipId, prompt);
  res.json(result);
});

// POST /v1/creator/instruction
v1Router.post('/creator/instruction', (req, res) => {
  const { preset } = req.body;
  if (!preset) return res.status(400).json({ error: 'preset required' });
  const result = CreatorEditingEngine.processInstruction(preset as InstructionPreset);
  res.json(result);
});

// GET /v1/creator/virality-matrix/:jobId
v1Router.get('/creator/virality-matrix/:jobId', (req, res) => {
  const timeline = new MediaTimeline(req.params.jobId);
  const matrix = ViralityMatrixEngine.evaluateMatrix(timeline, 0, 15);
  res.json(matrix);
});

// GET /v1/jobs/:id
v1Router.get('/jobs/:id', (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as Job | undefined;
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json({ job });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v1/search
v1Router.post('/search', (req, res) => {
  try {
    const { jobId, query, limit } = req.body;
    if (!jobId || !query) return res.status(400).json({ error: 'jobId and query required' });
    const results = SemanticEngine.search(jobId, query, limit || 5);
    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default v1Router;
