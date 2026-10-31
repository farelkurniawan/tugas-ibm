/* =============================================
   Customer Feedback Sentiment Analyzer
   app.js — Main Application Logic
   =============================================
   Modules:
     1. Sentiment Engine (lexicon, negation, intensifiers)
     2. LocalStorage persistence
     3. KPI calculations
     4. Chart.js rendering (Donut + Bar)
     5. Table render, search, filter
     6. Form submit, validation, XSS escape
     7. Export CSV, Reset Data
   ============================================= */

'use strict';

/* ─────────────────────────────────────────────
   1. SENTIMENT ENGINE
   ───────────────────────────────────────────── */

const LEXICON = {
  positive: [
    // English
    'good','great','excellent','amazing','awesome','fantastic','wonderful','love','loved','like','liked',
    'perfect','best','happy','satisfied','pleased','delighted','impressed','outstanding','brilliant',
    'superb','magnificent','enjoy','enjoyed','helpful','quick','fast','efficient','friendly','polite',
    'recommend','recommended','beautiful','smooth','easy','reliable','quality','value','affordable',
    'responsive','professional','accurate','clear','clean','safe','secure','innovative','creative',
    'positive','useful','effective','convenient','comfortable','fresh','nice','pleasant','remarkable',
    'superior','exceptional','flawless','spectacular','brilliant','fabulous','marvelous','terrific',
    // Indonesian
    'bagus','baik','hebat','luar biasa','mantap','keren','senang','puas','suka','cocok','memuaskan',
    'terbaik','sempurna','cepat','ramah','mudah','murah','berkualitas','terpercaya','aman','nyaman',
    'recommended','rekomendasikan','enak','indah','menarik','handal','andal','tepat','akurat','bersih',
    'canggih','inovatif','berguna','efektif','efisien','responsif','profesional','terjangkau'
  ],
  negative: [
    // English
    'bad','terrible','awful','horrible','worst','poor','disappointing','disappointed','hate','hated',
    'dislike','disliked','broken','damaged','defective','slow','late','delayed','rude','unfriendly',
    'unhelpful','useless','waste','expensive','overpriced','unreliable','confusing','difficult','hard',
    'frustrated','frustrating','annoyed','annoying','upset','angry','problem','issue','error','bug',
    'fail','failed','failure','crash','broken','missing','wrong','incorrect','false','fake','scam',
    'dirty','unsafe','insecure','outdated','complicated','messy','ugly','ugly','boring','dull','bland',
    'mediocre','inferior','subpar','unacceptable','unsatisfactory','inadequate','insufficient',
    // Indonesian
    'buruk','jelek','hancur','parah','kecewa','mengecewakan','benci','tidak suka','mahal','lambat',
    'telat','terlambat','kasar','tidak ramah','tidak membantu','tidak berguna','buang-buang',
    'rusak','bermasalah','salah','bohong','penipuan','kotor','tidak aman','membingungkan','sulit',
    'susah','rumit','menjengkelkan','kesal','marah','gagal','error','bug','bermasalah','payah',
    'mengecewakan','tidak memuaskan','tidak sesuai','tidak akurat','tidak profesional'
  ]
};

const NEGATORS = new Set([
  'not','no','never','neither','nor','cannot','cant',"can't",'dont',"don't",'didnt',"didn't",
  'isnt',"isn't",'wasnt',"wasn't",'wont',"won't",'couldnt',"couldn't",'shouldnt',"shouldn't",
  'wouldnt',"wouldn't",'havent',"haven't",'hasnt',"hasn't",'hadnt',"hadn't",
  // Indonesian
  'tidak','tak','bukan','belum','jangan','kurang','tanpa','tiada','nggak','ngga','gak','ga'
]);

const INTENSIFIERS = {
  // English
  'very':1.5,'extremely':1.8,'incredibly':1.8,'absolutely':1.8,'totally':1.5,'completely':1.6,
  'highly':1.4,'really':1.4,'so':1.3,'too':1.2,'quite':1.1,'pretty':1.1,'fairly':1.0,'rather':1.0,
  'super':1.5,'ultra':1.6,'terribly':1.4,'awfully':1.4,'exceptionally':1.7,'remarkably':1.6,
  // Indonesian
  'sangat':1.5,'amat':1.5,'sekali':1.4,'banget':1.4,'sungguh':1.5,'benar-benar':1.6,
  'luar biasa':1.7,'terlalu':1.2,'cukup':1.0,'agak':0.9,'sedikit':0.7,'lumayan':0.9
};

/**
 * Tokenize text into lowercase words, stripping punctuation
 */
function tokenize(text) {
  return text.toLowerCase().replace(/[^\w\s']/g, ' ').split(/\s+/).filter(Boolean);
}

/**
 * Core sentiment analysis function.
 * Returns { label, score, confidence, positiveKeywords, negativeKeywords }
 */
function analyzeSentiment(text) {
  const tokens = tokenize(text);
  const posSet = new Set(LEXICON.positive.map(w => w.toLowerCase()));
  const negSet = new Set(LEXICON.negative.map(w => w.toLowerCase()));

  let rawScore = 0;
  let wordCount = 0;
  const foundPositive = [];
  const foundNegative = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Check if this token is a sentiment word
    const isPos = posSet.has(token);
    const isNeg = negSet.has(token);

    if (!isPos && !isNeg) continue;

    // Look back for negator (within 3 tokens)
    let negated = false;
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (NEGATORS.has(tokens[j])) { negated = true; break; }
    }

    // Look back for intensifier (within 2 tokens before)
    let multiplier = 1.0;
    for (let j = Math.max(0, i - 2); j < i; j++) {
      if (INTENSIFIERS[tokens[j]]) { multiplier = INTENSIFIERS[tokens[j]]; break; }
    }

    let contribution = 1.0 * multiplier;
    if (negated) contribution *= -1;

    if (isPos) {
      rawScore += contribution;
      // Track keyword with sign
      if (contribution > 0) foundPositive.push(token);
      else foundNegative.push(token + ' (negated)');
    } else { // isNeg
      rawScore -= contribution;
      if (contribution > 0) foundNegative.push(token);
      else foundPositive.push(token + ' (negated)');
    }

    wordCount++;
  }

  // Normalise: clamp to [-1, 1]
  const normalizedScore = wordCount === 0
    ? 0
    : Math.max(-1, Math.min(1, rawScore / (wordCount + tokens.length * 0.05)));

  // Determine label
  let label;
  if (normalizedScore >= 0.12)       label = 'Positive';
  else if (normalizedScore <= -0.12) label = 'Negative';
  else                               label = 'Neutral';

  // Confidence: how far from 0 / how many sentiment words
  const absScore = Math.abs(normalizedScore);
  const density  = wordCount / Math.max(tokens.length, 1);
  const confidence = Math.min(100, Math.round((absScore * 0.6 + density * 0.4) * 100 + 30));

  return {
    label,
    score: parseFloat(normalizedScore.toFixed(3)),
    confidence: Math.max(30, Math.min(98, confidence)),
    positiveKeywords: [...new Set(foundPositive)].slice(0, 8),
    negativeKeywords: [...new Set(foundNegative)].slice(0, 8)
  };
}

/* ─────────────────────────────────────────────
   2. LOCALSTORAGE PERSISTENCE
   ───────────────────────────────────────────── */

const STORAGE_KEY = 'cfs_reviews_v1';

const SAMPLE_REVIEWS = [
  { id: uid(), date: '2026-10-01', name: 'Alice Johnson',    category: 'Product',  review: 'The product quality is absolutely amazing! It exceeded my expectations and works perfectly. Highly recommend to everyone.',          ...analyzeSentiment('The product quality is absolutely amazing! It exceeded my expectations and works perfectly. Highly recommend to everyone.') },
  { id: uid(), date: '2026-10-03', name: 'Budi Santoso',     category: 'Delivery', review: 'Pengiriman sangat cepat dan aman. Barang tiba dengan kondisi sempurna. Sangat puas dengan layanan ini!',                               ...analyzeSentiment('Pengiriman sangat cepat dan aman. Barang tiba dengan kondisi sempurna. Sangat puas dengan layanan ini!') },
  { id: uid(), date: '2026-10-05', name: 'Carol Martinez',   category: 'Support',  review: 'Customer support was not helpful at all. They were rude and completely ignored my issue. Very frustrated with this experience.',         ...analyzeSentiment('Customer support was not helpful at all. They were rude and completely ignored my issue. Very frustrated with this experience.') },
  { id: uid(), date: '2026-10-07', name: 'David Kim',        category: 'Pricing',  review: 'The pricing is a bit expensive compared to competitors, but the quality is good. Not sure if it is worth the extra cost.',               ...analyzeSentiment('The pricing is a bit expensive compared to competitors, but the quality is good. Not sure if it is worth the extra cost.') },
  { id: uid(), date: '2026-10-09', name: 'Eva Puspita',      category: 'Product',  review: 'Produk ini sangat bagus dan berkualitas tinggi. Saya sangat senang dengan pembelian ini. Pasti akan membeli lagi!',                      ...analyzeSentiment('Produk ini sangat bagus dan berkualitas tinggi. Saya sangat senang dengan pembelian ini. Pasti akan membeli lagi!') },
  { id: uid(), date: '2026-10-12', name: 'Frank Wilson',     category: 'Delivery', review: 'My package arrived damaged and the delivery was extremely late. This is totally unacceptable. I want a full refund immediately.',         ...analyzeSentiment('My package arrived damaged and the delivery was extremely late. This is totally unacceptable. I want a full refund immediately.') },
  { id: uid(), date: '2026-10-15', name: 'Grace Chen',       category: 'Support',  review: 'The support team was incredibly responsive and professional. They solved my problem quickly and efficiently. Outstanding service!',        ...analyzeSentiment('The support team was incredibly responsive and professional. They solved my problem quickly and efficiently. Outstanding service!') },
  { id: uid(), date: '2026-10-18', name: 'Hendra Wijaya',    category: 'Pricing',  review: 'Harganya cukup terjangkau dan sesuai dengan kualitasnya. Tidak terlalu mahal, tidak terlalu murah. Lumayan memuaskan.',                  ...analyzeSentiment('Harganya cukup terjangkau dan sesuai dengan kualitasnya. Tidak terlalu mahal, tidak terlalu murah. Lumayan memuaskan.') },
  { id: uid(), date: '2026-10-22', name: 'Isabella Torres',  category: 'Product',  review: 'The product is okay but nothing special. It works as described but there are better options available for this price range.',             ...analyzeSentiment('The product is okay but nothing special. It works as described but there are better options available for this price range.') },
  { id: uid(), date: '2026-10-28', name: 'Joko Prasetyo',    category: 'Support',  review: 'Tim support tidak profesional dan lambat merespons. Masalah saya tidak diselesaikan dengan baik. Sangat kecewa dengan layanan ini.',      ...analyzeSentiment('Tim support tidak profesional dan lambat merespons. Masalah saya tidak diselesaikan dengan baik. Sangat kecewa dengan layanan ini.') }
];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) { /* ignore */ }
  return null;
}

function saveData(reviews) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reviews));
}

function getReviews() {
  return loadData() || SAMPLE_REVIEWS;
}

/* ─────────────────────────────────────────────
   3. KPI CALCULATIONS
   ───────────────────────────────────────────── */

function calcKPIs(reviews) {
  const total = reviews.length;
  const pos   = reviews.filter(r => r.label === 'Positive').length;
  const neg   = reviews.filter(r => r.label === 'Negative').length;
  const neu   = reviews.filter(r => r.label === 'Neutral').length;
  const avgScore = total === 0 ? 0 :
    reviews.reduce((s, r) => s + r.score, 0) / total;
  return { total, pos, neg, neu, avgScore };
}

function calcCategoryBreakdown(reviews) {
  const cats = ['Product', 'Delivery', 'Support', 'Pricing'];
  const result = {};
  cats.forEach(c => {
    const sub = reviews.filter(r => r.category === c);
    result[c] = {
      positive: sub.filter(r => r.label === 'Positive').length,
      neutral:  sub.filter(r => r.label === 'Neutral').length,
      negative: sub.filter(r => r.label === 'Negative').length
    };
  });
  return result;
}

/* ─────────────────────────────────────────────
   4. CHART.JS RENDERING
   ───────────────────────────────────────────── */

let donutChart = null;
let barChart   = null;

const CHART_COLORS = {
  positive: { fill: 'rgba(16,185,129,0.85)',  border: '#10b981' },
  neutral:  { fill: 'rgba(245,158,11,0.85)',  border: '#f59e0b' },
  negative: { fill: 'rgba(239,68,68,0.85)',   border: '#ef4444' }
};

Chart.defaults.color = '#9ca3af';
Chart.defaults.borderColor = '#2e3a50';
Chart.defaults.font.family = '-apple-system, "Segoe UI", system-ui, sans-serif';

function renderDonut(reviews) {
  const { pos, neu, neg, total } = calcKPIs(reviews);
  const ctx = document.getElementById('donutChart').getContext('2d');

  const data = {
    labels: ['Positive', 'Neutral', 'Negative'],
    datasets: [{
      data: [pos, neu, neg],
      backgroundColor: [
        CHART_COLORS.positive.fill,
        CHART_COLORS.neutral.fill,
        CHART_COLORS.negative.fill
      ],
      borderColor: ['#252d3d','#252d3d','#252d3d'],
      borderWidth: 3,
      hoverOffset: 6
    }]
  };

  if (donutChart) {
    donutChart.data = data;
    donutChart.update('none');
  } else {
    donutChart = new Chart(ctx, {
      type: 'doughnut',
      data,
      options: {
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const val = ctx.parsed;
                const pct = total > 0 ? Math.round(val / total * 100) : 0;
                return ` ${val} reviews (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  // Center label
  const centerEl = document.getElementById('donutCenter');
  centerEl.innerHTML = `
    <div class="text-2xl font-bold text-white leading-none">${total}</div>
    <div class="text-xs text-gray-500 mt-0.5">Reviews</div>`;

  // Custom legend
  const legendEl = document.getElementById('donutLegend');
  const labels = [
    { label: 'Positive', count: pos, colorClass: 'bg-emerald-500' },
    { label: 'Neutral',  count: neu, colorClass: 'bg-amber-500' },
    { label: 'Negative', count: neg, colorClass: 'bg-rose-500' }
  ];
  legendEl.innerHTML = labels.map(l => `
    <div class="flex items-start gap-2">
      <div class="legend-dot ${l.colorClass}"></div>
      <div>
        <p class="text-xs font-semibold text-gray-200">${l.label}</p>
        <p class="text-xs text-gray-500">${l.count} reviews · ${total > 0 ? Math.round(l.count/total*100) : 0}%</p>
      </div>
    </div>`).join('');
}

function renderBar(reviews) {
  const breakdown = calcCategoryBreakdown(reviews);
  const cats = ['Product', 'Delivery', 'Support', 'Pricing'];
  const ctx = document.getElementById('barChart').getContext('2d');

  const data = {
    labels: cats,
    datasets: [
      {
        label: 'Positive',
        data: cats.map(c => breakdown[c].positive),
        backgroundColor: CHART_COLORS.positive.fill,
        borderRadius: 4
      },
      {
        label: 'Neutral',
        data: cats.map(c => breakdown[c].neutral),
        backgroundColor: CHART_COLORS.neutral.fill,
        borderRadius: 4
      },
      {
        label: 'Negative',
        data: cats.map(c => breakdown[c].negative),
        backgroundColor: CHART_COLORS.negative.fill,
        borderRadius: 4
      }
    ]
  };

  if (barChart) {
    barChart.data = data;
    barChart.update('none');
  } else {
    barChart = new Chart(ctx, {
      type: 'bar',
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 10, padding: 12, font: { size: 10 } }
          }
        },
        scales: {
          x: {
            stacked: false,
            grid: { display: false },
            ticks: { font: { size: 10 } }
          },
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1,
              font: { size: 10 },
              callback: v => Number.isInteger(v) ? v : ''
            }
          }
        }
      }
    });
  }
}

/* ─────────────────────────────────────────────
   5. KPI CARD RENDER
   ───────────────────────────────────────────── */

function renderKPIs(reviews) {
  const { total, pos, neg, avgScore } = calcKPIs(reviews);
  const posRate = total > 0 ? Math.round(pos / total * 100) : 0;
  const negRate = total > 0 ? Math.round(neg / total * 100) : 0;

  document.getElementById('kpiTotal').textContent    = total;
  document.getElementById('kpiPositive').textContent = posRate + '%';
  document.getElementById('kpiNegative').textContent = negRate + '%';
  document.getElementById('kpiPositiveCount').textContent = pos + ' reviews';
  document.getElementById('kpiNegativeCount').textContent = neg + ' reviews';

  const scoreEl = document.getElementById('kpiAvgScore');
  scoreEl.textContent = avgScore.toFixed(2);
  scoreEl.className = 'kpi-value ' + (avgScore >= 0.12 ? 'text-emerald-400' : avgScore <= -0.12 ? 'text-rose-400' : 'text-amber-400');
}

/* ─────────────────────────────────────────────
   6. TABLE RENDERING
   ───────────────────────────────────────────── */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function badgeHtml(label) {
  const cls = label === 'Positive' ? 'badge-positive' : label === 'Negative' ? 'badge-negative' : 'badge-neutral';
  const dot = label === 'Positive' ? '●' : label === 'Negative' ? '●' : '●';
  return `<span class="sentiment-badge ${cls}">${dot} ${escapeHtml(label)}</span>`;
}

function scoreHtml(score) {
  const cls = score >= 0.12 ? 'score-pos' : score <= -0.12 ? 'score-neg' : 'score-neu';
  return `<span class="${cls}">${score >= 0 ? '+' : ''}${score.toFixed(3)}</span>`;
}

function renderTable(reviews) {
  const search   = document.getElementById('tableSearch').value.trim().toLowerCase();
  const sentFilt = document.getElementById('filterSentiment').value;
  const catFilt  = document.getElementById('filterCategory').value;

  let filtered = reviews.filter(r => {
    if (sentFilt && r.label !== sentFilt) return false;
    if (catFilt  && r.category !== catFilt) return false;
    if (search) {
      const haystack = [r.name, r.category, r.review, r.label].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const tbody = document.getElementById('tableBody');
  const empty = document.getElementById('tableEmpty');
  const countEl = document.getElementById('tableCount');

  countEl.textContent = `Showing ${filtered.length} of ${reviews.length}`;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Sort: newest first (by id/date string)
  filtered = [...filtered].reverse();

  tbody.innerHTML = filtered.map(r => `
    <tr>
      <td class="whitespace-nowrap text-gray-400">${escapeHtml(r.date)}</td>
      <td class="whitespace-nowrap font-medium text-gray-200">${escapeHtml(r.name)}</td>
      <td><span class="cat-pill">${escapeHtml(r.category)}</span></td>
      <td class="td-review" title="${escapeHtml(r.review)}">${escapeHtml(r.review)}</td>
      <td>${badgeHtml(r.label)}</td>
      <td>${scoreHtml(r.score)}</td>
      <td class="text-gray-400">${r.confidence}%</td>
      <td><button class="btn-icon-danger" data-delete="${escapeHtml(r.id)}" title="Delete">✕</button></td>
    </tr>`).join('');
}

/* ─────────────────────────────────────────────
   7. FULL RE-RENDER
   ───────────────────────────────────────────── */

function rerender() {
  const reviews = getReviews();
  renderKPIs(reviews);
  renderDonut(reviews);
  renderBar(reviews);
  renderTable(reviews);
}

/* ─────────────────────────────────────────────
   8. FORM SUBMISSION & VALIDATION
   ───────────────────────────────────────────── */

function showError(id, show) {
  document.getElementById(id).classList.toggle('hidden', !show);
}

document.getElementById('feedbackForm').addEventListener('submit', function (e) {
  e.preventDefault();

  const nameEl     = document.getElementById('inputName');
  const reviewEl   = document.getElementById('inputReview');
  const categoryEl = document.getElementById('inputCategory');

  const name   = nameEl.value.trim();
  const review = reviewEl.value.trim();
  const cat    = categoryEl.value;

  let valid = true;
  if (!name)   { showError('errName',   true); valid = false; } else { showError('errName',   false); }
  if (!review) { showError('errReview', true); valid = false; } else { showError('errReview', false); }
  if (!valid) return;

  const result = analyzeSentiment(review);

  // Build entry
  const entry = {
    id: uid(),
    date: new Date().toISOString().slice(0, 10),
    name,
    category: cat,
    review,
    ...result
  };

  // Persist
  const reviews = getReviews();
  reviews.push(entry);
  saveData(reviews);

  // Show result panel
  showResultPanel(result);

  // Re-render dashboard
  rerender();

  // Clear form (keep category)
  nameEl.value   = '';
  reviewEl.value = '';
  nameEl.focus();
});

function showResultPanel(result) {
  const panel      = document.getElementById('resultPanel');
  const badge      = document.getElementById('resultBadge');
  const scoreEl    = document.getElementById('resultScore');
  const confEl     = document.getElementById('resultConfidence');
  const keywordsEl = document.getElementById('resultKeywords');

  const badgeCls = result.label === 'Positive' ? 'badge-positive' : result.label === 'Negative' ? 'badge-negative' : 'badge-neutral';
  badge.textContent = result.label;
  badge.className   = 'sentiment-badge ' + badgeCls;

  const scorePrefix = result.score >= 0 ? '+' : '';
  scoreEl.textContent = scorePrefix + result.score.toFixed(3);
  scoreEl.className   = 'result-metric-value ' + (result.score >= 0.12 ? 'score-pos' : result.score <= -0.12 ? 'score-neg' : 'score-neu');
  confEl.textContent  = result.confidence + '%';

  keywordsEl.innerHTML = [
    ...result.positiveKeywords.map(k => `<span class="keyword-pos">▲ ${escapeHtml(k)}</span>`),
    ...result.negativeKeywords.map(k => `<span class="keyword-neg">▼ ${escapeHtml(k)}</span>`)
  ].join('') || '<span class="text-xs text-gray-600 italic">No sentiment keywords detected.</span>';

  panel.classList.remove('hidden');
  panel.classList.add('visible');
}

/* ─────────────────────────────────────────────
   9. TABLE INTERACTIONS (delete, search, filter)
   ───────────────────────────────────────────── */

// Delete row via event delegation
document.getElementById('tableBody').addEventListener('click', function (e) {
  const btn = e.target.closest('[data-delete]');
  if (!btn) return;
  const id = btn.dataset.delete;
  const reviews = getReviews().filter(r => r.id !== id);
  saveData(reviews);
  rerender();
});

['tableSearch', 'filterSentiment', 'filterCategory'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const reviews = getReviews();
    renderTable(reviews);
  });
});

/* ─────────────────────────────────────────────
   10. EXPORT TO CSV
   ───────────────────────────────────────────── */

document.getElementById('btnExportCsv').addEventListener('click', () => {
  const reviews = getReviews();
  if (reviews.length === 0) { alert('No reviews to export.'); return; }

  const headers = ['Date','Customer Name','Category','Review','Sentiment','Score','Confidence (%)','Positive Keywords','Negative Keywords'];
  const rows = reviews.map(r => [
    r.date,
    r.name,
    r.category,
    r.review.replace(/"/g, '""'),
    r.label,
    r.score,
    r.confidence,
    (r.positiveKeywords || []).join('; '),
    (r.negativeKeywords || []).join('; ')
  ].map(v => `"${v}"`).join(','));

  const csv  = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `sentiment-export-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ─────────────────────────────────────────────
   11. RESET SAMPLE DATA
   ───────────────────────────────────────────── */

document.getElementById('btnResetData').addEventListener('click', () => {
  if (!confirm('Reset all reviews and reload the 10 sample entries? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  // Hide result panel
  document.getElementById('resultPanel').classList.add('hidden');
  // Clear filters
  document.getElementById('tableSearch').value        = '';
  document.getElementById('filterSentiment').value    = '';
  document.getElementById('filterCategory').value     = '';
  rerender();
});

/* ─────────────────────────────────────────────
   12. INITIALISE ON LOAD
   ───────────────────────────────────────────── */

(function init() {
  // If no data in localStorage yet, seed with sample reviews
  if (!loadData()) {
    saveData(SAMPLE_REVIEWS);
  }
  rerender();
})();
