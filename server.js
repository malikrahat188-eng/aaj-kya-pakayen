const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory rate limiter: 10 requests per minute per IP
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 10;

function rateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
  const now = Date.now();

  let record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    record = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(ip, record);
    return next();
  }

  if (record.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((record.resetTime - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    return res.status(429).json({
      error: 'Too many requests. Please wait a minute and try again.'
    });
  }

  record.count += 1;
  return next();
}

// Clean stale rate limit records every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// Default fallback list of models in priority order
const FALLBACK_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-1.5-flash'
];

let candidateModels = [...FALLBACK_MODELS];
let currentActiveModel = candidateModels[0];

// Dynamic model discovery from Gemini API
async function discoverModels(apiKey) {
  if (!apiKey || apiKey === 'your-key-here') {
    return;
  }

  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey
      }
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Model Discovery] API returned status ${res.status}: ${errText}`);
      return;
    }

    const data = await res.json();
    if (!data.models || !Array.isArray(data.models)) {
      return;
    }

    // Filter models supporting generateContent and filter out specialized non-text or preview/omni models
    const supported = data.models
      .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(name =>
        !name.includes('omni') &&
        !name.includes('preview') &&
        !name.includes('tts') &&
        !name.includes('image') &&
        !name.includes('transcribe') &&
        !name.includes('clip') &&
        !name.includes('robotics') &&
        !name.includes('computer-use') &&
        !name.includes('banana') &&
        !name.includes('antigravity') &&
        !name.includes('deep-research')
      );

    if (supported.length === 0) return;

    // Rank models: flash first (newest versions first), then flash-lite, then others
    const flashModels = supported
      .filter(m => m.includes('flash') && !m.includes('lite') && !m.includes('latest'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    const flashLiteModels = supported
      .filter(m => m.includes('flash') && m.includes('lite'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    const otherModels = supported
      .filter(m => !m.includes('flash'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

    const sorted = [...flashModels, ...flashLiteModels, ...otherModels];

    // If GEMINI_MODEL is specified in .env, place it at the front
    const envModel = (process.env.GEMINI_MODEL || '').trim();
    if (envModel) {
      const cleanEnvModel = envModel.replace(/^models\//, '');
      const filtered = sorted.filter(m => m !== cleanEnvModel);
      candidateModels = [cleanEnvModel, ...filtered];
    } else {
      candidateModels = sorted.length > 0 ? sorted : FALLBACK_MODELS;
    }

    currentActiveModel = candidateModels[0];
    console.log(`[Model Discovery] Discovered ${supported.length} models. Primary model: ${currentActiveModel}`);
  } catch (err) {
    console.warn('[Model Discovery] Could not reach Gemini models endpoint:', err.message);
  }
}

// Safe JSON parser for Gemini output
function parseGeminiJson(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  // Remove markdown code fences if present
  let clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();

  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  const jsonSnippet = clean.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonSnippet);
}

// Robust caller with fast model fallback
async function callGeminiWithFallback(prompt, apiKey) {
  let lastError = null;

  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    const model = candidateModels[mIdx];
    let modelFailed = false;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Gemini Request] Model: ${model} | Attempt: ${attempt}/2`);

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [{ text: prompt }]
                }
              ],
              generationConfig: {
                responseMimeType: 'application/json',
                maxOutputTokens: 4000
              }
            })
          }
        );

        if (response.ok) {
          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
          const parsed = parseGeminiJson(text);

          if (parsed && Array.isArray(parsed.meals) && parsed.meals.length > 0) {
            // Speed optimization: promote this working model to the front so subsequent requests are instant!
            if (mIdx > 0) {
              candidateModels.splice(mIdx, 1);
              candidateModels.unshift(model);
              console.log(`[Gemini Speed Boost] Promoted fast model '${model}' to primary.`);
            }
            currentActiveModel = model;
            return parsed;
          } else {
            console.error('[Gemini Parse Error] Invalid or empty meals JSON from model:', model, text.slice(0, 200));
            throw new Error('AI returned an invalid data format.');
          }
        }

        const errorBody = await response.text();
        console.error(`[Gemini Error] Model ${model} returned HTTP ${response.status}: ${errorBody.slice(0, 300)}`);

        // If 404 (model deprecated) or 429 (quota exhausted), jump immediately to next model without wasting seconds
        if (response.status === 404 || response.status === 429) {
          console.warn(`[Gemini] Model ${model} returned ${response.status}. Switching to next model immediately...`);
          modelFailed = true;
          break;
        }

        // If 503 (temporary high server load), retry once after 1s or try next model
        if (response.status === 503) {
          if (attempt === 1) {
            console.warn(`[Gemini] HTTP 503 on ${model}. Retrying once in 1s...`);
            await new Promise(r => setTimeout(r, 1000));
            continue;
          } else {
            console.warn(`[Gemini] Model ${model} repeated 503. Switching to next model...`);
            modelFailed = true;
            break;
          }
        }

        // For other status codes (e.g. 400 or 403), do not retry indefinitely
        lastError = new Error(`Gemini API HTTP ${response.status}`);
        modelFailed = true;
        break;
      } catch (err) {
        console.error(`[Gemini Network/Execution Error] Attempt ${attempt} on ${model}:`, err.message);
        lastError = err;
        if (attempt < 3) {
          const delay = attempt === 1 ? 2000 : 4000;
          await new Promise(r => setTimeout(r, delay));
        } else {
          modelFailed = true;
          break;
        }
      }
    }

    if (!modelFailed) {
      break;
    }
  }

  throw lastError || new Error('All Gemini model candidates failed to respond.');
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  const keyLoaded = Boolean(key && key !== 'your-key-here');
  res.json({
    ok: true,
    keyLoaded
  });
});

// Meal suggestion endpoint
app.post('/api/suggest', rateLimiter, async (req, res) => {
  try {
    const { ingredients, people, budget, lang } = req.body || {};

    // Validation
    if (typeof ingredients !== 'string') {
      return res.status(400).json({ error: 'Ingredients must be provided as text.' });
    }

    const trimmedIngredients = ingredients.trim();
    if (trimmedIngredients.length < 2 || trimmedIngredients.length > 500) {
      return res.status(400).json({
        error: 'Ingredients must be between 2 and 500 characters.'
      });
    }

    const numPeople = Math.min(20, Math.max(1, parseInt(people, 10) || 4));

    if (budget !== 'low' && budget !== 'medium') {
      return res.status(400).json({ error: "Budget must be either 'low' or 'medium'." });
    }

    if (lang !== 'ur' && lang !== 'en') {
      return res.status(400).json({ error: "Language must be either 'ur' or 'en'." });
    }

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey || apiKey === 'your-key-here') {
      console.error('[Configuration Error] GEMINI_API_KEY is missing or unset in .env file.');
      return res.status(500).json({
        error: lang === 'ur'
          ? 'Gemini API key configure nahi hai. Baraye meherbani .env file mein apni key add karein.'
          : 'Gemini API key is not configured on the server. Please add your key to .env.'
      });
    }

    // Build the tailored prompt
    const languageInstruction = lang === 'ur'
      ? `Write the entire response strictly in Roman Urdu (Urdu written using the English/Latin alphabet, for example: "Aloo Anda Bhujia", "Pehle pyaaz ko bareek kaat kar halka sunehra karein...", "Tamatar jaldi kharab ho sakte hain is liye unhe pehle use karein", "Bachi hui sabzi se subah paratha ya roll bana sakte hain"). Do NOT use Arabic or Nastaliq Urdu script. Use friendly, conversational Pakistani home-style phrasing.`
      : `Write the entire response in simple, encouraging English suitable for everyday home cooks and beginners.`;

    const budgetInstruction = budget === 'low'
      ? `The budget is LOW. Focus on extremely budget-friendly, economical dishes, minimal extra ingredients, smart stretching of staples, and no expensive meat or luxury spices.`
      : `The budget is MEDIUM. Standard everyday Pakistani home-style cooking with balanced ingredients.`;

    const prompt = `You are a friendly, expert Pakistani home-cooking helper assisting Pakistani households (housewives, working women, hostel students, and bachelors) to decide what to cook and avoid wasting food.

USER INVENTORY & PREFERENCES:
- Available Ingredients: ${trimmedIngredients}
- Household Size: ${numPeople} people
- Budget: ${budget} (${budgetInstruction})
- Language Requirement: ${languageInstruction}

COOKING GUIDELINES:
1. Suggest 2 to 3 common Pakistani home-style dishes (e.g. sabzi, daal, salan, pulao, khichdi, paratha, anda/egg dishes, bhujia) that utilize MOSTLY the given ingredients.
2. Assume standard Pakistani pantry staples are always available: cooking oil/ghee, namak (salt), haldi (turmeric), lal mirch (red chili), and water.
3. Scale the recipes and quantities suitably for ${numPeople} people.
4. For each dish, provide 4 to 6 concise, clear, step-by-step instructions and an estimated cooking time (e.g. "20-25 mins" or "20-25 minute").
5. "use_first": Identify which of the user's provided ingredients is most perishable and must be used immediately before spoiling, with a quick helpful tip.
6. "leftover_idea": Suggest one clever, practical idea to repurpose leftovers from these dishes for the next day's meal, breakfast, or hostel snack (e.g. leftover sabzi in a paratha roll or sandwich).

OUTPUT FORMAT:
You MUST reply strictly with valid JSON. No conversational text outside JSON, no markdown fences.
Strict schema:
{
  "meals": [
    {
      "name": "Dish name",
      "why": "Brief explanation of why it fits the ingredients and budget",
      "time": "Estimated cooking time",
      "steps": [
        "Step 1...",
        "Step 2...",
        "Step 3...",
        "Step 4..."
      ]
    }
  ],
  "use_first": "Perishable ingredient tip",
  "leftover_idea": "Leftover reuse idea"
}`;

    const result = await callGeminiWithFallback(prompt, apiKey);
    return res.json(result);
  } catch (error) {
    console.error('[Server Error in /api/suggest]:', error.message || error);
    const isUrdu = req.body?.lang === 'ur';
    return res.status(500).json({
      error: isUrdu
        ? 'Khana tajweez karne mein dushwari hui. Baraye meherbani thori der baad dobara koshish karein.'
        : 'Could not generate meal suggestions right now. Please try again in a moment.'
    });
  }
});

// Start Server
app.listen(PORT, async () => {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  const apiKeyFound = Boolean(apiKey && apiKey !== 'your-key-here');

  console.log('====================================================');
  console.log(` Aaj Kya Pakayen? (What to Cook Today?)`);
  console.log(` Server is running on port ${PORT}`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` GEMINI_API_KEY status: ${apiKeyFound ? 'FOUND & LOADED' : 'NOT FOUND (Please set it in .env)'}`);

  if (apiKeyFound) {
    await discoverModels(apiKey);
  } else {
    const envModel = (process.env.GEMINI_MODEL || '').trim();
    if (envModel) {
      candidateModels = [envModel.replace(/^models\//, ''), ...FALLBACK_MODELS];
    }
    currentActiveModel = candidateModels[0];
  }

  console.log(` Active Gemini Model: ${currentActiveModel}`);
  console.log(` Model Fallback Chain: ${candidateModels.slice(0, 4).join(' -> ')}`);
  console.log('====================================================');
});
