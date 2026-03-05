// ─── NARROW — main.js ───────────────────────
// Supabase client — initialized immediately so dashboard.html can access it
// This must run before any DOMContentLoaded listeners in other scripts
const narrowSupabase = window.supabase.createClient(
  'https://okalotfqhmwiyckhvcmk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM'
);

document.addEventListener('DOMContentLoaded', () => {

  // ── Auth state → nav ────────────────────
  async function updateNavAuth() {
    const navAuth = document.getElementById('nav-auth');
    const navLinks = document.getElementById('nav-links');
    if (!navAuth || !navLinks) return;

    const { data: { session } } = await narrowSupabase.auth.getSession();

    if (session && session.user) {
      const meta = session.user.user_metadata || {};
      const name = meta.full_name || session.user.email.split('@')[0];
      const firstName = name.split(' ')[0];
      const role = meta.role || 'homebuilder';

      // Update nav links based on role
      let links = '';
      if (role === 'homebuilder') {
        links = `
          <li><a href="index.html" class="nav__link">Home</a></li>
          <li><a href="dashboard.html" class="nav__link">${firstName}'s Dashboard</a></li>
        `;
      } else if (role === 'architect') {
        links = `
          <li><a href="index.html" class="nav__link">Home</a></li>
          <li><a href="professionals.html" class="nav__link">For Professionals</a></li>
          <li><a href="dashboard.html" class="nav__link">${firstName}'s Dashboard</a></li>
        `;
      } else if (role === 'contractor') {
        links = `
          <li><a href="index.html" class="nav__link">Home</a></li>
          <li><a href="professionals.html" class="nav__link">For Professionals</a></li>
          <li><a href="dashboard.html" class="nav__link">${firstName}'s Dashboard</a></li>
        `;
      } else {
        // fallback (agent, mortgage, etc)
        links = `
          <li><a href="index.html" class="nav__link">Home</a></li>
          <li><a href="marketplace.html" class="nav__link">Plan Marketplace</a></li>
          <li><a href="professionals.html" class="nav__link">For Professionals</a></li>
        `;
      }
      navLinks.innerHTML = links;

      // User dropdown
      navAuth.innerHTML = `
        <div class="nav__user-wrap">
          <button class="nav__user-btn" onclick="toggleUserDropdown(event)">
            Hello, ${firstName}
            <span style="font-size:0.65rem;opacity:0.6">▾</span>
          </button>
          <div id="userDropdown" class="nav__dropdown">
            <a href="dashboard.html">Dashboard</a>
            <hr>
            <button onclick="window.narrowSignOut()">Sign Out</button>
          </div>
        </div>
      `;

      // Update mobile menu
      updateMobileMenu(links, true, firstName);
    } else {
      // Pre-login nav
      navLinks.innerHTML = `
        <li><a href="index.html" class="nav__link">Home</a></li>
        <li><a href="marketplace.html" class="nav__link">Plan Marketplace</a></li>
        <li><a href="professionals.html" class="nav__link">For Professionals</a></li>
      `;
      navAuth.innerHTML = `<a href="login.html" class="nav__signin">Login</a>`;

      // Update mobile menu
      updateMobileMenu('', false, '');
    }
  }

  function updateMobileMenu(links, loggedIn, firstName) {
    const mobileMenu = document.getElementById('mobileMenu');
    if (!mobileMenu) return;

    if (loggedIn) {
      mobileMenu.innerHTML = `
        <a href="index.html">Home</a>
        <a href="dashboard.html">${firstName}'s Dashboard</a>
        <a href="marketplace.html">Plan Marketplace</a>
        <a href="professionals.html">For Professionals</a>
        <a href="#" onclick="window.narrowSignOut();return false;" style="color:var(--amber)">Sign Out</a>
      `;
    } else {
      mobileMenu.innerHTML = `
        <a href="index.html">Home</a>
        <a href="marketplace.html">Plan Marketplace</a>
        <a href="professionals.html">For Professionals</a>
        <a href="login.html" style="color:var(--amber)">Login</a>
      `;
    }
  }

  // Toggle user dropdown
  window.toggleUserDropdown = function(e) {
    e.stopPropagation();
    const dd = document.getElementById('userDropdown');
    if (dd) dd.classList.toggle('open');
  };

  document.addEventListener('click', () => {
    const dd = document.getElementById('userDropdown');
    if (dd) dd.classList.remove('open');
  });

  // Sign out
  window.narrowSignOut = async function() {
    await narrowSupabase.auth.signOut();
    window.location.href = 'index.html';
  };

  // Mobile hamburger
  const hamburger = document.querySelector('.nav__hamburger');
  if (hamburger) {
    hamburger.addEventListener('click', () => {
      const menu = document.getElementById('mobileMenu');
      if (menu) menu.classList.toggle('open');
    });
  }

  updateNavAuth();
  setTimeout(updateNavAuth, 500);
  setTimeout(updateNavAuth, 1500);

  narrowSupabase.auth.onAuthStateChange((_event, _session) => {
    updateNavAuth();
  });

  // ── Auto-open questionnaire after login redirect ──
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('openQuestionnaire') === '1') {
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(async () => {
      const { data: { session } } = await narrowSupabase.auth.getSession();
      if (!session) return;
      // If they've already completed the questionnaire, go straight to dashboard
      const { data: builds } = await narrowSupabase
        .from('user_builds')
        .select('id, questionnaire')
        .eq('user_id', session.user.id)
        .limit(1);
      const hasCompleted = builds && builds.length > 0 && builds[0].questionnaire;
      if (hasCompleted) {
        window.location.href = 'dashboard.html';
      } else {
        openQuestionnaire(session);
      }
    }, 800);
  }

  // After login redirect from marketplace — reopen the plan the user was trying to buy
  if (urlParams.get('redirect') === 'marketplace') {
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(async () => {
      const { data: { session } } = await narrowSupabase.auth.getSession();
      if (session) {
        const pending = sessionStorage.getItem('pendingPlan');
        if (pending) {
          sessionStorage.removeItem('pendingPlan');
          try {
            const planData = JSON.parse(pending);
            // Small delay to let the page settle
            setTimeout(() => {
              window.openPlanDetail(planData);
            }, 300);
          } catch(e) {
            // If plan data is corrupt just go to marketplace
            window.location.href = 'marketplace.html';
          }
        } else {
          window.location.href = 'marketplace.html';
        }
      }
    }, 800);
  }

  // ── Contact form ─────────────────────────
  const contactForm = document.getElementById('contactForm');
  if (contactForm) {
    contactForm.addEventListener('submit', handleContact);
  }

  // ── Land contact form ────────────────────
  const landForm = document.getElementById('landContactForm');
  if (landForm) {
    landForm.addEventListener('submit', handleLandContact);
  }

  // ── FAQ toggles ──────────────────────────
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.faq-item');
      item.classList.toggle('open');
    });
  });

  // ── Filter system ────────────────────────
  initFilters();
});

// ── START JOURNEY (requires login) ────────────
window.startJourney = async function() {
  if (!narrowSupabase) return;
  const { data: { session } } = await narrowSupabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html?redirect=questionnaire';
    return;
  }
  // Check if they've already completed the questionnaire
  const { data: builds } = await narrowSupabase
    .from('user_builds')
    .select('id, questionnaire')
    .eq('user_id', session.user.id)
    .limit(1);
  const hasCompleted = builds && builds.length > 0 && builds[0].questionnaire;
  if (hasCompleted) {
    window.location.href = 'dashboard.html';
    return;
  }
  // First time — open questionnaire
  openQuestionnaire(session);
};

// ── QUESTIONNAIRE MODAL ───────────────────────
function openQuestionnaire(session) {
  const modal = document.createElement('div');
  modal.id = 'journeyModal';
  modal.innerHTML = `
    <div class="modal-overlay" onclick="closeQuestionnaire()"></div>
    <div class="modal-box">
      <button class="modal-close" onclick="closeQuestionnaire()">✕</button>

      <!-- Progress bar -->
      <div class="q-progress-track" id="qProgressTrack">
        <div class="q-progress-fill" id="qProgressFill" style="width:16.6%"></div>
      </div>

      <!-- Step 1: Experience -->
      <div class="modal-step active" id="q-step-1">
        <p class="modal-label">Step 1 of 6</p>
        <h2>What's your building experience?</h2>
        <p class="q-sub">This helps us set the right level of guidance for you.</p>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 1)">🏠 First-time homebuilder</div>
          <div class="q-option" onclick="selectOption(this, 1)">🔨 I've built or renovated before</div>
          <div class="q-option" onclick="selectOption(this, 1)">🏗️ I build regularly / professionally</div>
        </div>
        <button class="btn btn-primary q-continue" onclick="nextStep(1)">Continue →</button>
      </div>

      <!-- Step 2: Budget -->
      <div class="modal-step" id="q-step-2">
        <p class="modal-label">Step 2 of 6</p>
        <h2>What's your total budget range?</h2>
        <p class="q-sub">Include land, construction, and soft costs.</p>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 2)">💵 Under $300K</div>
          <div class="q-option" onclick="selectOption(this, 2)">💵 $300K – $600K</div>
          <div class="q-option" onclick="selectOption(this, 2)">💵 $600K – $1M</div>
          <div class="q-option" onclick="selectOption(this, 2)">💵 $1M+</div>
        </div>
        <button class="btn btn-primary q-continue" onclick="nextStep(2)">Continue →</button>
      </div>

      <!-- Step 3: Where in the process -->
      <div class="modal-step" id="q-step-3">
        <p class="modal-label">Step 3 of 6</p>
        <h2>Where are you in the build process?</h2>
        <p class="q-sub">Be honest — your dashboard will jump you to the right step.</p>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 3)" data-step="2">💡 Just an idea — starting from zero</div>
          <div class="q-option" onclick="selectOption(this, 3)" data-step="2">💳 I need financing first</div>
          <div class="q-option" onclick="selectOption(this, 3)" data-step="3">✅ I have financing — need land</div>
          <div class="q-option" onclick="selectOption(this, 3)" data-step="4">🗺️ I have land — need plans</div>
          <div class="q-option" onclick="selectOption(this, 3)" data-step="6">📋 I have plans — need a contractor</div>
        </div>
        <button class="btn btn-primary q-continue" onclick="nextStep(3)">Continue →</button>
      </div>

      <!-- Step 4: Land status -->
      <div class="modal-step" id="q-step-4">
        <p class="modal-label">Step 4 of 6</p>
        <h2>Do you own your land?</h2>
        <p class="q-sub">This helps us match you with the right agent if needed.</p>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 4)">✅ Yes — I own my land</div>
          <div class="q-option" onclick="selectOption(this, 4)">🔍 Actively searching for land</div>
          <div class="q-option" onclick="selectOption(this, 4)">❓ Haven't started looking yet</div>
        </div>
        <button class="btn btn-primary q-continue" onclick="nextStep(4)">Continue →</button>
      </div>

      <!-- Step 5: Style preference -->
      <div class="modal-step" id="q-step-5">
        <p class="modal-label">Step 5 of 6</p>
        <h2>What's your home style preference?</h2>
        <p class="q-sub">We'll surface matching plans in the marketplace.</p>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 5)">🏙️ Modern / Contemporary</div>
          <div class="q-option" onclick="selectOption(this, 5)">🌾 Farmhouse / Rustic</div>
          <div class="q-option" onclick="selectOption(this, 5)">🏡 Craftsman / Traditional</div>
          <div class="q-option" onclick="selectOption(this, 5)">🏚️ Ranch / Single-story</div>
          <div class="q-option" onclick="selectOption(this, 5)">🏗️ Shouse / Barndominium</div>
          <div class="q-option" onclick="selectOption(this, 5)">🤷 Not sure yet</div>
        </div>
        <button class="btn btn-primary q-continue" onclick="nextStep(5)">Continue →</button>
      </div>

      <!-- Step 6: Location + Timeline -->
      <div class="modal-step" id="q-step-6">
        <p class="modal-label">Step 6 of 6</p>
        <h2>Where do you want to build?</h2>
        <p class="q-sub">We'll match you with contractors, agents, and lenders in your region.</p>
        <div class="form-group"><label>City / Region</label><input type="text" id="qCity" placeholder="e.g. Austin, TX"></div>
        <div class="form-group"><label>Target Timeline</label>
          <select id="qTimeline">
            <option value="">Select one</option>
            <option>Within 6 months</option>
            <option>6–12 months</option>
            <option>1–2 years</option>
            <option>Just exploring</option>
          </select>
        </div>
        <button class="btn btn-primary btn-lg" onclick="submitQuestionnaire()" style="width:100%;margin-top:12px">Build My Path →</button>
      </div>

      <!-- Success -->
      <div class="modal-step" id="q-success">
        <div style="text-align:center;padding:40px 0">
          <div style="font-size:3rem;margin-bottom:16px">🏠</div>
          <h2>Your path is ready!</h2>
          <p id="q-success-msg" style="color:#6B7280;margin:12px 0 24px">Your dashboard has been customized based on your answers.</p>
          <a href="dashboard.html" class="btn btn-primary btn-lg">Go to My Dashboard →</a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  if (!document.getElementById('modal-styles')) {
    const s = document.createElement('style');
    s.id = 'modal-styles';
    s.textContent = `
      #journeyModal { position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px; }
      .modal-overlay { position:absolute;inset:0;background:rgba(18,40,80,0.75);backdrop-filter:blur(4px); }
      .modal-box { position:relative;background:#fff;border-radius:16px;padding:48px;max-width:540px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.3); }
      .modal-close { position:absolute;top:16px;right:20px;background:none;border:none;font-size:1.2rem;cursor:pointer;color:#6B7280; }
      .modal-label { font-size:0.75rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#2D6A4F;margin-bottom:8px; }
      .modal-step { display:none; } .modal-step.active { display:block; }
      .q-sub { font-size:0.88rem;color:#6B7280;margin:4px 0 0; }
      .q-options { display:grid;gap:10px;margin-top:20px; }
      .q-option { padding:14px 20px;border:2px solid #E5E7EB;border-radius:10px;cursor:pointer;font-weight:500;transition:all 0.18s;font-family:'DM Sans',sans-serif;font-size:0.95rem; }
      .q-option:hover { border-color:#1B3A6B;background:#F0F4FF; }
      .q-option.selected { border-color:#1B3A6B;background:#EEF2FF;color:#1B3A6B;font-weight:700; }
      .q-continue { margin-top:24px; }
      .q-progress-track { height:4px;background:#E5E7EB;border-radius:99px;margin-bottom:32px;overflow:hidden; }
      .q-progress-fill { height:100%;background:linear-gradient(90deg,#1B3A6B,#2D6A4F);border-radius:99px;transition:width 0.4s ease; }
    `;
    document.head.appendChild(s);
  }
}

// Questionnaire state
let qAnswers = {};
let qComputedStartStep = 2; // default — will be overridden by step 3 answer

window.selectOption = function(el, step) {
  el.closest('.q-options').querySelectorAll('.q-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  qAnswers['q' + step] = el.textContent.trim();
  // Step 3 drives the starting dashboard step
  if (step === 3 && el.dataset.step) {
    qComputedStartStep = parseInt(el.dataset.step);
  }
};

window.nextStep = function(from) {
  const step = document.getElementById(`q-step-${from}`);
  const next = document.getElementById(`q-step-${from + 1}`);
  if (!next) return;
  step.classList.remove('active');
  next.classList.add('active');
  // Advance progress bar (6 steps total)
  const fill = document.getElementById('qProgressFill');
  if (fill) fill.style.width = ((from + 1) / 6 * 100) + '%';
};

window.submitQuestionnaire = async function() {
  if (!narrowSupabase) return;

  const city = document.getElementById('qCity')?.value || '';
  const timeline = document.getElementById('qTimeline')?.value || '';
  qAnswers.city = city;
  qAnswers.timeline = timeline;
  qAnswers.computedStartStep = qComputedStartStep;

  const { data: { session } } = await narrowSupabase.auth.getSession();
  if (!session) return;

  // Build steps_done array: all steps before the computed start are pre-completed
  // Step 1 (questionnaire) is always done after submitting
  const stepsDone = [1];
  for (let i = 2; i < qComputedStartStep; i++) {
    stepsDone.push(i);
  }

  // Build success message based on where they land
  const stepLabels = {
    2: 'Your first step is securing financing.',
    3: 'Your first step is finding land.',
    4: 'Your first step is choosing your home plans.',
    6: 'Your first step is finding and bidding contractors.'
  };
  const successMsg = document.getElementById('q-success-msg');
  if (successMsg) {
    successMsg.textContent = `You're starting at Step ${qComputedStartStep}. ${stepLabels[qComputedStartStep] || 'Your personalized path is ready.'}`;
  }

  try {
    // Save questionnaire response
    const { error: qErr } = await narrowSupabase.from('questionnaire_responses').upsert({
      user_id: session.user.id,
      answers: qAnswers,
      created_at: new Date().toISOString()
    });
    if (qErr) console.warn('Questionnaire save error:', qErr.message);

    // Create or update the build with the computed starting step
    const { data: existingBuilds } = await narrowSupabase
      .from('user_builds')
      .select('id')
      .eq('user_id', session.user.id);

    if (!existingBuilds || existingBuilds.length === 0) {
      const { error: buildErr } = await narrowSupabase.from('user_builds').insert({
        user_id: session.user.id,
        name: 'My First Build',
        current_step: qComputedStartStep,
        steps_done: stepsDone,
        questionnaire: qAnswers,
        created_at: new Date().toISOString()
      });
      if (buildErr) console.warn('Build create error:', buildErr.message);
    } else {
      // Update existing build's starting step based on new questionnaire answers
      const { error: updateErr } = await narrowSupabase
        .from('user_builds')
        .update({
          current_step: qComputedStartStep,
          steps_done: stepsDone,
          questionnaire: qAnswers
        })
        .eq('id', existingBuilds[0].id);
      if (updateErr) console.warn('Build update error:', updateErr.message);
    }
  } catch (err) {
    console.error('Questionnaire submit error:', err);
  }

  // Show success screen
  document.getElementById('q-step-6').classList.remove('active');
  document.getElementById('q-success').classList.add('active');
  const fill = document.getElementById('qProgressFill');
  if (fill) fill.style.width = '100%';
};

window.closeQuestionnaire = function() {
  const modal = document.getElementById('journeyModal');
  if (modal) modal.remove();
  document.body.style.overflow = '';
  qAnswers = {};
  qComputedStartStep = 2;
};

// ── FILTER SYSTEM ─────────────────────────────
function initFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const cards = document.querySelectorAll('.filterable');
  if (!filterBtns.length) return;

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      cards.forEach(card => {
        const show = filter === 'all' || card.dataset.category === filter;
        card.style.display = show ? '' : 'none';
      });
    });
  });
}

// ── CONTACT FORM (Resend via Supabase Edge Function) ──
async function handleContact(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const orig = btn.textContent;
  btn.textContent = 'Sending…';
  btn.disabled = true;

  const data = new FormData(e.target);

  try {
    const res = await fetch(
      'https://okalotfqhmwiyckhvcmk.supabase.co/functions/v1/send-contact',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM'
        },
        body: JSON.stringify({
          name:    data.get('name'),
          email:   data.get('email'),
          role:    data.get('role') || 'Not specified',
          message: data.get('message')
        })
      }
    );

    if (res.ok) {
      btn.textContent = '✓ Message Sent!';
      btn.style.background = '#2D6A4F';
      e.target.reset();
      setTimeout(() => { btn.textContent = orig; btn.style.background = ''; btn.disabled = false; }, 4000);
    } else {
      // Log actual server response for debugging
      const errBody = await res.text().catch(() => 'No response body');
      console.error(`Contact form error: HTTP ${res.status}`, errBody);
      throw new Error(`Server returned ${res.status}`);
    }
  } catch (err) {
    console.error('Contact form failed:', err);
    btn.textContent = '✗ Failed — try again';
    btn.style.background = '#DC2626';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 3000);
  }
}

// ── LAND CONTACT FORM (Resend via same edge function) ──
async function handleLandContact(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const orig = btn.textContent;
  btn.textContent = 'Sending…';
  btn.disabled = true;

  const data = new FormData(e.target);

  try {
    const res = await fetch(
      'https://okalotfqhmwiyckhvcmk.supabase.co/functions/v1/send-contact',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM',
          'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM'
        },
        body: JSON.stringify({
          name:    data.get('name') || 'Land Inquiry',
          email:   data.get('email') || 'via-dashboard@buildnarrow.com',
          role:    'Land Inquiry',
          message: `Location: ${data.get('location')}\nBudget: ${data.get('budget')}\nProperty Type: ${data.get('property_type')}\nTimeline: ${data.get('timeline')}\nNotes: ${data.get('notes')}`
        })
      }
    );

    if (res.ok) {
      btn.textContent = '✓ Submitted!';
      btn.style.background = '#2D6A4F';
      e.target.reset();
      setTimeout(() => { btn.textContent = orig; btn.style.background = ''; btn.disabled = false; }, 4000);
    } else {
      throw new Error('Server error');
    }
  } catch (err) {
    btn.textContent = '✗ Failed — try again';
    btn.style.background = '#DC2626';
    btn.disabled = false;
    setTimeout(() => { btn.textContent = orig; btn.style.background = ''; }, 3000);
  }
}

// ── PLAN DETAIL MODAL ─────────────────────────
window.openPlanDetail = function(planData) {
  // Build gallery slides — use planData.images if provided, else show elegant placeholders
  const images = planData.images || [
    { type: 'render',     label: 'Front Rendering',      bg: planData.gradient, content: `<div style="font-size:3rem;margin-bottom:8px">${planData.emoji}</div><p style="font-size:0.8rem;opacity:0.7;margin:0">3D Rendering</p>` },
    { type: 'floorplan',  label: 'Floor Plan',           bg: 'linear-gradient(135deg,#1e293b,#334155)', content: `<div style="font-size:2.5rem;margin-bottom:8px">📐</div><p style="font-size:0.8rem;opacity:0.7;margin:0">Floor Plan</p>` },
    { type: 'elevation',  label: 'Front Elevation',      bg: 'linear-gradient(135deg,#1f2937,#374151)', content: `<div style="font-size:2.5rem;margin-bottom:8px">🏗️</div><p style="font-size:0.8rem;opacity:0.7;margin:0">Front Elevation</p>` },
    { type: 'rear',       label: 'Rear Elevation',       bg: 'linear-gradient(135deg,#1a2e1a,#2d4a2d)', content: `<div style="font-size:2.5rem;margin-bottom:8px">🌲</div><p style="font-size:0.8rem;opacity:0.7;margin:0">Rear Elevation</p>` },
    { type: 'side',       label: 'Side Elevation',       bg: 'linear-gradient(135deg,#292524,#44403c)', content: `<div style="font-size:2.5rem;margin-bottom:8px">📏</div><p style="font-size:0.8rem;opacity:0.7;margin:0">Side Elevation</p>` },
  ];

  const gallerySlides = images.map((img, i) => {
    if (img.url) {
      // Real image
      return `<div class="plan-gallery__slide ${i===0?'plan-gallery__slide--active':''}">
        <img src="${img.url}" alt="${img.label}" style="width:100%;height:100%;object-fit:cover">
        <span class="plan-gallery__caption">${img.label}</span>
      </div>`;
    }
    // Placeholder
    return `<div class="plan-gallery__slide ${i===0?'plan-gallery__slide--active':''}" style="background:${img.bg};display:flex;flex-direction:column;align-items:center;justify-content:center;color:white;text-align:center">
      ${img.content}
      <span class="plan-gallery__caption">${img.label}</span>
    </div>`;
  }).join('');

  const thumbs = images.map((img, i) => {
    const thumbBg = img.url ? `background:url(${img.url}) center/cover` : `background:${img.bg}`;
    return `<button class="plan-gallery__thumb ${i===0?'active':''}" onclick="gallerySwitchTo(${i})" style="${thumbBg}" title="${img.label}"></button>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'plan-modal-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) { overlay.remove(); document.body.style.overflow = ''; } };
  overlay.innerHTML = `
    <div class="plan-modal">
      <button class="plan-modal__close" onclick="this.closest('.plan-modal-overlay').remove();document.body.style.overflow=''">✕</button>

      <!-- ── IMAGE GALLERY ── -->
      <div class="plan-gallery">
        <div class="plan-gallery__track" id="planGalleryTrack">
          ${gallerySlides}
        </div>
        <!-- Nav arrows -->
        <button class="plan-gallery__arrow plan-gallery__arrow--prev" onclick="galleryNav(-1)" aria-label="Previous">‹</button>
        <button class="plan-gallery__arrow plan-gallery__arrow--next" onclick="galleryNav(1)" aria-label="Next">›</button>
        <!-- Slide counter -->
        <div class="plan-gallery__counter"><span id="galleryCurrentNum">1</span> / ${images.length}</div>
      </div>
      <!-- Thumbnails -->
      <div class="plan-gallery__thumbs" id="planGalleryThumbs">
        ${thumbs}
      </div>
      <p class="plan-gallery__note">🔒 Full stamped drawings included after purchase. Previews shown without dimensions or stamps.</p>

      <div class="plan-modal__body">
        <span class="section-label" style="margin-bottom:12px">${planData.style}</span>
        <h2 style="margin-bottom:8px">${planData.name}</h2>
        <p style="color:var(--green);font-weight:600;font-size:0.9rem;margin-bottom:20px">✓ Verified · ${planData.architect}</p>
        <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:24px">
          <span style="font-size:0.9rem;color:var(--gray)">🛏️ ${planData.beds} bed</span>
          <span style="font-size:0.9rem;color:var(--gray)">🚿 ${planData.baths} bath</span>
          <span style="font-size:0.9rem;color:var(--gray)">📐 ${planData.sqft} sq ft</span>
          <span style="font-size:0.9rem;color:var(--gray)">🏗️ ${planData.stories}</span>
        </div>
        <div style="margin-bottom:24px">
          <span class="stars">${planData.stars}</span>
          <span style="font-size:0.85rem;color:var(--gray);margin-left:8px">${planData.reviews}</span>
        </div>
        <p style="margin-bottom:32px">This plan is designed by ${planData.architect} and includes full architectural drawings. Plans are priced by the architect and sold through Narrow. After purchase, customization services are available through the architect.</p>
        <div style="display:flex;justify-content:space-between;align-items:center;padding-top:24px;border-top:1px solid var(--cream-dark)">
          <span style="font-family:var(--font-display);font-size:2rem;font-weight:700;color:var(--navy)">${planData.price}</span>
          <button
            id="purchaseBtn"
            class="btn btn-primary btn-lg"
            onclick="handlePurchase(${JSON.stringify(planData).replace(/"/g, '&quot;')})"
          >Purchase Plan 🔒</button>
        </div>
        <p style="font-size:0.78rem;color:var(--gray);margin-top:12px;text-align:right">
          🔒 Secure checkout via Stripe &nbsp;·&nbsp; Instant PDF download after payment
        </p>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Inject gallery styles once
  if (!document.getElementById('gallery-styles')) {
    const gs = document.createElement('style');
    gs.id = 'gallery-styles';
    gs.textContent = `
      .plan-modal { max-width:640px;width:calc(100% - 32px);background:#fff;border-radius:20px;position:relative;overflow:hidden;max-height:92vh;overflow-y:auto; }
      .plan-modal__close { position:absolute;top:16px;right:16px;z-index:10;background:rgba(0,0,0,0.45);color:white;border:none;width:32px;height:32px;border-radius:50%;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1; }
      .plan-modal__body { padding:28px 32px 36px; }
      .plan-gallery { position:relative;width:100%;height:320px;overflow:hidden;background:#111;flex-shrink:0; }
      .plan-gallery__track { display:flex;height:100%;transition:none; }
      .plan-gallery__slide { min-width:100%;height:100%;position:absolute;top:0;left:0;opacity:0;transition:opacity 0.35s ease; }
      .plan-gallery__slide--active { opacity:1;position:relative;flex-shrink:0; }
      .plan-gallery__caption { position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.55);color:white;font-size:0.72rem;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;padding:4px 12px;border-radius:99px;white-space:nowrap; }
      .plan-gallery__counter { position:absolute;bottom:36px;right:12px;background:rgba(0,0,0,0.5);color:white;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:99px; }
      .plan-gallery__arrow { position:absolute;top:50%;transform:translateY(-50%);background:rgba(0,0,0,0.4);color:white;border:none;width:36px;height:36px;border-radius:50%;font-size:1.4rem;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;transition:background 0.2s;z-index:2; }
      .plan-gallery__arrow:hover { background:rgba(0,0,0,0.7); }
      .plan-gallery__arrow--prev { left:12px; }
      .plan-gallery__arrow--next { right:12px; }
      .plan-gallery__thumbs { display:flex;gap:8px;padding:10px 12px;overflow-x:auto;background:#f8f8f8;scrollbar-width:none; }
      .plan-gallery__thumbs::-webkit-scrollbar { display:none; }
      .plan-gallery__thumb { width:52px;height:40px;border-radius:6px;border:2px solid transparent;cursor:pointer;flex-shrink:0;transition:border-color 0.2s;opacity:0.65; }
      .plan-gallery__thumb.active { border-color:#1B3A6B;opacity:1; }
      .plan-gallery__thumb:hover { opacity:1; }
      .plan-gallery__note { font-size:0.75rem;color:#9CA3AF;text-align:center;padding:6px 12px 0;margin:0;background:#f8f8f8; }
    `;
    document.head.appendChild(gs);
  }

  // Gallery state
  let currentSlide = 0;
  const totalSlides = images.length;

  window.gallerySwitchTo = function(idx) {
    const slides = overlay.querySelectorAll('.plan-gallery__slide');
    const thumbButtons = overlay.querySelectorAll('.plan-gallery__thumb');
    const counter = overlay.querySelector('#galleryCurrentNum');
    slides[currentSlide].classList.remove('plan-gallery__slide--active');
    thumbButtons[currentSlide].classList.remove('active');
    currentSlide = (idx + totalSlides) % totalSlides;
    slides[currentSlide].classList.add('plan-gallery__slide--active');
    thumbButtons[currentSlide].classList.add('active');
    if (counter) counter.textContent = currentSlide + 1;
  };

  window.galleryNav = function(dir) {
    window.gallerySwitchTo(currentSlide + dir);
  };
};

// ── STRIPE CHECKOUT ────────────────────────────
window.handlePurchase = async function(planData) {
  const btn = document.getElementById('purchaseBtn');
  if (!btn) return;

  // Require login before purchase
  const { data: { session } } = await narrowSupabase.auth.getSession();
  if (!session) {
    // Save plan data so we can reopen it after login
    sessionStorage.setItem('pendingPlan', JSON.stringify(planData));
    window.location.href = 'login.html?redirect=marketplace';
    return;
  }

  btn.textContent = 'Redirecting to checkout…';
  btn.disabled = true;

  try {
    const res = await fetch(
      'https://okalotfqhmwiyckhvcmk.supabase.co/functions/v1/create-checkout',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM`,
          'apikey': `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM`,
        },
        body: JSON.stringify({
          planId:          planData.planId,
          planName:        planData.name,
          planPrice:       Math.round(parseFloat(planData.price.replace(/[^0-9.]/g, '')) * 100),
          architectName:   planData.architect,
          buyerEmail:      session.user.email,
          architectUserId: planData.architectUserId || null, // enables 88/12 Stripe Connect split
        }),
      }
    );

    const data = await res.json();

    if (data.url) {
      // Redirect to Stripe hosted checkout
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'No checkout URL returned');
    }
  } catch (err) {
    console.error('Purchase error:', err);
    btn.textContent = '✗ Error — try again';
    btn.style.background = '#DC2626';
    btn.disabled = false;
    setTimeout(() => {
      btn.textContent = 'Purchase Plan 🔒';
      btn.style.background = '';
    }, 3000);
  }
};
