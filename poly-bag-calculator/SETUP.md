# Putting the Poly Bag Calculator online with mobile OTP login

The website is in `site/`. It works in two modes:

| Mode | When | What people get |
|---|---|---|
| **Guest only** | `site/firebase-config.js` still says `null` | Full calculator. Saved products stay in each person's own browser. "Log in with mobile" shows "not switched on yet". |
| **Mobile OTP + guest** | You've pasted your Firebase config (steps below) | Log in with mobile number + OTP, or continue as guest. Products are saved in the cloud. A guest who logs in later keeps their products. |

Everything below is done once, in about 20–30 minutes, with your own Google account.

---

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Create a project**. Name it, e.g. `polybag-calculator`. Google Analytics is optional; you can switch it off.
2. **Upgrade to the Blaze (pay-as-you-go) plan**: the gear icon → *Usage and billing* → *Details & settings* → *Modify plan*. SMS OTP does not work on the free plan.
3. **Set a budget alert straight away**: Google Cloud console → *Billing* → *Budgets & alerts*, e.g. ₹500/month. It emails you before costs surprise you. (A budget alert warns you; it does not stop charges.)

## 2. Switch on the login methods

*Build → Authentication → Get started → Sign-in method*:

1. **Phone** → Enable → Save.
2. **Anonymous** → Enable → Save. (This is the "Continue as guest" option.)
3. **Limit SMS to India** (important against SMS fraud, where bots trigger OTPs to expensive foreign numbers): *Authentication → Settings → SMS region policy* → **Allow** → select **India** only (add others only if you really have users there).
4. **Free test numbers** for trying it out: *Sign-in method → Phone → Phone numbers for testing* → add e.g. `+91 99999 00000` with code `123456`. Test numbers never send a real SMS and cost nothing.

## 3. Create the database

*Build → Firestore Database → Create database* → choose location **asia-south1 (Mumbai)** → **Start in production mode**. (The security rules in `firestore.rules` are uploaded in step 5; they make sure each person can only see their own products.)

## 4. Connect the website to your project

1. Gear icon → **Project settings** → *General* → *Your apps* → click the **`</>`** (Web) icon → give it a nickname → **Register app** (no need to tick Firebase Hosting here).
2. Copy the `firebaseConfig = { ... }` values it shows.
3. Open `site/firebase-config.js` and replace `export const firebaseConfig = null;` with:

   ```js
   export const firebaseConfig = {
     apiKey: "…",
     authDomain: "…",
     projectId: "…",
     storageBucket: "…",
     messagingSenderId: "…",
     appId: "…",
   };
   ```

   These values are **not secret** — they're in every Firebase website's code. The data is protected by `firestore.rules`, not by hiding this config. (You can paste them to me in chat and I'll put them in.)

## 5. Put it online (Firebase Hosting, free tier)

On a computer with [Node.js](https://nodejs.org) installed, in a terminal:

```bash
npm install -g firebase-tools
firebase login                         # opens your browser to sign in with Google
cd poly-bag-calculator                 # this folder (the one with firebase.json)
firebase use --add                     # pick your project, alias "default"
firebase deploy                        # uploads the site + the database rules
```

It prints your website address, like **`https://polybag-calculator.web.app`**. Share that link.

To update the site later: change the files, run `firebase deploy` again.

**Using your own domain** (e.g. `bags.yourbrand.in`): *Hosting → Add custom domain*, follow the DNS steps, then add the domain under *Authentication → Settings → Authorized domains*, or OTP login will fail there with "This website address isn't allowed".

## 6. Check it works

1. Open the site, tap **Log in with mobile number**, use your test number `99999 00000` and code `123456`.
2. Save a product, log out, log back in: it's still there.
3. Tap **Continue as guest**, save a product, then log in with mobile: the product comes with you.
4. Try one real number once to see the SMS arrive.

---

## What it costs

- **SMS OTP**: billed per SMS by Google. Third-party guides put India at roughly **$0.07 (≈ ₹6) per SMS**; check the current rate on Firebase's pricing page. People stay logged in on their device, so each person usually needs an OTP only once per device.
- **Guest login, database, hosting**: free at this scale (Firebase's free allowances cover tens of thousands of reads/writes a day).

## Files

| File | What it is |
|---|---|
| `site/index.html` | The page |
| `site/app.js` | Calculator, saved products, login screens |
| `site/account.js` | Firebase login (OTP + guest) and saving; falls back to browser storage without config |
| `site/firebase-config.js` | Your project's config (step 4) |
| `firestore.rules` | Database security: each person reads/writes only their own data |
| `firebase.json` | Hosting + rules settings for `firebase deploy` |
