// Stand-in for Firebase used only in demo mode (firebaseConfig = 'demo').
// Behaves like the real login and database, but nothing leaves the browser:
// no SMS is sent, the OTP is always 123456, and data is kept in localStorage.
const DEMO_OTP = '123456';
const AK = 'demo-fb-auth', DK = 'demo-fb-db';
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const A = load(AK, { user: null, phones: {}, n: 0 });
const DB = load(DK, {});
const authListeners = [], dbSubs = [];
const persistAuth = () => save(AK, A);
const notifyAuth = () => { persistAuth(); authListeners.forEach(cb => setTimeout(() => cb(A.user))); };
const wait = ms => new Promise(r => setTimeout(r, ms));

export const demoApp = { initializeApp: c => ({ c }) };

export const demoAuth = {
  getAuth: () => ({ get currentUser() { return A.user; }, useDeviceLanguage() {} }),
  onAuthStateChanged(auth, cb) { authListeners.push(cb); setTimeout(() => cb(A.user)); return () => {}; },
  async signInAnonymously() { A.user = { uid: 'guest' + (++A.n), isAnonymous: true, phoneNumber: null }; notifyAuth(); return { user: A.user }; },
  RecaptchaVerifier: class { constructor() {} clear() {} },
  async signInWithPhoneNumber(auth, phone) {
    if (!/^\+\d{8,15}$/.test(phone)) throw { code: 'auth/invalid-phone-number' };
    await wait(500);
    return { confirm: async code => {
      if (code !== DEMO_OTP) throw { code: 'auth/invalid-verification-code' };
      const uid = A.phones[phone] || (A.phones[phone] = 'user' + (++A.n));
      A.user = { uid, isAnonymous: false, phoneNumber: phone }; notifyAuth(); return { user: A.user };
    } };
  },
  async linkWithPhoneNumber(user, phone) {
    if (!/^\+\d{8,15}$/.test(phone)) throw { code: 'auth/invalid-phone-number' };
    await wait(500);
    return { confirm: async code => {
      if (code !== DEMO_OTP) throw { code: 'auth/invalid-verification-code' };
      if (A.phones[phone]) throw { code: 'auth/credential-already-in-use', phone };
      A.phones[phone] = user.uid; A.user = { ...user, isAnonymous: false, phoneNumber: phone }; persistAuth(); return { user: A.user };
    } };
  },
  PhoneAuthProvider: { credentialFromError: e => ({ phone: e.phone }) },
  async signInWithCredential(auth, cred) { A.user = { uid: A.phones[cred.phone], isAnonymous: false, phoneNumber: cred.phone }; notifyAuth(); return { user: A.user }; },
  async signOut() { A.user = null; notifyAuth(); },
};

const notifyDb = () => { save(DK, DB); dbSubs.forEach(s => s.on && s.f()); };
const snapDoc = path => ({ id: path.split('/').pop(), exists: () => path in DB, data: () => DB[path] });
const owns = path => A.user && path.split('/')[1] === A.user.uid;  // same rule as firestore.rules
export const demoFirestore = {
  getFirestore: () => ({}),
  collection: (db, ...segs) => ({ type: 'col', path: segs.join('/') }),
  doc(a, ...segs) {
    if (a.type === 'col') { const id = segs[0] || 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); return { type: 'doc', path: a.path + '/' + id, id }; }
    return { type: 'doc', path: segs.join('/'), id: segs[segs.length - 1] };
  },
  orderBy: (f, dir) => ({ f, dir }),
  query: (col, o) => ({ type: 'query', col, o }),
  onSnapshot(ref, next, err) {
    const s = { on: true };
    s.f = ref.type === 'doc'
      ? () => owns(ref.path) ? next(snapDoc(ref.path)) : err && err({ code: 'permission-denied' })
      : () => {
        const base = ref.col.path, depth = base.split('/').length + 1;
        if (!owns(base)) return err && err({ code: 'permission-denied' });
        const docs = Object.keys(DB).filter(k => k.startsWith(base + '/') && k.split('/').length === depth).map(snapDoc);
        docs.sort((a, b) => (a.data()[ref.o.f] - b.data()[ref.o.f]) * (ref.o.dir === 'desc' ? -1 : 1));
        next({ docs });
      };
    dbSubs.push(s); setTimeout(s.f); return () => { s.on = false; };
  },
  async setDoc(ref, data, opts) {
    if (!owns(ref.path)) throw { code: 'permission-denied' };
    DB[ref.path] = opts && opts.merge ? { ...(DB[ref.path] || {}), ...data } : JSON.parse(JSON.stringify(data));
    notifyDb();
  },
  async deleteDoc(ref) { if (!owns(ref.path)) throw { code: 'permission-denied' }; delete DB[ref.path]; notifyDb(); },
};
