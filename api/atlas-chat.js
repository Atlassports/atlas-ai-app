```javascript
//
// ATLAS CHAT — backend
// =========================================================
// Vercel serverless function for the Atlas AI hockey coach.
//
// PUT THIS FILE AT:
//   api/atlas-chat.js
//
// REQUIRED VERCEL ENV VARS:
//   GEMINI_API_KEY
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// FLOW:
//   1. Authenticate the player using their Supabase access token.
//   2. Check the daily message limit.
//   3. Find the player's latest completed report.
//   4. If the report has not been cached, download the PDF and have Gemini
//      extract the useful information once.
//   5. Save the extracted report text to videos.report_data.
//   6. Use the cached report text to answer the player's question.
//   7. Save the conversation to chat_messages.
//
// =========================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const DAILY_MESSAGE_LIMIT = 25;

const VIDEOS_TABLE = 'videos';
const CHAT_TABLE = 'chat_messages';
const STORAGE_BUCKET = 'reports';

// Use an explicit model instead of a moving "latest" alias.
const GEMINI_MODEL = 'gemini-2.5-flash';

// ---------------------------------------------------------
// Basic configuration check
// ---------------------------------------------------------

function checkEnvironment() {
  const missing = [];

  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!GEMINI_API_KEY) missing.push('GEMINI_API_KEY');

  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }
}

// ---------------------------------------------------------
// Supabase headers
// ---------------------------------------------------------

function sbHeaders(extra = {}) {
  return Object.assign(
    {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    extra
  );
}

// ---------------------------------------------------------
// Safely read JSON
// ---------------------------------------------------------

async function readJson(res) {
  const text = await res.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// ---------------------------------------------------------
// Ask Gemini
// ---------------------------------------------------------

async function askGemini(systemPrompt, userText, pdfBase64 = null) {
  const parts = [];

  if (pdfBase64) {
    parts.push({
      inline_data: {
        mime_type: 'application/pdf',
        data: pdfBase64,
      },
    });
  }

  parts.push({
    text: userText,
  });

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const requestBody = {
    system_instruction: {
      parts: [
        {
          text: systemPrompt,
        },
      ],
    },

    contents: [
      {
        role: 'user',
        parts,
      },
    ],

    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1000,
    },
  };

  console.log(
    'Sending request to Gemini:',
    GEMINI_MODEL,
    pdfBase64 ? '(PDF attached)' : '(text only)'
  );

  let res;

  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (networkError) {
    console.error('Gemini network error:', networkError);

    throw new Error(
      'Gemini could not be reached. Please try again in a moment.'
    );
  }

  const data = await readJson(res);

  if (!res.ok) {
    console.error(
      'Gemini API error:',
      JSON.stringify({
        status: res.status,
        data,
      })
    );

    const message =
      data?.error?.message ||
      data?.error?.status ||
      `Gemini returned HTTP ${res.status}`;

    throw new Error(`Gemini error: ${message}`);
  }

  const reply =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || '')
      .join('')
      .trim() || '';

  if (!reply) {
    console.error('Gemini returned no text:', JSON.stringify(data));

    throw new Error('Gemini returned an empty response.');
  }

  return reply;
}

// ---------------------------------------------------------
// Download player's report PDF from Supabase Storage
// ---------------------------------------------------------

async function downloadReportPdf(row) {
  const ref = String(row.report_url || '').trim();

  if (!ref) {
    console.error('Report row has no report_url:', row.id);
    return null;
  }

  const candidates = [];

  // If report_url looks like a storage path, try it directly.
  if (ref.includes('/')) {
    candidates.push(ref);
  } else {
    // Existing Atlas naming convention.
    if (row.id) {
      candidates.push(`${row.id}/${ref}_report.pdf`);
    }

    if (row.user_id) {
      candidates.push(`${row.user_id}/${ref}_report.pdf`);
    }

    // Also try the raw reference in case report_url itself is the filename.
    candidates.push(ref);
  }

  // Remove duplicates.
  const uniqueCandidates = [...new Set(candidates)];

  console.log('Trying report paths:', uniqueCandidates);

  for (const path of uniqueCandidates) {
    try {
      const encodedPath = path
        .split('/')
        .map(encodeURIComponent)
        .join('/');

      const url =
        `${SUPABASE_URL}/storage/v1/object/` +
        `${STORAGE_BUCKET}/${encodedPath}`;

      const res = await fetch(url, {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
      });

      if (res.ok) {
        const buf = await res.arrayBuffer();

        console.log(
          'Successfully downloaded report:',
          path,
          'bytes:',
          buf.byteLength
        );

        if (buf.byteLength === 0) {
          console.error('Report file is empty:', path);
          continue;
        }

        return Buffer.from(buf).toString('base64');
      }

      const errorText = await res.text();

      console.log(
        'Report path failed:',
        path,
        'status:',
        res.status,
        'response:',
        errorText.slice(0, 500)
      );
    } catch (error) {
      console.error(
        'Error downloading report:',
        path,
        error
      );
    }
  }

  return null;
}

// ---------------------------------------------------------
// Gemini prompt used to turn PDF into cached report text
// ---------------------------------------------------------

const EXTRACT_PROMPT = `
You are reading a hockey skating-analysis report PDF for Atlas.

Extract ALL information that a hockey coach would need to discuss the report
with the player.

Include:

- Overall score
- Every metric name and its score
- Strengths and their descriptions
- Areas to improve
- The description of every area to improve
- Every drill listed for each area to improve
- The 3-week focus plan
- All raw measurements
- Angles
- Stride counts
- Timing measurements
- Any other numerical measurements
- Tracking information
- Notes
- Caveats
- Any warnings about the quality of the video or tracking

Preserve numbers accurately.

Write a clean, structured plain-text summary.

Do NOT add coaching advice.
Do NOT interpret the results.
Do NOT invent anything.
Do NOT omit information simply because it seems minor.

The purpose of this extraction is to give another AI coach enough accurate
information to answer questions about the player's report later.
`.trim();

// ---------------------------------------------------------
// Main handler
// ---------------------------------------------------------

export default async function handler(req, res) {
  // -------------------------------------------------------
  // CORS
  // -------------------------------------------------------

  res.setHeader(
    'Access-Control-Allow-Origin',
    '*'
  );

  res.setHeader(
    'Access-Control-Allow-Methods',
    'POST, OPTIONS'
  );

  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  try {
    // -----------------------------------------------------
    // Environment
    // -----------------------------------------------------

    checkEnvironment();

    // -----------------------------------------------------
    // Request body
    // -----------------------------------------------------

    const body = req.body || {};

    const accessToken =
      typeof body.accessToken === 'string'
        ? body.accessToken.trim()
        : '';

    const message =
      typeof body.message === 'string'
        ? body.message.trim()
        : '';

    if (!accessToken || !message) {
      return res.status(400).json({
        error: 'Missing accessToken or message',
      });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        error: 'Message is too long. Please keep it under 4,000 characters.',
      });
    }

    // -----------------------------------------------------
    // 1. Authenticate player
    // -----------------------------------------------------

    const userRes = await fetch(
      `${SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!userRes.ok) {
      console.error(
        'Supabase authentication failed:',
        userRes.status,
        await userRes.text()
      );

      return res.status(401).json({
        error: 'Not logged in',
      });
    }

    const user = await readJson(userRes);

    if (!user?.id) {
      console.error(
        'Supabase returned invalid user:',
        user
      );

      return res.status(401).json({
        error: 'Could not identify player',
      });
    }

    const userId = user.id;

    // -----------------------------------------------------
    // 2. Daily message limit
    // -----------------------------------------------------

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const countUrl =
      `${SUPABASE_URL}/rest/v1/${CHAT_TABLE}` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&created_at=gte.${encodeURIComponent(todayStart.toISOString())}` +
      `&select=id`;

    const countRes = await fetch(
      countUrl,
      {
        headers: sbHeaders(),
      }
    );

    if (!countRes.ok) {
      console.error(
        'Chat count query failed:',
        countRes.status,
        await countRes.text()
      );

      console.log(
        'Continuing with usedCount = 0 because count query failed.'
      );
    }

    const sentToday = countRes.ok
      ? await readJson(countRes)
      : [];

    const usedCount =
      Array.isArray(sentToday)
        ? sentToday.length
        : 0;

    if (usedCount >= DAILY_MESSAGE_LIMIT) {
      return res.status(429).json({
        error:
          `You've used all ${DAILY_MESSAGE_LIMIT} messages for today. ` +
          'Resets at midnight.',
        remaining: 0,
      });
    }

    // -----------------------------------------------------
    // 3. Find latest completed report
    // -----------------------------------------------------

    const rowUrl =
      `${SUPABASE_URL}/rest/v1/${VIDEOS_TABLE}` +
      `?user_id=eq.${encodeURIComponent(userId)}` +
      `&report_url=not.is.null` +
      `&order=created_at.desc` +
      `&limit=1`;

    const rowRes = await fetch(
      rowUrl,
      {
        headers: sbHeaders(),
      }
    );

    if (!rowRes.ok) {
      console.error(
        'Videos query failed:',
        rowRes.status,
        await rowRes.text()
      );

      return res.status(500).json({
        error: 'Could not load your skating report.',
      });
    }

    const rows = await readJson(rowRes);

    const row =
      Array.isArray(rows)
        ? rows[0]
        : null;

    if (!row) {
      return res.status(404).json({
        error:
          "You don't have a finished report yet — upload a clip and we'll analyze it.",
      });
    }

    console.log(
      'Using report row:',
      {
        id: row.id,
        user_id: row.user_id,
        report_url: row.report_url,
        has_report_data: Boolean(row.report_data),
      }
    );

    // -----------------------------------------------------
    // 4. Get report text
    // -----------------------------------------------------

    let reportText = row.report_data;

    // If the report was already extracted, skip the PDF entirely.
    if (reportText && typeof reportText === 'string') {
      console.log(
        'Using cached report_data.'
      );
    } else {
      console.log(
        'No cached report_data. Downloading PDF...'
      );

      const pdfBase64 =
        await downloadReportPdf(row);

      if (!pdfBase64) {
        console.error(
          'Could not find PDF for row:',
          row.id
        );

        return res.status(404).json({
          error:
            "I couldn't open your report file. Please email us and we'll help you out.",
        });
      }

      // ---------------------------------------------------
      // Gemini reads PDF
      // ---------------------------------------------------

      reportText = await askGemini(
        EXTRACT_PROMPT,
        'Extract the complete skating-analysis report.',
        pdfBase64
      );

      if (!reportText) {
        return res.status(500).json({
          error:
            "I couldn't read your report. Please email us and we'll help you out.",
        });
      }

      // ---------------------------------------------------
      // Cache extracted report
      // ---------------------------------------------------

      const cacheRes = await fetch(
        `${SUPABASE_URL}/rest/v1/${VIDEOS_TABLE}?id=eq.${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          headers: sbHeaders({
            Prefer: 'return=minimal',
          }),
          body: JSON.stringify({
            report_data: reportText,
          }),
        }
      );

      if (!cacheRes.ok) {
        console.error(
          'Could not cache report_data:',
          cacheRes.status,
          await cacheRes.text()
        );

        // Do NOT fail the chat just because caching failed.
        // We still have reportText in memory and can answer the player.
      } else {
        console.log(
          'Successfully cached report_data.'
        );
      }
    }

    // -----------------------------------------------------
    // Safety check
    // -----------------------------------------------------

    if (!reportText || typeof reportText !== 'string') {
      return res.status(500).json({
        error:
          "I couldn't read your report. Please email us and we'll help you out.",
      });
    }

    // -----------------------------------------------------
    // 5. Ask Atlas AI coach
    // -----------------------------------------------------

    const coachPrompt = `
You are the Atlas AI hockey coach, talking one-on-one with a player about
their own skating analysis.

Your job is to help the player understand and improve their skating based
ONLY on the report provided below.

VOICE:
- Direct
- Coach-like
- Encouraging
- Plain language
- Not corporate
- Not overly technical

RESPONSE STYLE:
- Lead with what's working when relevant.
- Then address what needs improvement.
- Be specific.
- Every weakness you identify should include a concrete on-ice drill when
  the report provides one.
- Keep normal replies short: approximately 2-4 sentences.
- If the player asks for detail, give a more detailed explanation.
- Talk directly to the player using "you."

ACCURACY RULES:
- ONLY use information contained in the report.
- Never invent scores.
- Never invent measurements.
- Never invent strengths.
- Never invent weaknesses.
- Never invent drills.
- Never claim that the player did something that the report does not say.
- If the report does not contain information needed to answer a question,
  say that clearly.
- You may explain or connect information that is explicitly present in the
  report, but do not introduce outside player-specific facts.

IMPORTANT:
The player may ask casual questions about their skating. Answer naturally,
but remain grounded in the report.

PLAYER'S REPORT:
----------------
${reportText}
----------------
`.trim();

    const reply =
      await askGemini(
        coachPrompt,
        message
      );

    // -----------------------------------------------------
    // 6. Save conversation
    // -----------------------------------------------------

    const logRes = await fetch(
      `${SUPABASE_URL}/rest/v1/${CHAT_TABLE}`,
      {
        method: 'POST',
        headers: sbHeaders({
          Prefer: 'return=minimal',
        }),
        body: JSON.stringify({
          user_id: userId,
          message,
          reply,
        }),
      }
    );

    if (!logRes.ok) {
      // Logging failure should NOT cause the player's successful
      // AI response to become a 500 error.
      console.error(
        'Chat message logging failed:',
        logRes.status,
        await logRes.text()
      );
    } else {
      console.log(
        'Chat message logged successfully.'
      );
    }

    // -----------------------------------------------------
    // 7. Return response
    // -----------------------------------------------------

    return res.status(200).json({
      reply:
        reply ||
        "Sorry, I couldn't come up with a response. Try rephrasing?",

      remaining:
        Math.max(
          0,
          DAILY_MESSAGE_LIMIT - usedCount - 1
        ),
    });

  } catch (err) {
    // -----------------------------------------------------
    // Global error handler
    // -----------------------------------------------------

    console.error(
      '=========================================='
    );

    console.error(
      'ATLAS CHAT ERROR'
    );

    console.error(
      err?.stack || err
    );

    console.error(
      '=========================================='
    );

    const errorMessage =
      err?.message ||
      'Something went wrong.';

    return res.status(500).json({
      error: errorMessage,
    });
  }
}
```
