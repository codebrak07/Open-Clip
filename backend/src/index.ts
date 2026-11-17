import express from 'express';
import cors from 'cors';
import { PORT, OUTPUTS_DIR } from './config';
import apiRouter from './routes/api';
import v1Router from './routes/v1';
import { QueueManager } from './services/QueueManager';
import { PluginSystem } from './services/PluginSystem';

import { StudioCore } from './studio/StudioCore';

const app = express();

app.use(cors());
app.use(express.json());

// Bootstrap Studio Core
StudioCore.bootstrap().catch(err => console.error('[StudioCore Bootstrap Error]', err));

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'OpenClip AI API Server',
    status: 'online',
    frontendUrl: 'http://localhost:5173',
    healthCheck: 'http://localhost:5001/health',
    apiEndpoint: 'http://localhost:5001/api',
  });
});

// Serve rendered clips and assets
app.use('/outputs', express.static(OUTPUTS_DIR));
app.use('/outputs', express.static(path.resolve(__dirname, '../storage/outputs')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/uploads', express.static(path.resolve(__dirname, '../storage/uploads')));

// API router
app.use('/api/v1', v1Router);
app.use('/api', apiRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: Date.now() });
});

// Initialize Plugin System & Queue Manager
(async () => {
  await PluginSystem.autoDiscover();
  QueueManager.start();

  app.listen(PORT, () => {
    console.log(`OpenClip AI Refactored Engine running on http://localhost:${PORT}`);
  });
})();
