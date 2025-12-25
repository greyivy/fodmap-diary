import 'dotenv/config';
import express from 'express';
import { Level } from 'level';
import { readFileSync } from 'fs';
import { classify, analyze } from './llm.js';
import { FACTORS, FACTOR_IDS, LEVELS } from './config.js';

const app = express();
const db = new Level('./data', { valueEncoding: 'json' });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Homepage - render diary
app.get('/', async (req, res) => {
  const entries = [];
  
  for await (const [key, value] of db.iterator()) {
    entries.push({ key, ...value });
  }
  
  // Sort by timestamp descending (newest first)
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  
  // Read and render template
  let html = readFileSync('./views/index.html', 'utf-8');
  html = html.replace('{{ENTRIES_JSON}}', JSON.stringify(entries));
  html = html.replace('{{FACTORS_JSON}}', JSON.stringify(FACTORS));
  html = html.replace('{{FACTOR_IDS_JSON}}', JSON.stringify(FACTOR_IDS));
  html = html.replace('{{LEVELS_JSON}}', JSON.stringify(LEVELS));
  
  res.send(html);
});

// Add new entry
app.post('/api/add', async (req, res) => {
  const { text, isNote, overrideTime, customTime } = req.body;
  
  if (!text || !text.trim()) {
    return res.redirect('/');
  }
  
  try {
    const timestamp = (overrideTime && customTime) 
      ? new Date(customTime).toISOString() 
      : new Date().toISOString();
    let entry;
    
    if (isNote) {
      // Notes skip LLM classification
      entry = {
        type: 'note',
        text: text.trim(),
        timestamp,
      };
    } else {
      const result = await classify(text.trim());
      entry = {
        ...result,
        text: text.trim(),
        timestamp,
      };
    }
    
    await db.put(timestamp, entry);
    res.redirect('/');
  } catch (error) {
    console.error('Error classifying entry:', error);
    res.status(500).send(`Error: ${error.message}. <a href="/">Go back</a>`);
  }
});

// Analyze entries (client sends filtered entries based on local date range)
app.post('/api/analyze', async (req, res) => {
  const { entries } = req.body;
  
  try {
    if (!entries || entries.length === 0) {
      return res.json({ error: 'No entries found in selected date range' });
    }
    
    const result = await analyze(entries);
    res.json(result);
  } catch (error) {
    console.error('Error analyzing entries:', error);
    res.status(500).json({ error: error.message });
  }
});

// Duplicate entry at current time
app.post('/api/duplicate', async (req, res) => {
  const { key } = req.body;
  
  try {
    const original = await db.get(key);
    const timestamp = new Date().toISOString();
    const entry = { ...original, timestamp };
    await db.put(timestamp, entry);
    res.redirect('/');
  } catch (error) {
    console.error('Error duplicating entry:', error);
    res.status(500).send(`Error: ${error.message}. <a href="/">Go back</a>`);
  }
});

// Update entry (factors, severity, or tag)
app.post('/api/update', async (req, res) => {
  const { key, factors, severity, tag } = req.body;
  
  try {
    const entry = await db.get(key);
    
    if (factors) {
      entry.factors = factors;
      // Clear old format if present
      delete entry.fodmaps;
      delete entry.other;
    }
    if (severity) {
      entry.severity = severity;
    }
    if (tag !== undefined) {
      // Toggle tag: if same tag, remove it; otherwise set it
      entry.tag = entry.tag === tag ? null : tag;
    }
    
    await db.put(key, entry);
    res.json({ success: true, entry });
  } catch (error) {
    console.error('Error updating entry:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete entry
app.post('/api/delete', async (req, res) => {
  const { key } = req.body;
  
  try {
    await db.del(key);
    res.redirect('/');
  } catch (error) {
    console.error('Error deleting entry:', error);
    res.status(500).send(`Error: ${error.message}. <a href="/">Go back</a>`);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`FODMAP Diary running at http://localhost:${PORT}`);
});

