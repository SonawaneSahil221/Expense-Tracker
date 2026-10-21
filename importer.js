/* ============================================================
   ExpenseIQ — UPI Statement Import
   PDFs are parsed entirely in the browser (PDF.js + rule-based
   categorisation). No AI model or third party ever sees the file.
   ============================================================ */

(function (root) {
  'use strict';

  // ════════════════════════════════════════════════════════════
  //  Parsing core (pure — no DOM; also runs under Node for tests)
  // ════════════════════════════════════════════════════════════

  const SOURCES = {
    bhim:    { label: 'BHIM UPI' },
    gpay:    { label: 'Google Pay' },
    phonepe: { label: 'PhonePe' },
    paytm:   { label: 'Paytm' },
  };

  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const BASE_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Entertainment', 'Health', 'Utilities', 'Education', 'Other'];
  const EXTRA_CATEGORIES = ['Groceries', 'Rent', 'Bills', 'Transfers'];

  // Order matters: the first rule that matches wins.
  const CATEGORY_RULES = [
    { cat: 'Bills', words: ['CRED', 'CREDIT CARD', 'CARD PAYMENT', 'BILLDESK', 'BILL', 'BILLS', 'EMI', 'LOAN', 'INSURANCE', 'LIC', 'BBPS', 'POLICYBAZAAR'] },
    { cat: 'Rent', words: ['PG', 'RENT', 'HOSTEL', 'ROOMS', 'FLAT', 'SOCIETY', 'MAINTENANCE', 'PAYING GUEST', 'LODGE', 'NESTAWAY', 'NOBROKER'] },
    { cat: 'Groceries', words: ['DMART', 'D MART', 'SUPERMARKET', 'HYPERMARKET', 'KIRANA', 'GROCERY', 'GROCERIES', 'PROVISION', 'PROVISIONS', 'BIGBASKET', 'BLINKIT', 'ZEPTO', 'INSTAMART', 'JIOMART', 'VEGETABLE', 'VEGETABLES', 'FRUITS', 'DAIRY', 'MILK'] },
    { cat: 'Food', words: ['SWEET', 'SWEETS', 'CHINESE', 'RESTAURANT', 'HOTEL', 'CAFE', 'CAFFE', 'COFFEE', 'TEA', 'CHAI', 'BAKERY', 'BAKERS', 'DHABA', 'BIRYANI', 'PIZZA', 'BURGER', 'KITCHEN', 'FOOD', 'FOODS', 'MESS', 'CANTEEN', 'JUICE', 'KULFI', 'ICE CREAM', 'WAFFLES', 'SAMOSA', 'VADA', 'VADAPAV', 'MISAL', 'BHEL', 'LASSI', 'MCDONALDS', 'DOMINOS', 'KFC', 'SUBWAY', 'SWIGGY', 'ZOMATO', 'BARBEQUE', 'DINING', 'SNACKS', 'VEG', 'NONVEG', 'BHOJANALAY', 'TIFFIN', 'PANIPURI', 'MOMOS', 'SHAWARMA', 'FAMILY RESTAURANT'] },
    { cat: 'Transport', words: ['UBER', 'OLA', 'RAPIDO', 'PARIVAHAN', 'PMPML', 'BEST', 'BUS', 'METRO', 'RAILWAY', 'RAILWAYS', 'IRCTC', 'TAXI', 'CAB', 'CABS', 'PETROL', 'PETROLEUM', 'FUEL', 'HPCL', 'BPCL', 'IOCL', 'INDIAN OIL', 'FASTAG', 'PARKING', 'REDBUS', 'TRAVELS', 'NAMMA YATRI', 'AUTO'] },
    { cat: 'Health', words: ['PHARMACY', 'PHARMA', 'MEDICAL', 'MEDICALS', 'MEDICO', 'CHEMIST', 'CHEMISTS', 'HOSPITAL', 'CLINIC', 'DOCTOR', 'DIAGNOSTIC', 'DIAGNOSTICS', 'PATHOLOGY', 'APOLLO', 'MEDPLUS', 'NETMEDS', 'PHARMEASY', 'TATA 1MG', 'DENTAL', 'HEALTH CARE', 'GYM', 'FITNESS'] },
    { cat: 'Utilities', words: ['ELECTRICITY', 'MSEDCL', 'MAHAVITARAN', 'WATER', 'GAS', 'BROADBAND', 'WIFI', 'AIRTEL', 'JIO', 'VODAFONE', 'BSNL', 'RECHARGE', 'DTH', 'TATA PLAY', 'MAHANAGAR GAS', 'POSTPAID', 'PREPAID'] },
    { cat: 'Entertainment', words: ['NETFLIX', 'HOTSTAR', 'PRIME VIDEO', 'SPOTIFY', 'BOOKMYSHOW', 'PVR', 'INOX', 'CINEMA', 'CINEMAS', 'MOVIE', 'MOVIES', 'GAMING', 'GAMES', 'STEAM', 'PLAYSTATION', 'YOUTUBE', 'SONYLIV', 'ZEE5'] },
    { cat: 'Education', words: ['SCHOOL', 'COLLEGE', 'UNIVERSITY', 'ACADEMY', 'CLASSES', 'TUITION', 'COACHING', 'INSTITUTE', 'BOOK', 'BOOKS', 'STATIONERY', 'XEROX', 'UDEMY', 'COURSERA', 'EXAM', 'FEES'] },
    { cat: 'Shopping', words: ['MEESHO', 'AMAZON', 'FLIPKART', 'MYNTRA', 'AJIO', 'NYKAA', 'STORE', 'STORES', 'MALL', 'SHOP', 'SHOPPE', 'FASHION', 'GARMENTS', 'CLOTHING', 'FOOTWEAR', 'ELECTRONICS', 'GIFT', 'GIFTS', 'DECATHLON', 'RELIANCE TRENDS', 'LIFESTYLE', 'MART'] },
  ];

  const VPA_HINTS = [
    { cat: 'Bills', re: /cardp|cred\.club|billdesk|bbps|\.bill@|creditcard/i },
    { cat: 'Shopping', re: /meesho|amazon|flipkart|myntra/i },
    { cat: 'Food', re: /swiggy|zomato/i },
    { cat: 'Transport', re: /uber|olacabs|rapido|irctc/i },
  ];

  // Paytm assigns its own tags; map the ones we recognise, and turn
  // any other meaningful tag into a newly discovered category.
  const PAYTM_TAG_MAP = {
    'shopping': 'Shopping', 'food': 'Food', 'food & drinks': 'Food', 'food and drinks': 'Food',
    'restaurants': 'Food', 'dining': 'Food', 'groceries': 'Groceries', 'grocery': 'Groceries',
    'travel': 'Transport', 'transport': 'Transport', 'fuel': 'Transport', 'commute': 'Transport',
    'bill payments': 'Bills', 'bills': 'Bills', 'credit card': 'Bills', 'loan': 'Bills', 'emi': 'Bills',
    'recharge': 'Utilities', 'recharges': 'Utilities', 'utilities': 'Utilities',
    'entertainment': 'Entertainment', 'movies': 'Entertainment',
    'health': 'Health', 'medical': 'Health', 'medicines': 'Health',
    'education': 'Education', 'rent': 'Rent', 'house rent': 'Rent',
    'money transfer': 'Transfers', 'transfer': 'Transfers', 'family': 'Transfers',
  };
  const GENERIC_TAGS = new Set(['miscellaneous', 'misc', 'others', 'other', 'money received', 'payment', 'payments', 'upi']);

  const NUM = (s) => parseFloat(String(s).replace(/,/g, ''));
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoDate = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

  function monthIndex(token) {
    if (!token) return -1;
    const k = token.slice(0, 3).toLowerCase();
    return k in MONTHS ? MONTHS[k] : -1;
  }

  function validDate(y, m, d) {
    if (m < 0 || m > 11 || d < 1 || d > 31 || y < 2000 || y > 2100) return false;
    const dt = new Date(Date.UTC(y, m, d));
    return dt.getUTCMonth() === m && dt.getUTCDate() === d;
  }

  // Infer a missing year (Paytm prints "26 Sep") from the statement period.
  function inferYear(m, d, period) {
    const today = new Date();
    if (period && period.start && period.end) {
      const endYear = +period.end.slice(0, 4);
      for (const y of [endYear, endYear - 1, +period.start.slice(0, 4)]) {
        if (!validDate(y, m, d)) continue;
        const iso = isoDate(y, m, d);
        if (iso >= shiftISO(period.start, -1) && iso <= shiftISO(period.end, 1)) return y;
      }
      return endYear;
    }
    const y = today.getFullYear();
    return isoDate(y, m, d) > isoDate(y, today.getMonth(), today.getDate()) ? y - 1 : y;
  }

  function shiftISO(iso, days) {
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days));
    return dt.toISOString().slice(0, 10);
  }

  function parseLooseDate(text, period) {
    if (!text) return null;
    let m;
    if ((m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/))) {
      const mi = monthIndex(m[2]);
      if (mi >= 0 && validDate(+m[3], mi, +m[1])) return isoDate(+m[3], mi, +m[1]);
    }
    if ((m = text.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/))) {
      const mi = monthIndex(m[1]);
      if (mi >= 0 && validDate(+m[3], mi, +m[2])) return isoDate(+m[3], mi, +m[2]);
    }
    if ((m = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/))) {
      if (validDate(+m[3], +m[2] - 1, +m[1])) return isoDate(+m[3], +m[2] - 1, +m[1]);
    }
    if ((m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\b/))) {
      const mi = monthIndex(m[2]);
      if (mi >= 0) {
        const y = inferYear(mi, +m[1], period);
        if (validDate(y, mi, +m[1])) return isoDate(y, mi, +m[1]);
      }
    }
    return null;
  }

  function parseTime(text) {
    const m = (text || '').match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i);
    if (!m) return '';
    let h = +m[1];
    const ap = (m[3] || '').toLowerCase().replace(/\./g, '');
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    return `${pad2(h)}:${m[2]}`;
  }

  function parsePeriod(text) {
    let m;
    // Paytm: 20 SEP'26 - 19 OCT'26
    if ((m = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})'(\d{2})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,9})'(\d{2})/))) {
      return mkPeriod(2000 + +m[3], m[2], +m[1], 2000 + +m[6], m[5], +m[4]);
    }
    // BHIM: from 12/09/2026 to 12/10/2026
    if ((m = text.match(/from\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+to\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i))) {
      return {
        start: validDate(+m[3], +m[2] - 1, +m[1]) ? isoDate(+m[3], +m[2] - 1, +m[1]) : null,
        end:   validDate(+m[6], +m[5] - 1, +m[4]) ? isoDate(+m[6], +m[5] - 1, +m[4]) : null,
      };
    }
    // PhonePe / GPay: 20 Sept, 2026 - 20 Oct, 2026
    if ((m = text.match(/(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})/))) {
      return mkPeriod(+m[3], m[2], +m[1], +m[6], m[5], +m[4]);
    }
    // Sep 20, 2026 - Oct 20, 2026
    if ((m = text.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\s*[-–]\s*([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/))) {
      return mkPeriod(+m[3], m[1], +m[2], +m[6], m[4], +m[5]);
    }
    return { start: null, end: null };
  }

  function mkPeriod(y1, mon1, d1, y2, mon2, d2) {
    const m1 = monthIndex(mon1), m2 = monthIndex(mon2);
    return {
      start: m1 >= 0 && validDate(y1, m1, d1) ? isoDate(y1, m1, d1) : null,
      end:   m2 >= 0 && validDate(y2, m2, d2) ? isoDate(y2, m2, d2) : null,
    };
  }

  // ── Text layout helpers ──────────────────────────────────────

  // Join items on one visual line, inserting a space only where there is a gap.
  function joinLine(items) {
    const sorted = items.slice().sort((a, b) => a.x - b.x);
    let out = '';
    let prevEnd = null;
    for (const it of sorted) {
      if (prevEnd !== null && it.x - prevEnd > 1) out += ' ';
      out += it.str;
      prevEnd = it.x + (it.w || 0);
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  function groupLines(items, tol = 2.5) {
    const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of sorted) {
      const line = lines.length ? lines[lines.length - 1] : null;
      if (line && Math.abs(line.y - it.y) <= tol) line.items.push(it);
      else lines.push({ y: it.y, items: [it] });
    }
    return lines.map(l => ({ y: l.y, text: joinLine(l.items) }));
  }

  function pageText(page) {
    return groupLines(page.items).map(l => l.text).join('\n');
  }

  function detectFormat(pages) {
    const text = pages.slice(0, 2).map(pageText).join('\n');
    if (/Paytm Statement for|Passbook Payments History/i.test(text)) return 'paytm';
    if (/Payment ID\s*\/\s*Reference Number/i.test(text) || (/Transaction History/i.test(text) && /DR\s*\/\s*CR/i.test(text))) return 'bhim';
    if (/phonepe/i.test(text) || (/Transaction Statement for/i.test(text) && /UTR No/i.test(text))) return 'phonepe';
    if (/Google Pay|UPI Transaction ID/i.test(text)) return 'gpay';
    return null;
  }

  // ── Columnar statements (Paytm, PhonePe, Google Pay) ─────────

  const HEADER_KEYS = [
    ['date', /^date\b/i],
    ['details', /^transaction details$/i],
    ['notes', /^notes/i],
    ['account', /^your account$/i],
    ['type', /^type$/i],
    ['amount', /^amount\b/i],
    ['status', /^status$/i],
  ];

  const FOOTER_RE = /^(page(\s+\d+\s+of\s+\d+)?|for any queries,?|contact us|this is (a|an) (system|automatically) generated.*|disclaimer.*)$/i;

  function findColumns(page) {
    const details = page.items.find(it => /^transaction details$/i.test(it.str.trim()));
    if (!details) return null;
    const cols = {};
    for (const it of page.items) {
      if (Math.abs(it.y - details.y) > 8) continue;
      const s = it.str.trim();
      for (const [key, re] of HEADER_KEYS) {
        if (re.test(s) && (cols[key] === undefined || it.x < cols[key])) cols[key] = it.x;
      }
    }
    if (cols.date === undefined || cols.amount === undefined) return null;
    const order = Object.entries(cols).sort((a, b) => a[1] - b[1]);
    return { headerY: details.y, order };
  }

  function columnOf(x, order) {
    let key = order[0][0];
    for (const [k, cx] of order) if (x >= cx - 6) key = k;
    return key;
  }

  function median(arr) {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  function parseColumnar(pages, period) {
    const rows = [];
    let layout = null;
    const anchorRe = /^(\d{1,2}\s+[A-Za-z]{3,9}\.?(,?\s+\d{4})?|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})$/;

    for (const page of pages) {
      const found = findColumns(page);
      if (found) layout = found;
      if (!layout) continue;
      const headerY = found ? found.headerY : Infinity;
      const dateMaxX = (layout.order.find(([k]) => k === 'details') || [null, 120])[1] - 6;

      const items = page.items.filter(it => it.y < headerY - 2 && !FOOTER_RE.test(it.str.trim()));
      const anchors = items
        .filter(it => it.x < dateMaxX && anchorRe.test(it.str.trim()))
        .sort((a, b) => b.y - a.y);
      if (!anchors.length) continue;

      const gaps = anchors.slice(1).map((a, i) => anchors[i].y - a.y);
      const rowLimit = (median(gaps) || 85) * 1.3;

      anchors.forEach((anchor, i) => {
        const top = anchor.y + 4;
        const bottom = i + 1 < anchors.length ? anchors[i + 1].y + 4 : anchor.y - rowLimit;
        const cells = {};
        const regionItems = items.filter(it => it.y <= top && it.y > bottom);
        const byCol = {};
        for (const it of regionItems) {
          const key = columnOf(it.x, layout.order);
          (byCol[key] = byCol[key] || []).push(it);
        }
        for (const [key, its] of Object.entries(byCol)) cells[key] = groupLines(its).map(l => l.text);
        rows.push(interpretColumnarRow(cells, period));
      });
    }
    return rows;
  }

  function interpretColumnarRow(cells, period) {
    const dateLines = cells.date || [];
    const dateText = dateLines.join(' ');
    const details = cells.details || [];
    const title = details[0] || '';
    const detailText = details.join('\n');
    const notesText = (cells.notes || []).join('\n');
    const amountText = (cells.amount || []).join(' ');
    const typeText = (cells.type || []).join(' ').toUpperCase();
    const statusText = (cells.status || []).join(' ').toUpperCase();

    const refMatch = detailText.match(/(?:UTR\s*No\.?|UPI\s*Ref(?:erence)?\s*(?:No|ID|Number)\.?|UPI\s*Transaction\s*ID|Bank\s*Ref(?:erence)?\s*No\.?)\s*:?\s*([0-9]{9,})/i);
    const vpaMatch = detailText.match(/UPI ID:?\s*(\S+@\S+)/i);
    const tagMatch = notesText.match(/#\s*([^\n#]+)/);
    const amtMatch = amountText.match(/([+\-−])?\s*(?:Rs\.?|₹|INR)?\s*([\d,]+(?:\.\d{1,2})?)/i);

    let direction = null;
    if (/\bDEBIT\b|\bDR\b/.test(typeText)) direction = 'debit';
    else if (/\bCREDIT\b|\bCR\b/.test(typeText)) direction = 'credit';
    else if (amtMatch && amtMatch[1]) direction = amtMatch[1] === '+' ? 'credit' : 'debit';
    else if (/^(paid|sent|money sent|transfer(red)? to)\b/i.test(title)) direction = 'debit';
    else if (/^received\b/i.test(title)) direction = 'credit';

    const tag = tagMatch ? tagMatch[1].trim() : '';
    if (/self[\s-]*transfer/i.test(title) || /self[\s-]*transfer/i.test(tag)) direction = 'self';

    let status = 'success';
    if (/FAIL|DECLINED|REVERSED|PENDING/.test(statusText) || /\b(failed|declined|reversed|pending)\b/i.test(detailText)) status = 'failed';

    return {
      date: parseLooseDate(dateText, period),
      time: parseTime(dateText),
      payee: title.replace(/^(paid\s+to|received\s+from|sent\s+to|money\s+sent\s+to|transfer(?:red)?\s+to)\s+/i, '').trim(),
      masked: false,
      vpa: vpaMatch ? vpaMatch[1] : '',
      tag,
      ref: refMatch ? refMatch[1] : '',
      amount: amtMatch ? NUM(amtMatch[2]) : NaN,
      direction,
      status,
    };
  }

  // ── BHIM (NPCI) single-line table ────────────────────────────

  const BHIM_ROW = /^(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+?)\s+(\S+)\s+(\S+@[^\s(]+(?:\([^)]*\))?)\s+(\S+@[^\s(]+(?:\([^)]*\))?)\s+(\d{6,})\s+(PAY|COLLECT)\s+([\d,]+(?:\.\d{1,2})?)\s+(DR|CR)\s+([A-Z]+)/i;

  function splitVpa(cell) {
    const m = cell.match(/^(\S+@[^\s(]+)(?:\(([^)]*)\))?$/);
    return m ? { vpa: m[1], name: (m[2] || '').trim() } : { vpa: cell, name: '' };
  }

  function parseBhim(pages, period) {
    const rows = [];
    for (const page of pages) {
      for (const line of groupLines(page.items)) {
        const m = line.text.match(BHIM_ROW);
        if (!m) continue;
        const sender = splitVpa(m[5]);
        const receiver = splitVpa(m[6]);
        const direction = m[10].toUpperCase() === 'DR' ? 'debit' : 'credit';
        const party = direction === 'debit' ? receiver : sender;
        const masked = /^x{3,}/i.test(party.name);
        rows.push({
          date: parseLooseDate(m[1], period),
          time: parseTime(m[2]),
          payee: masked ? party.name.replace(/^x+/i, '').trim() : party.name,
          masked,
          vpa: party.vpa,
          sender: sender.name,
          tag: '',
          ref: m[7],
          amount: NUM(m[9]),
          direction,
          status: m[11].toUpperCase() === 'SUCCESS' ? 'success' : 'failed',
        });
      }
    }
    return rows;
  }

  function findHolderName(pages, format, rows) {
    if (format === 'bhim') {
      const counts = {};
      rows.filter(r => r.direction === 'debit' && r.sender).forEach(r => { counts[r.sender] = (counts[r.sender] || 0) + 1; });
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      return best ? best[0] : '';
    }
    if (format === 'paytm' && pages[0]) {
      const top = pages[0].items.slice().sort((a, b) => b.y - a.y)[0];
      const s = top ? top.str.trim() : '';
      return /^[A-Za-z][A-Za-z .]{2,60}$/.test(s) ? s : '';
    }
    return '';
  }

  function parseStatement(pages, opts = {}) {
    const format = detectFormat(pages);
    const headText = pages.slice(0, 1).map(pageText).join('\n');
    const period = parsePeriod(headText);
    const parseAs = format || opts.source;
    const rows = parseAs === 'bhim' ? parseBhim(pages, period) : parseColumnar(pages, period);
    const holder = findHolderName(pages, parseAs, rows) || opts.fallbackHolder || '';
    return { format, period, holder, rows };
  }

  // ── Categorisation ───────────────────────────────────────────

  function tokens(s) {
    return (s || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  }

  function matchesWord(word, toks, upper) {
    if (word.includes(' ')) return upper.includes(word);
    return toks.some(t => t === word || (word.length >= 4 && t.startsWith(word) && t.length - word.length <= 2));
  }

  function surnameOf(holder) {
    const parts = tokens(holder);
    const last = parts[parts.length - 1] || '';
    return parts.length >= 2 && last.length >= 4 ? last : '';
  }

  function categorize(row, ctx = {}) {
    if (row.tag) {
      const key = row.tag.toLowerCase().trim();
      if (PAYTM_TAG_MAP[key]) return PAYTM_TAG_MAP[key];
      if (!GENERIC_TAGS.has(key) && /^[a-z][a-z &'-]{2,28}$/i.test(row.tag.trim())) {
        return titleCase(row.tag.trim());
      }
    }

    const surname = ctx.surname || '';
    const payeeUpper = (row.payee || '').toUpperCase().trim();
    if (surname) {
      if (row.masked) {
        const frag = payeeUpper.replace(/[^A-Z]/g, '');
        if (frag.length >= 3 && surname.endsWith(frag)) return 'Transfers';
      } else {
        const toks = tokens(payeeUpper);
        if (toks.length >= 2 && toks[toks.length - 1] === surname) return 'Transfers';
      }
    }

    for (const hint of VPA_HINTS) if (row.vpa && hint.re.test(row.vpa)) return hint.cat;

    const toks = tokens(payeeUpper);
    if (!row.masked) {
      for (const rule of CATEGORY_RULES) {
        if (rule.words.some(w => matchesWord(w, toks, payeeUpper))) return rule.cat;
      }
    } else {
      // Masked BHIM names only show the last few letters ("xxxxxxxxOTEL").
      const frag = payeeUpper.replace(/[^A-Z0-9 ]/g, '').trim();
      const fragToks = tokens(frag);
      const tail = frag.replace(/\s+/g, '');
      for (const rule of CATEGORY_RULES) {
        const hit = rule.words.some(w => {
          if (fragToks.length > 1 || frag.startsWith(' ')) return matchesWord(w, fragToks, frag);
          if (tail.length < 3) return false;
          if (w === tail) return true;
          return tail.length >= 4 && !w.includes(' ') && w.length > tail.length && w.endsWith(tail);
        });
        if (hit) return rule.cat;
      }
    }
    return 'Other';
  }

  const KEEP_UPPER = new Set(['npci', 'bhim', 'upi', 'hdfc', 'sbi', 'icici', 'lic', 'irctc', 'atm', 'neft', 'imps']);

  function titleCase(s) {
    const small = new Set(['of', 'and', 'the', 'to', 'for', 'in', 'at', 'on', 'by']);
    return s.toLowerCase().split(/(\s+)/).map((w, i) => {
      if (/^\s+$/.test(w) || !w) return w;
      if (KEEP_UPPER.has(w)) return w.toUpperCase();
      if (i > 0 && small.has(w)) return w;
      if (w.length <= 2 && /^[a-z]+$/.test(w) && !small.has(w)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join('');
  }

  function describe(row) {
    const payee = (row.payee || '').trim();
    const fallback = row.direction === 'credit' ? 'UPI money received' : 'UPI payment';
    if (row.masked) return payee ? `${fallback} (…${payee})` : fallback;
    if (!payee) return fallback;
    const pretty = payee === payee.toUpperCase() && /[A-Z]/.test(payee) ? titleCase(payee) : payee;
    return pretty.slice(0, 120);
  }

  // Splits parsed rows into expenses (debits) and income (credits); failed and self-transfers are dropped.
  function buildCandidates(parsed, ctx = {}) {
    const surname = surnameOf(parsed.holder) || surnameOf(ctx.fallbackHolder || '');
    const stats = { found: parsed.rows.length, failed: 0, self: 0, unreadable: 0, repeated: 0 };
    const seen = new Set();
    const debits = [];
    const credits = [];
    for (const row of parsed.rows) {
      if (row.status === 'failed') { stats.failed++; continue; }
      if (row.direction === 'self') { stats.self++; continue; }
      if ((row.direction !== 'debit' && row.direction !== 'credit') || !row.date || !(row.amount > 0)) {
        stats.unreadable++;
        continue;
      }
      const key = row.ref ? `upi:${row.ref}` : `row:${parsed.format}|${row.direction}|${row.date}|${row.time}|${row.amount}|${row.payee}`;
      if (seen.has(key)) { stats.repeated++; continue; }
      seen.add(key);
      const base = {
        key,
        date: row.date,
        time: row.time,
        amount: Math.round(row.amount * 100) / 100,
        desc: describe(row),
      };
      if (row.direction === 'debit') debits.push({ ...base, kind: 'expense', cat: categorize(row, { surname }) });
      else credits.push({ ...base, kind: 'income', cat: 'Income' });
    }
    return { debits, credits, stats };
  }

  const Core = {
    SOURCES, BASE_CATEGORIES, EXTRA_CATEGORIES,
    groupLines, detectFormat, parsePeriod, parseLooseDate, parseStatement,
    categorize, describe, buildCandidates, titleCase,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  root.UPIImportCore = Core;
  if (typeof document === 'undefined') return;

  // ════════════════════════════════════════════════════════════
  //  Browser UI (relies on globals from script.js)
  // ════════════════════════════════════════════════════════════

  const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
  const PDFJS_SRI = 'sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==';
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  let pdfjsPromise = null;

  function loadPdfJs() {
    if (root.pdfjsLib) return Promise.resolve(root.pdfjsLib);
    if (pdfjsPromise) return pdfjsPromise;
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${PDFJS_BASE}/pdf.min.js`;
      s.integrity = PDFJS_SRI;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => {
        root.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
        resolve(root.pdfjsLib);
      };
      s.onerror = () => {
        pdfjsPromise = null;
        reject(new Error('Could not load the PDF reader. Check your internet connection and try again.'));
      };
      document.head.appendChild(s);
    });
    return pdfjsPromise;
  }

  async function sha256Hex(data) {
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function extractPages(bytes, password) {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({
      data: bytes.slice(),
      password: password || undefined,
      isEvalSupported: false,
      disableFontFace: true,
    });
    const doc = await task.promise;
    try {
      const pages = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const tc = await (await doc.getPage(p)).getTextContent();
        pages.push({
          items: tc.items
            .filter(i => i.str && i.str.trim())
            .map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width })),
        });
      }
      return pages;
    } finally {
      doc.destroy();
    }
  }

  const sourceLabel = (s) => (SOURCES[s] ? SOURCES[s].label : 'UPI');
  const esc = (v) => escHtml(String(v ?? ''));
  const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Keep only the last 4 digits of long numbers (e.g. phone numbers) in file names.
  function safeFileName(name) {
    return (name || 'statement.pdf')
      .replace(/\d{6,}/g, m => 'x'.repeat(m.length - 4) + m.slice(-4))
      .slice(0, 200);
  }

  const els = {
    openBtn:     document.getElementById('btn-import'),
    modal:       document.getElementById('import-modal'),
    closeBtn:    document.getElementById('import-modal-close'),
    title:       document.getElementById('import-modal-title'),
    subtitle:    document.getElementById('import-subtitle'),
    fileInput:   document.getElementById('import-file-input'),
    workingText: document.getElementById('import-working-text'),
    pwForm:      document.getElementById('import-password-form'),
    pwInput:     document.getElementById('import-password-input'),
    pwError:     document.getElementById('import-password-error'),
    msgIcon:     document.getElementById('import-message-icon'),
    msgTitle:    document.getElementById('import-message-title'),
    msgText:     document.getElementById('import-message-text'),
    msgPrimary:  document.getElementById('import-message-primary'),
    summary:     document.getElementById('import-summary'),
    tbody:       document.getElementById('import-tbody'),
    selectAll:   document.getElementById('import-select-all'),
    footerText:  document.getElementById('import-footer-text'),
    confirmBtn:  document.getElementById('import-confirm-btn'),
  };
  if (!els.modal || !els.openBtn) return;

  const state = {};
  let msgPrimaryAction = null;

  function resetState() {
    Object.assign(state, {
      source: null, fileName: '', bytes: null, fileHash: null,
      parsed: null, stats: null, rows: [], busy: false,
    });
  }

  function showStep(step) {
    els.modal.querySelectorAll('.import-step').forEach(s => { s.hidden = s.dataset.step !== step; });
    els.modal.querySelector('.import-card').classList.toggle('import-card--wide', step === 'review');
  }

  function setHeader(title, subtitle) {
    els.title.textContent = title;
    els.subtitle.textContent = subtitle;
  }

  function openImportModal() {
    if (typeof closeExportDropdown === 'function') closeExportDropdown();
    resetState();
    setHeader('Import UPI Statement', 'Choose the app your statement PDF was downloaded from.');
    showStep('choose');
    els.modal.classList.add('open');
  }

  function closeImportModal() {
    if (state.busy) return;
    els.modal.classList.remove('open');
    resetState();
  }

  function showMessage({ tone = 'info', title, text, primary = null }) {
    const icons = { info: 'fa-circle-info', warn: 'fa-triangle-exclamation', error: 'fa-circle-xmark', done: 'fa-circle-check' };
    els.msgIcon.className = `import-message-icon import-message-icon--${tone}`;
    els.msgIcon.innerHTML = `<i class="fa-solid ${icons[tone] || icons.info}"></i>`;
    els.msgTitle.textContent = title;
    els.msgText.textContent = text;
    msgPrimaryAction = primary ? primary.action : null;
    els.msgPrimary.hidden = !primary;
    if (primary) els.msgPrimary.textContent = primary.label;
    showStep('message');
  }

  function chooseSource(source) {
    state.source = source;
    els.fileInput.value = '';
    els.fileInput.click();
  }

  async function handleFile(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
      showMessage({ tone: 'error', title: 'Not a PDF', text: 'Please choose the statement PDF downloaded from the app.' });
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showMessage({ tone: 'error', title: 'File too large', text: 'Statement PDFs are usually under 5 MB. Please choose a smaller file.' });
      return;
    }
    state.fileName = safeFileName(file.name);
    els.workingText.textContent = `Reading your ${sourceLabel(state.source)} statement…`;
    showStep('working');
    try {
      state.bytes = new Uint8Array(await file.arrayBuffer());
      state.fileHash = await sha256Hex(state.bytes);
      await readAndParse('');
    } catch (err) {
      console.error(err);
      showMessage({ tone: 'error', title: 'Could not read this PDF', text: err.message || 'The file may be damaged.' });
    }
  }

  async function readAndParse(password) {
    let pages;
    try {
      pages = await extractPages(state.bytes, password);
    } catch (err) {
      if (err && err.name === 'PasswordException') {
        els.pwInput.value = '';
        els.pwError.hidden = !password;
        setHeader('Password-protected PDF', 'Enter the password to unlock this statement.');
        showStep('password');
        setTimeout(() => els.pwInput.focus(), 50);
        return;
      }
      throw err;
    }

    const fallbackHolder = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.full_name : '';
    state.parsed = Core.parseStatement(pages, { source: state.source, fallbackHolder });
    const detected = state.parsed.format;

    if (!detected && !state.parsed.rows.length) {
      showMessage({
        tone: 'error',
        title: 'No transactions found',
        text: `This doesn't look like a ${sourceLabel(state.source)} UPI statement, or it is a scanned image. Download the statement PDF from the app and try again.`,
      });
      return;
    }
    if (detected && detected !== state.source) {
      showMessage({
        tone: 'warn',
        title: `This looks like a ${sourceLabel(detected)} statement`,
        text: `You picked ${sourceLabel(state.source)}, but this file appears to be from ${sourceLabel(detected)}.`,
        primary: {
          label: `Import as ${sourceLabel(detected)}`,
          action: () => { state.source = detected; prepareReview(); },
        },
      });
      return;
    }
    await prepareReview();
  }

  async function prepareReview() {
    els.workingText.textContent = 'Checking for duplicates…';
    showStep('working');
    try {
      const fallbackHolder = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.full_name : '';
      const { debits, credits, stats } = Core.buildCandidates(state.parsed, { fallbackHolder });
      state.stats = stats;

      if (!stats.found) {
        showMessage({ tone: 'error', title: 'No transactions found', text: 'The statement was read, but no transactions could be recognised in it.' });
        return;
      }

      const candidates = [...debits, ...credits];
      for (const c of candidates) c.refHash = await sha256Hex(c.key);

      const check = await apiPost('/imports/check', {
        source: state.source,
        file_hash: state.fileHash,
        file_name: state.fileName,
        ref_hashes: candidates.map(c => c.refHash),
      });

      // Your current lists are the source of truth. A row is "already in your list" when
      // its UPI reference is linked to a live entry, or (fallback, any source or manual)
      // when an unclaimed entry has the same date and amount.
      await Promise.all([loadExpenses(), loadIncome()]);
      const pool = { expense: expenses, income: incomes };
      const claimed = new Set(Object.values(check.linked || {}));
      const rows = candidates.map(c => {
        const row = { ...c, status: 'new', include: true, locked: false, note: '' };
        if (check.linked && check.linked[c.refHash]) {
          Object.assign(row, { status: 'imported', include: false, locked: true });
        }
        return row;
      });
      for (const row of rows) {
        if (row.status !== 'new') continue;
        const twin = pool[row.kind].find(e => !claimed.has(e.id) && e.date === row.date && Math.abs(e.amount - row.amount) < 0.005);
        if (twin) {
          claimed.add(twin.id);
          Object.assign(row, { status: 'possible', include: false, note: twin.desc });
        }
      }

      state.reupload = check.already_imported || null;
      if (state.reupload && !rows.some(r => r.status === 'new' || r.status === 'possible')) {
        const info = state.reupload;
        showMessage({
          tone: 'info',
          title: 'Statement already imported',
          text: `This exact file was imported on ${formatDateTime(info.created_at)} (${info.imported_count} entr${info.imported_count === 1 ? 'y' : 'ies'} added). Transactions are never entered twice.`,
        });
        return;
      }

      // Expenses first, then income; each newest first.
      state.rows = rows.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'expense' ? -1 : 1) || b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
      renderReview();
    } catch (err) {
      console.error(err);
      showMessage({ tone: 'error', title: 'Something went wrong', text: err.message || 'Please try again.' });
    }
  }

  function categoryChoices() {
    const set = new Set([...BASE_CATEGORIES, ...EXTRA_CATEGORIES]);
    expenses.forEach(e => set.add(e.cat));
    state.rows.forEach(r => set.add(r.cat));
    set.delete('Other');
    return [...set].sort((a, b) => a.localeCompare(b)).concat('Other');
  }

  const STATUS_BADGE = {
    new:      ['import-status--new', 'New'],
    imported: ['import-status--imported', 'Already in list'],
    possible: ['import-status--possible', 'Likely duplicate'],
  };

  function renderReview() {
    const { stats, parsed } = state;
    const rows = state.rows;
    const period = parsed.period.start && parsed.period.end
      ? `${formatDate(parsed.period.start)} – ${formatDate(parsed.period.end)}`
      : 'Statement period not found';
    setHeader(`Review ${sourceLabel(state.source)} transactions`, `${state.fileName} · ${period}`);

    const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
    const newOf = (kind) => rows.filter(r => r.kind === kind && r.status === 'new').length;
    const knownCats = new Set([...BASE_CATEGORIES, ...expenses.map(e => e.cat)]);
    const discovered = [...new Set(rows.filter(r => r.kind === 'expense' && r.status !== 'imported').map(r => r.cat))].filter(c => !knownCats.has(c));

    const chip = (cls, icon, text) => `<span class="import-chip ${cls}"><i class="fa-solid ${icon}"></i>${text}</span>`;
    const chips = [
      chip('import-chip--total', 'fa-list-check', `<strong>${stats.found}</strong> transactions found`),
      chip('import-chip--new', 'fa-arrow-up', `<strong>${newOf('expense')}</strong> new expenses`),
      chip('import-chip--income', 'fa-arrow-down', `<strong>${newOf('income')}</strong> new income`),
    ];
    if (counts.imported) chips.push(chip('import-chip--muted', 'fa-clone', `<strong>${counts.imported}</strong> already in your list`));
    if (counts.possible) chips.push(chip('import-chip--warn', 'fa-triangle-exclamation', `<strong>${counts.possible}</strong> likely duplicates`));
    if (stats.self) chips.push(chip('import-chip--muted', 'fa-right-left', `<strong>${stats.self}</strong> self transfers`));
    if (stats.failed) chips.push(chip('import-chip--muted', 'fa-ban', `<strong>${stats.failed}</strong> failed`));
    if (stats.unreadable) chips.push(chip('import-chip--warn', 'fa-circle-question', `<strong>${stats.unreadable}</strong> unreadable`));

    els.summary.innerHTML = `
      <div class="import-chips">${chips.join('')}</div>
      ${state.reupload ? `<p class="import-note"><i class="fa-solid fa-circle-info"></i><span>You uploaded this file on ${esc(formatDateTime(state.reupload.created_at))}. Only transactions missing from your list are offered again.</span></p>` : ''}
      ${discovered.length ? `<p class="import-note"><i class="fa-solid fa-wand-magic-sparkles"></i><span>New categories detected: ${discovered.map(c => `<strong>${esc(c)}</strong>`).join(', ')}</span></p>` : ''}
      ${counts.possible ? `<p class="import-note import-note--warn"><i class="fa-solid fa-triangle-exclamation"></i><span>“Likely duplicate” rows have the same date and amount as an entry already in your list (from any app, or added manually). They are unticked — tick one only if it is a different payment.</span></p>` : ''}`;

    const cats = categoryChoices();
    const section = (label, icon) => `<tr class="import-section-row"><td colspan="6"><i class="fa-solid ${icon}"></i> ${label}</td></tr>`;
    let lastKind = null;
    els.tbody.innerHTML = rows.length ? rows.map((r, i) => {
      const [cls, label] = STATUS_BADGE[r.status];
      const isIncome = r.kind === 'income';
      let header = '';
      if (r.kind !== lastKind) {
        header = isIncome
          ? section('Money received → Income list', 'fa-arrow-down')
          : section('Payments → Expenses', 'fa-arrow-up');
        lastKind = r.kind;
      }
      const catCell = isIncome
        ? '<span class="category-pill cat-income">💰 Income</span>'
        : `<select class="filter-select import-cat" ${r.locked ? 'disabled' : ''} aria-label="Category">${cats.map(c => `<option value="${esc(c)}"${c === r.cat ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
      return `${header}<tr class="${r.locked ? 'import-row--locked' : ''}${r.include ? '' : ' import-row--off'}" data-index="${i}">
        <td class="col-checkbox"><input type="checkbox" class="expense-checkbox import-row-check" ${r.include ? 'checked' : ''} ${r.locked ? 'disabled' : ''} aria-label="Include ${esc(r.desc)}"></td>
        <td class="import-date">${esc(formatDate(r.date))}<span>${esc(r.time)}</span></td>
        <td class="import-desc">${esc(r.desc)}${r.note ? `<span>Matches “${esc(r.note)}”</span>` : ''}</td>
        <td>${catCell}</td>
        <td class="import-amount${isIncome ? ' import-amount--in' : ''}">${isIncome ? '+' : ''}${inr(r.amount)}</td>
        <td><span class="import-status ${cls}">${label}</span></td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="import-empty">No transactions in this statement.</td></tr>`;

    showStep('review');
    updateFooter();
  }

  function updateFooter() {
    const selectable = state.rows.filter(r => !r.locked);
    const chosen = selectable.filter(r => r.include);
    const exp = chosen.filter(r => r.kind === 'expense');
    const inc = chosen.filter(r => r.kind === 'income');
    const sum = (list) => list.reduce((s, r) => s + r.amount, 0);
    els.selectAll.checked = selectable.length > 0 && chosen.length === selectable.length;
    els.selectAll.indeterminate = chosen.length > 0 && chosen.length < selectable.length;
    els.selectAll.disabled = selectable.length === 0;
    const parts = [];
    if (exp.length) parts.push(`<strong>${exp.length}</strong> expense${exp.length === 1 ? '' : 's'} (<strong>${inr(sum(exp))}</strong>)`);
    if (inc.length) parts.push(`<strong>${inc.length}</strong> income entr${inc.length === 1 ? 'y' : 'ies'} (<strong class="income-text">+${inr(sum(inc))}</strong>)`);
    els.footerText.innerHTML = chosen.length ? `Add ${parts.join(' and ')}?` : 'No transactions selected.';
    els.confirmBtn.disabled = chosen.length === 0;
    els.confirmBtn.innerHTML = chosen.length
      ? `<i class="fa-solid fa-check"></i> Yes, import ${chosen.length}`
      : 'Nothing to import';
  }

  async function confirmImport() {
    const chosen = state.rows.filter(r => !r.locked && r.include);
    if (!chosen.length || state.busy) return;
    state.busy = true;
    els.confirmBtn.disabled = true;
    els.confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importing…';
    try {
      const { stats, parsed } = state;
      const result = await apiPost('/imports', {
        source: state.source,
        file_hash: state.fileHash,
        file_name: state.fileName,
        period_start: parsed.period.start,
        period_end: parsed.period.end,
        found_count: stats.found,
        failed_count: stats.failed,
        transactions: state.rows.filter(r => !r.locked).map(r => ({
          ref_hash: r.refHash,
          kind: r.kind,
          date: r.date,
          desc: r.desc,
          amount: r.amount,
          cat: r.cat,
          include: r.include,
        })),
      });
      state.busy = false;
      const nExp = result.imported.length;
      const nInc = result.income.length;
      const label = sourceLabel(state.source);
      closeImportModal();
      await Promise.all([loadExpenses(), loadIncome()]);
      renderAll();
      if (typeof animateStatCards === 'function') animateStatCards();
      const parts = [];
      if (nExp) parts.push(`${nExp} expense${nExp === 1 ? '' : 's'}`);
      if (nInc) parts.push(`${nInc} income entr${nInc === 1 ? 'y' : 'ies'}`);
      showToast(`Imported ${parts.join(' and ') || 'nothing new'} from ${label}.${result.duplicates ? ` ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} skipped.` : ''}`, 'success');
    } catch (err) {
      state.busy = false;
      showToast(escHtml(err.message || 'Import failed.'), 'danger');
      updateFooter();
    }
  }

  // ── Events ──────────────────────────────────────────────────
  els.openBtn.addEventListener('click', openImportModal);
  els.closeBtn.addEventListener('click', closeImportModal);
  els.modal.addEventListener('click', (e) => {
    if (e.target === els.modal) closeImportModal();
    const tile = e.target.closest('.upi-app-tile');
    if (tile) chooseSource(tile.dataset.source);
    if (e.target.closest('[data-import-close]')) closeImportModal();
    if (e.target.closest('[data-import-back]')) openImportModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modal.classList.contains('open')) closeImportModal();
  });
  els.fileInput.addEventListener('change', () => handleFile(els.fileInput.files[0]));
  els.msgPrimary.addEventListener('click', () => { if (msgPrimaryAction) msgPrimaryAction(); });

  els.pwForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = els.pwInput.value;
    if (!pw) return;
    els.workingText.textContent = 'Unlocking statement…';
    showStep('working');
    try {
      await readAndParse(pw);
    } catch (err) {
      showMessage({ tone: 'error', title: 'Could not read this PDF', text: err.message || 'The file may be damaged.' });
    } finally {
      els.pwInput.value = '';
    }
  });

  els.tbody.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-index]');
    if (!tr) return;
    const row = state.rows[+tr.dataset.index];
    if (e.target.classList.contains('import-row-check')) {
      row.include = e.target.checked;
      tr.classList.toggle('import-row--off', !row.include);
      updateFooter();
    } else if (e.target.classList.contains('import-cat')) {
      row.cat = e.target.value;
    }
  });

  els.selectAll.addEventListener('change', () => {
    const on = els.selectAll.checked;
    state.rows.forEach(r => { if (!r.locked) r.include = on; });
    els.tbody.querySelectorAll('tr[data-index]').forEach(tr => {
      const row = state.rows[+tr.dataset.index];
      const cb = tr.querySelector('.import-row-check');
      if (cb) cb.checked = row.include;
      tr.classList.toggle('import-row--off', !row.include);
    });
    updateFooter();
  });

  els.confirmBtn.addEventListener('click', confirmImport);
  resetState();
})(typeof window !== 'undefined' ? window : globalThis);
