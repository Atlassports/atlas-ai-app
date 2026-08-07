<!-- ================= ATLAS CHAT — paste INSIDE <div id="app">, right after
     <div class="list" id="videoList"></div> ================= -->

<style>
  .atlas-chat-wrap { margin: 26px 0; }
  .atlas-chat-label {
    font-size: 11px; letter-spacing: 2px; color: #A78BFA;
    font-weight: 700; margin-bottom: 10px;
  }
  .atlas-chat-panel {
    background: #0e0c17;
    border: 1px solid rgba(139,92,246,0.35);
    border-radius: 12px;
    padding: 18px 20px;
  }
  .atlas-chat-head { display: flex; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px; }
  .atlas-chat-title { color: #A78BFA; font-size: 11px; letter-spacing: 2px; font-weight: 700; }
  .atlas-chat-pill {
    background: rgba(52,211,153,0.14); color: #34D399;
    font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 5px;
  }
  .atlas-chat-count { margin-left: auto; color: #6E6C7C; font-size: 11px; }
  .atlas-chat-messages {
    display: flex; flex-direction: column; gap: 8px;
    margin-bottom: 14px; max-height: 340px; overflow-y: auto;
  }
  .atlas-msg-coach {
    align-self: flex-start; background: #241f36; color: #E4E2EC;
    padding: 9px 13px; border-radius: 10px; font-size: 13.5px;
    max-width: 80%; line-height: 1.5; white-space: pre-wrap;
  }
  .atlas-msg-user {
    align-self: flex-end; background: #8B5CF6; color: #fff;
    padding: 9px 13px; border-radius: 10px; font-size: 13.5px; max-width: 80%;
  }
  .atlas-chat-empty { color: #6E6C7C; font-size: 13px; font-style: italic; }
  .atlas-chat-error { color: #F87171; font-size: 12px; margin-bottom: 10px; }
  .atlas-chat-row { display: flex; gap: 8px; }
  .atlas-chat-input {
    flex: 1; background: #08060e;
    border: 1px solid rgba(139,92,246,0.3); border-radius: 8px;
    padding: 10px 12px; color: #fff; font-size: 13.5px;
    font-family: 'Barlow', inherit; outline: none;
  }
  .atlas-chat-input::placeholder { color: #6E6C7C; }
  .atlas-chat-input:focus { border-color: rgba(139,92,246,0.7); }
  .atlas-chat-send {
    background: #8B5CF6; color: #fff; border: none; border-radius: 8px;
    padding: 10px 20px; font-size: 13.5px; font-weight: 700;
    cursor: pointer; font-family: 'Barlow', inherit;
  }
  .atlas-chat-send:disabled { opacity: 0.5; cursor: default; }

  /* Locked state for non-subscribers */
  .atlas-chat-locked { text-align: center; padding: 8px 0 4px; }
  .atlas-chat-locked h4 {
    margin: 0 0 8px; font-family: 'Archivo Black', sans-serif;
    color: #fff; font-size: 17px;
  }
  .atlas-chat-locked p {
    margin: 0 0 16px; color: #8A879A; font-size: 14px; line-height: 1.6;
  }
</style>

<div class="atlas-chat-wrap">
  <div class="atlas-chat-label">ASK YOUR COACH</div>
  <div class="atlas-chat-panel">

    <!-- Locked view (non-subscribers) -->
    <div id="atlasChatLocked" style="display:none;">
      <div class="atlas-chat-locked">
        <h4>Atlas Chat</h4>
        <p>
          Ask your coach anything about your report — why a score is what it is,
          which drill to run first, what to focus on this week.<br>
          Included with the beta plan.
        </p>
        <a class="btn btn-primary" id="atlasChatUpgrade" href="#" target="_blank" rel="noopener">Upgrade — $15/mo</a>
      </div>
    </div>

    <!-- Live view (subscribers) -->
    <div id="atlasChatLive" style="display:none;">
      <div class="atlas-chat-head">
        <span class="atlas-chat-title">ATLAS CHAT</span>
        <span class="atlas-chat-pill">Knows your latest report</span>
        <span class="atlas-chat-count" id="atlasChatCount"></span>
      </div>

      <div class="atlas-chat-messages" id="atlasChatMessages">
        <div class="atlas-chat-empty" id="atlasChatEmpty">
          Ask anything about your last clip — what to fix, what drills to run, why a score is what it is.
        </div>
      </div>

      <div class="atlas-chat-error" id="atlasChatError" style="display:none;"></div>

      <div class="atlas-chat-row">
        <input class="atlas-chat-input" id="atlasChatInput" placeholder="Ask about your skating…" />
        <button class="atlas-chat-send" id="atlasChatSend">Send</button>
      </div>
    </div>

  </div>
</div>

<script>
(async function () {
  var messagesEl = document.getElementById('atlasChatMessages');
  var emptyEl    = document.getElementById('atlasChatEmpty');
  var errorEl    = document.getElementById('atlasChatError');
  var inputEl    = document.getElementById('atlasChatInput');
  var sendEl     = document.getElementById('atlasChatSend');
  var countEl    = document.getElementById('atlasChatCount');
  var lockedEl   = document.getElementById('atlasChatLocked');
  var liveEl     = document.getElementById('atlasChatLive');

  // --- Show locked or live depending on subscription --------------------
  try {
    var userRes = await supabaseClient.auth.getUser();
    var uid = userRes && userRes.data && userRes.data.user && userRes.data.user.id;

    var profRes = await supabaseClient
      .from('profiles')
      .select('subscription_status')
      .eq('id', uid)
      .single();

    var status = profRes && profRes.data ? profRes.data.subscription_status : null;
    var allowed = (status === 'active' || status === 'trialing');

    if (allowed) {
      liveEl.style.display = 'block';
    } else {
      lockedEl.style.display = 'block';
      var upBtn = document.getElementById('atlasChatUpgrade');
      if (typeof ATLAS_CONFIG !== 'undefined' && ATLAS_CONFIG.STRIPE_PAYMENT_LINK) {
        upBtn.href = ATLAS_CONFIG.STRIPE_PAYMENT_LINK;
      }
      return; // don't wire up the chat at all
    }
  } catch (e) {
    console.error('Atlas Chat: could not check subscription', e);
    lockedEl.style.display = 'block';
    return;
  }

  function addBubble(text, who) {
    if (emptyEl) { emptyEl.style.display = 'none'; }
    var div = document.createElement('div');
    div.className = who === 'user' ? 'atlas-msg-user' : 'atlas-msg-coach';
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }

  async function send() {
    var text = inputEl.value.trim();
    if (!text) return;

    errorEl.style.display = 'none';
    addBubble(text, 'user');
    inputEl.value = '';
    sendEl.disabled = true;

    var thinking = addBubble('Thinking…', 'coach');

    try {
      var sessionResult = await supabaseClient.auth.getSession();
      var token = sessionResult &&
                  sessionResult.data &&
                  sessionResult.data.session &&
                  sessionResult.data.session.access_token;

      if (!token) {
        thinking.remove();
        showError('You need to be logged in to use Atlas Chat.');
        sendEl.disabled = false;
        return;
      }

      var res = await fetch('/api/atlas-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token, message: text })
      });

      var data = await res.json();
      thinking.remove();

      if (!res.ok) {
        showError(data.error || 'Something went wrong.');
      } else {
        addBubble(data.reply, 'coach');
        if (typeof data.remaining === 'number') {
          countEl.textContent = data.remaining + ' messages left today';
        }
      }
    } catch (e) {
      thinking.remove();
      showError('Connection problem — try again.');
      console.error(e);
    } finally {
      sendEl.disabled = false;
    }
  }

  sendEl.addEventListener('click', send);
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send();
  });
})();
</script>
<!-- ================= END ATLAS CHAT ================= -->
