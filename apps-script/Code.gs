/**
 * Piper Industry Partners: Apps Script backend
 * ------------------------------------------------------------------
 * The Google Sheet this script is attached to IS the database.
 * This file does three jobs:
 *   1. JSON API for the GitHub-hosted app        (doPost)
 *   2. Hosts the same app inside Google (backup)  (doGet -> Index.html)
 *   3. Issues sign-in tokens so the GitHub app knows who you are (doGet ?action=login)
 *
 * Nothing in this file needs editing. Settings live on the "Settings" tab.
 * First time: run setup() once from the editor (Run > setup).
 */

var APP_VERSION = '1.0.0';
var SEP = '; ';
var TOKEN_DAYS = 14;
var STATUSES = ['Active', 'Inactive', 'Do Not Contact'];
var AVAILABILITY = ['In person', 'Virtual', 'Either'];
var PARTNERSHIP_TYPES = ['CCP', 'Internship', 'EE', 'Other'];

var SCHEMA = {
  contacts: { sheet: 'Contacts', prefix: 'P', fields: [
    ['id', 'ID'], ['status', 'Status'], ['title', 'Title'], ['first', 'First Name'], ['last', 'Last Name'],
    ['profession', 'Profession'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone'],
    ['location', 'Location'], ['linkedin', 'LinkedIn'], ['academies', 'Academies', 'list'],
    ['roles', 'Roles', 'list'], ['availability', 'Availability'], ['relationship', 'Relationship'],
    ['staff', 'Piper Staff Contact', 'list'], ['lastContact', 'Last Positive Contact', 'date'],
    ['raptor', 'Raptor Cleared', 'date'], ['notes', 'Notes'], ['source', 'Source'],
    ['created', 'Created', 'stamp'], ['createdBy', 'Created By'], ['updated', 'Updated', 'stamp'], ['updatedBy', 'Updated By']
  ]},
  engagements: { sheet: 'Engagements', prefix: 'E', fields: [
    ['id', 'ID'], ['contactId', 'Contact ID'], ['contactName', 'Contact Name'], ['date', 'Date', 'date'],
    ['activity', 'Activity'], ['academy', 'Academy'], ['staff', 'Piper Staff'], ['notes', 'Notes'],
    ['loggedBy', 'Logged By'], ['loggedAt', 'Logged At', 'stamp']
  ]},
  partnerships: { sheet: 'Partnerships', prefix: 'X', fields: [
    ['id', 'ID'], ['company', 'Company'], ['type', 'Type'], ['contactId', 'Contact ID'], ['partnerName', 'Partner Name'],
    ['email', 'Email'], ['phone', 'Phone'], ['academy', 'Academy'], ['status', 'Status'], ['schoolYear', 'School Year'],
    ['notes', 'Notes'], ['updated', 'Updated', 'stamp'], ['updatedBy', 'Updated By']
  ]},
  submissions: { sheet: 'Submissions', prefix: 'S', fields: [
    ['id', 'ID'], ['submittedAt', 'Submitted At', 'stamp'], ['status', 'Status'], ['title', 'Title'],
    ['first', 'First Name'], ['last', 'Last Name'], ['profession', 'Profession'], ['company', 'Company'],
    ['email', 'Email'], ['phone', 'Phone'], ['location', 'Location'], ['linkedin', 'LinkedIn'],
    ['academies', 'Academies', 'list'], ['roles', 'Roles', 'list'], ['availability', 'Availability'],
    ['relationship', 'Relationship'], ['staffKnown', 'Piper Staff They Know'], ['message', 'Message'],
    ['reviewedBy', 'Reviewed By'], ['reviewedAt', 'Reviewed At', 'stamp'], ['contactId', 'Contact ID']
  ]},
  log: { sheet: 'Change Log', prefix: '', fields: [
    ['timestamp', 'Timestamp', 'stamp'], ['user', 'User'], ['action', 'Action'], ['record', 'Record'], ['details', 'Details']
  ]}
};

var CONTACT_EDITABLE = ['status', 'title', 'first', 'last', 'profession', 'company', 'email', 'phone', 'location',
  'linkedin', 'academies', 'roles', 'availability', 'relationship', 'staff', 'lastContact', 'raptor', 'notes'];

var DEFAULT_SETTINGS = {
  roles: [
    ['Individual Interview', 'Meet one-on-one with a student (in person or by video) so they can interview you about your career path.'],
    ['Capstone Evaluator', 'Score senior capstone presentations with a provided rubric, usually one evening or school day.'],
    ['Round Table Interview', 'Sit on a small panel of professionals answering questions from a group of students.'],
    ['Client', 'Be the "client" for a student project: share a real need and give feedback on their work.'],
    ['Mock Interview', 'Give students practice job interviews and feedback on how they did.'],
    ['Subject Matter Expert', 'Answer questions and advise students researching a topic in your field.'],
    ['Internship Supervisor', 'Host a student intern at your workplace and supervise their work.'],
    ['Advisory Board', 'Help guide an academy by meeting with staff a few times per year.']
  ],
  academies: [
    ['Design, Production & Aviation', 'Engineering, architecture, construction, trades, manufacturing, aviation'],
    ['Business, Entrepreneurship & Innovation', 'Business, finance, marketing, sales, IT, entrepreneurship'],
    ['Arts & Media', 'Visual & performing arts, design, photography, video, journalism, music'],
    ['Human Services', 'Education, hospitality & culinary, cosmetology, social & family services'],
    ['Health & Life Sciences', 'Medicine, nursing, therapy, lab science, veterinary, agriculture & environment'],
    ['Public Services', 'Fire, EMS, law enforcement, law, government, military']
  ],
  relationships: ['Industry Partner', 'Alumni', 'Parent', 'Community Member', 'Board Member', 'Piper Education Foundation', 'Piper Staff', 'Other'],
  config: [
    ['STAFF_DOMAIN', 'piperschools.us'], ['ALLOWED_APP_URLS', ''], ['PUBLIC_FORM_URL', ''], ['STAFF_APP_URL', ''],
    ['NOTIFY_EMAILS', ''], ['SCHOOL_NAME', 'Piper High School'], ['FORM_TITLE', 'Partner with Piper'],
    ['FORM_INTRO', 'Piper High School students learn best from people doing the work. Tell us a little about yourself and the ways you would be open to helping. A Piper staff member will reach out. There is never an obligation to say yes.'],
    ['STALE_MONTHS', '12'], ['IGNORED_DUPES', '']
  ]
};
var SETTINGS_HEADERS = ['Roles', 'Role Description', 'Show On Form', '', 'Academies', 'Academy Description', '',
  'Relationships', '', 'Piper Staff', '', 'Admins', '', 'Setting', 'Value'];

/* ================================================================== entry points */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'login') return loginPage_(p['return'] || '');
  if (p.action === 'ping') return json_({ ok: true, app: 'piper-partners', version: APP_VERSION });
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Piper Industry Partners')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** JSON API used by the GitHub-hosted app. Auth = signed token only (never the Google session). */
function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, code: 'BAD_REQUEST', error: 'Request was not valid JSON.' }); }
  var user = userFromToken_(req.token);
  return json_(route_(req, user));
}

/** Called by the Apps Script-hosted copy of the app through google.script.run. Auth = Google session. */
function api(req) {
  return route_(req || {}, userFromSession_());
}

/* ================================================================== router */

var ACTIONS = {
  // public
  publicConfig: { level: 'public', fn: publicConfig_ },
  submitPartner: { level: 'public', fn: submitPartner_ },
  // any Piper staff
  whoami: { level: 'staff', fn: function (p, u) { return { email: u.email, isAdmin: u.isAdmin, name: nameFromEmail_(u.email) }; } },
  bootstrap: { level: 'staff', fn: bootstrap_ },
  // admins
  saveContact: { level: 'admin', fn: saveContact_ },
  deleteContact: { level: 'admin', fn: deleteContact_ },
  bulkUpdateContacts: { level: 'admin', fn: bulkUpdateContacts_ },
  mergeContacts: { level: 'admin', fn: mergeContacts_ },
  logEngagements: { level: 'admin', fn: logEngagements_ },
  deleteEngagement: { level: 'admin', fn: deleteEngagement_ },
  savePartnership: { level: 'admin', fn: savePartnership_ },
  deletePartnership: { level: 'admin', fn: deletePartnership_ },
  reviewSubmission: { level: 'admin', fn: reviewSubmission_ },
  saveSettings: { level: 'admin', fn: saveSettings_ },
  signOutEveryone: { level: 'admin', fn: signOutEveryone_ }
};

function route_(req, user) {
  try {
    var a = ACTIONS[req.action];
    if (!a) throw err_('BAD_REQUEST', 'Unknown action: ' + req.action);
    if (a.level !== 'public') {
      if (!user || !user.email) throw err_('AUTH', 'Please sign in with your Piper Google account.');
      if (!user.ok) throw err_('FORBIDDEN', 'Only ' + staffDomain_() + ' accounts can use the staff side. You are signed in as ' + user.email + '.');
      if (a.level === 'admin' && !user.isAdmin) throw err_('FORBIDDEN', 'Only admins can make changes. Ask an admin to add you on the Settings tab.');
    }
    var data = a.fn(req.payload || {}, user || {});
    return { ok: true, data: data, version: APP_VERSION };
  } catch (e) {
    if (e && e.code) return { ok: false, code: e.code, error: e.message, data: e.data };
    console.error(e && e.stack || e);
    return { ok: false, code: 'SERVER', error: 'Something went wrong on the server: ' + (e && e.message || e) };
  }
}

function err_(code, message, data) { var e = new Error(message); e.code = code; e.data = data; return e; }

/* ================================================================== auth */

function staffDomain_() { return (settings_().config.STAFF_DOMAIN || 'piperschools.us').toLowerCase().replace(/^@/, ''); }

function describeUser_(email) {
  email = String(email || '').toLowerCase().trim();
  if (!email) return { email: '', ok: false, isAdmin: false };
  var s = settings_();
  var owner = '';
  try { owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  var ok = email === owner || email.slice(-(staffDomain_().length + 1)) === '@' + staffDomain_();
  var isAdmin = ok && (email === owner || s.admins.indexOf(email) >= 0);
  return { email: email, ok: ok, isAdmin: isAdmin };
}

function userFromSession_() {
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}
  return describeUser_(email);
}

function userFromToken_(token) { return describeUser_(verifyToken_(token)); }

function secret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('TOKEN_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('TOKEN_SECRET', s); }
  return s;
}

function sign_(text) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret_())).replace(/=+$/, '');
}

function makeToken_(email) {
  var body = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, x: Date.now() + TOKEN_DAYS * 864e5 })).replace(/=+$/, '');
  return body + '.' + sign_(body);
}

function verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return '';
  var parts = token.split('.');
  if (parts.length !== 2 || sign_(parts[0]) !== parts[1]) return '';
  try {
    var pad = parts[0] + '==='.slice((parts[0].length + 3) % 4);
    var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
    if (!data.e || !data.x || data.x < Date.now()) return '';
    return String(data.e);
  } catch (e) { return ''; }
}

function signOutEveryone_(p, user) {
  PropertiesService.getScriptProperties().setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  log_(user.email, 'sign-out-everyone', '', 'All GitHub-app sign-ins were reset');
  return { done: true };
}

/** Sign-in hand-off for the GitHub-hosted app. Must be served by the "Staff" deployment (domain-only access). */
function loginPage_(returnUrl) {
  var user = userFromSession_();
  var allowed = listFromText_(settings_().config.ALLOWED_APP_URLS);
  var ret = String(returnUrl || '');
  var okUrl = /^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/)/.test(ret) && allowed.some(function (a) {
    a = a.replace(/\/+$/, '');
    if (!a || ret.indexOf(a) !== 0) return false;
    var next = ret.charAt(a.length);
    return next === '' || next === '/' || next === '?' || next === '#';   // exact origin/path boundary
  });
  var body;
  if (!user.email) {
    body = '<h1>We could not confirm your Google account</h1><p>Make sure you are signed in to your <b>@' + esc_(staffDomain_()) +
      '</b> Google account in this browser, then try again.</p>';
  } else if (!user.ok) {
    body = '<h1>Piper staff only</h1><p>You are signed in as <b>' + esc_(user.email) + '</b>. Switch to your @' + esc_(staffDomain_()) + ' account and try again.</p>';
  } else if (!okUrl) {
    body = '<h1>This app address is not approved yet</h1><p>An admin needs to add this address to <b>ALLOWED_APP_URLS</b> on the Settings tab:</p><pre>' +
      esc_(ret || '(no return address given)') + '</pre>';
  } else {
    var dest = ret.split('#')[0] + '#token=' + encodeURIComponent(makeToken_(user.email));
    body = '<h1>You are signed in</h1><p>Signed in as <b>' + esc_(user.email) + '</b>' + (user.isAdmin ? ' (admin)' : '') + '.</p>' +
      '<p><a class="btn" href="' + esc_(dest) + '" target="_top">Continue to Industry Partners &rarr;</a></p>' +
      '<p class="small">This sign-in lasts ' + TOKEN_DAYS + ' days on this device.</p>';
  }
  var html = '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f6f3fa;color:#1f1830;margin:0;padding:48px 20px}' +
    '.card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;box-shadow:0 8px 30px rgba(84,52,132,.12)}' +
    '.bar{height:6px;background:#543484;border-radius:16px 16px 0 0;margin:-32px -32px 24px}' +
    'h1{font-size:22px;margin:0 0 12px;color:#3b2360}p{line-height:1.5}pre{background:#f3eef9;padding:12px;border-radius:8px;white-space:pre-wrap;word-break:break-all}' +
    '.btn{display:inline-block;background:#543484;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:600}' +
    '.small{color:#6b6280;font-size:13px}</style></head><body><div class="card"><div class="bar"></div>' + body + '</div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Piper Industry Partners: Sign in')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ================================================================== settings */

var settingsCache_ = null;

function settings_() {
  if (settingsCache_) return settingsCache_;
  var sh = ss_().getSheetByName('Settings');
  var out = { roles: [], academies: [], relationships: [], staff: [], admins: [], config: {} };
  DEFAULT_SETTINGS.config.forEach(function (kv) { out.config[kv[0]] = kv[1]; });
  if (!sh || sh.getLastRow() < 1) {
    out.roles = DEFAULT_SETTINGS.roles.map(function (r) { return { name: r[0], description: r[1], showOnForm: true }; });
    out.academies = DEFAULT_SETTINGS.academies.map(function (a) { return { name: a[0], description: a[1] }; });
    out.relationships = DEFAULT_SETTINGS.relationships.slice();
    settingsCache_ = out; return out;
  }
  var values = sh.getDataRange().getValues();
  var head = values[0].map(function (h) { return String(h).trim(); });
  var col = function (name) { return head.indexOf(name); };
  var c = {
    role: col('Roles'), roleDesc: col('Role Description'), roleShow: col('Show On Form'),
    acad: col('Academies'), acadDesc: col('Academy Description'), rel: col('Relationships'),
    staff: col('Piper Staff'), admin: col('Admins'), key: col('Setting'), val: col('Value')
  };
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var v = function (idx) { return idx >= 0 ? String(r[idx] === null || r[idx] === undefined ? '' : r[idx]).trim() : ''; };
    if (v(c.role)) out.roles.push({ name: v(c.role), description: v(c.roleDesc), showOnForm: !/^(false|no|0)$/i.test(v(c.roleShow)) });
    if (v(c.acad)) out.academies.push({ name: v(c.acad), description: v(c.acadDesc) });
    if (v(c.rel)) out.relationships.push(v(c.rel));
    if (v(c.staff)) out.staff.push(v(c.staff));
    if (v(c.admin)) out.admins.push(v(c.admin).toLowerCase());
    if (v(c.key)) out.config[v(c.key)] = v(c.val);
  }
  settingsCache_ = out;
  return out;
}

function saveSettings_(p, user) {
  var lock = lock_();
  try {
    var cur = settings_();
    var clean = function (arr) { return uniq_((arr || []).map(function (x) { return String(x || '').trim(); }).filter(String)); };
    var roles = (p.roles || []).filter(function (r) { return r && String(r.name || '').trim(); })
      .map(function (r) { return { name: String(r.name).trim(), description: String(r.description || '').trim(), showOnForm: r.showOnForm !== false }; });
    var academies = (p.academies || []).filter(function (a) { return a && String(a.name || '').trim(); })
      .map(function (a) { return { name: String(a.name).trim(), description: String(a.description || '').trim() }; });
    if (!roles.length) throw err_('INVALID', 'Keep at least one role.');
    if (!academies.length) throw err_('INVALID', 'Keep at least one academy.');
    var admins = clean(p.admins).map(function (a) { return a.toLowerCase(); });
    if (admins.indexOf(user.email) < 0 && user.email !== String(Session.getEffectiveUser().getEmail()).toLowerCase()) {
      admins.push(user.email); // never lock yourself out
    }
    var config = {};
    Object.keys(cur.config).forEach(function (k) { config[k] = cur.config[k]; });
    Object.keys(p.config || {}).forEach(function (k) { if (/^[A-Z_]+$/.test(k)) config[k] = String(p.config[k] === null ? '' : p.config[k]).trim(); });
    var next = { roles: roles, academies: academies, relationships: clean(p.relationships), staff: clean(p.staff).sort(), admins: admins, config: config };
    writeSettings_(next);

    // Rename roles / academies everywhere they are used
    var renames = p.renames || {};
    var changed = 0;
    if ((renames.roles && Object.keys(renames.roles).length) || (renames.academies && Object.keys(renames.academies).length)) {
      var t = readTable_('contacts');
      t.rows.forEach(function (c) {
        var before = JSON.stringify([c.roles, c.academies]);
        c.roles = uniq_(c.roles.map(function (x) { return (renames.roles || {})[x] || x; }));
        c.academies = uniq_(c.academies.map(function (x) { return (renames.academies || {})[x] || x; }));
        if (JSON.stringify([c.roles, c.academies]) !== before) { writeRecord_(t, c); changed++; }
      });
    }
    var oldRoles = cur.roles.map(function (r) { return r.name; }).join('|');
    if (oldRoles !== roles.map(function (r) { return r.name; }).join('|')) rebuildRoleTabs_();
    log_(user.email, 'settings', 'Settings', 'Saved settings' + (changed ? '; renamed values on ' + changed + ' contacts' : ''));
    return { settings: publicSettings_(user, true), renamedContacts: changed };
  } finally { lock.releaseLock(); }
}

function writeSettings_(s) {
  var ss = ss_();
  var sh = ss.getSheetByName('Settings') || ss.insertSheet('Settings');
  var n = Math.max(s.roles.length, s.academies.length, s.relationships.length, s.staff.length, s.admins.length, Object.keys(s.config).length, 1);
  var rows = [SETTINGS_HEADERS.slice()];
  var keys = Object.keys(s.config);
  for (var i = 0; i < n; i++) {
    var r = SETTINGS_HEADERS.map(function () { return ''; });
    if (s.roles[i]) { r[0] = s.roles[i].name; r[1] = s.roles[i].description; r[2] = s.roles[i].showOnForm ? 'TRUE' : 'FALSE'; }
    if (s.academies[i]) { r[4] = s.academies[i].name; r[5] = s.academies[i].description; }
    if (s.relationships[i]) r[7] = s.relationships[i];
    if (s.staff[i]) r[9] = s.staff[i];
    if (s.admins[i]) r[11] = s.admins[i];
    if (keys[i]) { r[13] = keys[i]; r[14] = s.config[keys[i]]; }
    rows.push(r.map(safeCell_));
  }
  sh.clearContents();
  sh.getRange(1, 1, rows.length, SETTINGS_HEADERS.length).setNumberFormat('@').setValues(rows);
  settingsCache_ = null;
}

function publicSettings_(user, includeAdmin) {
  var s = settings_();
  var out = {
    roles: s.roles, academies: s.academies, relationships: s.relationships, staff: s.staff,
    availability: AVAILABILITY, statuses: STATUSES, partnershipTypes: PARTNERSHIP_TYPES,
    config: {
      SCHOOL_NAME: s.config.SCHOOL_NAME, FORM_TITLE: s.config.FORM_TITLE, FORM_INTRO: s.config.FORM_INTRO,
      STALE_MONTHS: s.config.STALE_MONTHS, PUBLIC_FORM_URL: s.config.PUBLIC_FORM_URL, STAFF_APP_URL: s.config.STAFF_APP_URL,
      STAFF_DOMAIN: s.config.STAFF_DOMAIN
    }
  };
  if (includeAdmin && user && user.isAdmin) {
    out.admins = s.admins;
    out.config = JSON.parse(JSON.stringify(s.config));
  }
  return out;
}

/* ================================================================== reads */

function bootstrap_(p, user) {
  var contacts = readTable_('contacts').rows.map(clean_);
  var engagements = readTable_('engagements').rows.map(clean_);
  var partnerships = readTable_('partnerships').rows.map(clean_);
  var subs = readTable_('submissions').rows.map(clean_);
  var pending = subs.filter(function (s) { return (s.status || 'Pending') === 'Pending'; });
  return {
    me: { email: user.email, isAdmin: user.isAdmin, name: nameFromEmail_(user.email) },
    settings: publicSettings_(user, true),
    contacts: contacts, engagements: engagements, partnerships: partnerships,
    submissions: user.isAdmin ? subs : [],
    pendingCount: pending.length,
    serverTime: now_()
  };
}

function publicConfig_() {
  var s = settings_();
  return {
    schoolName: s.config.SCHOOL_NAME, formTitle: s.config.FORM_TITLE, formIntro: s.config.FORM_INTRO,
    roles: s.roles.filter(function (r) { return r.showOnForm; }).map(function (r) { return { name: r.name, description: r.description }; }),
    academies: s.academies,
    relationships: s.relationships.filter(function (r) { return r !== 'Piper Staff'; }),
    availability: AVAILABILITY
  };
}

/* ================================================================== public form */

function submitPartner_(p) {
  if (p.website) return { received: true };                     // honeypot: bots fill hidden fields
  if (p.elapsedMs && p.elapsedMs < 2500) return { received: true }; // filled faster than a human can
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get('submitCount') || 0);
  if (count > 40) throw err_('RATE', 'We are getting a lot of submissions right now. Please try again in a few minutes.');
  cache.put('submitCount', String(count + 1), 600);

  var s = settings_();
  var cut = function (v, n) { return String(v || '').replace(/\s+/g, ' ').trim().slice(0, n || 200); };
  var rec = {
    status: 'Pending', submittedAt: now_(),
    title: cut(p.title, 40), first: cut(p.first, 80), last: cut(p.last, 80), profession: cut(p.profession),
    company: cut(p.company), email: cut(p.email, 120).toLowerCase(), phone: cut(p.phone, 40), location: cut(p.location),
    linkedin: cut(p.linkedin, 300),
    roles: knownOnly_(p.roles, s.roles.map(function (r) { return r.name; })),
    academies: knownOnly_(p.academies, s.academies.map(function (a) { return a.name; })),
    availability: AVAILABILITY.indexOf(p.availability) >= 0 ? p.availability : '',
    relationship: s.relationships.indexOf(p.relationship) >= 0 ? p.relationship : '',
    staffKnown: cut(p.staffKnown), message: String(p.message || '').trim().slice(0, 2000)
  };
  if (!rec.first || !rec.last) throw err_('INVALID', 'Please enter your first and last name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) throw err_('INVALID', 'Please enter a valid email address.');
  if (!p.consent) throw err_('INVALID', 'Please check the box saying Piper staff may contact you.');

  var lock = lock_();
  try {
    var t = readTable_('submissions');
    rec.id = nextId_(t, 'submissions');
    appendRecords_(t, [rec]);
  } finally { lock.releaseLock(); }

  try {
    var to = listFromText_(s.config.NOTIFY_EMAILS).join(',');
    if (to) {
      var link = s.config.STAFF_APP_URL ? '\n\nReview it here: ' + s.config.STAFF_APP_URL.replace(/#.*$/, '') + '#pending' : '';
      MailApp.sendEmail(to, 'New industry partner: ' + rec.first + ' ' + rec.last + (rec.company ? ' (' + rec.company + ')' : ''),
        rec.first + ' ' + rec.last + ' filled out the "' + s.config.FORM_TITLE + '" form.\n\n' +
        'Profession: ' + rec.profession + '\nCompany: ' + rec.company + '\nEmail: ' + rec.email + '\nPhone: ' + rec.phone +
        '\nInterested in: ' + rec.roles.join(', ') + '\nAcademies: ' + rec.academies.join(', ') +
        (rec.message ? '\n\nMessage:\n' + rec.message : '') + link);
    }
  } catch (e) { console.warn('Notification email failed: ' + e); }
  return { received: true };
}

/* ================================================================== contacts */

function normalizeContact_(c, s) {
  var out = {};
  CONTACT_EDITABLE.forEach(function (k) { if (c[k] !== undefined) out[k] = c[k]; });
  ['title', 'first', 'last', 'profession', 'company', 'phone', 'location', 'linkedin', 'notes', 'relationship', 'availability']
    .forEach(function (k) { if (out[k] !== undefined) out[k] = String(out[k] || '').trim(); });
  if (out.email !== undefined) out.email = String(out.email || '').trim().toLowerCase();
  if (out.status !== undefined && STATUSES.indexOf(out.status) < 0) out.status = 'Active';
  if (out.roles !== undefined) out.roles = toList_(out.roles, s.roles.map(function (r) { return r.name; }));
  if (out.academies !== undefined) out.academies = toList_(out.academies, s.academies.map(function (a) { return a.name; }));
  if (out.staff !== undefined) out.staff = toList_(out.staff, null);
  if (out.lastContact !== undefined) out.lastContact = toIsoDate_(out.lastContact);
  if (out.raptor !== undefined) out.raptor = toIsoDate_(out.raptor);
  return out;
}

function saveContact_(p, user) {
  var lock = lock_();
  try {
    var s = settings_();
    var input = normalizeContact_(p.contact || {}, s);
    var t = readTable_('contacts');
    var rec, isNew = !(p.contact && p.contact.id);
    if (isNew) {
      rec = blank_('contacts');
      Object.keys(input).forEach(function (k) { rec[k] = input[k]; });
      rec.status = rec.status || 'Active';
      rec.id = nextId_(t, 'contacts');
      rec.source = p.source || 'Staff entry';
      rec.created = rec.updated = now_();
      rec.createdBy = rec.updatedBy = user.email;
      if (!rec.first && !rec.last && !rec.email && !rec.company) throw err_('INVALID', 'Add at least a name, email, or company.');
      appendRecords_(t, [rec]);
      log_(user.email, 'add', rec.id, displayName_(rec));
    } else {
      rec = findById_(t, p.contact.id);
      if (p.expectedUpdated && String(rec.updated) !== String(p.expectedUpdated)) {
        throw err_('CONFLICT', displayName_(rec) + ' was changed by ' + (rec.updatedBy || 'someone') + ' at ' + rec.updated + '. Reload to see their changes.', clean_(rec));
      }
      var changed = [];
      Object.keys(input).forEach(function (k) {
        if (JSON.stringify(rec[k]) !== JSON.stringify(input[k])) { changed.push(k); rec[k] = input[k]; }
      });
      if (!changed.length) return { contact: clean_(rec), unchanged: true };
      rec.updated = now_(); rec.updatedBy = user.email;
      writeRecord_(t, rec);
      log_(user.email, 'edit', rec.id, displayName_(rec) + ': ' + changed.join(', '));
    }
    return { contact: clean_(rec) };
  } finally { lock.releaseLock(); }
}

function deleteContact_(p, user) {
  var lock = lock_();
  try {
    var t = readTable_('contacts');
    var rec = findById_(t, p.id);
    var e = readTable_('engagements');
    var gone = e.rows.filter(function (x) { return x.contactId === rec.id; });
    deleteRecords_(e, gone);
    var x = readTable_('partnerships');
    x.rows.forEach(function (r) { if (r.contactId === rec.id) { r.contactId = ''; writeRecord_(x, r); } });
    deleteRecords_(t, [rec]);
    log_(user.email, 'delete', rec.id, displayName_(rec) + (gone.length ? ' (+' + gone.length + ' participation records)' : ''));
    return { id: rec.id, engagementIds: gone.map(function (g) { return g.id; }) };
  } finally { lock.releaseLock(); }
}

function bulkUpdateContacts_(p, user) {
  var lock = lock_();
  try {
    var s = settings_();
    var ch = p.changes || {};
    var t = readTable_('contacts');
    var ids = p.ids || [];
    if (!ids.length) throw err_('INVALID', 'No contacts selected.');
    if (ids.length > 600) throw err_('INVALID', 'Too many contacts at once.');
    var roleNames = s.roles.map(function (r) { return r.name; }), acadNames = s.academies.map(function (a) { return a.name; });
    var addRoles = toList_(ch.addRoles, roleNames), rmRoles = toList_(ch.removeRoles, roleNames);
    var addAcad = toList_(ch.addAcademies, acadNames), rmAcad = toList_(ch.removeAcademies, acadNames);
    var addStaff = toList_(ch.addStaff, null);
    var updated = [];
    ids.forEach(function (id) {
      var rec = findById_(t, id);
      var before = JSON.stringify(rec);
      rec.roles = uniq_(rec.roles.concat(addRoles)).filter(function (r) { return rmRoles.indexOf(r) < 0; });
      rec.academies = uniq_(rec.academies.concat(addAcad)).filter(function (a) { return rmAcad.indexOf(a) < 0; });
      rec.staff = uniq_(rec.staff.concat(addStaff));
      if (ch.status && STATUSES.indexOf(ch.status) >= 0) rec.status = ch.status;
      if (ch.relationship) rec.relationship = String(ch.relationship);
      if (JSON.stringify(rec) !== before) {
        rec.updated = now_(); rec.updatedBy = user.email;
        writeRecord_(t, rec);
        updated.push(clean_(rec));
      }
    });
    log_(user.email, 'bulk-edit', updated.length + ' contacts', JSON.stringify(ch).slice(0, 300));
    return { contacts: updated };
  } finally { lock.releaseLock(); }
}

function mergeContacts_(p, user) {
  var lock = lock_();
  try {
    if (!p.keepId || !p.removeId || p.keepId === p.removeId) throw err_('INVALID', 'Pick two different contacts to merge.');
    var t = readTable_('contacts');
    var keep = findById_(t, p.keepId), drop = findById_(t, p.removeId);
    CONTACT_EDITABLE.forEach(function (k) {
      var a = keep[k], b = drop[k];
      if (Array.isArray(a)) keep[k] = uniq_(a.concat(b || []));
      else if (k === 'notes') keep[k] = [a, b].filter(String).join(' | ');
      else if (k === 'lastContact' || k === 'raptor') keep[k] = [a, b].sort().pop() || '';
      else if (!a && b) keep[k] = b;
    });
    if (drop.email && keep.email !== drop.email && keep.notes.indexOf(drop.email) < 0) {
      keep.notes = [keep.notes, 'Other email: ' + drop.email].filter(String).join(' | ');
    }
    keep.updated = now_(); keep.updatedBy = user.email;
    writeRecord_(t, keep);
    var moved = { engagements: [], partnerships: [], submissions: [] };
    ['engagements', 'partnerships', 'submissions'].forEach(function (key) {
      var x = readTable_(key);
      x.rows.forEach(function (r) {
        if (r.contactId === drop.id) {
          r.contactId = keep.id;
          if (key === 'engagements') r.contactName = displayName_(keep);
          writeRecord_(x, r); moved[key].push(r.id);
        }
      });
    });
    deleteRecords_(readTable_('contacts'), [{ id: drop.id }]);
    log_(user.email, 'merge', keep.id, 'Merged ' + drop.id + ' (' + displayName_(drop) + ') into ' + keep.id);
    return { contact: clean_(keep), removedId: drop.id, moved: moved };
  } finally { lock.releaseLock(); }
}

/* ================================================================== engagements */

function logEngagements_(p, user) {
  var lock = lock_();
  try {
    var s = settings_();
    var entries = p.entries || [];
    if (!entries.length) throw err_('INVALID', 'Nothing to log.');
    var ct = readTable_('contacts');
    var et = readTable_('engagements');
    var roleNames = s.roles.map(function (r) { return r.name; });
    var recs = [], touched = {};
    var nextNum = maxNum_(et.rows);
    entries.forEach(function (en) {
      var c = findById_(ct, en.contactId);
      var date = toIsoDate_(en.date) || today_();
      var activity = String(en.activity || '').trim();
      if (!activity) throw err_('INVALID', 'Choose what they helped with.');
      nextNum++;
      recs.push({
        id: 'E' + pad_(nextNum), contactId: c.id, contactName: displayName_(c), date: date, activity: activity,
        academy: String(en.academy || '').trim(), staff: String(en.staff || '').trim(), notes: String(en.notes || '').trim(),
        loggedBy: user.email, loggedAt: now_()
      });
      var changed = false;
      if (!c.lastContact || c.lastContact < date) { c.lastContact = date; changed = true; }
      if (roleNames.indexOf(activity) >= 0 && c.roles.indexOf(activity) < 0) { c.roles.push(activity); changed = true; }
      if (en.academy && c.academies.indexOf(en.academy) < 0) { c.academies.push(String(en.academy)); changed = true; }
      if (changed) { c.updated = now_(); c.updatedBy = user.email; touched[c.id] = c; }
    });
    appendRecords_(et, recs);
    Object.keys(touched).forEach(function (id) { writeRecord_(ct, touched[id]); });
    log_(user.email, 'log-participation', recs.length + ' records', recs.map(function (r) { return r.contactName; }).slice(0, 20).join(', '));
    return { engagements: recs.map(clean_), contacts: Object.keys(touched).map(function (id) { return clean_(touched[id]); }) };
  } finally { lock.releaseLock(); }
}

function deleteEngagement_(p, user) {
  var lock = lock_();
  try {
    var t = readTable_('engagements');
    var rec = findById_(t, p.id);
    deleteRecords_(t, [rec]);
    log_(user.email, 'delete-participation', rec.id, rec.contactName + ': ' + rec.activity + ' ' + rec.date);
    return { id: rec.id };
  } finally { lock.releaseLock(); }
}

/* ================================================================== partnerships */

function savePartnership_(p, user) {
  var lock = lock_();
  try {
    var x = p.partnership || {};
    var t = readTable_('partnerships');
    var rec = x.id ? findById_(t, x.id) : blank_('partnerships');
    ['company', 'type', 'contactId', 'partnerName', 'email', 'phone', 'academy', 'status', 'schoolYear', 'notes'].forEach(function (k) {
      if (x[k] !== undefined) rec[k] = String(x[k] || '').trim();
    });
    if (!rec.company) throw err_('INVALID', 'Company is required.');
    rec.status = rec.status || 'Active';
    rec.updated = now_(); rec.updatedBy = user.email;
    if (!rec.id) { rec.id = nextId_(t, 'partnerships'); appendRecords_(t, [rec]); log_(user.email, 'add-partnership', rec.id, rec.company); }
    else { writeRecord_(t, rec); log_(user.email, 'edit-partnership', rec.id, rec.company); }
    return { partnership: clean_(rec) };
  } finally { lock.releaseLock(); }
}

function deletePartnership_(p, user) {
  var lock = lock_();
  try {
    var t = readTable_('partnerships');
    var rec = findById_(t, p.id);
    deleteRecords_(t, [rec]);
    log_(user.email, 'delete-partnership', rec.id, rec.company);
    return { id: rec.id };
  } finally { lock.releaseLock(); }
}

/* ================================================================== submissions (pending queue) */

function reviewSubmission_(p, user) {
  var lock = lock_();
  try {
    var s = settings_();
    var st = readTable_('submissions');
    var sub = findById_(st, p.id);
    if (sub.status && sub.status !== 'Pending') throw err_('CONFLICT', 'This submission was already ' + sub.status.toLowerCase() + ' by ' + (sub.reviewedBy || 'someone') + '.', clean_(sub));
    var ct = readTable_('contacts');
    var contact = null;
    var note = 'Partner form ' + String(sub.submittedAt).slice(0, 10) + (sub.message ? ': ' + sub.message : '') +
      (sub.staffKnown ? ' (knows: ' + sub.staffKnown + ')' : '');
    if (p.decision === 'approve') {
      var edits = normalizeContact_(p.contact || {}, s);
      contact = blank_('contacts');
      ['title', 'first', 'last', 'profession', 'company', 'email', 'phone', 'location', 'linkedin', 'roles', 'academies', 'availability', 'relationship']
        .forEach(function (k) { contact[k] = sub[k]; });
      Object.keys(edits).forEach(function (k) { contact[k] = edits[k]; });
      contact.status = contact.status || 'Active';
      if (!edits.notes) contact.notes = note;
      contact.id = nextId_(ct, 'contacts');
      contact.source = 'Partner form';
      contact.created = contact.updated = now_();
      contact.createdBy = contact.updatedBy = user.email;
      appendRecords_(ct, [contact]);
      sub.status = 'Approved';
    } else if (p.decision === 'merge') {
      contact = findById_(ct, p.contactId);
      ['title', 'first', 'last', 'profession', 'company', 'email', 'phone', 'location', 'linkedin', 'availability', 'relationship']
        .forEach(function (k) { if (!contact[k] && sub[k]) contact[k] = sub[k]; });
      if (p.preferNew) ['profession', 'company', 'phone', 'location', 'linkedin', 'availability']
        .forEach(function (k) { if (sub[k]) contact[k] = sub[k]; });
      if (sub.email && contact.email && sub.email !== contact.email && contact.notes.indexOf(sub.email) < 0) note += ' (new email: ' + sub.email + ')';
      contact.roles = uniq_(contact.roles.concat(sub.roles));
      contact.academies = uniq_(contact.academies.concat(sub.academies));
      contact.notes = [contact.notes, note].filter(String).join(' | ');
      if (contact.status === 'Inactive') contact.status = 'Active';
      contact.updated = now_(); contact.updatedBy = user.email;
      writeRecord_(ct, contact);
      sub.status = 'Merged';
    } else if (p.decision === 'reject') {
      sub.status = 'Rejected';
    } else throw err_('INVALID', 'Unknown decision.');
    sub.reviewedBy = user.email; sub.reviewedAt = now_(); sub.contactId = contact ? contact.id : '';
    writeRecord_(st, sub);
    log_(user.email, 'review-' + p.decision, sub.id, sub.first + ' ' + sub.last + (contact ? ' -> ' + contact.id : ''));
    return { submission: clean_(sub), contact: contact ? clean_(contact) : null };
  } finally { lock.releaseLock(); }
}

/* ================================================================== table helpers */

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw err_('SETUP', 'This script must be attached to the partner database spreadsheet (Extensions > Apps Script from inside the sheet).');
  return ss;
}

function tz_() { return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }
function now_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function lock_() { var l = LockService.getScriptLock(); l.waitLock(25000); return l; }
function pad_(n) { return ('0000' + n).slice(-Math.max(4, String(n).length)); }
function uniq_(arr) { var seen = {}; return arr.filter(function (x) { var k = String(x); if (!k || seen[k]) return false; seen[k] = 1; return true; }); }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function esc_(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function listFromText_(v) { return String(v || '').split(/[\s,;]+/).map(function (x) { return x.trim(); }).filter(String); }
function displayName_(c) { return ([c.title, c.first, c.last].filter(String).join(' ') || c.email || c.company || c.id); }
function nameFromEmail_(email) {
  return String(email || '').split('@')[0].split(/[._-]+/).filter(String)
    .map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
}

/** Split a multi-value cell. Accepts "a; b" and, for known values, "a, b". Canonicalizes case. */
function toList_(v, known) {
  if (Array.isArray(v)) v = v.join(';');
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s) return [];
  var parts = s.split(/\s*[;\n]\s*/).filter(String);
  var lowerKnown = known ? known.map(function (k) { return k.toLowerCase(); }) : null;
  var canon = function (x) { if (!lowerKnown) return x; var i = lowerKnown.indexOf(x.toLowerCase()); return i >= 0 ? known[i] : x; };
  var out = [];
  parts.forEach(function (p) {
    if (p.indexOf(',') >= 0 && (!lowerKnown || lowerKnown.indexOf(p.toLowerCase()) < 0)) {
      var sub = p.split(/\s*,\s*/).filter(String);
      if (!lowerKnown || sub.every(function (x) { return lowerKnown.indexOf(x.toLowerCase()) >= 0; })) { sub.forEach(function (x) { out.push(canon(x)); }); return; }
    }
    out.push(canon(p));
  });
  return uniq_(out);
}

function knownOnly_(v, known) { return toList_(v, known).filter(function (x) { return known.indexOf(x) >= 0; }); }

function toIsoDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? '' : Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/))) return (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  if ((m = s.match(/^(\d{1,2})\/(\d{4})$/))) return m[2] + '-' + ('0' + m[1]).slice(-2) + '-01';
  if ((m = s.match(/^(\d{4})$/))) return m[1] + '-01-01';
  return '';
}

function fromCell_(v, type) {
  if (type === 'date') return toIsoDate_(v);
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v)) return '';
    return Utilities.formatDate(v, tz_(), type === 'stamp' ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
  }
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v).trim();
}

/** Stops spreadsheet formula injection from public input (=, +, -, @ at the start of text). */
function safeCell_(v) {
  if (typeof v !== 'string') return v;
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function toCell_(v, type) {
  if (type === 'list') return safeCell_((v || []).join(SEP));
  if (v === null || v === undefined) return '';
  return safeCell_(String(v));
}

function readTable_(key) {
  var spec = SCHEMA[key];
  var sh = ss_().getSheetByName(spec.sheet);
  if (!sh) throw err_('SETUP', 'The "' + spec.sheet + '" tab is missing. Open the sheet and run Industry Partners > Run setup.');
  var lastRow = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), 1);
  var values = lastRow ? sh.getRange(1, 1, lastRow, lastCol).getValues() : [[]];
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var map = {};
  spec.fields.forEach(function (f) { map[f[0]] = headers.indexOf(f[1]); });
  var listKnown = {};
  if (key === 'contacts' || key === 'submissions') {
    var s = settings_();
    listKnown.roles = s.roles.map(function (r) { return r.name; });
    listKnown.academies = s.academies.map(function (a) { return a.name; });
  }
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i], rec = { _row: i + 1 };
    spec.fields.forEach(function (f) {
      var idx = map[f[0]];
      var raw = idx >= 0 ? row[idx] : '';
      rec[f[0]] = f[2] === 'list' ? toList_(raw, listKnown[f[0]] || null) : fromCell_(raw, f[2]);
    });
    if (spec.prefix ? rec.id : rec.timestamp) rows.push(rec);
  }
  return { key: key, sh: sh, headers: headers, map: map, rows: rows, width: lastCol };
}

function blank_(key) {
  var r = {};
  SCHEMA[key].fields.forEach(function (f) { r[f[0]] = f[2] === 'list' ? [] : ''; });
  return r;
}

function clean_(rec) {
  var o = {};
  Object.keys(rec).forEach(function (k) { if (k !== '_row') o[k] = rec[k]; });
  return o;
}

function maxNum_(rows) {
  var max = 0;
  rows.forEach(function (r) { var n = parseInt(String(r.id).replace(/\D/g, ''), 10); if (n > max) max = n; });
  return max;
}

function nextId_(t, key) {
  var n = maxNum_(t.rows) + 1;
  t.rows.push({ id: SCHEMA[key].prefix + pad_(n) }); // reserve within this request
  return SCHEMA[key].prefix + pad_(n);
}

function findById_(t, id) {
  for (var i = 0; i < t.rows.length; i++) if (t.rows[i].id === id && t.rows[i]._row) return t.rows[i];
  throw err_('NOT_FOUND', 'Record ' + id + ' was not found. It may have been deleted. Reload to refresh.');
}

/** Re-checks the row still holds this ID (someone may have sorted the sheet) before writing. */
function locateRow_(t, rec) {
  var idCol = t.map.id + 1;
  if (rec._row && String(t.sh.getRange(rec._row, idCol).getValue()).trim() === rec.id) return rec._row;
  var ids = t.sh.getRange(1, idCol, Math.max(t.sh.getLastRow(), 1), 1).getValues();
  for (var i = 1; i < ids.length; i++) if (String(ids[i][0]).trim() === rec.id) { rec._row = i + 1; return rec._row; }
  throw err_('NOT_FOUND', 'Record ' + rec.id + ' disappeared from the sheet. Reload and try again.');
}

function writeRecord_(t, rec) {
  var row = locateRow_(t, rec);
  var width = Math.max(t.headers.length, t.sh.getLastColumn());
  var range = t.sh.getRange(row, 1, 1, width);
  var cur = range.getValues()[0];
  SCHEMA[t.key].fields.forEach(function (f) {
    var idx = t.map[f[0]];
    if (idx >= 0) cur[idx] = toCell_(rec[f[0]], f[2]);
  });
  range.setValues([cur]);
}

function appendRecords_(t, recs) {
  if (!recs.length) return;
  var width = Math.max(t.headers.length, 1);
  var rows = recs.map(function (rec) {
    var r = [];
    for (var i = 0; i < width; i++) r.push('');
    SCHEMA[t.key].fields.forEach(function (f) { var idx = t.map[f[0]]; if (idx >= 0) r[idx] = toCell_(rec[f[0]], f[2]); });
    return r;
  });
  var start = t.sh.getLastRow() + 1;
  t.sh.getRange(start, 1, rows.length, width).setValues(rows);
  recs.forEach(function (rec, i) { rec._row = start + i; });
}

function deleteRecords_(t, recs) {
  var rows = recs.map(function (r) { return locateRow_(t, r); }).sort(function (a, b) { return b - a; });
  rows.forEach(function (r) { t.sh.deleteRow(r); });
}

function log_(user, action, record, details) {
  try {
    var sh = ss_().getSheetByName('Change Log');
    if (!sh) return;
    sh.appendRow([now_(), user, action, record, String(details || '').slice(0, 500)].map(safeCell_));
  } catch (e) { console.warn('log failed ' + e); }
}

/* ================================================================== setup & sheet menu */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Industry Partners')
    .addItem('Run setup / repair', 'setup')
    .addItem('Rebuild role tabs', 'rebuildRoleTabs')
    .addSeparator()
    .addItem('Sign everyone out of the GitHub app', 'menuSignOutEveryone')
    .addToUi();
}

/**
 * Run once after attaching the script (and any time later to repair formatting).
 * Safe to re-run: never deletes data.
 */
function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone('America/Chicago');
  if (!ss.getSheetByName('Settings')) {
    var me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
    var cfg = {}; DEFAULT_SETTINGS.config.forEach(function (kv) { cfg[kv[0]] = kv[1]; });
    cfg.NOTIFY_EMAILS = me;
    writeSettings_({
      roles: DEFAULT_SETTINGS.roles.map(function (r) { return { name: r[0], description: r[1], showOnForm: true }; }),
      academies: DEFAULT_SETTINGS.academies.map(function (a) { return { name: a[0], description: a[1] }; }),
      relationships: DEFAULT_SETTINGS.relationships, staff: [], admins: me ? [me] : [], config: cfg
    });
  } else {
    // add any new config keys introduced by updates
    var sh = ss.getSheetByName('Settings'), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var kc = head.indexOf('Setting') + 1;
    if (kc > 0) {
      var keys = sh.getRange(1, kc, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]); });
      DEFAULT_SETTINGS.config.forEach(function (kv) { if (keys.indexOf(kv[0]) < 0) { var row = keys.length + 1; sh.getRange(row, kc, 1, 2).setValues([[kv[0], kv[1]]]); keys.push(kv[0]); } });
    }
  }
  settingsCache_ = null;
  ['contacts', 'engagements', 'partnerships', 'submissions', 'log'].forEach(function (key) {
    var spec = SCHEMA[key];
    var sh = ss.getSheetByName(spec.sheet) || ss.insertSheet(spec.sheet);
    var lastCol = Math.max(sh.getLastColumn(), 1);
    var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    if (!head.filter(String).length) head = [];
    spec.fields.forEach(function (f) { if (head.indexOf(f[1]) < 0) head.push(f[1]); });
    sh.getRange(1, 1, 1, head.length).setValues([head])
      .setFontWeight('bold').setFontColor('#ffffff').setBackground('#543484');
    sh.setFrozenRows(1);
    var rows = Math.max(sh.getMaxRows() - 1, 1);
    spec.fields.forEach(function (f) {
      var col = head.indexOf(f[1]) + 1;
      sh.getRange(2, col, rows, 1).setNumberFormat(f[2] === 'date' ? 'yyyy-mm-dd' : '@');
    });
    if (key === 'contacts') {
      var stCol = head.indexOf('Status') + 1;
      sh.getRange(2, stCol, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(STATUSES, true).setAllowInvalid(true).build());
      var avCol = head.indexOf('Availability') + 1;
      sh.getRange(2, avCol, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation()
        .requireValueInList(AVAILABILITY, true).setAllowInvalid(true).build());
    }
  });
  secret_();
  rebuildRoleTabs_();
  log_(String(Session.getEffectiveUser().getEmail()), 'setup', '', 'Setup / repair ran (v' + APP_VERSION + ')');
  try { SpreadsheetApp.getUi().alert('Industry Partners setup is complete.\n\nNext: Deploy > New deployment (see the setup guide).'); } catch (e) {}
  return 'ok';
}

function rebuildRoleTabs() { rebuildRoleTabs_(); }
function menuSignOutEveryone() {
  signOutEveryone_({}, { email: String(Session.getEffectiveUser().getEmail()) });
  try { SpreadsheetApp.getUi().alert('Done. Everyone using the GitHub app will need to sign in again.'); } catch (e) {}
}

function colLetter_(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** One live, read-only tab per role (replaces the old ToTabs copies). */
function rebuildRoleTabs_() {
  var ss = ss_();
  var props = PropertiesService.getScriptProperties();
  var made = JSON.parse(props.getProperty('ROLE_TABS') || '[]');
  var core = ['Contacts', 'Engagements', 'Partnerships', 'Submissions', 'Settings', 'Change Log', 'Migration Review'];
  var roles = settings_().roles.map(function (r) { return r.name; }).filter(function (r) { return core.indexOf(r) < 0; });
  made.forEach(function (name) {
    if (roles.indexOf(name) < 0) { var old = ss.getSheetByName(name); if (old) ss.deleteSheet(old); }
  });
  var csh = ss.getSheetByName('Contacts');
  var head = csh.getRange(1, 1, 1, csh.getLastColumn()).getValues()[0].map(String);
  var L = colLetter_(head.length);
  var col = function (name) { return colLetter_(head.indexOf(name) + 1); };
  var lastIdx = head.indexOf('Last Name') + 1, firstIdx = head.indexOf('First Name') + 1;
  roles.forEach(function (role) {
    var sh = ss.getSheetByName(role) || ss.insertSheet(role);
    sh.clear();
    var rx = role.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/"/g, '""');
    sh.getRange('A1').setFormula("=Contacts!A1:" + L + "1");
    sh.getRange('A2').setFormula('=IFERROR(SORT(FILTER(Contacts!A2:' + L + ', REGEXMATCH(Contacts!' + col('Roles') + '2:' + col('Roles') +
      ', "(?i)(^|;)\\s*' + rx + '\\s*(;|$)"), Contacts!' + col('Status') + '2:' + col('Status') + '<>"Inactive", Contacts!' +
      col('Status') + '2:' + col('Status') + '<>"Do Not Contact"), ' + lastIdx + ', TRUE, ' + firstIdx + ', TRUE), "No active contacts with this role yet")');
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setFontColor('#ffffff').setBackground('#7a5aa8');
    sh.setFrozenRows(1);
    sh.setTabColor('#b9a4d6');
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
    sh.protect().setDescription('Live view of Contacts. Edit people on the Contacts tab or in the app.').setWarningOnly(true);
  });
  props.setProperty('ROLE_TABS', JSON.stringify(roles));
}
