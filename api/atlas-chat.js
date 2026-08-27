
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const DAILY_MESSAGE_LIMIT = 25;
const VIDEOS_TABLE = "videos";
const CHAT_TABLE = "chat_messages";
const STORAGE_BUCKET = "reports";
const GEMINI_MODEL = "gemini-2.5-flash";

function sbHeaders(extra) {
  return Object.assign({
    apikey: SERVICE_KEY,
    Authorization: "Bearer " + SERVICE_KEY,
    "Content-Type": "application/json"
  }, extra || {});
}

async function getData(response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

async function askGemini(systemPrompt, userText, pdfBase64) {
  const parts = [];

  if (pdfBase64) {
    parts.push({
      inline_data: {
        mime_type: "application/pdf",
        data: pdfBase64
      }
    });
  }

  parts.push({
    text: userText
  });

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    GEMINI_MODEL +
    ":generateContent?key=" +
    encodeURIComponent(GEMINI_API_KEY);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text: systemPrompt
          }
        ]
      },
      contents: [
        {
          role: "user",
          parts: parts
        }
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1000
      }
    })
  });

  const data = await getData(response);

  if (!response.ok) {
    console.error(
      "Gemini error:",
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

  let reply = "";

  if (
    data &&
    data.candidates &&
    data.candidates[0] &&
    data.candidates[0].content &&
    data.candidates[0].content.parts
  ) {
    reply = data.candidates[0].content.parts
      .map(function(part) {
        return part.text || "";
      })
      .join("")
      .trim();
  }

  if (!reply) {
    console.error(
      "Gemini returned no text:",
      JSON.stringify(data)
    );

    throw new Error("Gemini returned an empty response.");
  }

  return reply;
}

async function downloadReportPdf(row) {
  const ref = String(row.report_url || "").trim();

  if (!ref) {
    return null;
  }

  const paths = [];

  if (ref.includes("/")) {
    paths.push(ref);
  } else {
    if (row.id) {
      paths.push(
        row.id + "/" + ref + "_report.pdf"
      );
    }

    if (row.user_id) {
      paths.push(
        row.user_id + "/" + ref + "_report.pdf"
      );
    }

    paths.push(ref);
  }

  for (const path of paths) {
    try {
      const encodedPath = path
        .split("/")
        .map(function(part) {
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
          Authorization: "Bearer " + SERVICE_KEY
        }
      });

      if (response.ok) {
        const buffer =
          await response.arrayBuffer();

        if (buffer.byteLength > 0) {
          console.log(
            "Downloaded report:",
            path,
            buffer.byteLength
          );

          return Buffer
            .from(buffer)
            .toString("base64");
        }
      } else {
        console.error(
          "Report download failed:",
          path,
          response.status
        );
      }

    } catch (error) {
      console.error(
        "Report download error:",
        error
      );
    }
  }

  return null;
}

const EXTRACT_PROMPT = [
  "You are reading a hockey skating-analysis report PDF for Atlas.",
  "",
  "Extract all information that a hockey coach would need to discuss the report with the player.",
  "",
  "Include the overall score.",
  "Include every metric name and score.",
  "Include the strengths and their descriptions.",
  "Include every area to improve.",
  "Include the descriptions of every area to improve.",
  "Include every drill listed for each area to improve.",
  "Include the 3-week focus plan.",
  "Include all raw measurements.",
  "Include angles, stride counts, timing measurements, and other numerical measurements.",
  "Include tracking information.",
  "Include notes and caveats.",
  "Include warnings about video or tracking quality.",
  "",
  "Preserve all numbers accurately.",
  "Do not add coaching advice.",
  "Do not interpret the results.",
  "Do not invent anything.",
  "Do not omit information.",
  "Write a clean structured plain-text summary."
].join("\n");

export default async function handler(req, res) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

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
      error: "Method not allowed"
    });
  }

  try {

    if (!SUPABASE_URL) {
      throw new Error(
        "SUPABASE_URL is missing"
      );
    }

    if (!SERVICE_KEY) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY is missing"
      );
    }

    if (!GEMINI_API_KEY) {
      throw new Error(
        "GEMINI_API_KEY is missing"
      );
    }

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
        error: "Missing accessToken or message"
      });
    }

    if (message.length > 4000) {
      return res.status(400).json({
        error:
          "Message is too long. Please keep it under 4,000 characters."
      });
    }

    console.log(
      "Atlas chat request started"
    );

    // Authenticate user

    const userResponse = await fetch(
      SUPABASE_URL + "/auth/v1/user",
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization:
            "Bearer " + accessToken
        }
      }
    );

    if (!userResponse.ok) {
      console.error(
        "Authentication failed:",
        userResponse.status
      );

      return res.status(401).json({
        error: "Not logged in"
      });
    }

    const user =
      await getData(userResponse);

    if (!user || !user.id) {
      return res.status(401).json({
        error:
          "Could not identify player"
      });
    }

    const userId = user.id;

    console.log(
      "Authenticated user:",
      userId
    );

    // Daily limit

    const todayStart = new Date();

    todayStart.setHours(
      0,
      0,
      0,
      0
    );

    const countUrl =
      SUPABASE_URL +
      "/rest/v1/" +
      CHAT_TABLE +
      "?user_id=eq." +
      encodeURIComponent(userId) +
      "&created_at=gte." +
      encodeURIComponent(
        todayStart.toISOString()
      ) +
      "&select=id";

    const countResponse =
      await fetch(countUrl, {
        headers: sbHeaders()
      });

    let usedCount = 0;

    if (countResponse.ok) {
      const messages =
        await getData(countResponse);

      if (Array.isArray(messages)) {
        usedCount = messages.length;
      }
    }

    if (
      usedCount >= DAILY_MESSAGE_LIMIT
    ) {
      return res.status(429).json({
        error:
          "You've used all " +
          DAILY_MESSAGE_LIMIT +
          " messages for today. Resets at midnight.",
        remaining: 0
      });
    }

    // Find latest report

    const reportQuery =
      SUPABASE_URL +
      "/rest/v1/" +
      VIDEOS_TABLE +
      "?user_id=eq." +
      encodeURIComponent(userId) +
      "&report_url=not.is.null" +
      "&order=created_at.desc" +
      "&limit=1";

    const reportResponse =
      await fetch(reportQuery, {
        headers: sbHeaders()
      });

    if (!reportResponse.ok) {
      console.error(
        "Videos query failed:",
        reportResponse.status,
        await reportResponse.text()
      );

      return res.status(500).json({
        error:
          "Could not load your skating report."
      });
    }

    const rows =
      await getData(reportResponse);

    const row =
      Array.isArray(rows) &&
      rows.length > 0
        ? rows[0]
        : null;

    if (!row) {
      return res.status(404).json({
        error:
          "You don't have a finished report yet — upload a clip and we'll analyze it."
      });
    }

    console.log(
      "Found report:",
      row.id
    );

    // Get cached report

    let reportText =
      row.report_data;

    if (
      !reportText ||
      typeof reportText !== "string" ||
      !reportText.trim()
    ) {

      console.log(
        "Downloading report PDF"
      );

      const pdfBase64 =
        await downloadReportPdf(row);

      if (!pdfBase64) {
        return res.status(404).json({
          error:
            "I couldn't open your report file. Please email us and we'll help you out."
        });
      }

      console.log(
        "Sending PDF to Gemini"
      );

      reportText =
        await askGemini(
          EXTRACT_PROMPT,
          "Extract the complete skating-analysis report.",
          pdfBase64
        );

      if (!reportText) {
        return res.status(500).json({
          error:
            "I couldn't read your report. Please email us and we'll help you out."
        });
      }

      const cacheUrl =
        SUPABASE_URL +
        "/rest/v1/" +
        VIDEOS_TABLE +
        "?id=eq." +
        encodeURIComponent(row.id);

      const cacheResponse =
        await fetch(cacheUrl, {
          method: "PATCH",
          headers: sbHeaders({
            Prefer: "return=minimal"
          }),
          body: JSON.stringify({
            report_data: reportText
          })
        });

      if (!cacheResponse.ok) {
        console.error(
          "Could not cache report:",
          cacheResponse.status,
          await cacheResponse.text()
        );
      }

    } else {

      console.log(
        "Using cached report"
      );

    }

    if (
      !reportText ||
      typeof reportText !== "string"
    ) {
      return res.status(500).json({
        error:
          "I couldn't read your report. Please email us and we'll help you out."
      });
    }

    // Ask Atlas AI

    const coachPrompt = [
      "You are the Atlas AI hockey coach, talking one-on-one with a player about their own skating analysis.",
      "",
      "Your job is to help the player understand and improve their skating based ONLY on the report below.",
      "",
      "Voice:",
      "Direct, coach-like, encouraging, and plain language.",
      "Do not sound corporate.",
      "Do not be unnecessarily technical.",
      "",
      "Response style:",
      "Lead with what is working when relevant.",
      "Then address what needs improvement.",
      "Be specific.",
      "When the report provides a drill for a weakness, include that drill.",
      "Keep normal replies around 2-4 sentences.",
      "If the player asks for more detail, provide more detail.",
      "Talk directly to the player using 'you'.",
      "",
      "Accuracy:",
      "Only use information contained in the report.",
      "Never invent scores.",
      "Never invent measurements.",
      "Never invent strengths.",
      "Never invent weaknesses.",
      "Never invent drills.",
      "Never claim something happened if the report does not say it.",
      "If the report does not contain enough information to answer a question, say so clearly.",
      "",
      "PLAYER REPORT:",
      "----------------",
      reportText,
      "----------------"
    ].join("\n");

    const reply =
      await askGemini(
        coachPrompt,
        message,
        null
      );

    // Save chat message

    const logResponse =
      await fetch(
        SUPABASE_URL +
        "/rest/v1/" +
        CHAT_TABLE,
        {
          method: "POST",
          headers: sbHeaders({
            Prefer: "return=minimal"
          }),
          body: JSON.stringify({
            user_id: userId,
            message: message,
            reply: reply
          })
        }
      );

    if (!logResponse.ok) {
      console.error(
        "Chat logging failed:",
        logResponse.status,
        await logResponse.text()
      );
    }

    return res.status(200).json({
      reply: reply,
      remaining:
        Math.max(
          0,
          DAILY_MESSAGE_LIMIT -
          usedCount -
          1
        )
    });

  } catch (error) {

    console.error(
      "ATLAS CHAT ERROR:"
    );

    console.error(
      error &&
      error.stack
        ? error.stack
        : error
    );

    return res.status(500).json({
      error:
        error &&
        error.message
          ? error.message
          : "Something went wrong."
    });
  }
}
```
