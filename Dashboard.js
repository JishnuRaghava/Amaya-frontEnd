
(function(){
  // ---- CONFIG: your Lambda Function URLs (already provided earlier) ----
  const PRESIGN_URL = "https://l5ehkjo7iwhovs5q55cadg6xjq0gwxda.lambda-url.us-east-1.on.aws/";
  const PRESIGN_GET_URL = "https://zu6vnpuylskru35a6hkdhkjwaa0ajauj.lambda-url.us-east-1.on.aws/";

  // Polling / timeout
  const POLL_INTERVAL_MS = 2000;
  const POLL_TIMEOUT_MS = 120000;

  // UI elements
  const input = document.getElementById('csvInput');
  const statusEl = document.getElementById('uploadStatus');
  const kpiTotal = document.getElementById('kpiTotal');
  const kpiPos = document.getElementById('kpiPos');
  const kpiNeu = document.getElementById('kpiNeu');
  const kpiNeg = document.getElementById('kpiNeg');

  const feedbackList = document.getElementById('feedbackList');
  const sentimentCard = document.getElementById('sentimentCard'); // visible by default
  const themesCard = document.getElementById('themesCard');       // hidden until themes found
  const themesList = document.getElementById('themesList');

  // filter chips
  const chipAll = document.querySelector('.filters .chip');
  const chips = Array.from(document.querySelectorAll('.filters .chip'));

  // in-memory storage of rows from latest analysis
  let storedRows = []; // each item: { text, sentiment, ... }
  let currentFilter = 'All'; // All / Positive / Neutral / Negative

  function setStatus(msg){
    if(statusEl) statusEl.textContent = msg;
    console.log('[Dashboard] ' + msg);
  }

  // network helpers
  async function getPresign(filename){
    const res = await fetch(PRESIGN_URL, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ filename })
    });
    const parsed = await res.json();
    if(parsed && parsed.body){
      try { return JSON.parse(parsed.body); } catch(e){ return parsed.body; }
    }
    return parsed;
  }

  async function uploadToS3(presignedUrl, file){
    const res = await fetch(presignedUrl, {
      method: 'PUT',
      headers: {'Content-Type':'text/csv'},
      body: file
    });
    if(!res.ok){
      const text = await res.text().catch(()=>null);
      throw new Error('S3 upload failed: ' + res.status + ' ' + res.statusText + (text?(' - '+text):''));
    }
  }

  async function getPresignGet(key){
    const res = await fetch(PRESIGN_GET_URL, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ key })
    });
    const parsed = await res.json();
    if(parsed && parsed.body){
      try { return JSON.parse(parsed.body); } catch(e){ return parsed.body; }
    }
    return parsed;
  }

  async function pollForResults(resultKey){
    const start = Date.now();
    while(Date.now() - start < POLL_TIMEOUT_MS){
      try {
        const pres = await getPresignGet(resultKey);
        const getUrl = pres && (pres.url || (pres.data && pres.data.url));
        if(getUrl){
          const r = await fetch(getUrl);
          if(r.ok) return await r.json();
        }
      } catch(e){
        console.log('poll attempt error', e);
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error('Timed out waiting for results');
  }

  // render helpers
  function clearFeedbackList(){ if(feedbackList) feedbackList.innerHTML = ''; }

  function renderFeedbackList(filter = 'All'){
    if(!feedbackList) return;
    clearFeedbackList();

    // newest-first
    const rows = storedRows.slice().reverse();

    const filtered = rows.filter(r => {
      if(filter === 'All') return true;
      if(filter === 'Positive') return (r.sentiment || '').toLowerCase() === 'positive';
      if(filter === 'Neutral') return (r.sentiment || '').toLowerCase() === 'neutral';
      if(filter === 'Negative') return (r.sentiment || '').toLowerCase() === 'negative';
      return true;
    });

    for(const r of filtered){
      const li = document.createElement('li');

      const sentiment = (r.sentiment || '').toLowerCase();
      const badge = document.createElement('span');
      badge.className = 'badge ' + (sentiment === 'positive' ? 'pos' : sentiment === 'negative' ? 'neg' : 'neu');
      badge.textContent = (sentiment === 'positive' ? 'Positive' : sentiment === 'negative' ? 'Negative' : 'Neutral');

      const p = document.createElement('p');
      p.textContent = r.text || r.comment || '';

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = r.meta || new Date().toLocaleDateString();

      li.appendChild(badge);
      li.appendChild(p);
      li.appendChild(meta);
      feedbackList.appendChild(li);
    }
  }

  function computeTopThemes(rows, topN = 5){
    if(!Array.isArray(rows) || rows.length === 0) return [];
    const stopwords = new Set(['the','and','for','with','that','this','it','its','is','are','was','were','but','not','too','very','i','my','we','you','they','their','have','has','had','be','on','in','of','a','an','to','from']);
    const counts = new Map();
    for(const r of rows){
      const text = (r.text || r.comment || '').toLowerCase();
      if(!text) continue;
      const tokens = text.replace(/[^\w\s]/g,' ').split(/\s+/).filter(Boolean);
      for(const t of tokens){
        if(t.length < 3) continue;
        if(stopwords.has(t)) continue;
        if(/^\d+$/.test(t)) continue;
        counts.set(t, (counts.get(t)||0)+1);
      }
    }
    return Array.from(counts.entries()).sort((a,b)=>b[1]-a[1]).slice(0, topN).map(x=>x[0]);
  }

  function updateTopThemes(rows){
    if(!themesCard || !themesList) return;
    const themes = computeTopThemes(rows, 5);
    themesList.innerHTML = '';
    if(!themes.length){
      themesCard.classList.add('hidden');
      return;
    }
    themesCard.classList.remove('hidden');
    for(const t of themes){
      const li = document.createElement('li');
      li.textContent = '#' + t.replace(/\s+/g,'-');
      themesList.appendChild(li);
    }
  }

  function updateKPIs(total, pos, neu, neg){
    if(kpiTotal) kpiTotal.textContent = (typeof total === 'number' ? total : (total ?? '-'));
    if(kpiPos) kpiPos.textContent = (typeof pos === 'number' ? pos : (pos ?? '-'));
    if(kpiNeu) kpiNeu.textContent = (typeof neu === 'number' ? neu : (neu ?? '-'));
    if(kpiNeg) kpiNeg.textContent = (typeof neg === 'number' ? neg : (neg ?? '-'));
  }

  function updateSentimentMix(total, pos, neu, neg){
    if(!sentimentCard) return;
    sentimentCard.classList.remove('hidden');
    const posBar = sentimentCard.querySelector('.bar.pos');
    const neuBar = sentimentCard.querySelector('.bar.neu');
    const negBar = sentimentCard.querySelector('.bar.neg');

    let pPct = 0, nPct = 0, mPct = 0;
    if(total && total > 0){
      pPct = Math.round((pos/total)*100);
      nPct = Math.round((neg/total)*100);
      mPct = 100 - pPct - nPct;
      if(mPct < 0) mPct = 0;
    }

    if(posBar && neuBar && negBar){
      posBar.style.setProperty('--w', pPct + '%');
      neuBar.style.setProperty('--w', mPct + '%');
      negBar.style.setProperty('--w', nPct + '%');
      posBar.querySelector('span').textContent = pPct + '%';
      neuBar.querySelector('span').textContent = mPct + '%';
      negBar.querySelector('span').textContent = nPct + '%';
    }
  }

  // attach filter behaviour to chips
  function setupFilters(){
    if(!chips || chips.length === 0) return;
    chips.forEach(chip => {
      chip.addEventListener('click', () => {
        // remove active from all
        chips.forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');

        const txt = chip.textContent.trim();
        currentFilter = txt; // 'All' / 'Positive' / 'Neutral' / 'Negative'
        renderFeedbackList(currentFilter);
      });
    });
    // default filter
    renderFeedbackList(currentFilter);
  }

  // Wire input change and full flow
  if(input){
    input.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if(!file) return;
      try {
        setStatus('Requesting upload URL...');
        const pres = await getPresign(file.name);
        const uploadUrl = pres && (pres.url || pres.putUrl || (pres.data && pres.data.url));
        const key = pres && (pres.key || (pres.data && pres.data.key));
        if(!uploadUrl || !key) throw new Error('Presign response missing url/key. Check presign Lambda.');

        setStatus('Uploading file to S3...');
        await uploadToS3(uploadUrl, file);
        setStatus('Uploaded. Waiting for analysis...');

        const resultKey = 'results/' + key.replace(/^uploads\//, '') + '.json';
        const resultJson = await pollForResults(resultKey);

        setStatus('Analysis complete');

        const total = typeof resultJson.total === 'number' ? resultJson.total : (resultJson.rows ? resultJson.rows.length : 0);
        const pos = typeof resultJson.positive === 'number' ? resultJson.positive : 0;
        const neu = typeof resultJson.neutral === 'number' ? resultJson.neutral : 0;
        const neg = typeof resultJson.negative === 'number' ? resultJson.negative : 0;

        // store rows for rendering/filtering (we keep original order as returned)
        storedRows = Array.isArray(resultJson.rows) ? resultJson.rows.map(r => ({
          text: r.text || r.comment || '',
          sentiment: (r.sentiment || '').toLowerCase(),
          meta: r.date || r.meta || new Date().toLocaleDateString()
        })) : [];

        // update UI components
        updateKPIs(total, pos, neu, neg);
        updateSentimentMix(total, pos, neu, neg);
        updateTopThemes(storedRows);

        // render feedback list (newest first)
        renderFeedbackList(currentFilter);
      } catch(err){
        console.error(err);
        setStatus('Error: ' + (err.message || err));
      } finally {
        input.value = '';
      }
    });
  } else {
    console.warn('CSV input element not found - file upload disabled');
  }

  // initial setup
  // show sentiment card by default (you insisted)
  if(sentimentCard) sentimentCard.classList.remove('hidden');
  // hide themes until available
  if(themesCard) themesCard.classList.add('hidden');
  setupFilters();

})();

