```javascript
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const DAILY_MESSAGE_LIMIT = 25;
const VIDEOS_TABLE = "videos";
const CHAT_TABLE = "chat_messages";
const STORAGE_BUCKET = "reports";
const GEMINI_MODEL = "gemini-2.5-flash";

function sbHeaders(extra) {
  return Object.assign(
    {
      apikey: SERVICE_KEY,
      Authorization: "Bearer " + SERVICE_KEY,
      "Content-Type": "application/json",
    },
    extra || {}
  );
}

async function getResponseText(res) {
  const text = await res.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    return { raw: text };
  }
}

function checkEnvironment() {
  const missing = [];

  if (!SUPABASE_URL) {
    missing.push("SUPABASE_URL");
  }

  if (!SERVICE_KEY) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  if (!GEMINI_API_KEY) {
    missing.push("GEMINI_API_KEY");
  }

  if (missing.length > 0) {
    throw new Error(
      "Missing environment variables: " + missing.join(", ")
    );
  }
}

async function askGemini(systemPrompt, userText, pdfBase64) {
  const parts = [];

  if (pdfBase64) {
    parts.push({
      inline_data: {
        mime_type: "application/pdf",
        data: pdfBase64,
      },
    });
  }

  parts.push({
    text: userText,
  });

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    GEMINI_MODEL +
    ":generateContent?key=" +
    encodeURIComponent(GEMINI_API_KEY);

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
        role: "user",
        parts: parts,
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1000,
    },
  };

  console.log(
    "Calling Gemini model:",
    GEMINI_MODEL,
    pdfBase64 ? "with PDF" : "without PDF"
  );

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    console.error("Gemini network error:", error);
    throw new Error(
      "Gemini could not be reached. Please try again in a moment."
    );
  }

  const data = await getResponseText(response);

  if (!response.ok) {
    console.error(
      "Gemini API error:",
      response.status,
      JSON.stringify(data)
    );

    const message =
      data &&
      data.error &&
      data.error.message
        ? data.error.message
        : "Gemini returned HTTP " + response.status;

    throw new Error("Gemini error: " + message);
  }

  const reply =
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts
      ? data.candidates[0].content.parts
          .map(function (part) {
            return part.text || "";
          })
          .join("")
          .trim()
      : "";

  if (!reply) {
    console.error(
      "Gemini returned no usable text:",
      JSON.stringify(data)
    );

    throw new Error("Gemini returned an empty response.");
  }

  return reply;
}

async function downloadReportPdf(row) {
  const ref = String(row.report_url || "").trim();

  if (!ref) {
    console.error("Report has no report_url. Row:", row.id);
    return null;
  }

  const candidates = [];

  if (ref.includes("/")) {
    candidates.push(ref);
  } else {
    if (row.id) {
      candidates.push(row.id + "/" + ref + "_report.pdf");
    }

    if (row.user_id) {
      candidates.push(row.user_id + "/" + ref + "_report.pdf");
    }

    candidates.push(ref);
  }

  const uniqueCandidates = Array.from(new Set(candidates));

  console.log("Report paths to try:", uniqueCandidates);

  for (const path of uniqueCandidates) {
    try {
      const encodedPath = path
        .split("/")
        .map(function (part) {
          return encodeURIComponent(part);
        })
        .join("/");

      const url =
        SUPABASE_URL +
        "/storage/v1/object/" +
        STORAGE_BUCKET +
        "/" +
        encodedPath;

      const response = await fetch(url, {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: "Bearer " + SERVICE_KEY,
        },
      });

      if (response.ok) {
        const buffer = await response.arrayBuffer();

        console.log(
          "Report downloaded successfully:",
          path,
          "bytes:",
          buffer.byteLength
        );

        if (buffer.byteLength === 0) {
          console.error("Report file is empty:", path);
          continue;
        }

        return Buffer.from(buffer).toString("base64");
      }

      const errorText = await response.text();

      console.error(
        "Report path failed:",
        path,
        "status:",
        response.status,
        "response:",
        errorText.slice(0, 500)
      );
    } catch (error) {
      console.error(
        "Error downloading report:",
        path,
        error
      );
    }
  }

  return null;
}

const EXTRACT_PROMPT = `
You are reading a hockey skating-analysis report PDF for Atlas.

Extract all information a hockey coach would need to discuss the report with
the player.

Include:

- Overall score
- Every metric name and score
- Strengths and their descriptions
- Areas to improve
- Descriptions of every area to improve
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

Preserve all numbers accurately.

Write a clean, structured plain-text summary.

Do not add coaching advice.
Do not interpret the results.
Do not invent anything.
Do not omit information.
`.trim();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    checkEnvironment();

    const body = req.body || {};

    const accessToken =
      typeof body.accessToken === "string"
        ? body.accessToken.trim()
        : "";

    const message =
      typeof body.message === "string"
        ? body.message.trim()
        : "";

    if (!accessToken || !message) {
      return res.status(400).json({
        error: "Missing accessToken or message",
      });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        error:
          "Message is too long. Please keep it under 4,000 characters.",
      });
    }

    // ---------------------------------------------------
    // 1. Authenticate user
    // ---------------------------------------------------

    const userResponse = await fetch(
      SUPABASE_URL + "/auth/v1/user",
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: "Bearer " + accessToken,
        },
      }
    );

    if (!userResponse.ok) {
      console.error(
        "Supabase authentication failed:",
        userResponse.status,
        await userResponse.text()
      );

      return res.status(401).json({
        error: "Not logged in",
      });
    }

    const user = await getResponseText(userResponse);

    if (!user || !user.id) {
      console.error(
        "Supabase returned invalid user:",
        JSON.stringify(user)
      );

      return res.status(401).json({
        error: "Could not identify player",
      });
    }

    const userId = user.id;

    console.log("Authenticated user:", userId);

    // ---------------------------------------------------
    // 2. Daily message limit
    // ---------------------------------------------------

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const countUrl =
      SUPABASE_URL +
      "/rest/v1/" +
      CHAT_TABLE +
      "?user_id=eq." +
      encodeURIComponent(userId) +
      "&created_at=gte." +
      encodeURIComponent(todayStart.toISOString()) +
      "&select=id";

    const countResponse = await fetch(countUrl, {
      headers: sbHeaders(),
    });

    let usedCount = 0;

    if (countResponse.ok) {
      const messages = await getResponseText(countResponse);

      if (Array.isArray(messages)) {
        usedCount = messages.length;
      }
    } else {
      console.error(
        "Could not check daily message count:",
        countResponse.status,
        await countResponse.text()
      );
    }

    if (usedCount >= DAILY_MESSAGE_LIMIT) {
      return res.status(429).json({
        error:
          "You've used all " +
          DAILY_MESSAGE_LIMIT +
          " messages for today. Resets at midnight.",
        remaining: 0,
      });
    }

    // ---------------------------------------------------
    // 3. Find latest report
    // ---------------------------------------------------

    const reportUrl =
      SUPABASE_URL +
      "/rest/v1/" +
      VIDEOS_TABLE +
      "?user_id=eq." +
      encodeURIComponent(userId) +
      "&report_url=not.is.null" +
      "&order=created_at.desc" +
      "&limit=1";

    const reportResponse = await fetch(reportUrl, {
      headers: sbHeaders(),
    });

    if (!reportResponse.ok) {
      console.error(
        "Videos query failed:",
        reportResponse.status,
        await reportResponse.text()
      );

      return res.status(500).json({
        error: "Could not load your skating report.",
      });
    }

    const rows = await getResponseText(reportResponse);

    const row =
      Array.isArray(rows) && rows.length > 0
        ? rows[0]
        : null;

    if (!row) {
      return res.status(404).json({
        error:
          "You don't have a finished report yet — upload a clip and we'll analyze it.",
      });
    }

    console.log("Report row:", {
      id: row.id,
      user_id: row.user_id,
      report_url: row.report_url,
      has_report_data: !!row.report_data,
    });

    // ---------------------------------------------------
    // 4. Get cached report or read PDF
    // ---------------------------------------------------

    let reportText = row.report_data;

    if (
      !reportText ||
      typeof reportText !== "string" ||
      !reportText.trim()
    ) {
      console.log(
        "No cached report data. Downloading PDF..."
      );

      const pdfBase64 =
        await downloadReportPdf(row);

      if (!pdfBase64) {
        console.error(
          "Could not find PDF for report:",
          row.id
        );

        return res.status(404).json({
          error:
            "I couldn't open your report file. Please email us and we'll help you out.",
        });
      }

      console.log(
        "Sending PDF to Gemini for extraction..."
      );

      reportText = await askGemini(
        EXTRACT_PROMPT,
        "Extract the complete skating-analysis report.",
        pdfBase64
      );

      if (!reportText) {
        return res.status(500).json({
          error:
            "I couldn't read your report. Please email us and we'll help you out.",
        });
      }

      // Cache report text.
      const cacheUrl =
        SUPABASE_URL +
        "/rest/v1/" +
        VIDEOS_TABLE +
        "?id=eq." +
        encodeURIComponent(row.id);

      const cacheResponse = await fetch(cacheUrl, {
        method: "PATCH",
        headers: sbHeaders({
          Prefer: "return=minimal",
        }),
        body: JSON.stringify({
          report_data: reportText,
        }),
      });

      if (!cacheResponse.ok) {
        console.error(
          "Could not cache report_data:",
          cacheResponse.status,
          await cacheResponse.text()
        );

        // Do not fail the chat. We still have reportText.
      } else {
        console.log(
          "Report successfully cached."
        );
      }
    } else {
      console.log(
        "Using cached report_data."
      );
    }

    if (
      !reportText ||
      typeof reportText !== "string"
    ) {
      return res.status(500).json({
        error:
          "I couldn't read your report. Please email us and we'll help you out.",
      });
    }

    // ---------------------------------------------------
    // 5. Ask Atlas AI coach
    // ---------------------------------------------------

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
- Keep normal replies around 2-4 sentences.
- If the player asks for more detail, provide more detail.
- Talk directly to the player using "you."

ACCURACY:
- Only use information contained in the report.
- Never invent scores.
- Never invent measurements.
- Never invent strengths.
- Never invent weaknesses.
- Never invent drills.
- Never claim something happened if the report does not say it.
- If the report does not contain enough information to answer a question,
  say so clearly.
- Do not pretend to have analyzed video beyond what is contained in the
  report.

PLAYER REPORT:
----------------
${reportText}
----------------
`.trim();

    console.log(
      "Sending player question to Gemini..."
    );

    const reply = await askGemini(
      coachPrompt,
      message,
      null
    );

    // ---------------------------------------------------
    // 6. Save conversation
    // ---------------------------------------------------

    const logResponse = await fetch(
      SUPABASE_URL +
        "/rest/v1/" +
        CHAT_TABLE,
      {
        method: "POST",
        headers: sbHeaders({
          Prefer: "return=minimal",
        }),
        body: JSON.stringify({
          user_id: userId,
          message: message,
          reply: reply,
        }),
      }
    );

    if (!logResponse.ok) {
      console.error(
        "Chat logging failed:",
        logResponse.status,
        await logResponse.text()
      );

      // IMPORTANT:
      // The AI response still worked, so don't turn this
      // into a 500 error.
    }

    // ---------------------------------------------------
    // 7. Return successful response
    // ---------------------------------------------------

    return res.status(200).json({
      reply:
        reply ||
        "Sorry, I couldn't come up with a response. Try rephrasing?",
      remaining:
        DAILY_MESSAGE_LIMIT - usedCount - 1,
    });

  } catch (error) {
    console.error(
      "=========================================="
    );

    console.error(
      "ATLAS CHAT ERROR"
    );

    console.error(
      error && error.stack
        ? error.stack
        : error
    );

    console.error(
      "=========================================="
    );

    return res.status(500).json({
      error:
        error && error.message
          ? error.message
          : "Something went wrong.",
    });
  }
}
```
