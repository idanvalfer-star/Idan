import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const anthropic = new Anthropic();

// Middleware
app.use(express.json());
app.use(express.static(__dirname));

// API Endpoints

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json({ videoBackend: true, whisper: false });
});

// Analyze video endpoint
app.post('/api/analyze-video', async (req, res) => {
  try {
    const { url, caption } = req.body;

    if (!caption) {
      return res.json({ success: false, error: 'Caption required' });
    }

    // Use Claude to extract ingredients from caption
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-1',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Extract all food/grocery ingredients from this recipe caption. Return as JSON array with {name, qty} objects. Caption:\n\n${caption}`
        }
      ]
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      return res.json({ success: false, error: 'Failed to parse response' });
    }

    // Parse Claude's response
    let ingredients = [];
    try {
      const jsonMatch = content.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        ingredients = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse ingredients:', e);
    }

    res.json({
      success: true,
      ingredients,
      platform: url.includes('instagram') ? 'instagram' : 'youtube'
    });

  } catch (error) {
    console.error('Video analysis error:', error);
    res.json({ success: false, error: error.message });
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
