"""
One-time migration: old "Master List of Industry Partners" export (.xlsx)
  -> new Piper Industry Partners database workbook (.xlsx) ready to import
     into a NEW Google Sheet. The original sheet is never modified.

Usage:  python3 migrate.py <old_export.xlsx> <new_database.xlsx> [admin_email]
"""
import sys, re, datetime, collections
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

SRC, DST = sys.argv[1], sys.argv[2]
ADMIN = sys.argv[3] if len(sys.argv) > 3 else ''
TODAY = datetime.date.today().isoformat()
SEP = '; '   # multi-value separator (academy names contain commas)
NOW = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')

# ---------------------------------------------------------------- schema
CONTACT_COLS = ['ID', 'Status', 'Title', 'First Name', 'Last Name', 'Profession', 'Company',
                'Email', 'Phone', 'Location', 'LinkedIn', 'Academies', 'Roles', 'Availability',
                'Relationship', 'Piper Staff Contact', 'Last Positive Contact', 'Raptor Cleared',
                'Notes', 'Source', 'Created', 'Created By', 'Updated', 'Updated By']
ENGAGEMENT_COLS = ['ID', 'Contact ID', 'Contact Name', 'Date', 'Activity', 'Academy', 'Piper Staff',
                   'Notes', 'Logged By', 'Logged At']
PARTNERSHIP_COLS = ['ID', 'Company', 'Type', 'Contact ID', 'Partner Name', 'Email', 'Phone', 'Academy',
                    'Status', 'School Year', 'Notes', 'Updated', 'Updated By']
SUBMISSION_COLS = ['ID', 'Submitted At', 'Status', 'Title', 'First Name', 'Last Name', 'Profession',
                   'Company', 'Email', 'Phone', 'Location', 'LinkedIn', 'Academies', 'Roles',
                   'Availability', 'Relationship', 'Piper Staff They Know', 'Message',
                   'Reviewed By', 'Reviewed At', 'Contact ID']
LOG_COLS = ['Timestamp', 'User', 'Action', 'Record', 'Details']

ROLES = [
    ('Individual Interview', 'Meet one-on-one with a student (in person or by video) so they can interview you about your career path.'),
    ('Capstone Evaluator', 'Score senior capstone presentations with a provided rubric, usually one evening or school day.'),
    ('Round Table Interview', 'Sit on a small panel of professionals answering questions from a group of students.'),
    ('Client', 'Be the "client" for a student project: share a real need and give feedback on their work.'),
    ('Mock Interview', 'Give students practice job interviews and feedback on how they did.'),
    ('Subject Matter Expert', 'Answer questions and advise students researching a topic in your field.'),
    ('Internship Supervisor', 'Host a student intern at your workplace and supervise their work.'),
    ('Advisory Board', 'Help guide an academy by meeting with staff a few times per year.'),
]
ACADEMIES = [
    ('Design, Production & Aviation', 'Engineering, architecture, construction, trades, manufacturing, aviation'),
    ('Business, Entrepreneurship & Innovation', 'Business, finance, marketing, sales, IT, entrepreneurship'),
    ('Arts & Media', 'Visual & performing arts, design, photography, video, journalism, music'),
    ('Human Services', 'Education, hospitality & culinary, cosmetology, social & family services'),
    ('Health & Life Sciences', 'Medicine, nursing, therapy, lab science, veterinary, agriculture & environment'),
    ('Public Services', 'Fire, EMS, law enforcement, law, government, military'),
]
RELATIONSHIPS = ['Industry Partner', 'Alumni', 'Parent', 'Community Member', 'Board Member',
                 'Piper Education Foundation', 'Piper Staff', 'Other']
AVAILABILITY = ['In person', 'Virtual', 'Either']

# ---------------------------------------------------------------- helpers
def s(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return re.sub(r'[ \t]+', ' ', str(v)).strip()

def fix_phone(v):
    v = s(v)
    if not v: return ''
    parts = [p for p in re.split(r'[\n;/]+', v) if p.strip()]
    out = []
    for p in parts:
        d = re.sub(r'\D', '', p)
        if len(d) == 11 and d.startswith('1'): d = d[1:]
        out.append(f'{d[:3]}-{d[3:6]}-{d[6:]}' if len(d) == 10 else p.strip())
    return ' / '.join(dict.fromkeys(out))

def fix_email(v):
    return s(v).lower().replace(' ', '')

def norm_role(v):
    t = s(v).lower()
    if not t: return None
    if 'individual' in t or 'inidividual' in t: return 'Individual Interview'
    if 'capstone' in t: return 'Capstone Evaluator'
    if 'table' in t: return 'Round Table Interview'
    if 'client' in t: return 'Client'
    if 'mock' in t: return 'Mock Interview'
    if 'subject' in t: return 'Subject Matter Expert'
    if 'internship' in t: return 'Internship Supervisor'
    if 'advisory' in t: return 'Advisory Board'
    return None

STAFF_ALIASES = {'deneault': 'Tori Deneault', 'haflich': 'Claire Haflich', 'vader': 'Polly Vader',
                 'hineman': 'Kalli Hineman', 'brumbaugh': 'Stephan Brumbaugh', 'brumbaguh': 'Stephan Brumbaugh'}
REL_MAP = {'alumni': 'Alumni', 'alumni?': 'Alumni', 'community member': 'Community Member',
           'board member': 'Board Member', 'board': 'Board Member', 'pef member': 'Piper Education Foundation',
           "student's parent": 'Parent'}

def split_contact(v):
    """'Who is their contact at Piper?' mixes staff names and relationship types."""
    raw = s(v)
    staff, rel, note = [], '', ''
    if not raw: return '', '', ''
    low = raw.lower()
    if low in REL_MAP: return '', REL_MAP[low], ''
    if low == 'only remote contact': return '', '', 'Only remote contact'
    for part in re.split(r'[\n/,&]+', raw):
        p = part.strip()
        if not p: continue
        key = p.lower()
        if key in STAFF_ALIASES:
            p = STAFF_ALIASES[key]
        else:
            last = key.split()[-1]
            if last in STAFF_ALIASES and len(key.split()) <= 2:
                p = STAFF_ALIASES[last]
        staff.append(p)
    return SEP.join(dict.fromkeys(staff)), rel, note

ACADEMY_KEYWORDS = {
    'Design, Production & Aviation': r'architect|archetet|engineer|construction|contracting|drafter|hvac|heating and cooling|heathing|plumb|electrician|electrical|weld|automotive|auto repair|muffler|pilot|flight|avionic|aerospace|interior design|industrial design|furniture|manufactur|print',
    'Business, Entrepreneurship & Innovation': r'business|marketing|financ|banking|bank|accountant|accounting|actuary|real estate|realtor|sales|entrepren|human resources|human relations|\bhr\b|recruit|talent|insurance|wealth|economics|trading|information technology|computer|programm|software|cyber|data analy|data science|pricing|purchasing|operations|general manager|management|planning analyst|corporate',
    'Arts & Media': r'\bart\b|artist|arts/|graphic|animat|game design|photograph|videograph|journalis|broadcast|music|dance|choreograph|actor|actress|author|writer|fashion|clothing|costume|tattoo|content creator|social media|sound engineer|radio',
    'Human Services': r'cosmet|barber|esthetic|culinary|hospitality|restaurant|baking|brewing|education|teacher|instructional coach|daycare|early childhood|social work|family consumer|family services|funeral|event plann|event director|event management|massage|image consultant|employment specialist|non-?profit',
    'Health & Life Sciences': r'nurs|nuse pract|practioner|physician|pediatric|dentist|dental|pharm|physical therap|occupational therap|chiropract|chriopract|radiolog|mri|ultrasound|veterinar|biolog|biochem|bioengineer|laborator|patholog|immunolog|epidemiolog|public health|dietic|athletic training|neonatolog|neurolog|obstat|anesthes|speech language|psychiatr|medical|microbiolog|clinical|anatomy|agricultur|agrigultur|agronom|horticult|farmer|ecolog|entemolog|entomolog|environmental scien|wildlife|paleontolog|marine|personal train|physical train|phyiscal train',
    'Public Services': r'fire|paramedic|\bemt\b|emergency medical|battalion|police|sherr?iff|detective|crime|forensic|attorney|lawyer|\blaw\b|legal|pre law|government|senator|legislat|elected official|military|army|security|investigator|public information|cadet|officer',
}

def infer_academies(profession, company):
    text = f'{profession} | {company}'.lower()
    hits = [a for a, rx in ACADEMY_KEYWORDS.items() if re.search(rx, text)]
    return hits

def fmt_date(v):
    if isinstance(v, datetime.datetime): return v.date()
    if isinstance(v, datetime.date): return v
    if isinstance(v, (int, float)) and 1990 < v < 2100: return datetime.date(int(v), 1, 1)
    t = s(v)
    m = re.match(r'^(\d{1,2})/(\d{4})$', t)
    if m: return datetime.date(int(m.group(2)), int(m.group(1)), 1)
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', t)
    if m: return datetime.date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    return None

# ---------------------------------------------------------------- read source (read-only)
src = openpyxl.load_workbook(SRC, data_only=True, read_only=True)
master = [r for r in list(src['Master List'].iter_rows(values_only=True))[1:] if any(c not in (None, '') for c in r)]
ccp_name = [n for n in src.sheetnames if n.lower().startswith('capstone ccp')][0]
ccp = [r for r in list(src[ccp_name].iter_rows(values_only=True))[1:] if any(c not in (None, '') for c in r)]

review = []   # (Category, Item, Details)
contacts = []
by_email = {}

def add_contact(c):
    c['ID'] = ''
    contacts.append(c)
    for e in re.split(r'[\s;,/]+', c['Email']):
        if e: by_email.setdefault(e, c)
    return c

orphan_emails = []
for r in master:
    r = list(r) + [None] * 20
    first, last = s(r[1]), s(r[2])
    email = fix_email(r[6])
    roles, odd_roles = [], []
    for v in r[12:20]:
        nr = norm_role(v)
        if nr and nr not in roles: roles.append(nr)
        elif s(v) and not nr: odd_roles.append(s(v))
    if not first and not last:
        if email: orphan_emails.append((email, roles))
        continue
    staff, rel, cnote = split_contact(r[10])
    title = s(r[0]).rstrip('.')
    title = {'Dr': 'Dr.', 'Horable': 'Honorable'}.get(title, title)
    notes = [n for n in [s(r[11]), cnote] if n]
    lpc_raw = r[9]
    lpc = fmt_date(lpc_raw)
    if lpc_raw not in (None, '') and lpc is None:
        notes.append(f'Last contact (old sheet): {s(lpc_raw)}')
    if isinstance(lpc_raw, float):
        notes.append('Last contact year only')
    prof, comp = s(r[3]).replace('\n', ' / '), s(r[4]).replace('\n', ' / ')
    loc = s(r[8])
    acad = infer_academies(prof, comp)
    add_contact({
        'Status': 'Active', 'Title': title, 'First Name': first, 'Last Name': last,
        'Profession': prof, 'Company': comp, 'Email': email, 'Phone': fix_phone(r[5]),
        'Location': loc, 'LinkedIn': '', 'Academies': SEP.join(acad), 'Roles': SEP.join(roles),
        'Availability': 'Virtual' if 'phone/video' in ' '.join(notes).lower() else '',
        'Relationship': rel, 'Piper Staff Contact': staff, 'Last Positive Contact': lpc,
        'Raptor Cleared': '', 'Notes': '; '.join(notes), 'Source': '2025 Master List',
        'Created': TODAY, 'Created By': 'migration', 'Updated': TODAY, 'Updated By': 'migration',
        '_acad_auto': bool(acad),
    })
    if odd_roles:
        review.append(('Unrecognized role text', f'{first} {last}', ', '.join(odd_roles)))

# CCP / Internship partner tab -> Partnerships (+ create contacts not yet in list)
partnerships = []
for r in ccp:
    r = list(r) + [None] * 6
    company, ptype, pname = s(r[0]), s(r[1]).upper().replace('INTERNSHIP', 'Internship'), s(r[2])
    ptype = {'CCP': 'CCP', 'INTERNSHIP': 'Internship', 'Internship': 'Internship', 'EE': 'EE'}.get(ptype, ptype)
    emails = [fix_email(x) for x in r[3:6] if x and '@' in str(x)]
    phones = [fix_phone(x) for x in r[3:6] if x and '@' not in str(x) and re.search(r'\d{3}', str(x))]
    contact = next((by_email[e] for e in emails if e in by_email), None)
    if contact is None and emails:
        nm = re.sub(r'^(dr\.?)\s+', '', pname, flags=re.I).split()
        is_person = len(nm) >= 1 and not re.search(r'univ|college|dept', pname, re.I)
        first = nm[0] if is_person and nm else ''
        last = ' '.join(nm[1:]) if is_person and len(nm) > 1 else ''
        title = 'Dr.' if re.match(r'^dr\.?\s', pname, re.I) else ''
        acad = infer_academies('', company)
        contact = add_contact({
            'Status': 'Active', 'Title': title, 'First Name': first, 'Last Name': last,
            'Profession': '', 'Company': company, 'Email': emails[0], 'Phone': ' / '.join(phones),
            'Location': '', 'LinkedIn': '', 'Academies': SEP.join(acad),
            'Roles': 'Internship Supervisor' if ptype == 'Internship' else '',
            'Availability': '', 'Relationship': 'Industry Partner', 'Piper Staff Contact': '',
            'Last Positive Contact': None, 'Raptor Cleared': '',
            'Notes': ('Also: ' + ', '.join(emails[1:])) if len(emails) > 1 else '',
            'Source': 'CCP/Internship tab', 'Created': TODAY, 'Created By': 'migration',
            'Updated': TODAY, 'Updated By': 'migration', '_acad_auto': bool(acad),
        })
        for e in emails[1:]: by_email.setdefault(e, contact)
        if not first:
            review.append(('Partner contact has no name', company, emails[0]))
    partnerships.append({'_contact': contact, 'Company': company, 'Type': ptype, 'Partner Name': pname,
                         'Email': ', '.join(emails), 'Phone': ' / '.join(phones),
                         'Academy': '', 'Status': 'Active', 'School Year': '', 'Notes': '',
                         'Updated': TODAY, 'Updated By': 'migration'})

# Email-only rows at the bottom of the master list
def merge_roles(c, roles):
    have = [x for x in c['Roles'].split(SEP) if x]
    c['Roles'] = SEP.join(have + [x for x in roles if x not in have])

for e, oroles in orphan_emails:
    if e in by_email:
        merge_roles(by_email[e], oroles)
        continue
    staff = e.endswith('@piperschools.us')
    add_contact({
        'Status': 'Active', 'Title': '', 'First Name': '', 'Last Name': '', 'Profession': '',
        'Company': 'Piper USD 203' if staff else '', 'Email': e, 'Phone': '', 'Location': '',
        'LinkedIn': '', 'Academies': '', 'Roles': SEP.join(oroles), 'Availability': '',
        'Relationship': 'Piper Staff' if staff else '', 'Piper Staff Contact': '',
        'Last Positive Contact': None, 'Raptor Cleared': '',
        'Notes': 'Name unknown: imported from email-only rows of the old list', 'Source': '2025 Master List (email only)',
        'Created': TODAY, 'Created By': 'migration', 'Updated': TODAY, 'Updated By': 'migration', '_acad_auto': False,
    })
    review.append(('Email only, needs a name', e, 'Was an email-only row in the old list'))

# Sort and assign IDs
contacts.sort(key=lambda c: ((c['Last Name'] or '~').lower(), c['First Name'].lower(), c['Email']))
for i, c in enumerate(contacts, 1):
    c['ID'] = f'P{i:04d}'
for i, p in enumerate(partnerships, 1):
    p['ID'] = f'X{i:04d}'
    p['Contact ID'] = p['_contact']['ID'] if p['_contact'] else ''

# Duplicate checks for review
def full(c): return (f"{c['First Name']} {c['Last Name']}".strip() or c['Email'])
groups = collections.defaultdict(list)
for c in contacts:
    for e in re.split(r'[\s;,/]+', c['Email']):
        if e: groups[('email', e)].append(c)
    for p in c['Phone'].split(' / '):
        d = re.sub(r'\D', '', p)
        if len(d) >= 10: groups[('phone', d)].append(c)
for (kind, val), cs in groups.items():
    ids = {c['ID'] for c in cs}
    if len(ids) > 1:
        review.append((f'Possible duplicate (same {kind})', ' / '.join(f"{full(c)} ({c['ID']})" for c in cs), val))
no_role = sum(1 for c in contacts if not c['Roles'])
auto = sum(1 for c in contacts if c['_acad_auto'])

# ---------------------------------------------------------------- write new workbook
out = openpyxl.Workbook()
HDR_FILL = PatternFill('solid', fgColor='4B2E83')
HDR_FONT = Font(bold=True, color='FFFFFF')

def sheet(name, cols, rows, widths=None, first=False):
    ws = out.active if first else out.create_sheet()
    ws.title = name
    ws.append(cols)
    for r in rows:
        ws.append([r.get(c, '') if r.get(c) is not None else '' for c in cols])
    for cell in ws[1]:
        cell.fill, cell.font = HDR_FILL, HDR_FONT
        cell.alignment = Alignment(vertical='center')
    ws.freeze_panes = 'A2'
    for i, c in enumerate(cols, 1):
        ws.column_dimensions[get_column_letter(i)].width = (widths or {}).get(c, max(12, min(32, len(c) + 4)))
    return ws

W = {'ID': 8, 'Status': 10, 'Title': 8, 'First Name': 14, 'Last Name': 16, 'Profession': 28, 'Company': 28,
     'Email': 30, 'Phone': 15, 'Academies': 34, 'Roles': 36, 'Notes': 40, 'Piper Staff Contact': 22}
ws = sheet('Contacts', CONTACT_COLS, contacts, W, first=True)
col = CONTACT_COLS.index('Last Positive Contact') + 1
for row in ws.iter_rows(min_row=2, min_col=col, max_col=col):
    for cell in row:
        if isinstance(cell.value, datetime.date): cell.number_format = 'yyyy-mm-dd'
for row in ws.iter_rows(min_row=2):
    for cell in row:
        cell.number_format = '@' if cell.column != col else cell.number_format

sheet('Engagements', ENGAGEMENT_COLS, [], {'Contact Name': 24, 'Activity': 24, 'Notes': 40})
sheet('Partnerships', PARTNERSHIP_COLS, partnerships, {'Company': 34, 'Partner Name': 22, 'Email': 34, 'Notes': 30})
sheet('Submissions', SUBMISSION_COLS, [])

st = out.create_sheet('Settings')
heads = ['Roles', 'Role Description', 'Show On Form', '', 'Academies', 'Academy Description', '',
         'Relationships', '', 'Piper Staff', '', 'Admins', '', 'Setting', 'Value']
st.append(heads)
staff_names = sorted({n for c in contacts for n in c['Piper Staff Contact'].split(SEP) if n})
settings = [
    ('STAFF_DOMAIN', 'piperschools.us'),
    ('ALLOWED_APP_URLS', ''),
    ('NOTIFY_EMAILS', ADMIN),
    ('SCHOOL_NAME', 'Piper High School'),
    ('FORM_TITLE', 'Partner with Piper'),
    ('FORM_INTRO', 'Piper High School students learn best from people doing the work. Tell us a little about yourself and the ways you would be open to helping. A Piper staff member will reach out. There is never an obligation to say yes.'),
    ('STALE_MONTHS', '12'),
    ('IGNORED_DUPES', ''),
]
n = max(len(ROLES), len(ACADEMIES), len(RELATIONSHIPS), len(staff_names), len(settings), 1)
for i in range(n):
    row = [''] * len(heads)
    if i < len(ROLES): row[0], row[1], row[2] = ROLES[i][0], ROLES[i][1], 'TRUE'
    if i < len(ACADEMIES): row[4], row[5] = ACADEMIES[i]
    if i < len(RELATIONSHIPS): row[7] = RELATIONSHIPS[i]
    if i < len(staff_names): row[9] = staff_names[i]
    if i == 0 and ADMIN: row[11] = ADMIN
    if i < len(settings): row[13], row[14] = settings[i]
    st.append(row)
for cell in st[1]:
    if cell.value: cell.fill, cell.font = HDR_FILL, HDR_FONT
for letter, w in zip('ABCDEFGHIJKLMNO', [24, 60, 12, 3, 36, 60, 3, 24, 3, 22, 3, 32, 3, 18, 60]):
    st.column_dimensions[letter].width = w
st.freeze_panes = 'A2'

lg = sheet('Change Log', LOG_COLS, [{'Timestamp': NOW, 'User': 'migration', 'Action': 'import',
                                       'Record': f'{len(contacts)} contacts, {len(partnerships)} partnerships',
                                       'Details': 'Imported from "Master List of Industry Partners - Updated 2025" (original left unchanged)'}],
           {'Details': 80, 'Record': 30})

rv = out.create_sheet('Migration Review')
rv.append(['Category', 'Item', 'Details', 'Done?'])
for cell in rv[1]: cell.fill, cell.font = HDR_FILL, HDR_FONT
rv.append(['Summary', f'{len(contacts)} contacts', f'{no_role} have no role tagged yet; {auto} got academies auto-suggested from their profession (please spot-check)', ''])
for r in review: rv.append(list(r) + [''])
for letter, w in zip('ABCD', [32, 60, 60, 8]): rv.column_dimensions[letter].width = w
rv.freeze_panes = 'A2'

out.save(DST)
print(f'contacts={len(contacts)} partnerships={len(partnerships)} review_items={len(review)} no_role={no_role} auto_academy={auto}')
print('staff:', staff_names)
print('academy counts:', collections.Counter(a for c in contacts for a in c['Academies'].split(SEP) if a))
print('role counts:', collections.Counter(a for c in contacts for a in c['Roles'].split(SEP) if a))
print('relationship:', collections.Counter(c['Relationship'] for c in contacts))
