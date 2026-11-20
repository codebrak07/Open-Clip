import { Router } from 'express';
import { db, Job, Clip, FootballMatch, CommentaryScript, PublishingPackage } from '../../models/db';
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
import { ProviderRegistry } from '../../services/ProviderRegistry';
import { PythonEngineBridge } from '../../services/PythonEngineBridge';
import { UPLOADS_DIR, OUTPUTS_DIR } from '../../config';
import crypto from 'crypto';

import storyRouter from './story';

const v1Router = Router();

// Story Studio Autonomous Generative Module
v1Router.use('/story', storyRouter);

// GET /v1/diagnostics
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

// GET /v1/providers
v1Router.get('/providers', async (req, res) => {
  try {
    const available = ProviderRegistry.getAvailableProviders();
    res.json({ providers: available });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v1/providers/test
v1Router.post('/providers/test', async (req, res) => {
  try {
    const { provider, apiKey, apiBase } = req.body;
    if (!provider) return res.status(400).json({ error: 'provider name is required' });
    const result = await ProviderRegistry.testProvider(provider, apiKey, apiBase);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v1/providers/configure
v1Router.post('/providers/configure', async (req, res) => {
  try {
    const { provider, apiKey, apiBase } = req.body;
    if (!provider) return res.status(400).json({ error: 'provider name is required' });
    if (apiKey) {
      ProviderRegistry.setRuntimeKey(provider, apiKey);
    }
    const result = await ProviderRegistry.testProvider(provider, apiKey, apiBase);
    res.json({
      configured: true,
      provider,
      test: result,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v1/football/resolve
v1Router.post('/football/resolve', async (req, res) => {
  try {
    const { matchText, language = 'English', style = 'Passionate Fan', sourceUrl } = req.body;
    if (!matchText) return res.status(400).json({ error: 'matchText is required' });

    // Invoke Python football resolver & commentary engine
    const pythonResult = await PythonEngineBridge.resolveFootball(matchText, language, style);

    const matchId = `match_${Date.now()}`;
    const insertMatch = db.prepare(`
      INSERT INTO football_matches (id, home_team, away_team, competition, scoreline, source_url, status, verified, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Parse teams from title or fallback
    const title = pythonResult.match_title || matchText;
    const parts = title.split(' vs ');
    const homeTeam = parts[0] || 'Home Team';
    const awayTeam = (parts[1] || 'Away Team').split(' ')[0];

    insertMatch.run(
      matchId,
      homeTeam,
      awayTeam,
      'League Clash',
      'Verified',
      sourceUrl || '',
      'resolved',
      1,
      Date.now()
    );

    // Save commentary script
    const scriptId = `script_${Date.now()}`;
    db.prepare(`
      INSERT INTO commentary_scripts (id, match_id, language, style, hook, segments_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      scriptId,
      matchId,
      language,
      style,
      pythonResult.opening_hook || '',
      JSON.stringify(pythonResult.segments || []),
      Date.now()
    );

    res.json({
      matchId,
      context: {
        homeTeam,
        awayTeam,
        title: pythonResult.match_title,
      },
      commentary: pythonResult,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v1/publishing/generate
v1Router.post('/publishing/generate', (req, res) => {
  try {
    const { targetId, topic, niche = 'General', summary = '', aspect = '9:16' } = req.body;
    if (!targetId || !topic) return res.status(400).json({ error: 'targetId and topic required' });

    const cleanTopic = topic.trim();
    const primaryTitle = `${cleanTopic}: What Nobody Told You`;
    const alternativeTitles = [
      `The Untold Truth About ${cleanTopic}`,
      `How ${cleanTopic} Actually Works (Full Breakdown)`,
      `Stop Doing This If You Care About ${cleanTopic}!`,
      `Why ${cleanTopic} Will Change Everything in 2026`,
    ];

    const primaryKw = cleanTopic.toLowerCase();
    const seoKeywords = [primaryKw, `${primaryKw} guide`, `${primaryKw} tutorial`, `${niche.toLowerCase()} 2026`];
    const tags = [primaryKw.replace(/\s+/g, ''), niche.toLowerCase(), 'shorts', 'reels', 'viral'];
    const hashtags = [`#${primaryKw.replace(/\s+/g, '')}`, `#${niche.toLowerCase()}`, '#shorts', '#viral'];
    const description = `Discover the truth about ${cleanTopic}.\n\nKey Takeaway: ${summary || 'Comprehensive breakdown for creators.'}\n\n${hashtags.join(' ')}`;

    const packageId = `pub_${Date.now()}`;
    db.prepare(`
      INSERT INTO publishing_packages (
        id, target_id, target_type, primary_title, alternative_titles_json,
        description, primary_keyword, seo_keywords_json, tags_json, hashtags_json,
        thumbnail_type, aspect_ratio, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      packageId,
      targetId,
      'clip',
      primaryTitle,
      JSON.stringify(alternativeTitles),
      description,
      primaryKw,
      JSON.stringify(seoKeywords),
      JSON.stringify(tags),
      JSON.stringify(hashtags),
      'frame',
      aspect,
      Date.now()
    );

    res.json({
      id: packageId,
      primaryTitle,
      alternativeTitles,
      description,
      primaryKeyword: primaryKw,
      seoKeywords,
      tags,
      hashtags,
      thumbnailType: 'frame',
      aspectRatio: aspect,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
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
