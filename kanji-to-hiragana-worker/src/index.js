import { kanjiToHiragana } from './kakasi'
/**
 * Handles incoming requests to the worker
 * @param {Request} request - The incoming request object
 * @returns {Response} The response with conversion results
 */
async function handleRequest(request) {
  // Set up CORS headers for cross-origin requests
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Accept both GET and POST methods for flexibility
  if (request.method === 'GET') {
    // For GET requests, use the URL parameter
    const url = new URL(request.url);
    const text = url.searchParams.get('text');

    if (!text) {
      return new Response(JSON.stringify({ error: 'Text parameter is required' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    // Process as a batch by splitting on newlines
    const phrases = text.split('\n').filter(phrase => phrase.trim());
    const results = processBatch(phrases);

    return new Response(JSON.stringify({ data: results.join('\n') }), {
      headers: corsHeaders
    });
  }
  else if (request.method === 'POST') {
    try {
      // Parse request body
      const data = await request.json();

      // Handle both single text and array of texts
      if (!data.text && !data.texts) {
        return new Response(JSON.stringify({ error: 'Text or texts array is required' }), {
          status: 400,
          headers: corsHeaders
        });
      }

      let phrases;
      if (data.text) {
        // Single text case - split on newlines
        phrases = data.text.split('\n').filter(phrase => phrase.trim());
      } else if (Array.isArray(data.texts)) {
        // Array case - use as is
        phrases = data.texts.filter(phrase => phrase && typeof phrase === 'string');
      } else {
        phrases = [];
      }

      if (phrases.length === 0) {
        return new Response(JSON.stringify({ error: 'No valid text phrases provided' }), {
          status: 400,
          headers: corsHeaders
        });
      }

      // Process the batch of phrases
      const results = processBatch(phrases);

      return new Response(JSON.stringify({ data: results.join('\n') }), {
        headers: corsHeaders
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: corsHeaders
      });
    }
  }

  // Method not allowed
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: corsHeaders
  });
}

/**
 * Process a batch of phrases
 * @param {string[]} phrases - Array of Japanese phrases to convert
 * @returns {string[]} Array of hiragana readings in same order as input
 */
function processBatch(phrases) {
  // Deduplicate phrases to avoid unnecessary requests
  const uniquePhrases = [...new Set(phrases)];

  // Create a map to store results
  const resultsMap = new Map();

  // Process in chunks to avoid rate limiting
  const chunkSize = 20;
  for (let i = 0; i < uniquePhrases.length; i += chunkSize) {
    const chunk = uniquePhrases.slice(i, i + chunkSize);
    chunk.map((phrase, index) => {
      try {
        const result = getReadings(phrase);
        resultsMap.set(phrase, result);
      } catch (error) {
        console.error(`Error processing "${phrase}":`, error);
        resultsMap.set(phrase, ''); // Empty string for failed lookups
      }
    });
  }

  // Map original phrases to their readings, preserving the original order
  return phrases.map(phrase => resultsMap.get(phrase) || '');
}

/**
 * Fetches readings for given text from jisho.org
 * @param {string} text - Japanese text to convert
 * @returns {Object} Object containing hiragana reading
 */
function getReadings(text) {
  // Skip empty text
  if (!text || text.trim() === '') {
    return "";
  }
	return kanjiToHiragana(text);
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request);
  },
};

