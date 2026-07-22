import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeVideo } from './lib/analyze.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// API Endpoints

// Config endpoint
app.get('/api/config', (req, res) => {
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
  const hasGeminiKey = !!process.env.GEMINI_API_KEY;

  res.json({
    videoBackend: hasAnthropicKey || hasGeminiKey,
    whisper: hasOpenAIKey,
    anthropic: hasAnthropicKey,
    openai: hasOpenAIKey,
    gemini: hasGeminiKey
  });
});

// Analyze video endpoint - uses full pipeline
app.post('/api/analyze-video', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.json({ success: false, error: 'Video URL required' });
    }

    const result = await analyzeVideo(url, {
      anthropicKey: process.env.ANTHROPIC_API_KEY,
      openaiKey: process.env.OPENAI_API_KEY,
      geminiKey: process.env.GEMINI_API_KEY,
      geminiModel: process.env.GEMINI_MODEL
    });

    res.json({ success: true, ...result });

  } catch (error) {
    console.error('Video analysis error:', error);
    res.json({
      success: false,
      error: error.message,
      code: error.code
    });
  }
});

// Routes - serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, 'signup.html'));
});

app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});

// 404 - serve app for SPA fallback
app.get('*', (req, res) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css') || req.path.endsWith('.json')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'app.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Cartly server running on port ${PORT}`);
});
