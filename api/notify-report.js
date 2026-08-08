// api/notify-report.js
//
// Emails a player when their report is ready. Called automatically by the
// admin panel the first time a video is marked processed.
//
// SECURITY: only admins can trigger this, and the recipient address is looked
// up server-side from the database — never taken from the browser.
//
// ENV VARS NEEDED:
//   RESEND_API_KEY            (from resend.com — free, no card)
//   SUPABASE_URL              (already set)
//   SUPABASE_SERVICE_ROLE_KEY (already set)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Change this once your domain is verified in Resend.
// Before verification, use: 'Atlas AI <onboarding@resend.dev>'
const FROM_ADDRESS = 'Atlas AI <reports@atlashockey.net>';
const DASHBOARD_URL = 'https://atlashockey.net/dashboard.html';

function sbHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function emailHtml(hasClip) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#08060e;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#08060e;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#12101c;border:1px solid rgba(139,92,246,0.25);border-radius:14px;overflow:hidden;">

        <tr><td style="padding:28px 30px 0;">
          <div style="font-size:13px;font-weight:bold;letter-spacing:3px;color:#ffffff;">ATLAS AI</div>
          <div style="font-size:11px;letter-spacing:2px;color:#A78BFA;margin-top:6px;">YOUR REPORT IS READY</div>
        </td></tr>

        <tr><td style="padding:22px 30px 0;">
          <div style="font-size:24px;font-weight:bold;color:#ffffff;line-height:1.25;">
            Your skating analysis is done.
          </div>
          <p style="font-size:15px;line-height:1.6;color:#C4C2CF;margin:14px 0 0;">
            We've finished breaking down your clip. Your full report is waiting in your dashboard${hasClip ? ', along with your annotated video' : ''}.
          </p>
          <p style="font-size:15px;line-height:1.6;color:#C4C2CF;margin:14px 0 0;">
            Once you've had a look, you can ask Atlas Chat anything about it &mdash; why a score came out the way it did, or which drill to start with.
          </p>
        </td></tr>

        <tr><td style="padding:26px 30px 30px;">
          <a href="${DASHBOARD_URL}"
             style="display:inline-block;background:#34D399;color:#060608;font-size:15px;font-weight:bold;
                    text-decoration:none;padding:14px 28px;border-radius:10px;">
            View your report
          </a>
        </td></tr>

        <tr><td style="padding:18px 30px 26px;border-top:1px solid rgba(139,92,246,0.15);">
          <p style="font-size:12px;color:#6E6C7C;margin:0;line-height:1.6;">
            Questions? Just reply to this email.<br>
            Atlas AI &middot; Built in Boston
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { accessToken, videoId } = req.body || {};
    if (!accessToken || !videoId) {
      return res.status(400).json({ error: 'Missing accessToken or videoId' });
    }

    // --- 1. Who is calling, and are they an admin? ---
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Not logged in' });

    const caller = await userRes.json();

    const adminRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${caller.id}&select=is_admin`,
      { headers: sbHeaders() }
    );
    const adminRows = await adminRes.json();
    if (!Array.isArray(adminRows) || !adminRows[0] || !adminRows[0].is_admin) {
      return res.status(403).json({ error: 'Admins only' });
    }

    // --- 2. Find the video and its owner ---
    const vidRes = await fetch(
      `${SUPABASE_URL}/rest/v1/videos?id=eq.${videoId}&select=id,user_id,annotated_url`,
      { headers: sbHeaders() }
    );
    const vids = await vidRes.json();
    const video = Array.isArray(vids) ? vids[0] : null;
    if (!video) return res.status(404).json({ error: 'Video not found' });

    const profRes = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${video.user_id}&select=email`,
      { headers: sbHeaders() }
    );
    const profs = await profRes.json();
    const email = Array.isArray(profs) && profs[0] ? profs[0].email : null;

    if (!email) {
      return res.status(404).json({ error: 'No email on file for this player' });
    }

    // --- 3. Send it ---
    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [email],
        subject: 'Your Atlas skating report is ready',
        html: emailHtml(!!video.annotated_url),
      }),
    });

    const sendData = await sendRes.json();

    if (!sendRes.ok) {
      console.error('Resend error:', JSON.stringify(sendData));
      return res.status(502).json({ error: sendData.message || 'Email failed to send' });
    }

    return res.status(200).json({ sent: true, to: email });
  } catch (err) {
    console.error('notify-report error:', err);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
