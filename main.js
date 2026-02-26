// ─── NARROW — main.js ───────────────────────
// Supabase client
let narrowSupabase;

document.addEventListener('DOMContentLoaded', () => {
  narrowSupabase = window.supabase.createClient(
    'https://okalotfqhmwiyckhvcmk.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9rYWxvdGZxaG13aXlja2h2Y21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2NzAxMTUsImV4cCI6MjA4NzI0NjExNX0.xTtqUl4k8VmvupmPblkLyPvtyp7JoyM2e4N88VI6tbM'
  );

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
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    // Wait for auth to resolve, then open questionnaire
    setTimeout(async () => {
      const { data: { session } } = await narrowSupabase.auth.getSession();
      if (session) openQuestionnaire(session);
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
    // Redirect to login
    window.location.href = 'login.html?redirect=questionnaire';
    return;
  }
  // Logged in → open questionnaire
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
      <div class="modal-step active" id="q-step-1">
        <p class="modal-label">Step 1 of 4</p>
        <h2>What's your building experience?</h2>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 1)">🏠 First-time homebuilder</div>
          <div class="q-option" onclick="selectOption(this, 1)">🔨 I've built or renovated before</div>
          <div class="q-option" onclick="selectOption(this, 1)">🏗️ I build regularly / professionally</div>
        </div>
        <button class="btn btn-primary" onclick="nextStep(1)" style="margin-top:24px">Continue →</button>
      </div>
      <div class="modal-step" id="q-step-2">
        <p class="modal-label">Step 2 of 4</p>
        <h2>What's your budget range?</h2>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 2)">Under $300K</div>
          <div class="q-option" onclick="selectOption(this, 2)">$300K – $600K</div>
          <div class="q-option" onclick="selectOption(this, 2)">$600K – $1M</div>
          <div class="q-option" onclick="selectOption(this, 2)">$1M+</div>
        </div>
        <button class="btn btn-primary" onclick="nextStep(2)" style="margin-top:24px">Continue →</button>
      </div>
      <div class="modal-step" id="q-step-3">
        <p class="modal-label">Step 3 of 4</p>
        <h2>Where are you in the process?</h2>
        <div class="q-options">
          <div class="q-option" onclick="selectOption(this, 3)">💡 Just an idea — starting from zero</div>
          <div class="q-option" onclick="selectOption(this, 3)">💰 I have financing & need land</div>
          <div class="q-option" onclick="selectOption(this, 3)">🗺️ I have land & need plans</div>
          <div class="q-option" onclick="selectOption(this, 3)">📋 I have plans & need a contractor</div>
        </div>
        <button class="btn btn-primary" onclick="nextStep(3)" style="margin-top:24px">Continue →</button>
      </div>
      <div class="modal-step" id="q-step-4">
        <p class="modal-label">Step 4 of 4</p>
        <h2>Where do you want to build?</h2>
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
      <div class="modal-step" id="q-success">
        <div style="text-align:center;padding:40px 0">
          <div style="font-size:3rem;margin-bottom:16px">🏠</div>
          <h2>Your journey starts now!</h2>
          <p style="color:#6B7280;margin:12px 0 24px">Your personalized path is ready. Head to your dashboard to start building.</p>
          <a href="dashboard.html" class="btn btn-primary">Go to My Dashboard →</a>
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
      .modal-box { position:relative;background:#fff;border-radius:16px;padding:48px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,0.3); }
      .modal-close { position:absolute;top:16px;right:20px;background:none;border:none;font-size:1.2rem;cursor:pointer;color:#6B7280; }
      .modal-label { font-size:0.75rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#2D6A4F;margin-bottom:8px; }
      .modal-step { display:none; } .modal-step.active { display:block; }
      .q-options { display:grid;gap:12px;margin-top:20px; }
      .q-option { padding:16px 20px;border:2px solid #E5E7EB;border-radius:10px;cursor:pointer;font-weight:500;transition:all 0.2s;font-family:'DM Sans',sans-serif; }
      .q-option:hover { border-color:#1B3A6B;background:#F0F4FF; }
      .q-option.selected { border-color:#1B3A6B;background:#EEF2FF;color:#1B3A6B; }
    `;
    document.head.appendChild(s);
  }
}

// Questionnaire state
let qAnswers = {};

window.selectOption = function(el, step) {
  el.closest('.q-options').querySelectorAll('.q-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  qAnswers['q' + step] = el.textContent.trim();
};

window.nextStep = function(from) {
  const step = document.getElementById(`q-step-${from}`);
  const next = document.getElementById(`q-step-${from + 1}`);
  if (!next) return;
  step.classList.remove('active');
  next.classList.add('active');
};

window.submitQuestionnaire = async function() {
  if (!narrowSupabase) return;

  const city = document.getElementById('qCity')?.value || '';
  const timeline = document.getElementById('qTimeline')?.value || '';
  qAnswers.city = city;
  qAnswers.timeline = timeline;

  const { data: { session } } = await narrowSupabase.auth.getSession();
  if (!session) return;

  try {
    // Save questionnaire to Supabase
    const { error: qErr } = await narrowSupabase.from('questionnaire_responses').upsert({
      user_id: session.user.id,
      answers: qAnswers,
      created_at: new Date().toISOString()
    });
    if (qErr) console.warn('Questionnaire save error:', qErr.message);

    // Create initial build + journey
    const { data: existingBuilds } = await narrowSupabase
      .from('user_builds')
      .select('id')
      .eq('user_id', session.user.id);

    if (!existingBuilds || existingBuilds.length === 0) {
      const { error: buildErr } = await narrowSupabase.from('user_builds').insert({
        user_id: session.user.id,
        name: 'My First Build',
        current_step: 2,
        steps_done: [1],
        questionnaire: qAnswers,
        created_at: new Date().toISOString()
      });
      if (buildErr) console.warn('Build create error:', buildErr.message);
    }
  } catch (err) {
    console.error('Questionnaire submit error:', err);
  }

  // Show success regardless — user can still proceed to dashboard
  document.getElementById('q-step-4').classList.remove('active');
  document.getElementById('q-success').classList.add('active');
};

window.closeQuestionnaire = function() {
  const modal = document.getElementById('journeyModal');
  if (modal) modal.remove();
  document.body.style.overflow = '';
  qAnswers = {};
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
  const overlay = document.createElement('div');
  overlay.className = 'plan-modal-overlay';
  overlay.onclick = function(e) { if (e.target === overlay) { overlay.remove(); document.body.style.overflow = ''; } };
  overlay.innerHTML = `
    <div class="plan-modal">
      <button class="plan-modal__close" onclick="this.closest('.plan-modal-overlay').remove();document.body.style.overflow=''">✕</button>
      <div class="plan-modal__img" style="background:${planData.gradient}">
        <span>${planData.emoji}</span>
      </div>
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
};

// ── STRIPE CHECKOUT ────────────────────────────
window.handlePurchase = async function(planData) {
  const btn = document.getElementById('purchaseBtn');
  if (!btn) return;

  // Require login before purchase
  const { data: { session } } = await narrowSupabase.auth.getSession();
  if (!session) {
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
          planId:        planData.planId,
          planName:      planData.name,
          planPrice:     planData.price,
          architectName: planData.architect,
          buyerEmail:    session.user.email,
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
