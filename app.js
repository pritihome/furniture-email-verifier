/**
 * FURNITURE BUYER EMAIL FILTER & DOMAIN VERIFIER
 * Core JavaScript Application Engine
 */

(function() {
  'use strict';

  // =========================================================================
  // I. CONFIGURATION, STORAGE & GLOBAL STATE MANAGEMENT
  // =========================================================================

  const STORAGE_KEY = 'furniture_verifier_settings';

  const appSettings = {
    rejectPersonal: true,
    rejectOrg: true,
    rejectGov: true,
    minKeepScore: 55,
    incDecor: true,
    incDesigners: true,
    incHotels: true,
    incArchitecture: true,
    concurrency: 6,
    useGemini: false,
    geminiKey: '',
    useSearch: false,
    searchKey: '',
    corsProxy: 'https://api.allorigins.win/get?url='
  };

  const appState = {
    rawRecords: [],        // Records parsed from files
    mappedRecords: [],     // Standardized records with mapped columns
    processedRecords: [],  // Final classified records
    duplicatesCount: 0,
    isProcessing: false,
    abortScan: false,
    currentWorkers: 0
  };

  // Lists of email providers, Indian indicators, and keyword vocabularies
  const PERSONAL_DOMAINS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 
    'rediffmail.com', 'aol.com', 'protonmail.com', 'icloud.com', 'ymail.com', 
    'mail.com', 'gmx.com', 'zoho.com', 'fastmail.com', 'hushmail.com',
    'googlemail.com', 'googleemail.com',
    'imelavi.fr', 'gadz.org', 'centraliens.net',
    // Common ISP and Cable providers
    'chello.nl', 'comcast.net', 'charter.net', 'cox.net', 'att.net', 'sbcglobal.net', 
    'verizon.net', 'bellsouth.net', 'optonline.net', 'earthlink.net', 'shaw.ca', 
    'rogers.com', 'sympatico.ca', 'btinternet.com', 'virginmedia.com', 'talktalk.net', 
    't-online.de', 'freenet.de', 'web.de', 'wanadoo.fr', 'orange.fr', 'free.fr', 
    'alice.it', 'libero.it', 'tin.it', 'telenet.be', 'skynet.be', 'xtra.co.nz', 'bigpond.com'
  ];

  const INDIAN_CITIES_STATES = [
    'india', 'indian', 'mumbai', 'delhi', 'chennai', 'bengaluru', 'bangalore', 
    'jodhpur', 'jaipur', 'rajasthan', 'gujarat', 'pune', 'hyderabad', 'kolkata', 
    'noida', 'gurgaon', 'gurugram', 'moradabad', 'saharanpur', 'kerala', 
    'tamilnadu', 'punjab', 'haryana', 'uttar pradesh', 'maharashtra', 'karnataka'
  ];

  const POSITIVE_KEYWORDS = [
    'furniture', 'furnishings', 'home decor', 'home furniture', 'outdoor furniture', 
    'garden furniture', 'contract furniture', 'hospitality furniture', 'hotel furniture', 
    'solid wood', 'wooden furniture', 'metal furniture', 'wrought iron furniture', 
    'dining table', 'coffee table', 'console table', 'cabinet', 'chair', 'bench', 
    'bar furniture', 'living room', 'bedroom furniture', 'importer', 'imports', 
    'wholesale', 'distributor', 'retailer', 'sourcing', 'private label', 'trade', 
    'B2B', 'showroom', 'home living', 'interiors', 'upholstery', 'sofa', 'credenza', 
    'furnishing', 'decor', 'homeware', 'patio furniture',
    // International translations (French, German, Dutch, Spanish, Italian)
    'meuble', 'meubles', 'mobilier', 'meubel', 'meubelen', 'moebel', 'möbel', 'mueble', 
    'muebles', 'mobili', 'einrichtung', 'inrichting', 'interieur', 'interieurs', 'diseño', 
    'diseno', 'wohnen', 'wohnkultur', 'ambient', 'ambiente', 'casa', 'haus', 'deco'
  ];

  const NEGATIVE_KEYWORDS = [
    'india', 'indian manufacturer', 'indian exporter', 'ngo', 'government', 
    'university', 'school', 'hospital', 'software', 'digital marketing', 
    'recruitment', 'finance', 'crypto', 'news', 'blog only', 'directory only', 
    'no products', 'no business website', 'parked domain', 'it services', 
    'law firm', 'insurance', 'cargo', 'freight', 'logistics', 'apparel', 
    'textile', 'clothing', 'pharmaceuticals', 'medical', 'clinic', 'dentist', 
    'real estate developer', 'automobile', 'car dealer',
    // Office furniture terms (excluded sector)
    'office furniture', 'office seating', 'office chair', 'office chairs', 'office desk', 
    'office desks', 'workstation', 'workstations', 'desk system', 'desk systems'
  ];

  // Helper for Settings mapping and storage
  function loadSettings() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        Object.assign(appSettings, JSON.parse(data));
      }
    } catch (e) {
      console.error('Failed to load settings from localStorage:', e);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appSettings));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  }

  // =========================================================================
  // II. TELEMETRY, LOGGING, & DASHBOARD CHART RENDERING
  // =========================================================================

  function logConsole(message, type = 'info') {
    const consoleLogs = document.getElementById('console-logs');
    if (!consoleLogs) return;

    const time = new Date().toLocaleTimeString();
    const logEl = document.createElement('div');
    logEl.className = `log-row ${type}`;
    logEl.innerText = `[${time}] ${message}`;
    
    consoleLogs.appendChild(logEl);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }

  function clearConsole() {
    const consoleLogs = document.getElementById('console-logs');
    if (consoleLogs) consoleLogs.innerHTML = '';
  }

  function updateDashboard() {
    const total = appState.processedRecords.length;
    let high = 0, medium = 0, review = 0, reject = 0;
    
    let rejIndian = 0, rejPersonal = 0, rejTld = 0, rejWeb = 0, rejMx = 0, rejSector = 0;

    appState.processedRecords.forEach(r => {
      if (r.decision === 'Keep - High Quality') high++;
      else if (r.decision === 'Keep - Medium Quality') medium++;
      else if (r.decision === 'Manual Review') review++;
      else if (r.decision === 'Reject') reject++;

      // Count rejection reasons
      if (r.decision === 'Reject') {
        const reason = r.reason.toLowerCase();
        if (reason.includes('indian') || reason.includes('competitor')) rejIndian++;
        else if (reason.includes('personal')) rejPersonal++;
        else if (reason.includes('extension') || reason.includes('.org') || reason.includes('.gov') || reason.includes('.edu')) rejTld++;
        else if (reason.includes('active website') || reason.includes('offline') || reason.includes('scraping') || reason.includes('inactive') || reason.includes('no website') || reason.includes('unreachable')) rejWeb++;
        else if (reason.includes('mx') || reason.includes('dns')) rejMx++;
        else if (reason.includes('irrelevant') || reason.includes('industry') || reason.includes('sector')) rejSector++;
      }
    });

    // Update Counters
    document.getElementById('dash-total').innerText = total;
    document.getElementById('dash-high').innerText = high;
    document.getElementById('dash-medium').innerText = medium;
    document.getElementById('dash-review').innerText = review;
    document.getElementById('dash-rejected').innerText = reject;

    document.getElementById('dash-rej-indian').innerText = rejIndian;
    document.getElementById('dash-rej-personal').innerText = rejPersonal;
    document.getElementById('dash-rej-tld').innerText = rejTld;
    document.getElementById('dash-rej-web').innerText = rejWeb;
    document.getElementById('dash-rej-mx').innerText = rejMx;
    document.getElementById('dash-rej-sector').innerText = rejSector;

    // Update Percentages
    const calcPct = (val) => total > 0 ? Math.round((val / total) * 100) : 0;
    document.getElementById('dash-high-pct').innerText = `${calcPct(high)}%`;
    document.getElementById('dash-medium-pct').innerText = `${calcPct(medium)}%`;
    document.getElementById('dash-review-pct').innerText = `${calcPct(review)}%`;
    document.getElementById('dash-reject-pct').innerText = `${calcPct(reject)}%`;

    // Render SVG Donut Chart
    const totalCircumference = 2 * Math.PI * 90; // 565.48
    const donutHigh = document.getElementById('donut-ring-high');
    const donutMedium = document.getElementById('donut-ring-medium');
    const donutReview = document.getElementById('donut-ring-review');
    const donutReject = document.getElementById('donut-ring-reject');
    
    document.getElementById('donut-center-total').textContent = total;

    if (total === 0) {
      [donutHigh, donutMedium, donutReview, donutReject].forEach(el => {
        el.setAttribute('stroke-dashoffset', totalCircumference);
      });
      return;
    }

    const highLen = (high / total) * totalCircumference;
    const medLen = (medium / total) * totalCircumference;
    const revLen = (review / total) * totalCircumference;
    const rejLen = (reject / total) * totalCircumference;

    // High Quality Ring Segment
    donutHigh.setAttribute('stroke-dasharray', `${highLen} ${totalCircumference - highLen}`);
    donutHigh.setAttribute('stroke-dashoffset', 0);

    // Medium Quality Ring Segment
    donutMedium.setAttribute('stroke-dasharray', `${medLen} ${totalCircumference - medLen}`);
    donutMedium.setAttribute('stroke-dashoffset', -highLen);

    // Manual Review Ring Segment
    donutReview.setAttribute('stroke-dasharray', `${revLen} ${totalCircumference - revLen}`);
    donutReview.setAttribute('stroke-dashoffset', -(highLen + medLen));

    // Reject Ring Segment
    donutReject.setAttribute('stroke-dasharray', `${rejLen} ${totalCircumference - rejLen}`);
    donutReject.setAttribute('stroke-dashoffset', -(highLen + medLen + revLen));
  }

  // =========================================================================
  // III. DATA PARSING & FIELD MAPPING LOGIC
  // =========================================================================

  function handleFileSelected(file) {
    if (!file) return;
    
    logConsole(`Reading uploaded file: ${file.name} (${Math.round(file.size / 1024)} KB)...`, 'sys');
    
    const fileReader = new FileReader();
    const extension = file.name.split('.').pop().toLowerCase();
    
    if (extension === 'xlsx' || extension === 'xls') {
      fileReader.readAsArrayBuffer(file);
      fileReader.onload = function(e) {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheet = workbook.SheetNames[0];
          const sheetJson = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { header: 1 });
          
          if (sheetJson.length === 0) {
            logConsole('The uploaded Excel file contains no data.', 'err');
            return;
          }
          
          processRawRows(sheetJson);
        } catch (err) {
          logConsole(`Excel parsing error: ${err.message}`, 'err');
        }
      };
    } else {
      fileReader.readAsText(file);
      fileReader.onload = function(e) {
        Papa.parse(e.target.result, {
          skipEmptyLines: true,
          header: false,
          complete: function(results) {
            if (results.errors.length > 0) {
              logConsole(`CSV parsing warnings found: ${results.errors[0].message}`, 'warn');
            }
            processRawRows(results.data);
          }
        });
      };
    }
  }

  function processRawRows(matrix) {
    if (!matrix || matrix.length === 0) return;
    
    // Header Row detection
    const headers = matrix[0].map(h => String(h || '').trim());
    const dataRows = matrix.slice(1);
    
    appState.rawRecords = dataRows.map(row => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx] !== undefined ? String(row[idx]).trim() : '';
      });
      return obj;
    });

    logConsole(`Successfully parsed header row: [${headers.join(', ')}]`, 'ok');
    logConsole(`Discovered ${appState.rawRecords.length} records. Displaying column mapper...`, 'sys');

    renderColumnMapper(headers);
  }

  function renderColumnMapper(headers) {
    const container = document.getElementById('mapping-selects');
    if (!container) return;
    container.innerHTML = '';

    const requirements = [
      { key: 'email', label: 'Email Address (Required)*', matches: ['email', 'mail', 'address'] },
      { key: 'name', label: 'Contact Name', matches: ['name', 'contact', 'person', 'first', 'last'] },
      { key: 'company', label: 'Company Name', matches: ['company', 'firm', 'business', 'corp'] },
      { key: 'website', label: 'Website URL', matches: ['website', 'site', 'url', 'web', 'domain'] },
      { key: 'country', label: 'Country Signal', matches: ['country', 'nation', 'location', 'state'] },
      { key: 'phone', label: 'Phone Number', matches: ['phone', 'tel', 'mobile'] },
      { key: 'notes', label: 'Notes / Comments', matches: ['note', 'comment', 'description'] }
    ];

    requirements.forEach(req => {
      const selectBox = document.createElement('div');
      selectBox.style.display = 'flex';
      selectBox.style.flexDirection = 'column';
      selectBox.style.gap = '0.35rem';
      
      const label = document.createElement('label');
      label.className = 'option-title';
      label.innerText = req.label;
      label.style.fontSize = '0.8rem';
      
      const select = document.createElement('select');
      select.className = 'select-field';
      select.id = `map-field-${req.key}`;
      select.style.width = '100%';
      
      // Default empty option
      const optEmpty = document.createElement('option');
      optEmpty.value = '';
      optEmpty.innerText = '-- Do Not Map --';
      select.appendChild(optEmpty);
      
      // Append headers
      let preselected = false;
      headers.forEach(h => {
        const option = document.createElement('option');
        option.value = h;
        option.innerText = h;
        
        // Auto match
        const lowerH = h.toLowerCase();
        if (!preselected && req.matches.some(keyword => lowerH.includes(keyword))) {
          option.selected = true;
          preselected = true;
        }
        select.appendChild(option);
      });
      
      selectBox.appendChild(label);
      selectBox.appendChild(select);
      container.appendChild(selectBox);
    });

    document.getElementById('upload-panel').style.display = 'none';
    document.getElementById('mapping-panel').style.display = 'block';
  }

  function startQueueProcessing() {
    const emailHeader = document.getElementById('map-field-email').value;
    if (!emailHeader) {
      alert('You must select which column represents the Email Address.');
      return;
    }

    const mapping = {
      email: emailHeader,
      name: document.getElementById('map-field-name').value,
      company: document.getElementById('map-field-company').value,
      website: document.getElementById('map-field-website').value,
      country: document.getElementById('map-field-country').value,
      phone: document.getElementById('map-field-phone').value,
      notes: document.getElementById('map-field-notes').value
    };

    // Standardize raw rows into mapped structures
    const records = [];
    const seen = new Set();
    let duplicates = 0;

    appState.rawRecords.forEach(raw => {
      const email = String(raw[mapping.email] || '').trim().toLowerCase();
      if (!email) return; // Skip empty emails

      if (seen.has(email)) {
        duplicates++;
        return;
      }
      seen.add(email);

      records.push({
        originalEmail: email,
        name: mapping.name ? (raw[mapping.name] || '') : '',
        company: mapping.company ? (raw[mapping.company] || '') : '',
        website: mapping.website ? (raw[mapping.website] || '') : '',
        country: mapping.country ? (raw[mapping.country] || '') : '',
        phone: mapping.phone ? (raw[mapping.phone] || '') : '',
        notes: mapping.notes ? (raw[mapping.notes] || '') : ''
      });
    });

    appState.mappedRecords = records;
    appState.duplicatesCount = duplicates;
    appState.processedRecords = [];

    logConsole(`Mapped email lists standard config. Duplicates skipped: ${duplicates}`, 'ok');
    logConsole(`Total unique queue entries: ${appState.mappedRecords.length}`, 'sys');

    // Switch panels
    document.getElementById('mapping-panel').style.display = 'none';
    document.getElementById('progress-panel').style.display = 'block';

    runEngineScanner();
  }

  // =========================================================================
  // IV. VALIDATION, SCORING, & WEBSCRAPER LOGIC
  // =========================================================================

  // Email format regex check
  function isValidEmailFormat(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  // DNS-over-HTTPS (DoH) MX Lookup
  async function resolveMxRecords(domain) {
    try {
      const response = await fetch(`https://dns.google/resolve?name=${domain}&type=MX`);
      if (!response.ok) return { valid: false, details: 'DNS Server Error' };
      const json = await response.json();
      
      // Look for MX records inside the DNS response Answers
      if (json.Answer && json.Answer.length > 0) {
        const mxList = json.Answer.filter(ans => ans.type === 15);
        if (mxList.length > 0) {
          return { valid: true, list: mxList.map(m => m.data).join(', ') };
        }
      }
      
      // Check A record fallback if no MX
      const aResponse = await fetch(`https://dns.google/resolve?name=${domain}&type=A`);
      if (aResponse.ok) {
        const aJson = await aResponse.json();
        if (aJson.Answer && aJson.Answer.length > 0) {
          return { valid: false, details: 'No MX record found but A record exists (domain parked or sub-hosted)' };
        }
      }
      
      return { valid: false, details: 'No MX or A DNS records resolved' };
    } catch (e) {
      return { valid: false, details: `DNS handshake failed: ${e.message}` };
    }
  }

  async function checkWebsiteDnsA(domain) {
    try {
      const response = await fetch(`https://dns.google/resolve?name=${domain}&type=A`);
      if (response.ok) {
        const json = await response.json();
        if (json.Answer && json.Answer.length > 0) {
          return true;
        }
      }
      
      const wwwResponse = await fetch(`https://dns.google/resolve?name=www.${domain}&type=A`);
      if (wwwResponse.ok) {
        const wwwJson = await wwwResponse.json();
        if (wwwJson.Answer && wwwJson.Answer.length > 0) {
          return true;
        }
      }
    } catch (e) {
      console.error('DNS A lookup failed:', e);
    }
    return false;
  }

  function findKeywordsInMetadata(domain, company, website, notes, mailbox = '') {
    const textToSearch = `${domain} ${company} ${website} ${notes} ${mailbox}`.toLowerCase();
    const matchedKws = [];
    
    POSITIVE_KEYWORDS.forEach(kw => {
      if (textToSearch.includes(kw)) {
        matchedKws.push(kw);
      }
    });

    const substrings = [
      'furniture', 'furnish', 'decor', 'living', 'design', 'interiors', 'sofa', 'chair', 
      'table', 'wood', 'concept', 'home', 'style', 'studio', 'collection', 'casa', 'loft',
      'garden', 'outdoor', 'teak', 'bed', 'cabinet', 'kitchen', 'importer', 'imports',
      'wholesale', 'distributor', 'retailer', 'sourcing',
      // European translations roots
      'meubel', 'moebel', 'möbel', 'meuble', 'mobilier', 'mobili', 'mueble', 'einricht', 
      'inricht', 'interieur', 'diseno', 'diseño', 'wohn', 'haus', 'ambient', 'deco'
    ];
    
    substrings.forEach(sub => {
      if (textToSearch.includes(sub) && !matchedKws.includes(sub)) {
        matchedKws.push(sub);
      }
    });

    return matchedKws;
  }

  function findNegativeKeywordsInMetadata(domain, company, website, notes, mailbox = '') {
    const textToSearch = `${domain} ${company} ${website} ${notes} ${mailbox}`.toLowerCase();
    const matchedNegs = [];

    const negativeSubstrings = [
      'software', 'saas', 'cloud', 'digital', 'agency', 'marketing',
      'properties', 'property', 'realty', 'realestate', 'construction', 'builders',
      'bank', 'finance', 'financial', 'crypto', 'law-firm', 'lawfirm', 'legal', 'attorney', 'insurance',
      'medical', 'pharma', 'clinic', 'hospital', 'dental', 'health',
      'logistics', 'freight', 'cargo', 'shipping',
      'school', 'university', 'college', 'academy',
      'newspaper', 'news-agency', 'press-release', 'blogging',
      'cars', 'automotive', 'motors', 'motor', 'automobile', 'vehicle', 'dealership',
      // Computer and IT shop terms
      'computer', 'computers', 'laptop', 'laptops', 'repair', 'repairs', 'hosting', 'tech-support', 'it-support',
      // Office furniture terms and companies
      'office-furniture', 'officefurniture', 'steelcase', 'workstation', 'workstations', 'office-seating', 
      'officeseating', 'office-chair', 'officechairs', 'hermanmiller', 'haworth', 'knoll', 'teknion',
      // Giant generic e-commerce & retail marketplaces
      'amazon', 'ebay', 'shopify', 'alibaba', 'aliexpress', 'ikea',
      // Freelancing, recruitment, and jobs portals
      'freelancer', 'upwork', 'fiverr', 'peopleperhour', 'toptal', 'careers', 'jobs', 'recruitment', 'staffing',
      // Social networks, platforms and portals
      'instagram', 'facebook', 'twitter', 'linkedin', 'pinterest', 'tiktok', 'youtube', 'snapchat',
      // Specific domain/brand exclusions
      'imelavi', 'vesta', 'citrusuk', 'officemaker', 'officemakers', 'hettich', 'blum', 'hafele', 'haefele', 'salice',
      // Office furniture brands & international terms
      'flokk', 'allsteel', 'giroflex', 'offecct', 'kantoor', 'buero', 'büro', 'ufficio', 'oficina'
    ];

    // Check if domain or company name contains both "office" and furniture-related terms
    const domainLower = domain.toLowerCase();
    const companyLower = company.toLowerCase();
    if (domainLower.includes('office') || companyLower.includes('office')) {
      const furnitureWords = [
        'furniture', 'furnish', 'seating', 'desk', 'chair', 'table', 'maker', 'makers', 
        'system', 'systems', 'solution', 'solutions', 'design', 'designs', 'fitout', 'fitouts', 
        'interior', 'interiors', 'workplace', 'workspaces', 'workspace', 'product', 'products'
      ];
      const hasClash = furnitureWords.some(w => domainLower.includes(w) || companyLower.includes(w));
      if (hasClash) {
        matchedNegs.push('office-furniture');
      }
    }

    negativeSubstrings.forEach(sub => {
      if (textToSearch.includes(sub)) {
        matchedNegs.push(sub);
      }
    });

    return matchedNegs;
  }

  // Scraping logic using proxy
  async function scrapeWebsiteContent(domain, customUrl = '') {
    let urlsToTry = [];
    if (customUrl) {
      let cleanUrl = customUrl.trim();
      if (!/^https?:\/\//i.test(cleanUrl)) {
        cleanUrl = 'http://' + cleanUrl;
      }
      urlsToTry.push(cleanUrl);
    }
    
    // Add default fallbacks based on domain
    urlsToTry.push(`https://${domain}`);
    urlsToTry.push(`http://${domain}`);
    urlsToTry.push(`https://www.${domain}`);
    urlsToTry.push(`http://www.${domain}`);

    let html = '';
    let successUrl = '';
    let statusMsg = 'Offline';

    for (let url of urlsToTry) {
      try {
        const fetchUrl = `${appSettings.corsProxy}${encodeURIComponent(url)}`;
        const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
          const json = await res.json();
          // Extract contents from allorigins payload
          if (json && json.contents) {
            html = json.contents;
            successUrl = url;
            statusMsg = 'Active';
            break;
          }
        }
      } catch (err) {
        statusMsg = `Connection failed (${err.message})`;
      }
    }

    if (!html) {
      return { active: false, status: statusMsg, text: '', url: '' };
    }

    // Parse elements
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      const title = doc.querySelector('title') ? doc.querySelector('title').innerText : '';
      const metaDesc = doc.querySelector('meta[name="description"]') ? doc.querySelector('meta[name="description"]').getAttribute('content') : '';
      
      // Headings
      const headings = Array.from(doc.querySelectorAll('h1, h2, h3')).map(h => h.innerText).join(' ');
      
      // Footer & Address
      const footerText = doc.querySelector('footer') ? doc.querySelector('footer').innerText : '';
      
      // Core text body (limit to first 12000 chars to avoid memory issues)
      const bodyText = doc.body ? doc.body.innerText.substring(0, 12000) : '';

      const compiledText = `
        TITLE: ${title}
        METADESC: ${metaDesc}
        HEADINGS: ${headings}
        FOOTER: ${footerText}
        BODY: ${bodyText}
      `.replace(/\s+/g, ' ');

      return {
        active: true,
        status: 'Active',
        text: compiledText,
        url: successUrl,
        title: title.trim(),
        metaDesc: metaDesc ? metaDesc.trim() : ''
      };
    } catch (e) {
      return { active: true, status: 'Parsing Error', text: '', url: successUrl };
    }
  }

  // Google Gemini AI Validation Layer
  async function runGeminiAIClassification(text, domain) {
    if (!appSettings.useGemini || !appSettings.geminiKey) {
      return null;
    }

    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${appSettings.geminiKey}`;
      
      const prompt = `
      You are an expert AI lead qualifier for a high-end furniture exporter.
      Analyze the scraped text content of the website homepage for the domain "${domain}".
      Classify the business and determine if they are an overseas buyer (importer, retailer, wholesaler, hotel/resort group, interior design distributor) for furniture/home decor.
      Note that we STRICTLY REJECT any businesses originating from or having operations primarily based in INDIA (due to local competition).

      Website Text Snippet:
      """
      ${text.substring(0, 4000)}
      """

      Return a structured JSON object strictly matching this schema format (no markdown formatting block):
      {
        "business_category": "Specify company industry type e.g. Furniture Retailer, Interior Designer, Software, Parked, etc.",
        "country_detected": "Detect headquarter country or location",
        "is_furniture_related": true/false,
        "is_likely_buyer": true/false,
        "is_indian_origin": true/false,
        "final_decision": "Keep High Quality / Keep Medium Quality / Manual Review / Reject",
        "score": 0-100,
        "reason": "Provide a brief reason in 1 sentence."
      }
      `;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      });

      if (!response.ok) {
        return { error: `Gemini API responded with status ${response.status}` };
      }

      const json = await response.json();
      const resultText = json.candidates[0].content.parts[0].text;
      return JSON.parse(resultText);
    } catch (err) {
      console.error('Gemini AI execution failed:', err);
      return { error: `Gemini execution failure: ${err.message}` };
    }
  }

  // SerpAPI Search Engine Fallback
  async function runSerpAPISearch(query) {
    if (!appSettings.useSearch || !appSettings.searchKey) {
      return null;
    }

    try {
      const endpoint = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${appSettings.searchKey}`;
      
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const json = await res.json();
        return json;
      }
    } catch (e) {
      console.error('SerpAPI connection failed:', e);
    }
    return null;
  }

  // Core Scoring Engine Logic
  async function qualifyEmailRecord(record, workerId) {
    const email = record.originalEmail;
    
    // 1. Format validation
    if (!isValidEmailFormat(email)) {
      return {
        ...record,
        cleanedEmail: email,
        domain: '',
        mxStatus: 'Fail',
        webStatus: 'Offline',
        country: 'Unknown',
        category: 'Invalid',
        score: 0,
        importerSignal: 'No',
        indianSignal: 'No',
        decision: 'Reject',
        reason: 'Rejected because email format is invalid',
        urlChecked: '',
        keywords: '',
        notes: 'Invalid formatting syntax'
      };
    }

    const parts = email.split('@');
    const mailbox = parts[0];
    const domain = parts[1];
    const domainParts = domain.split('.');
    const tld = domainParts[domainParts.length - 1];
    const companyFromDomain = domainParts[0];

    let score = 0;
    let details = [];
    let isIndian = false;
    let rejectReason = '';
    let keywordsFound = [];
    
    logConsole(`[Worker ${workerId}] Checking DNS & MX record for domain: ${domain}`, 'info');

    // Rule 1: Extension checks
    if (tld === 'in') {
      isIndian = true;
      rejectReason = 'Rejected because domain ends with .in';
    } else if (appSettings.rejectOrg && tld === 'org') {
      rejectReason = 'Rejected because domain ends with .org';
    } else if (appSettings.rejectGov && (tld === 'gov' || tld === 'edu')) {
      rejectReason = 'Rejected because domain belongs to government/educational institution';
    }

    // Check Indian keywords in domain
    if (!isIndian) {
      const matchedCity = INDIAN_CITIES_STATES.find(city => domain.includes(city));
      if (matchedCity) {
        isIndian = true;
        rejectReason = `Rejected because domain contains Indian indicator: "${matchedCity}"`;
      }
    }

    // Check personal email providers
    let isPersonal = PERSONAL_DOMAINS.includes(domain);
    let hasPositiveInMailbox = false;
    let searchValidated = false;
    let searchReason = '';

    if (isPersonal) {
      const mailboxLower = mailbox.toLowerCase();
      const positiveSubstrings = [
        'furniture', 'furnish', 'decor', 'living', 'design', 'interiors', 'sofa', 'chair', 
        'table', 'wood', 'concept', 'home', 'style', 'studio', 'collection', 'casa', 'loft',
        'garden', 'outdoor', 'teak', 'bed', 'cabinet', 'kitchen', 'importer', 'imports',
        'wholesale', 'distributor', 'retailer', 'sourcing',
        'meubel', 'moebel', 'möbel', 'meuble', 'mobilier', 'mobili', 'mueble', 'einricht', 
        'inricht', 'interieur', 'diseno', 'diseño', 'wohn', 'haus', 'ambient', 'deco'
      ];
      hasPositiveInMailbox = POSITIVE_KEYWORDS.some(kw => mailboxLower.includes(kw)) || positiveSubstrings.some(sub => mailboxLower.includes(sub));
      
      if (appSettings.useSearch && appSettings.searchKey) {
        logConsole(`[Worker ${workerId}] Personal domain detected. Searching Google/Facebook/LinkedIn for email: ${email}`, 'sys');
        const searchResult = await runSerpAPISearch(`"${email}"`);
        if (searchResult && searchResult.organic_results && searchResult.organic_results.length > 0) {
          const combinedText = searchResult.organic_results.slice(0, 4)
            .map(r => `${r.title} ${r.snippet} ${r.link}`)
            .join(' ').toLowerCase();
          
          const hasSocialLink = combinedText.includes('facebook.com') || 
                                 combinedText.includes('linkedin.com') || 
                                 combinedText.includes('instagram.com') ||
                                 combinedText.includes('pinterest.com');
          const hasFurnitureKeywords = POSITIVE_KEYWORDS.some(kw => combinedText.includes(kw));
          
          if (hasFurnitureKeywords || hasSocialLink) {
            searchValidated = true;
            searchReason = `Found on ${hasSocialLink ? 'Facebook/LinkedIn/Social' : 'Google'} associated with furniture`;
            logConsole(`[Worker ${workerId}] SerpAPI found social/business results for ${email}: ${searchReason}`, 'ok');
          }
        }
        
        // Fallback to name search if exact email query returned nothing
        if (!searchValidated) {
          logConsole(`[Worker ${workerId}] Email search returned no results. Searching for business name: "${mailbox} furniture"`, 'sys');
          const searchResultName = await runSerpAPISearch(`"${mailbox}" furniture`);
          if (searchResultName && searchResultName.organic_results && searchResultName.organic_results.length > 0) {
            const combinedText = searchResultName.organic_results.slice(0, 4)
              .map(r => `${r.title} ${r.snippet} ${r.link}`)
              .join(' ').toLowerCase();
            const hasFurnitureKeywords = POSITIVE_KEYWORDS.some(kw => combinedText.includes(kw));
            if (hasFurnitureKeywords) {
              searchValidated = true;
              searchReason = `Found business "${mailbox}" on Google/Social associated with furniture`;
              logConsole(`[Worker ${workerId}] SerpAPI found business name results for ${mailbox}: ${searchReason}`, 'ok');
            }
          }
        }
      }

      if (appSettings.rejectPersonal) {
        if (!hasPositiveInMailbox && !searchValidated) {
          rejectReason = 'Rejected because personal email domain is blocked';
        }
      }
    }

    // DNS MX checks
    const mxCheck = await resolveMxRecords(domain);
    let mxStatus = 'Offline';
    if (mxCheck.valid) {
      score += 15; // +15 MX record
      mxStatus = 'Active';
      details.push('MX DNS Valid');
    } else {
      mxStatus = 'Fail';
      rejectReason = rejectReason || `Rejected because no active MX record was found: ${mxCheck.details}`;
    }

    score += 10; // +10 for valid email format

    // Check if we should abort website scraping based on hard rules already hit
    // However, the rule says "never delete data silently, every rejected email must show a clear reason"
    // So we evaluate website checks if possible to build a complete audit report.
    let webStatus = 'Offline';
    let urlChecked = '';
    let textScraped = '';
    let category = 'Unknown';
    let countryDetected = 'Unknown';
    let importerSignal = 'No';

    // Scan metadata for keywords first (always runs to collect initial signals)
    const metadataKeywords = findKeywordsInMetadata(domain, record.company, record.website || '', record.notes || '', mailbox);
    metadataKeywords.forEach(kw => {
      if (!keywordsFound.includes(kw)) {
        keywordsFound.push(kw);
      }
    });

    // Scan metadata for negative industry keywords
    const metadataNegatives = findNegativeKeywordsInMetadata(domain, record.company, record.website || '', record.notes || '', mailbox);
    if (metadataNegatives.length > 0) {
      rejectReason = rejectReason || `Rejected because domain/company is associated with an irrelevant industry: ${metadataNegatives.join(', ')}`;
      score -= 80;
    }

    if (!isIndian && rejectReason !== 'Rejected because email format is invalid') {
      if (isPersonal && !record.website) {
        webStatus = 'Skipped';
        details.push('Personal Provider (No Website)');
      } else {
        logConsole(`[Worker ${workerId}] Scrapping website for domain: ${domain}`, 'info');
        const scrapeResult = await scrapeWebsiteContent(domain, record.website);
      
      if (scrapeResult.active) {
        score += 15; // +15 website active
        webStatus = 'Active';
        urlChecked = scrapeResult.url;
        textScraped = scrapeResult.text;
        details.push('Website Active');
        
        // Scan scraped text for keywords
        const lowerText = textScraped.toLowerCase();
        POSITIVE_KEYWORDS.forEach(kw => {
          if (lowerText.includes(kw) && !keywordsFound.includes(kw)) {
            keywordsFound.push(kw);
          }
        });

        // Scan scraped text for negative industry keywords
        const negativeMatches = [];
        NEGATIVE_KEYWORDS.forEach(kw => {
          if (lowerText.includes(kw)) {
            negativeMatches.push(kw);
          }
        });
        if (negativeMatches.length > 0) {
          rejectReason = rejectReason || `Rejected because website contains irrelevant industry signals: ${negativeMatches.slice(0, 4).join(', ')}`;
          score -= 80;
        }

        // Contact page link found
        if (lowerText.includes('contact') || lowerText.includes('about') || lowerText.includes('location')) {
          score += 5; // +5 contact details
        }

        // Verify Indian signals inside website content
        const phoneMatch = lowerText.match(/\+91\s?[0-9]/g) || lowerText.includes('gstin') || lowerText.includes('cin number') || lowerText.includes('made in india');
        const addressCityMatch = INDIAN_CITIES_STATES.some(city => lowerText.includes(city));
        
        if (phoneMatch || addressCityMatch) {
          isIndian = true;
          rejectReason = 'Rejected because Indian business signals (address, phone prefix, or GST) were discovered on their website';
        }
      } else {
        // Website fetch failed (CORS or offline). Check DNS A record fallback
        logConsole(`[Worker ${workerId}] Website scrape failed. Querying DNS A record for fallback...`, 'sys');
        const hasARecord = await checkWebsiteDnsA(domain);
        
        if (hasARecord) {
          score += 15; // Treat as active website (CORS proxy block)
          webStatus = 'CORS Blocked';
          details.push('Website Online (CORS Blocked)');
        } else {
          if (isPersonal && (hasPositiveInMailbox || searchValidated || !appSettings.rejectPersonal)) {
            webStatus = 'Offline';
            details.push('Website Offline (Personal Provider)');
          } else {
            score -= 30; // Truly offline
            webStatus = 'Offline';
            details.push('Website Offline');
            rejectReason = rejectReason || 'Rejected because website is offline, inactive, or unreachable';
          }
        }
      }
    }
  } else {
    if (isPersonal && (hasPositiveInMailbox || searchValidated || !appSettings.rejectPersonal)) {
        details.push('No website (Personal Provider)');
      } else {
        score -= 30;
        rejectReason = rejectReason || 'Rejected because no website was provided';
      }
    }

    // Keyword & Buyer evaluations (runs based on combined web + metadata keywords)
    if (keywordsFound.length > 0) {
      score += 25; // +25 furniture keywords found
      details.push(`Keywords found (${keywordsFound.length})`);
    } else {
      if (webStatus === 'Active') {
        rejectReason = rejectReason || 'Rejected because website content contains no furniture-related keywords';
      }
    }

    const buyerKeywords = ['importer', 'imports', 'wholesale', 'distributor', 'retailer', 'sourcing', 'private label', 'buying group', 'chain store', 'living', 'concepts', 'showroom'];
    const hasBuyerSignal = buyerKeywords.some(kw => {
      const lowerCompany = record.company.toLowerCase();
      const lowerDomain = domain.toLowerCase();
      return keywordsFound.includes(kw) || lowerCompany.includes(kw) || lowerDomain.includes(kw);
    });

    if (hasBuyerSignal) {
      score += 20; // +20 buyer signal
      importerSignal = 'Yes';
      details.push('Buyer Signal Detected');
    }

    // Set Country Detected
    if (isIndian) {
      countryDetected = 'India';
      score -= 100;
    } else if (webStatus === 'Active' || webStatus === 'CORS Blocked') {
      score += 10; // +10 Country outside India
      // Basic Country extraction heuristic
      if (tld === 'us') countryDetected = 'United States';
      else if (tld === 'uk' || tld === 'co.uk') countryDetected = 'United Kingdom';
      else if (tld === 'de') countryDetected = 'Germany';
      else if (tld === 'fr') countryDetected = 'France';
      else if (tld === 'au') countryDetected = 'Australia';
      else if (tld === 'ca') countryDetected = 'Canada';
      else countryDetected = 'International';
    }

    if (isPersonal && appSettings.rejectPersonal) {
      if (hasPositiveInMailbox || searchValidated) {
        score -= 15; // Minor deduction for personal email, leaving room to keep if valid
      } else {
        score -= 50;
      }
    }

    // Add custom score boosts for verified personal email patterns
    if (isPersonal) {
      if (hasPositiveInMailbox) {
        score += 20; // Prefix bypass boost
        details.push('Personal Email Prefix Bypass');
      }
      if (searchValidated) {
        score += 30; // Search verification boost
        details.push(searchReason);
      }
    }

    // Perform Search Fallback if settings permit and website was inactive/unclear
    if (!isIndian && !rejectReason && score < 55 && appSettings.useSearch && appSettings.searchKey) {
      logConsole(`[Worker ${workerId}] Borderline score. Running SerpAPI search fallback...`, 'sys');
      const searchQuery = `${domain} ${record.company || ''} furniture importer`;
      const searchResult = await runSerpAPISearch(searchQuery);
      if (searchResult && searchResult.organic_results && searchResult.organic_results.length > 0) {
        const snippets = searchResult.organic_results.slice(0, 3).map(r => r.snippet || '').join(' ').toLowerCase();
        let matchCount = 0;
        POSITIVE_KEYWORDS.forEach(kw => {
          if (snippets.includes(kw)) {
            matchCount++;
          }
        });
        if (matchCount > 0) {
          score += 20;
          details.push(`Search match fallback (+20)`);
        }
      }
    }

    // Perform AI Verification Layer if settings permit and domain not already rejected
    let aiReason = '';
    if (!isIndian && !rejectReason && appSettings.useGemini && appSettings.geminiKey && textScraped) {
      logConsole(`[Worker ${workerId}] Querying Gemini AI content classifier...`, 'sys');
      const aiResponse = await runGeminiAIClassification(textScraped, domain);
      
      if (aiResponse && !aiResponse.error) {
        category = aiResponse.business_category || category;
        countryDetected = aiResponse.country_detected || countryDetected;
        aiReason = aiResponse.reason;
        
        if (aiResponse.is_indian_origin) {
          isIndian = true;
          rejectReason = 'Rejected because AI detected Indian manufacturing operations';
          score = 0;
        } else {
          // Adjust scoring based on AI confidence
          if (aiResponse.is_furniture_related && aiResponse.is_likely_buyer) {
            score = Math.max(score, aiResponse.score || 85);
          } else if (!aiResponse.is_furniture_related) {
            score = Math.min(score, 30);
            rejectReason = 'Rejected because website content is not related to furniture industry';
          }
        }
      } else if (aiResponse && aiResponse.error) {
        logConsole(`Gemini API error: ${aiResponse.error}`, 'warn');
      }
    }

    // Categorization logic based on score
    let finalDecision = 'Reject';
    
    // Apply Settings constraints on Medium keeps
    let passDesigners = appSettings.incDesigners;
    let passDecor = appSettings.incDecor;
    let passHotels = appSettings.incHotels;
    let passArchitecture = appSettings.incArchitecture;

    if (score >= 75) {
      finalDecision = 'Keep - High Quality';
    } else if (score >= appSettings.minKeepScore) {
      finalDecision = 'Keep - Medium Quality';
    } else if (score >= 35) {
      finalDecision = 'Manual Review';
    } else {
      finalDecision = 'Reject';
      rejectReason = rejectReason || 'Rejected because furniture relevance score was too low';
    }

    // Invalidation reason overrides
    if (isIndian || rejectReason) {
      finalDecision = 'Reject';
      if (isIndian) {
        rejectReason = rejectReason || 'Rejected due to competitor / Indian operations signal';
      }
    }

    // Build keyword display string
    const kwDisplay = keywordsFound.slice(0, 6).join(', ');

    return {
      ...record,
      cleanedEmail: email,
      domain: domain,
      mxStatus: mxStatus === 'Active' ? '✓ Online' : (mxStatus === 'Fail' ? '✕ Dead' : 'Skipped'),
      webStatus: webStatus,
      country: countryDetected,
      category: category === 'Unknown' && webStatus === 'Active' ? 'Furniture-related' : category,
      score: Math.max(0, Math.min(100, score)),
      importerSignal: importerSignal,
      indianSignal: isIndian ? 'Yes' : 'No',
      decision: finalDecision,
      reason: finalDecision === 'Reject' ? rejectReason : (aiReason || 'Meets international furniture buyer criteria'),
      urlChecked: urlChecked,
      keywords: kwDisplay,
      notes: details.join('; ')
    };
  }

  // =========================================================================
  // V. MULTI-THREADED ASYNC QUEUE CONTROLLER
  // =========================================================================

  async function runEngineScanner() {
    if (appState.isProcessing) return;
    
    appState.isProcessing = true;
    appState.abortScan = false;
    clearConsole();
    
    logConsole('Initialising background crawler queue...', 'sys');
    logConsole(`Configured parallel threads: ${appSettings.concurrency}`, 'sys');

    const total = appState.mappedRecords.length;
    const progressFill = document.getElementById('progress-bar');
    const progressPct = document.getElementById('progress-percentage');
    const titleStatus = document.getElementById('progress-status-title');
    
    // Spawn simulated worker grid
    const workersContainer = document.getElementById('workers-container');
    workersContainer.innerHTML = '';
    
    const workerNodes = [];
    for (let w = 0; w < appSettings.concurrency; w++) {
      const node = document.createElement('div');
      node.className = 'worker-node';
      node.id = `worker-node-${w}`;
      
      const name = document.createElement('span');
      name.className = 'worker-name';
      name.innerText = `THREAD RUNNER #${w + 1}`;
      
      const status = document.createElement('span');
      name.className = 'worker-status';
      status.innerText = 'Initializing...';
      
      const track = document.createElement('div');
      track.className = 'worker-progress-track';
      
      const fill = document.createElement('div');
      fill.className = 'worker-progress-fill';
      
      track.appendChild(fill);
      node.appendChild(name);
      node.appendChild(status);
      node.appendChild(track);
      workersContainer.appendChild(node);
      
      workerNodes.push({ element: node, statusEl: status, fillEl: fill });
    }

    let index = 0;

    async function processNextRecord(workerId) {
      if (appState.abortScan || index >= total) {
        return;
      }

      const currentIndex = index++;
      const record = appState.mappedRecords[currentIndex];
      const node = workerNodes[workerId];

      node.element.className = 'worker-node busy';
      node.statusEl.innerText = `Processing: ${record.originalEmail}`;
      node.fillEl.style.width = '40%';

      logConsole(`[Thread #${workerId + 1}] Processing email #${currentIndex + 1}: ${record.originalEmail}`, 'info');

      try {
        const result = await qualifyEmailRecord(record, workerId + 1);
        
        if (appState.abortScan) return;
        
        appState.processedRecords.push(result);
        
        node.element.className = 'worker-node complete';
        node.statusEl.innerText = 'Completed Check';
        node.fillEl.style.width = '100%';
        
        if (result.decision === 'Reject') {
          logConsole(`[Result] Rejected: ${result.originalEmail}. Reason: ${result.reason}`, 'err');
        } else {
          logConsole(`[Result] Verified: ${result.originalEmail}. Decision: ${result.decision} (Score: ${result.score})`, 'ok');
        }

      } catch (err) {
        logConsole(`Queue Exception on row ${currentIndex}: ${err.message}`, 'err');
        
        // Push raw failed row to not lose data
        appState.processedRecords.push({
          ...record,
          cleanedEmail: record.originalEmail,
          domain: '',
          mxStatus: 'Fail',
          webStatus: 'Offline',
          country: 'Unknown',
          category: 'Unknown',
          score: 10,
          importerSignal: 'No',
          indianSignal: 'No',
          decision: 'Reject',
          reason: `Queue Exception: ${err.message}`,
          urlChecked: '',
          keywords: '',
          notes: 'Processing Exception'
        });
      }

      // Update progress metrics
      const completed = appState.processedRecords.length;
      const pct = Math.round((completed / total) * 100);
      progressFill.style.width = `${pct}%`;
      progressPct.innerText = `${pct}% (${completed}/${total})`;
      titleStatus.innerText = `Queue execution: processing item ${completed} of ${total}...`;

      updateDashboard();
      appendRecordToSpreadsheet(appState.processedRecords[completed - 1], completed);

      // Recursive call for next item
      await processNextRecord(workerId);
    }

    // Spawning workers in parallel
    const promises = [];
    for (let w = 0; w < appSettings.concurrency; w++) {
      promises.push(processNextRecord(w));
    }

    await Promise.all(promises);

    // Scan complete
    appState.isProcessing = false;
    document.getElementById('status-glow').className = 'status-indicator-dot online';
    document.getElementById('status-glow').style.animation = 'none';

    if (appState.abortScan) {
      titleStatus.innerText = 'Queue process aborted by user.';
      logConsole('Verification Queue cancelled. Displaying partial results.', 'warn');
    } else {
      titleStatus.innerText = 'Queue check completed successfully.';
      logConsole('Queue processed all email listings.', 'ok');
    }

    // Enable Exports
    enableDatabaseExports(true);
  }

  // =========================================================================
  // VI. DATABASE SPREADSHEET RENDERER
  // =========================================================================

  function appendRecordToSpreadsheet(record, index) {
    const tbody = document.getElementById('table-tbody');
    const placeholder = tbody.querySelector('.table-placeholder-row');
    if (placeholder) {
      tbody.innerHTML = '';
    }

    const tr = document.createElement('tr');
    
    let badgeClass = 'badge-reject';
    if (record.decision === 'Keep - High Quality') badgeClass = 'badge-high';
    else if (record.decision === 'Keep - Medium Quality') badgeClass = 'badge-medium';
    else if (record.decision === 'Manual Review') badgeClass = 'badge-review';

    let scoreClass = 'score-reject';
    if (record.score >= 75) scoreClass = 'score-high';
    else if (record.score >= 55) scoreClass = 'score-medium';
    else if (record.score >= 35) scoreClass = 'score-review';

    tr.innerHTML = `
      <td style="text-align: center; color: var(--text-dim);">${index}</td>
      <td style="font-weight: 700; color: #fff;">${record.cleanedEmail}</td>
      <td><span class="badge ${badgeClass}">${record.decision}</span></td>
      <td><span class="score-indicator ${scoreClass}">${record.score}</span></td>
      <td>${record.domain}</td>
      <td style="color:${record.mxStatus.includes('Online') ? 'var(--success)' : 'var(--danger)'};">${record.mxStatus}</td>
      <td style="color:${record.webStatus === 'Active' ? 'var(--success)' : 'var(--text-muted)'};">${record.webStatus}</td>
      <td>${record.country}</td>
      <td>${record.category}</td>
      <td style="color:${record.indianSignal === 'Yes' ? 'var(--danger)' : 'var(--text-dim)'};">${record.indianSignal}</td>
      <td style="color:var(--text-muted); font-size:0.75rem;" title="${record.reason}">${record.reason}</td>
      <td style="color:var(--text-muted); font-size:0.75rem;">${record.keywords}</td>
      <td style="font-size:0.75rem;"><a href="${record.urlChecked}" target="_blank" style="color:var(--info);">${record.urlChecked || '-'}</a></td>
    `;
    
    tbody.appendChild(tr);
  }

  function renderFullSpreadsheet() {
    const tbody = document.getElementById('table-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const query = document.getElementById('search-input').value.toLowerCase().trim();
    const decisionFilter = document.getElementById('filter-decision').value;
    const statusFilter = document.getElementById('filter-status').value;

    const filtered = appState.processedRecords.filter(r => {
      // Search query filter
      const matchesSearch = 
        r.cleanedEmail.toLowerCase().includes(query) || 
        r.domain.toLowerCase().includes(query) || 
        r.reason.toLowerCase().includes(query) ||
        r.country.toLowerCase().includes(query);

      // Decision Filter
      let matchesDecision = true;
      if (decisionFilter === 'keep-high') matchesDecision = r.decision === 'Keep - High Quality';
      else if (decisionFilter === 'keep-medium') matchesDecision = r.decision === 'Keep - Medium Quality';
      else if (decisionFilter === 'manual') matchesDecision = r.decision === 'Manual Review';
      else if (decisionFilter === 'reject') matchesDecision = r.decision === 'Reject';

      // Status filter
      let matchesStatus = true;
      if (statusFilter === 'mx-pass') matchesStatus = r.mxStatus.includes('Online');
      else if (statusFilter === 'mx-fail') matchesStatus = r.mxStatus.includes('Dead');
      else if (statusFilter === 'web-active') matchesStatus = r.webStatus === 'Active';
      else if (statusFilter === 'web-inactive') matchesStatus = r.webStatus !== 'Active';

      return matchesSearch && matchesDecision && matchesStatus;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr class="table-placeholder-row">
          <td colspan="13" class="table-placeholder">
            <span class="table-placeholder-icon">🔍</span>
            <strong>No matching records found</strong><br>
            Try adjusting your search query or dropdown filter mappings.
          </td>
        </tr>
      `;
      return;
    }

    filtered.forEach((r, idx) => {
      appendRecordToSpreadsheet(r, idx + 1);
    });
  }

  function enableDatabaseExports(enabled) {
    const buttons = [
      'btn-export-high', 'btn-export-medium', 'btn-export-review', 
      'btn-export-rejected', 'btn-export-all'
    ];
    buttons.forEach(id => {
      document.getElementById(id).disabled = !enabled;
    });
  }

  // =========================================================================
  // VII. SHEETJS EXPORT SYSTEM
  // =========================================================================

  function exportDataToExcel(type) {
    if (appState.processedRecords.length === 0) {
      alert("No verified records found to export. Please load your list and start processing first!");
      return;
    }

    let subset = [];
    let filename = 'furniture_leads_audit';

    if (type === 'high') {
      subset = appState.processedRecords.filter(r => r.decision === 'Keep - High Quality');
      filename = 'furniture_leads_high_quality';
    } else if (type === 'medium') {
      subset = appState.processedRecords.filter(r => r.decision === 'Keep - Medium Quality');
      filename = 'furniture_leads_medium_quality';
    } else if (type === 'review') {
      subset = appState.processedRecords.filter(r => r.decision === 'Manual Review');
      filename = 'furniture_leads_manual_review';
    } else if (type === 'rejected') {
      subset = appState.processedRecords.filter(r => r.decision === 'Reject');
      filename = 'furniture_leads_rejected';
    } else {
      subset = appState.processedRecords;
    }

    // Format fields for cleaner sheets
    const rows = subset.map(r => ({
      'Original Email': r.originalEmail,
      'Cleaned Email': r.cleanedEmail,
      'Domain Name': r.domain,
      'Final Decision': r.decision,
      'Relevance Score': r.score,
      'MX DNS Status': r.mxStatus,
      'Website Active': r.webStatus,
      'Detected Country': r.country,
      'Business Category': r.category,
      'Competitor Signal': r.indianSignal,
      'Reason For Decision': r.reason,
      'Keywords Found': r.keywords,
      'Website URL Checked': r.urlChecked,
      'Notes': r.notes
    }));

    try {
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Leads Register');
      
      // Save file
      XLSX.writeFile(workbook, `${filename}_${new Date().toISOString().slice(0,10)}.xlsx`);
      logConsole(`Exported Excel database file: ${filename}.xlsx`, 'ok');
    } catch (e) {
      logConsole(`Excel Export Failed: ${e.message}`, 'err');
    }
  }

  // =========================================================================
  // VIII. UI CONTROLLER & EVENT BINDINGS
  // =========================================================================

  function setupDemoData() {
    logConsole('Injecting pre-populated international and competitor emails for testing...', 'sys');
    
    // Sample test dataset containing various categories
    const demoRows = [
      ['Email', 'Name', 'Company', 'Website', 'Country'],
      ['sourcing@restorationhardware.com', 'Rh Buyer', 'RH Sourcing', 'rh.com', 'United States'],
      ['buying@boconcept.dk', 'Bo Sourcing', 'BoConcept', 'boconcept.com', 'Denmark'],
      ['info@jaipurfurniture.in', 'Competitor', 'Jaipur Furnitures', 'jaipurfurniture.in', 'India'],
      ['johndoe@gmail.com', 'John', 'Personal Account', '', 'United States'],
      ['purchasing@ikea.com', 'Ikea Buyer', 'IKEA', 'ikea.com', 'Sweden'],
      ['contact@jodhpurcrafts.com', 'Jodhpur Exporter', 'Jodhpur Crafts Exporters', 'jodhpurcrafts.com', 'India'],
      ['hotelpurchasing@hilton.com', 'Hilton Procurement', 'Hilton Group', 'hilton.com', 'United States'],
      ['sourcing@moradabadmetal.com', 'Competitor', 'Moradabad Metal Exporters', 'moradabadmetal.com', 'India'],
      ['office@westelm.com', 'West Elm Sourcing', 'West Elm Store', 'westelm.com', 'United States'],
      ['admin@furnitureimporters.org', 'Association', 'Importers Association', 'furnitureimporters.org', 'Canada'],
      ['info@teakgardenoutdoors.co.uk', 'Teak Outdoor', 'Teak Outdoor Living', 'teakgardenoutdoors.co.uk', 'United Kingdom'],
      ['sales@jodhpurart.com', 'Jodhpur competitor', 'Jodhpur Art Emporium', 'jodhpurart.com', 'India'],
      ['buyer@harrods.com', 'Harrods Home', 'Harrods Department Store', 'harrods.com', 'United Kingdom'],
      ['purchases@marriotthotels.com', 'Marriott Sourcing', 'Marriott Hotels Group', 'marriott.com', 'United States'],
      ['architecture@interiorstudio.de', 'Studio Arch', 'Deutsches Interior Design', 'interiorstudio.de', 'Germany'],
      ['sourcing@mumbaicrafts.co.in', 'Competitor', 'Mumbai Crafts Exporters', 'mumbaicrafts.co.in', 'India'],
      ['mjvogd@vesta.nl', 'Vesta Lead', 'Vesta Woonforum', 'vesta.nl', 'Netherlands'],
      ['jean-claude.richard@imelavi.fr', 'Jean Claude', 'Personal Forwarder', 'imelavi.fr', 'France'],
      ['olgal@instagram.com', 'Olga', 'Social Account', 'instagram.com', 'United States'],
      ['takerman@officemakers.com', 'Office Maker Lead', 'Office Makers', 'officemakers.com', 'United States'],
      ['dougiemillward@googlemail.com', 'Dougie Millward', 'Personal Account', 'googlemail.com', 'United Kingdom'],
      ['yapalak@hettich.com', 'Hettich Partner', 'Hettich Hardware', 'hettich.com', 'Germany'],
      ['jameskim@myfbs.org', 'James Kim', 'FBS Association', 'myfbs.org', 'United States'],
      ['abedalqader@freelancer.com', 'Abed Alqader', 'Freelancer Portal', 'freelancer.com', 'Australia'],
      ['info@flokk.com', 'Flokk Admin', 'Flokk Group', 'flokk.com', 'Norway'],
      ['eddie@casualfurnitureworld.com', 'Casual Furniture', 'Casual Furniture World', 'casualfurnitureworld.com', 'United States'],
      ['rogier@oosterbaan-living.nl', 'Oosterbaan', 'Oosterbaan Living', 'oosterbaan-living.nl', 'Netherlands'],
      ['info@cps-interieurs.nl', 'CPS Admin', 'CPS Interieurs', 'cps-interieurs.nl', 'Netherlands'],
      ['julie@furniturevillage.co.uk', 'Julie Village', 'Furniture Village', 'furniturevillage.co.uk', 'United Kingdom'],
      ['getawayfurniture@aol.com', 'Getaway Furniture', 'Getaway Furniture Store', '', 'United States'],
      ['plattefurniture@gmail.com', 'Platte Furniture', 'Platte Furniture Store', '', 'United States'],
      ['flippinfurniture4you@gmail.com', 'Flippin Furniture', 'Flippin Furniture Fashions', '', 'United States'],
      ['christiansenfurniture@gmail.com', 'Christiansen Furniture', 'Christiansen Furniture Store', '', 'United States']
    ];

    processRawRows(demoRows);
  }

  function bindEvents() {
    // Navigation Tabs Toggle
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        
        tab.classList.add('active');
        const targetId = tab.getAttribute('data-tab');
        document.getElementById(targetId).classList.add('active');
      });
    });

    // File selection clicks
    document.getElementById('btn-select-file').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFileSelected(e.target.files[0]);
      }
    });

    // Drag-and-drop triggers
    const dropZone = document.getElementById('drop-zone');
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFileSelected(e.dataTransfer.files[0]);
      }
    });

    // Custom Mapping panel controls
    document.getElementById('btn-cancel-mapping').addEventListener('click', () => {
      document.getElementById('mapping-panel').style.display = 'none';
      document.getElementById('upload-panel').style.display = 'block';
      document.getElementById('file-input').value = '';
    });

    document.getElementById('btn-start-process').addEventListener('click', () => {
      startQueueProcessing();
    });

    // Queue scanning controls
    document.getElementById('btn-stop-scan').addEventListener('click', () => {
      appState.abortScan = true;
      document.getElementById('btn-stop-scan').disabled = true;
      logConsole('Stopping scan queue. Completing currently running checks...', 'warn');
    });

    // Settings adjustments UI syncs
    const sliderMinScore = document.getElementById('set-min-keep-score');
    sliderMinScore.addEventListener('input', (e) => {
      document.getElementById('set-min-score-val').innerText = e.target.value;
    });

    const sliderConcurrency = document.getElementById('set-concurrency');
    sliderConcurrency.addEventListener('input', (e) => {
      document.getElementById('set-concurrency-val').innerText = e.target.value;
    });

    // Save configurations
    document.getElementById('btn-save-settings').addEventListener('click', () => {
      appSettings.rejectPersonal = document.getElementById('set-reject-personal').checked;
      appSettings.rejectOrg = document.getElementById('set-reject-org').checked;
      appSettings.rejectGov = document.getElementById('set-reject-gov').checked;
      appSettings.minKeepScore = parseInt(sliderMinScore.value);
      
      appSettings.incDecor = document.getElementById('set-inc-decor').checked;
      appSettings.incDesigners = document.getElementById('set-inc-designers').checked;
      appSettings.incHotels = document.getElementById('set-inc-hotels').checked;
      appSettings.incArchitecture = document.getElementById('set-inc-architecture').checked;
      
      appSettings.concurrency = parseInt(sliderConcurrency.value);
      
      appSettings.useGemini = document.getElementById('set-use-gemini').checked;
      appSettings.geminiKey = document.getElementById('set-gemini-key').value;
      appSettings.useSearch = document.getElementById('set-use-search').checked;
      appSettings.searchKey = document.getElementById('set-search-key').value;
      appSettings.corsProxy = document.getElementById('set-cors-proxy').value;

      saveSettings();
      alert('Application configuration saved successfully!');
    });

    // Search and filters on table database view
    document.getElementById('search-input').addEventListener('input', () => {
      renderFullSpreadsheet();
    });

    document.getElementById('filter-decision').addEventListener('change', () => {
      renderFullSpreadsheet();
    });

    document.getElementById('filter-status').addEventListener('change', () => {
      renderFullSpreadsheet();
    });

    // Exports downloads
    document.getElementById('btn-export-high').addEventListener('click', () => exportDataToExcel('high'));
    document.getElementById('btn-export-medium').addEventListener('click', () => exportDataToExcel('medium'));
    document.getElementById('btn-export-review').addEventListener('click', () => exportDataToExcel('review'));
    document.getElementById('btn-export-rejected').addEventListener('click', () => exportDataToExcel('rejected'));
    document.getElementById('btn-export-all').addEventListener('click', () => exportDataToExcel('all'));
  }

  function syncSettingsToUI() {
    document.getElementById('set-reject-personal').checked = appSettings.rejectPersonal;
    document.getElementById('set-reject-org').checked = appSettings.rejectOrg;
    document.getElementById('set-reject-gov').checked = appSettings.rejectGov;
    
    document.getElementById('set-min-keep-score').value = appSettings.minKeepScore;
    document.getElementById('set-min-score-val').innerText = appSettings.minKeepScore;
    
    document.getElementById('set-inc-decor').checked = appSettings.incDecor;
    document.getElementById('set-inc-designers').checked = appSettings.incDesigners;
    document.getElementById('set-inc-hotels').checked = appSettings.incHotels;
    document.getElementById('set-inc-architecture').checked = appSettings.incArchitecture;
    
    document.getElementById('set-concurrency').value = appSettings.concurrency;
    document.getElementById('set-concurrency-val').innerText = appSettings.concurrency;

    document.getElementById('set-use-gemini').checked = appSettings.useGemini;
    document.getElementById('set-gemini-key').value = appSettings.geminiKey;
    document.getElementById('set-use-search').checked = appSettings.useSearch;
    document.getElementById('set-search-key').value = appSettings.searchKey;
    document.getElementById('set-cors-proxy').value = appSettings.corsProxy;
  }

  // Application initialization entry
  function init() {
    try {
      loadSettings();
      bindEvents();
      syncSettingsToUI();
      updateDashboard();
      
      // Add testing cue directly to Upload container
      const zone = document.getElementById('drop-zone');
      if (zone) {
        const demoLnk = document.createElement('p');
        demoLnk.style.fontSize = '0.75rem';
        demoLnk.style.color = 'var(--info)';
        demoLnk.style.marginTop = '1rem';
        demoLnk.style.textDecoration = 'underline';
        demoLnk.innerHTML = 'Or click here to load 15 demo emails (with Indian, competitor, and global buyers) to run engine validation.';
        demoLnk.style.cursor = 'pointer';
        demoLnk.addEventListener('click', (e) => {
          e.stopPropagation(); // prevent triggering parent file picker
          setupDemoData();
        });
        zone.appendChild(demoLnk);
      }
    } catch (error) {
      alert("Initialization Error: " + error.message + "\nStack: " + error.stack);
      console.error("Initialization Error:", error);
    }
  }

  // Window load binding with fallback for already-loaded document
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
