// api/atlas-chat.js
//
// ATLAS CHAT — backend (auto-reads the player's PDF report)
// =========================================================
// Vercel serverless function. No npm packages — plain fetch only, so this
// works on a static HTML site with no build step.
//
// HOW IT WORKS:
//   The first time a player chats, this downloads their latest PDF report from
//   private Supabase storage, has Gemini read it once, and saves the extracted
//   summary into videos.report_data. Every message after that reads the saved
//   text — fast and cheap. You never paste anything by hand.
//
// PUT THIS FILE AT: api/atlas-chat.js
//
// ENV VARS (already set in Vercel):
//   GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const DAILY_MESSAGE_LIMIT = 25;
const VIDEOS_TABLE = 'videos';
const STORAGE_BUCKET = 'reports';
const GEMINI_MODEL = 'gemini-flash-latest';

function sbHeaders(extra) {
  return Object.assign(
    {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    extra || {}
  );
}

// Ask Gemini something. `pdfBase64` is optional.
async function askGemini(systemPrompt, userText, pdfBase64) {
  const parts = [];
  if (pdfBase64) {
    parts.push({ inline_data: { mime_type: 'application/pdf', data: pdfBase64 } });
  }
  parts.push({ text: userText });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: parts }],
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    console.error('Gemini error:', JSON.stringify(data));
    throw new Error('gemini_failed');
  }
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Download the PDF out of the private bucket using the service key.
// Tries folder = row.id first, then folder = row.user_id as a fallback,
// since either is plausible and a wrong guess would fail silently.
async function downloadReportPdf(row) {
  const ref = row.report_url || '';

  const candidates = ref.includes('/')
    ? [ref]
    : [
        `${row.id}/${ref}_report.pdf`,
        `${row.user_id}/${ref}_report.pdf`,
      ];

  for (const path of candidates) {
    const res = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    if (res.ok) {
      const buf = await res.arrayBuffer();
      return Buffer.from(buf).toString('base64');
    }
    console.log('PDF not found at:', path);
  }
  return null;
}

const EXTRACT_PROMPT = `
You are reading a hockey skating-analysis report PDF. Pull out ALL of the
information a coach would need to discuss it with the player, as plain text:

- The overall score
- Every metric name and its score
- The strengths section, with the descriptions
- The areas to improve, with the descriptions AND the drills listed for each
- The 3-week focus plan
- All raw measurements (angles, stride counts, etc.)
- Any notes or caveats about the clip or tracking

Write it as a clean plain-text summary. Do not add commentary, do not invent
anything that isn't in the document, do not leave numbers out.
`.trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { accessToken, message } = req.body || {};
    if (!accessToken || !message) {
      return res.status(400).json({ error: 'Missing accessToken or message' });
    }

    // --- 1. Who is this? ------------------------------------------------
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Not logged in' });

    const user = await userRes.json();
    const userId = user.id;

    // --- 2. Daily limit -------------------------------------------------
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const countRes = await fetch(
      `${SUPABASE_URL}/rest/v1/chat_messages?user_id=eq.${userId}` +
        `&created_at=gte.${todayStart.toISOString()}&select=id`,
      { headers: sbHeaders() }
    );
    const sentToday = await countRes.json();
    const usedCount = Array.isArray(sentToday) ? sentToday.length : 0;

    if (usedCount >= DAILY_MESSAGE_LIMIT) {
      return res.status(429).json({
        error: `You've used all ${DAILY_MESSAGE_LIMIT} messages for today. Resets at midnight.`,
        remaining: 0,
      });
    }

    // --- 3. Latest report row -------------------------------------------
    const rowRes = await fetch(
      `${SUPABASE_URL}/rest/v1/${VIDEOS_TABLE}?user_id=eq.${userId}` +
        `&report_url=not.is.null&order=created_at.desc&limit=1`,
      { headers: sbHeaders() }
    );
    const rows = await rowRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row) {
      return res.status(404).json({
        error: "You don't have a finished report yet — upload a clip and we'll analyze it.",
      });
    }

    // --- 4. Get the report text (cached, or read the PDF once) ----------
    let reportText = row.report_data;

    if (!reportText) {
      const pdfBase64 = await downloadReportPdf(row);
      if (!pdfBase64) {
        console.error('Could not find PDF. row.id:', row.id, 'report_url:', row.report_url);
        return res.status(404).json({ error: "I couldn't open your report file. Let Michele know." });
      }

      reportText = await askGemini(EXTRACT_PROMPT, 'Extract this report.', pdfBase64);

      if (reportText) {
        // Cache it so the PDF is only ever read once per report.
        await fetch(`${SUPABASE_URL}/rest/v1/${VIDEOS_TABLE}?id=eq.${row.id}`, {
          method: 'PATCH',
          headers: sbHeaders({ Prefer: 'return=minimal' }),
          body: JSON.stringify({ report_data: reportText }),
        });
      }
    }

    if (!reportText) {
      return res.status(500).json({ error: "I couldn't read your report. Let Michele know." });
    }

    // --- 5. Answer as the coach -----------------------------------------
    const coachPrompt = `
You are the Atlas AI hockey coach, talking one-on-one with a player about their
own skating analysis.

Voice: direct, coach-like, plain language. Not corporate, not overly technical.
Lead with what's working before what needs work. Every weakness you name must
come with a concrete on-ice drill, never just a criticism. Keep replies short
(2-4 sentences) unless they ask for more.

Ground every answer ONLY in the report below. Never invent scores, stats, or
measurements. If they ask about something the report doesn't cover, say so
plainly and offer what you can speak to instead.

THIS PLAYER'S LATEST REPORT:
${reportText}
`.trim();

    const reply = await askGemini(coachPrompt, message);

    // --- 6. Log it ------------------------------------------------------
    await fetch(`${SUPABASE_URL}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ user_id: userId, message, reply }),
    });

    return res.status(200).json({
      reply: reply || "Sorry, I couldn't come up with a response. Try rephrasing?",
      remaining: DAILY_MESSAGE_LIMIT - usedCount - 1,
    });
  } catch (err) {
    console.error('Atlas Chat error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
