// Login (mobile OTP or guest) and storage for saved products and bag sizes.
//
// With no Firebase config, the site runs in "device guest" mode: everything is
// kept in this browser's localStorage and mobile login is shown as not set up.
// With a Firebase config:
//   - Guest = Firebase anonymous sign-in; data lives in the cloud under that
//     guest's id, so logging in with a mobile number later keeps it.
//   - Mobile = Firebase phone auth (SMS OTP).
// Firestore layout (see firestore.rules):
//   users/{uid}                    { bags: [{w, l}, ...] }
//   users/{uid}/products/{pid}     { name, L, B, H, M, soft, updatedAt }
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';

// ---- stores ---------------------------------------------------------------
// Both stores share one shape: watchProducts(cb), watchBags(cb), saveProduct(id|null, body),
// deleteProduct(id), saveBags(bags), stop().
function localStore() {
  const PK = 'pb-products', BK = 'polybag-sizes';
  const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  let onProducts = () => {};
  const emit = () => onProducts([...read(PK, [])].sort((a, b) => b.updatedAt - a.updatedAt));
  return {
    kind: 'local',
    watchProducts(cb) { onProducts = cb; emit(); },
    watchBags(cb) { const b = read(BK, null); if (Array.isArray(b) && b.length) cb(b.map(x => Array.isArray(x) ? { w: x[0], l: x[1] } : x)); },
    async saveProduct(id, body) {
      const list = read(PK, []);
      id = id || 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const i = list.findIndex(p => p.id === id);
      if (i >= 0) list[i] = { id, ...body }; else list.push({ id, ...body });
      write(PK, list); emit(); return id;
    },
    async deleteProduct(id) { write(PK, read(PK, []).filter(p => p.id !== id)); emit(); },
    async saveBags(bags) { write(BK, bags.map(b => [b.w, b.l])); },
    stop() { onProducts = () => {}; },
  };
}

function cloudStore(fs, db, uid) {
  const userDoc = fs.doc(db, 'users', uid), col = fs.collection(db, 'users', uid, 'products');
  const unsubs = [];
  let bagWrite = Promise.resolve();
  return {
    kind: 'cloud',
    watchProducts(cb, onErr) {
      unsubs.push(fs.onSnapshot(fs.query(col, fs.orderBy('updatedAt', 'desc')),
        snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), onErr));
    },
    watchBags(cb, onErr) {
      unsubs.push(fs.onSnapshot(userDoc, snap => {
        const b = snap.exists() ? snap.data().bags : null;
        if (Array.isArray(b) && b.length) cb(b);
      }, onErr));
    },
    async saveProduct(id, body) {
      const ref = id ? fs.doc(col, id) : fs.doc(col);
      await fs.setDoc(ref, body);
      return ref.id;
    },
    async deleteProduct(id) { await fs.deleteDoc(fs.doc(col, id)); },
    saveBags(bags) {  // one write at a time
      bagWrite = bagWrite.catch(() => {}).then(() => fs.setDoc(userDoc, { bags }, { merge: true }));
      return bagWrite;
    },
    stop() { unsubs.splice(0).forEach(u => u()); },
  };
}

// ---- auth -----------------------------------------------------------------
// account.start(onChange) calls onChange({mode, label, store}) whenever the person changes.
//   mode: 'device-guest' | 'guest' | 'phone' | 'signed-out'
export function createAccount() {
  let fb = null, auth = null, fs = null, db = null, store = null, onChange = () => {};
  let verifier = null, confirmation = null, linking = false;
  const demo = firebaseConfig === 'demo';  // practice mode: no SMS, OTP 123456, data stays in the browser
  const enabled = demo || !!(firebaseConfig && firebaseConfig.apiKey);

  async function load() {
    let app, a, f;
    if (demo) { const m = await import('./demo-firebase.js'); [app, a, f] = [m.demoApp, m.demoAuth, m.demoFirestore]; }
    else [app, a, f] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')]);
    fb = { app, a }; fs = f;
    const appInst = app.initializeApp(firebaseConfig);
    auth = a.getAuth(appInst); auth.useDeviceLanguage();
    db = f.getFirestore(appInst);
  }

  function useStore(s, info) { store && store.stop(); store = s; onChange({ ...info, store: s }); }

  async function start(cb) {
    onChange = cb;
    if (!enabled) { useStore(localStore(), { mode: 'device-guest', label: 'Guest' }); return; }
    try { await load(); }
    catch (e) {
      useStore(localStore(), { mode: 'device-guest', label: 'Guest', error: "Couldn't load the login service. Your products are saved on this device for now." });
      return;
    }
    fb.a.onAuthStateChanged(auth, user => {
      if (!user) { store && store.stop(); store = null; onChange({ mode: 'signed-out', label: '', store: null }); return; }
      if (linking) return;  // the guest → mobile upgrade finishes in verifyOtp
      const s = cloudStore(fs, db, user.uid);
      useStore(s, user.isAnonymous ? { mode: 'guest', label: 'Guest' } : { mode: 'phone', label: user.phoneNumber || 'Signed in' });
    });
  }

  async function continueAsGuest() {
    if (!enabled) return;
    try { await fb.a.signInAnonymously(auth); }
    catch (e) {
      // anonymous sign-in switched off in Firebase: fall back to this device only
      useStore(localStore(), { mode: 'device-guest', label: 'Guest' });
    }
  }

  function resetVerifier() { try { verifier && verifier.clear(); } catch (e) {} verifier = null; }

  async function sendOtp(phone, buttonId) {
    if (!enabled) throw { code: 'not-configured' };
    resetVerifier();
    verifier = new fb.a.RecaptchaVerifier(auth, buttonId, { size: 'invisible' });
    const current = auth.currentUser;
    try {
      if (current && current.isAnonymous) {
        linking = true;
        confirmation = await fb.a.linkWithPhoneNumber(current, phone, verifier);
      } else {
        linking = false;
        confirmation = await fb.a.signInWithPhoneNumber(auth, phone, verifier);
      }
    } catch (e) { linking = false; resetVerifier(); throw e; }
  }

  // Returns {merged: n} when guest products were copied into an existing mobile account.
  async function verifyOtp(code, guestProducts) {
    if (!confirmation) throw { code: 'auth/missing-verification-id' };
    try {
      const cred = await confirmation.confirm(code);
      if (linking) {  // same uid, now with a phone number: data stays where it is
        linking = false;
        const u = cred.user;
        useStore(cloudStore(fs, db, u.uid), { mode: 'phone', label: u.phoneNumber || 'Signed in' });
      }
      return { merged: 0 };
    } catch (e) {
      if (e && e.code === 'auth/credential-already-in-use') {
        // this number already has an account: sign into it and bring the guest's products along
        const credential = fb.a.PhoneAuthProvider.credentialFromError(e);
        linking = false;
        const { user } = await fb.a.signInWithCredential(auth, credential);
        const target = cloudStore(fs, db, user.uid);
        for (const p of guestProducts) { const { id, ...body } = p; await target.saveProduct(null, body); }
        target.stop();
        return { merged: guestProducts.length };
      }
      throw e;
    }
  }

  async function logout() { if (enabled) await fb.a.signOut(auth); }

  return { enabled, demo, start, continueAsGuest, sendOtp, verifyOtp, logout, cancelOtp() { linking = false; confirmation = null; resetVerifier(); } };
}

// Messages people see for Firebase error codes.
export function authMessage(e) {
  const c = (e && e.code) || '';
  return ({
    'not-configured': "Mobile login isn't switched on for this site yet. You can still use it as a guest.",
    'auth/invalid-phone-number': 'That mobile number doesn\'t look right. Check the digits and try again.',
    'auth/missing-phone-number': 'Enter your mobile number.',
    'auth/too-many-requests': 'Too many attempts from this device. Wait a few minutes and try again.',
    'auth/quota-exceeded': "Today's OTP limit for this site has been reached. Try again later or continue as a guest.",
    'auth/billing-not-enabled': "OTP login isn't active yet: the site owner needs to turn on billing in Firebase.",
    'auth/operation-not-allowed': "Mobile login isn't enabled for this site yet.",
    'auth/invalid-verification-code': 'That OTP is wrong. Check the SMS and try again.',
    'auth/code-expired': 'That OTP has expired. Tap Resend to get a new one.',
    'auth/missing-verification-id': 'Request an OTP first.',
    'auth/network-request-failed': 'No connection. Check your internet and try again.',
    'auth/captcha-check-failed': "The security check didn't pass. Reload the page and try again.",
    'auth/unauthorized-domain': "This website address isn't allowed to use login yet. Add it in Firebase under Authentication → Settings → Authorized domains.",
  })[c] || 'Something went wrong. Try again.' + (c ? ` (${c})` : '');
}
