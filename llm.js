// Groq API wrapper for FODMAP classification and analysis

import { FACTOR_IDS, LEVELS } from './config.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const ANALYSIS_MODEL = process.env.GROQ_ANALYSIS_MODEL || 'openai/gpt-oss-120b';

// Build factors schema for LLM prompt
const FACTORS_SCHEMA = FACTOR_IDS
  .map(id => `"${id}":"${LEVELS.join('|')}"`)
  .join(',');

// Extract JSON from response text (browser search doesn't support structured output)
function extractJSON(text) {
  if (!text) throw new Error('Empty response from LLM');
  
  // Try to find JSON by looking for balanced braces
  let depth = 0;
  let start = -1;
  
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        const jsonStr = text.slice(start, i + 1);
        try {
          return JSON.parse(jsonStr);
        } catch {
          // Continue looking for valid JSON
          start = -1;
        }
      }
    }
  }
  
  throw new Error('No valid JSON found in response');
}

async function callGroq(messages, { useBrowserSearch = false, model = MODEL } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }

  const body = {
    model,
    messages,
    temperature: 0.3,
    max_completion_tokens: 4096,
  };

  // Add browser search tool for web lookups (e.g., recipe URLs)
  // Note: browser_search is not compatible with response_format: json_object
  if (useBrowserSearch) {
    body.tools = [{ type: 'browser_search' }];
    body.tool_choice = 'auto';
  } else {
    body.response_format = { type: 'json_object' };
  }

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  
  if (!data.choices?.[0]?.message?.content) {
    throw new Error('Unexpected response structure from Groq API');
  }
  
  const content = data.choices[0].message.content;
  
  try {
    return useBrowserSearch ? extractJSON(content) : JSON.parse(content);
  } catch (e) {
    throw new Error(`Failed to parse LLM response: ${e.message}. Response was: ${content.slice(0, 200)}...`);
  }
}

// Classify user input as either a food entry or symptom entry
export async function classify(text) {
  const messages = [
    {
      role: 'system',
      content: `You are a FODMAP diet expert. Analyze the user's input and classify it as either a food entry or a symptom entry. If a food entry, take portion size into account, assuming a medium portion size if not specified. All entered food is vegan (no honey).

You have access to browser_search which you may optionally use to:
- Visit recipe URLs the user provides
- Look up FODMAP info for unfamiliar foods or ingredients you're unsure about (prioritizing the Monash University as a source)

CRITICAL: Your final response must be plain text containing a JSON object. Do NOT use any tool to return JSON - just write the JSON directly as text. No markdown code blocks.

For FOOD entries, respond with:
{"type":"food","factors":{${FACTORS_SCHEMA}},"note":"Brief note about content or portion guidance"}

Use "unknown" for a category if you cannot determine the level with reasonable confidence.

For SYMPTOM entries, respond with:
{"type":"symptom","severity":"low|medium|high","note":"Brief note about the symptom"}

Be accurate about FODMAP levels based on Monash University guidelines.`
    },
    {
      role: 'user',
      content: text
    }
  ];

  // Use browser search for URLs
  return callGroq(messages, { useBrowserSearch: true });
}

// Format entries for LLM analysis in a readable format
function formatEntriesForAnalysis(entries) {
  // Group entries by date
  const byDate = {};
  for (const entry of entries) {
    const d = new Date(entry.timestamp);
    const dateKey = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push({ ...entry, date: d });
  }
  
  // Format each day
  const lines = [];
  for (const [date, dayEntries] of Object.entries(byDate)) {
    lines.push(`\n${date}`);
    
    // Sort entries by time
    dayEntries.sort((a, b) => a.date - b.date);
    
    for (const entry of dayEntries) {
      const time = entry.date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      
      if (entry.type === 'food') {
        const factors = entry.factors || { ...entry.fodmaps, ...entry.other };
        const factorTags = Object.entries(factors || {})
          .filter(([_, level]) => level && level !== 'none' && level !== 'unknown')
          .map(([name, level]) => `[${level} ${name}]`)
          .join(' ');
        const tagLabel = entry.tag ? ` (${entry.tag})` : '';
        lines.push(`  ${time}: ${entry.text}${tagLabel} ${factorTags}`);
      } else if (entry.type === 'symptom') {
        lines.push(`  ${time}: SYMPTOM - ${entry.text} [${entry.severity}]`);
      } else if (entry.type === 'note') {
        lines.push(`  ${time}: NOTE - ${entry.text}`);
      }
    }
  }
  
  return lines.join('\n');
}

// Analyze entries for correlations between foods and symptoms
export async function analyze(entries) {
  const formattedEntries = formatEntriesForAnalysis(entries);
  
  const messages = [
    {
      role: 'system',
      content: `You are a FODMAP diet expert analyzing a food diary. Look for correlations between foods eaten and symptoms reported. Consider timing (symptoms often appear 1-4 hours after eating trigger foods but could take as long as 12-24 hours).

Foods marked as (safe) or (culprit) are user-identified patterns to consider.

Return JSON in this format:
{
  "summary": "Brief overall summary of the diary period",
  "correlations": [
    {
      "food": "Food item or FODMAP category",
      "symptom": "Related symptom",
      "confidence": "low|medium|high",
      "explanation": "Why this correlation might exist"
    }
  ],
  "recommendations": ["List of actionable recommendations"],
  "safe_foods": ["Foods that appear well-tolerated"],
  "trigger_foods": ["Foods that may be causing issues"]
}

IMPORTANT: Your response must contain valid JSON matching the format above.`
    },
    {
      role: 'user',
      content: `Here are the diary entries to analyze:\n${formattedEntries}`
    }
  ];

  // Analysis uses a different model without browser search
  return callGroq(messages, { model: ANALYSIS_MODEL });
}
