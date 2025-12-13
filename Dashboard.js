  (function(){
    // ---- CONFIG ----
    // enter your url of lambda function here
    const PRESIGN_URL = "https://l5ehkjo7iwhovs5q55cadg6xjq0gwxda.lambda-url.us-east-1.on.aws/";
    const PRESIGN_GET_URL = "https://zu6vnpuylskru35a6hkdhkjwaa0ajauj.lambda-url.us-east-1.on.aws/";
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

    // State management
    let allFeedbackData = [];
    let currentFilter = 'all';

    // ---- HELPER FUNCTIONS ----
    function setStatus(msg){
      if(statusEl) statusEl.textContent = msg;
      console.log('[Dashboard] ' + msg);
    }

    function normalizeSentiment(sentiment) {
      const s = (sentiment || '').toLowerCase().trim();
      if (s.includes('pos') || s === 'positive') return 'positive';
      if (s.includes('neg') || s === 'negative') return 'negative';
      return 'neutral';
    }

    function extractThemes(feedbackRows) {
      // Extract common keywords/themes from feedback text
      const wordCounts = {};
      const stopWords = new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'as', 'by', 'it', 'from', 'are', 'was', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'me', 'him', 'her', 'us', 'them']);

      feedbackRows.forEach(row => {
        const text = (row.text || row.comment || '').toLowerCase();
        const words = text.match(/\b[a-z]{4,}\b/g) || [];
        
        words.forEach(word => {
          if (!stopWords.has(word)) {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
          }
        });
      });

      // Get top themes
      const sorted = Object.entries(wordCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      return sorted.map(([word]) => `#${word}`);
    }

    function updateThemes(themes) {
      const tagsContainer = document.querySelector('.tags');
      if (tagsContainer && themes.length > 0) {
        tagsContainer.innerHTML = themes.map(t => `<li>${t}</li>`).join('');
      }
    }

    function updateKPIs(total, pos, neu, neg){
      if(kpiTotal) kpiTotal.textContent = total ?? '-';
      if(kpiPos) kpiPos.textContent = pos ?? '-';
      if(kpiNeu) kpiNeu.textContent = neu ?? '-';
      if(kpiNeg) kpiNeg.textContent = neg ?? '-';

      // Update bar chart
      const posBar = document.querySelector('.bar.pos');
      const neuBar = document.querySelector('.bar.neu');
      const negBar = document.querySelector('.bar.neg');
      
      if(posBar && neuBar && negBar && typeof total === 'number' && total > 0){
        const p = Math.round((pos/total)*100);
        const n = Math.round((neg/total)*100);
        const m = 100 - p - n;
        
        posBar.style.setProperty('--w', p + '%');
        neuBar.style.setProperty('--w', m + '%');
        negBar.style.setProperty('--w', n + '%');
        posBar.querySelector('span').textContent = p + '%';
        neuBar.querySelector('span').textContent = m + '%';
        negBar.querySelector('span').textContent = n + '%';
      }
    }

    function createFeedbackRow(item, index){
      const li = document.createElement('li');
      li.dataset.index = index;
      li.dataset.sentiment = item.sentiment;

      const sentiment = item.sentiment;
      const badge = document.createElement('span');
      badge.className = 'badge ' + (sentiment === 'positive' ? 'pos' : sentiment === 'negative' ? 'neg' : 'neu');
      badge.textContent = sentiment.charAt(0).toUpperCase() + sentiment.slice(1);

      const p = document.createElement('p');
      p.textContent = item.text || item.comment || '';

      const meta = document.createElement('span');
      meta.className = 'meta';
      
      // Try to parse date from item
      let dateStr = 'Recent';
      if (item.date) {
        try {
          const d = new Date(item.date);
          if (!isNaN(d.getTime())) {
            dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          }
        } catch(e) {}
      }
      meta.textContent = dateStr + ' • ' + (item.source || 'Web');

      li.appendChild(badge);
      li.appendChild(p);
      li.appendChild(meta);

      return li;
    }

    function renderFeedback(filter = 'all') {
      if (!feedbackList) return;

      const filtered = filter === 'all' 
        ? allFeedbackData 
        : allFeedbackData.filter(item => item.sentiment === filter);

      feedbackList.innerHTML = '';
      
      if (filtered.length === 0) {
        const li = document.createElement('li');
        li.innerHTML = '<a> No feedback matching this filter.</a>';
        feedbackList.appendChild(li);
        return;
      }

      filtered.forEach((item, idx) => {
        feedbackList.appendChild(createFeedbackRow(item, idx));
      });
    }

    function setupFilters() {
      const filterButtons = document.querySelectorAll('.filters .chip');
      
      filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          // Remove active class from all
          filterButtons.forEach(b => b.classList.remove('active'));
          // Add to clicked
          btn.classList.add('active');

          // Determine filter
          const text = btn.textContent.toLowerCase();
          if (text === 'all') {
            currentFilter = 'all';
          } else if (text === 'positive') {
            currentFilter = 'positive';
          } else if (text === 'neutral') {
            currentFilter = 'neutral';
          } else if (text === 'negative') {
            currentFilter = 'negative';
          }

          renderFeedback(currentFilter);
        });
      });
    }

    // ---- API FUNCTIONS ----
    async function getPresign(filename){
      try {
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
      } catch(e){
        throw new Error('Failed calling presign: ' + e.message);
      }
    }

    async function uploadToS3(presignedUrl, file){
      const res = await fetch(presignedUrl, {
        method: 'PUT',
        headers: {'Content-Type':'text/csv'},
        body: file
      });
      if(!res.ok) throw new Error('S3 upload failed: ' + res.status + ' ' + res.statusText);
    }

    async function getPresignGet(key){
      try {
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
      } catch(e){
        throw new Error('Failed calling presign_get: ' + e.message);
      }
    }

    async function pollForResults(resultKey){
      const start = Date.now();
      while(Date.now() - start < POLL_TIMEOUT_MS){
        try {
          const pres = await getPresignGet(resultKey);
          const getUrl = pres && (pres.url || (pres.data && pres.data.url));
          if(getUrl){
            const r = await fetch(getUrl);
            if(r.ok){
              const j = await r.json();
              return j;
            }
          }
        } catch(e){
          console.log('poll attempt error', e);
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      }
      throw new Error('Timed out waiting for results');
    }

    // ---- MAIN UPLOAD HANDLER ----
    if(input){
      input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if(!file) return;
        
        try {
          setStatus('Requesting upload URL...');
          const pres = await getPresign(file.name);
          const uploadUrl = pres && (pres.url || pres.putUrl || (pres.data && pres.data.url));
          const key = pres && (pres.key || (pres.data && pres.data.key));
          
          if(!uploadUrl || !key) {
            throw new Error('Presign response missing url/key. Check presign Lambda.');
          }

          setStatus('Uploading file to S3...');
          await uploadToS3(uploadUrl, file);
          setStatus('Uploaded. Waiting for analysis...');

          const resultKey = 'results/' + key.replace(/^uploads\//, '') + '.json';
          const resultJson = await pollForResults(resultKey);

          setStatus('Analysis complete!');

          // Process results
          const rows = resultJson.rows || [];
          
          // Normalize sentiment in all rows
          const processedRows = rows.map(row => ({
            ...row,
            text: row.text || row.comment || '',
            sentiment: normalizeSentiment(row.sentiment || row.sentimentLabel),
            date: row.date || row.timestamp || null,
            source: row.source || row.platform || 'Web'
          }));

          // Calculate sentiment counts
          const counts = {
            total: processedRows.length,
            positive: processedRows.filter(r => r.sentiment === 'positive').length,
            neutral: processedRows.filter(r => r.sentiment === 'neutral').length,
            negative: processedRows.filter(r => r.sentiment === 'negative').length
          };

          // Update state
          allFeedbackData = processedRows;
          currentFilter = 'all';

          // Update UI
          updateKPIs(counts.total, counts.positive, counts.neutral, counts.negative);
          
          // Extract and update themes
          const themes = extractThemes(processedRows);
          updateThemes(themes);

          // Render feedback
          renderFeedback('all');

          // Reset filter buttons
          document.querySelectorAll('.filters .chip').forEach(b => {
            b.classList.toggle('active', b.textContent === 'All');
          });

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

    // Initialize filters
    setupFilters();

  })();