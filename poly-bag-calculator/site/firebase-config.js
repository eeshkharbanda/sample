// Paste your Firebase web app config here to switch on mobile OTP login and cloud saving.
// Firebase console → Project settings → General → Your apps → Web app → SDK setup and configuration → Config.
// These values are not secret: they identify the project; firestore.rules is what protects the data.
// Leave it as null and the site still works, in guest mode, saving on each person's device.
export const firebaseConfig = null;
/* Example shape:
export const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123",
};
*/
