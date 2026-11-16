# Piper Industry Partners

A Piper-branded directory of industry partners for the Academies of Piper High School. The Google Sheet stays the database and backup, and the app sits on top of it.

- **Staff app.** Search and filter by role, academy, staff contact, or how long since we last heard from someone. Add and edit partners, log participation, and copy everyone's email for BCC.
- **Public "Partner with Piper" form.** Send partners a link or a QR code. Submissions wait in a **Pending** queue until an admin approves them.
- **Two copies of the same app.** The main copy runs on **GitHub Pages**. A backup copy runs inside **Google Apps Script**. Both read and write the same Google Sheet.

```
 GitHub Pages (index.html)  ──┐
                              ├──►  Apps Script (Code.gs)  ──►  Google Sheet
 Apps Script copy (Index)  ───┘         = the "bridge"           = the database
```

Try it with fake data first: open `index.html` and add `?demo` to the end of the address.

---

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The whole app in one file: staff side, public form, and demo mode. It runs on GitHub as-is. Paste the same file into Apps Script as `Index`. |
| `config.js` | Your two Apps Script links (GitHub copy only). Fill it in once; updating `index.html` never touches it. |
| `apps-script/Code.gs` | The bridge between the app and the sheet. Paste it into the sheet's Apps Script. |
| `apps-script/appsscript.json` | Apps Script settings (time zone and runtime). |
| `tools/migrate.py` | The one-time script that cleaned the old "Master List" into the new format. You don't need to run it again. |

> ⚠️ **Never put the spreadsheet, or a download of it, in this GitHub repo.** GitHub Pages repos are public. This folder holds only code, and all contact data stays in Google.

---

## One-time setup (about 30 minutes)

### Part 1: Create the new Google Sheet
1. In Google Drive, open the folder where the old Master List lives. Choose **New → File upload** and upload `Piper-Industry-Partners-Database.xlsx`.
2. Open the uploaded file and choose **File → Save as Google Sheets**. Name it **Piper Industry Partners Database**, then delete the uploaded `.xlsx` copy.
3. Look over the **Migration Review** tab. It lists about 30 items to check: possible duplicates and email-only rows that need a name. You can delete that tab when you're done.

The old Master List is never touched.

### Part 2: Attach the bridge script
1. In the new sheet, open **Extensions → Apps Script**. Rename the project **Piper Industry Partners**.
2. Replace everything in `Code.gs` with the contents of `apps-script/Code.gs`.
3. Click **+ → HTML** and name the file **`Index`** (capital I; Apps Script adds `.html`). Replace its contents with the whole `index.html`.
4. *(Optional)* Open **Project Settings ⚙**, check **Show "appsscript.json"**, and paste in `apps-script/appsscript.json`.
5. Choose **`setup`** in the function menu at the top and click **Run**. Approve the permissions. Google will say the app is unverified; click **Advanced → Go to Piper Industry Partners**. This is normal for your own scripts.
6. Go back to the sheet and reload it. You'll see an **Industry Partners** menu and one live tab per role (Capstone Evaluator, Client, and so on). These replace the old ToTabs copies and update automatically.

### Part 3: Create two deployments (two links)
In Apps Script, choose **Deploy → New deployment → ⚙ → Web app** and create both of these:

| Deployment | Execute as | Who has access | What it's for |
|---|---|---|---|
| **Staff** | Me | **Anyone within piperschools.us** | Staff sign-in, plus the Google-hosted backup copy of the app |
| **Public** | Me | **Anyone** | The partner form, and the data connection for the GitHub copy |

Copy both `/exec` links somewhere safe.
- Open the **Staff** link. You should see the full app running inside Google. That's your backup copy, and it already works.
- Open the **Public** link with `?page=join` added to the end. You should see the partner form.

> If **"Anyone"** isn't offered, the district has blocked public Apps Script apps. Ask IT to allow it for this project. Until then, the staff side still works through the Staff link.

### Part 4: Put the main copy on GitHub Pages
1. Create a new **public** GitHub repository, for example `piper-industry-partners`.
2. Upload `index.html`, `config.js`, and the other files to the repo (plus `logo.png` if you have one).
3. In the repo, open `config.js`, click ✏️ to edit it, and paste in your two links:
   ```js
   API_URL:   'https://script.google.com/macros/s/…PUBLIC…/exec',
   STAFF_URL: 'https://script.google.com/macros/s/…STAFF…/exec',
   ```
   Then click **Commit changes**.
4. In the repo, go to **Settings → Pages**. Set it to deploy from the `main` branch, `/ (root)`. After a minute, your app is live at `https://YOUR-NAME.github.io/piper-industry-partners/`.
5. Open the **Staff** link, go to **Settings**, and fill in these three fields. (You can also type them on the sheet's Settings tab.) Then click **Save**.
   - **Allowed GitHub app addresses:** `https://YOUR-NAME.github.io/piper-industry-partners/`
   - **Public partner form link:** `https://YOUR-NAME.github.io/piper-industry-partners/?page=join`
   - **Staff app link:** `https://YOUR-NAME.github.io/piper-industry-partners/`
6. Open the GitHub address, click **Sign in with your Piper Google account**, then click **Continue**. You're in.

### Part 5: Invite people
- **Staff:** send them the GitHub address. Everyone with a @piperschools.us account can **view**.
- **Admins:** on **Settings → Admins**, add the people who can add, edit, approve, and delete.
- **Partners:** open the **Partner form** page. It has the link, a QR code, a printable sign, and a ready-to-send invite email.

You do **not** need to share the spreadsheet with staff. The app works through your account.

---

## Making changes later (keep both copies in sync)

Apps Script deployments are frozen at the version you deployed. After any change:

1. **Changed `index.html`?** Upload it to GitHub (replace the old one; `config.js` keeps your links). Also paste it into Apps Script's `Index` file.
2. **Changed `Code.gs`?** Paste it into Apps Script, choose **setup**, and click **Run**. Setup is safe to re-run. It repairs formatting and the automatic sheet features.
3. In Apps Script, go to **Deploy → Manage deployments**. Click ✏️ on **Staff**, set Version to **New version**, and click **Deploy**. Then do the same for **Public**. The links don't change.

Forgetting step 3 is the most common reason a change "doesn't show up."

## If GitHub gets blocked at school

Nothing is lost, because the Google copy is the same app.
- Staff use the **Staff** Apps Script link.
- Partners use the **Public** link with `?page=join` added to the end. Update **Public partner form link** in Settings so new QR codes point there.

## If Piper leaves Google someday

- **The data:** go to **File → Download → Excel**. The tabs are plain, labeled columns.
- **The app:** every request goes through one function, `Backend.call(action, payload)`. A replacement bridge (Microsoft 365, a hosted database, and so on) only needs to answer the same ~15 actions that `Code.gs` handles. The screens don't change.

---

## Working directly in the spreadsheet

People who prefer the sheet can use it like any spreadsheet. The app keeps up on its own, and nobody has to do any extra steps.

- **Add a person:** type them into the next empty row on **Contacts**. Their ID, Status, and who added them fill in automatically within a second or two.
- **Edit anything:** just type. "Updated" and "Updated By" stamp themselves.
- **Roles, academies, and staff:** separate several with `;` or a comma. Capitalization doesn't matter. The choices are on the Settings tab.
- **Log participation in the sheet:** on **Engagements**, type the person's name (as it appears on Contacts) or their email under *Contact Name*, plus the date and activity. The Contact ID fills in, and their "Last Positive Contact" updates.
- **Sort, filter, move columns, add your own columns or formulas, and copy/paste rows:** all safe. The app finds columns by their names and people by their IDs.
  - Tip: use **Data → Create filter view** instead of a regular filter, so your filter doesn't change what everyone else sees.
- **Add a new role:** type it on the **Settings** tab. Its role tab and its spot on the partner form appear automatically.

**How fast is it?**
- **App → sheet:** about 1 second.
- **Sheet → app:** about 2–6 seconds. Open copies of the app check for changes every 5 seconds while someone is using them (every 30 seconds after 10 idle minutes), and update in place without losing their search or open panel. The green **Live** dot in the top bar shows it's connected.

**Two people editing the same person at once:** if one person edits in the sheet while another edits in the app, both changes are kept as long as they touched different fields. If they changed the *same* field, the app saves nothing, says who changed it, and offers to load their version.

**The only things to avoid:**
- **Renaming a column header.** You'll get a warning first, and admins see a red banner in the app until it's renamed back.
- **Typing on the role tabs.** They're live views; make edits on Contacts instead.
- **Changing or deleting someone's ID.**

> Anyone with **Editor** access to the sheet can change any record, just like an admin in the app. Give spreadsheet people Editor access only if they should be able to edit. Everyone else can use the app.

## The spreadsheet tabs

| Tab | What's on it |
|---|---|
| **Contacts** | One row per person. Roles and academies are separated by `; `. You can edit here directly, and the app picks it up. |
| **Engagements** | One row each time a partner helps: date, activity, academy, and staff. Logging one updates that person's "Last Positive Contact." |
| **Partnerships** | CCP, internship, and EE partners, linked to a contact by ID. |
| **Submissions** | Every public-form entry, with its status: Pending, Approved, Merged, or Rejected. |
| **Settings** | Roles and their descriptions, academies, relationships, staff names, admins, and links. |
| **Change Log** | Who changed what, and when. |
| **Role tabs** | Live, read-only views of Contacts for each role. Edit people on Contacts, not here. |

You can sort the sheet or add your own columns. The app finds columns by their header names, so keep those header names the same.

## Security notes
- Sign-in uses your Google account. The GitHub app gets a signed pass that lasts 14 days. If a laptop is lost or someone leaves, use **Settings → Sign everyone out**.
- Public-form text is always shown as plain text and stored safely, so it can't run code in the app or formulas in the sheet.
- Birthdays are not collected. "Raptor Cleared" records only the date someone was cleared.

## Troubleshooting
| Symptom | Fix |
|---|---|
| Rows typed in the sheet don't get an ID | Re-run **setup** once from Apps Script. It installs the automatic sheet features. The app also fills in missing IDs the next time anyone opens it. |
| The Live dot is yellow ("Reconnecting") | The app can't reach Google right now. It keeps retrying, and your data is safe. |
| "This app address is not approved yet" | Add the exact GitHub address to **Allowed GitHub app addresses** in Settings. |
| "Could not reach the server" | The Public deployment must be set to **Anyone**. Also deploy a **New version**. |
| A change doesn't appear | Use **Manage deployments → New version** on both deployments. |
| Everyone is view-only | Add admin emails on the **Settings** tab. |
| The sheet's role tabs look stale | Use **Industry Partners → Rebuild role tabs**. |
