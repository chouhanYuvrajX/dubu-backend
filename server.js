/**
 * DUBU Push Notification Server
 * 
 * Kaise kaam karta hai:
 * 1. Firebase Realtime DB ko listen karta hai naye messages ke liye
 * 2. Jab naya message aaye, dusre user ka saved push subscription fetch karta hai
 * 3. web-push library se uske browser/phone pe notification bhejta hai
 * 4. Phone band ho, app band ho — tab bhi notification aayegi ✅
 */

const express = require('express');
const webpush = require('web-push');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors()); // Frontend se requests allow karne ke liye

// ============================================================
// STEP 1: VAPID Keys (ek baar generate karo, phir yahi use karo)
// Run karke dekho: node -e "const wp=require('web-push'); console.log(wp.generateVAPIDKeys())"
// Woh keys yahan daalo:
// ============================================================
const VAPID_PUBLIC_KEY  = 'BAPv0JuaDVO5uxiya6o_u7Mp3OO--yD6xc9pySYfOAaXVC04Au9c48L_TeRipeK_Bf67RzqPNaoEmrfn_XUVDhU';
const VAPID_PRIVATE_KEY = 'r7pHaZePhY9tSyGm2V-nXODo50nfWezB8sicoJrqp1g';

webpush.setVapidDetails(
  'mailto:dubu@example.com', // koi bhi email
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

// ============================================================
// STEP 2: Firebase Admin SDK
// Firebase Console > Project Settings > Service Accounts >
// "Generate new private key" > download karo > yahan path daalo
// ============================================================
const serviceAccount = require('./firebase-service-account.json'); // <-- apna file

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://dubu-app-9fbb5-default-rtdb.firebaseio.com'
});

const db = admin.database();

// ============================================================
// API: Frontend yahan push subscription save karta hai
// POST /subscribe  { role: 'yuvi'|'priyanshi', subscription: {...} }
// ============================================================
app.post('/subscribe', async (req, res) => {
  const { role, subscription } = req.body;
  if (!role || !subscription) return res.status(400).json({ error: 'role aur subscription chahiye' });

  try {
    await db.ref(`pushSubscriptions/${role}`).set(subscription);
    console.log(`✅ Subscription saved for: ${role}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('Subscribe error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// VAPID Public Key frontend ko dena (sw.js ko chahiye)
// GET /vapid-public-key
// ============================================================
app.get('/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC_KEY });
});

// ============================================================
// Firebase listener: naya message aaya? dusre ko push bhejo!
// ============================================================
let lastMsgTime = Date.now(); // Server start ke pehle ke messages ignore karo

db.ref('messages').on('child_added', async (snap) => {
  const msg = snap.val();
  if (!msg) return;
  if (msg.time < lastMsgTime) return; // Purane messages skip
  lastMsgTime = msg.time + 1;

  const sender = msg.sender; // 'yuvi' ya 'priyanshi'
  const receiver = sender === 'yuvi' ? 'priyanshi' : 'yuvi';

  console.log(`📩 New message from ${sender} → ${receiver}: "${msg.text || '[media]'}"`);

  // Receiver ka push subscription fetch karo
  const subSnap = await db.ref(`pushSubscriptions/${receiver}`).once('value');
  const subscription = subSnap.val();

  if (!subscription) {
    console.log(`⚠️ ${receiver} ka push subscription nahi mila (unhone allow nahi kiya hoga)`);
    return;
  }

  // Notification payload
  const payload = JSON.stringify({
    title: msg.senderName || (sender === 'yuvi' ? 'Billuu 💙' : 'Dilluu 💕'),
    body: msg.type === 'voice'
      ? '🎤 Voice message bheja'
      : msg.type === 'image'
        ? '📷 Image bheja'
        : (msg.text || '💌 Naya message'),
    icon: '/logo.png',
    tag: 'dubu-msg',
    url: '/'
  });

  try {
    await webpush.sendNotification(subscription, payload);
    console.log(`✅ Push sent to ${receiver}`);
  } catch (err) {
    if (err.statusCode === 410) {
      // Subscription expire ho gayi — delete karo
      console.log(`🗑️ Expired subscription for ${receiver}, removing...`);
      await db.ref(`pushSubscriptions/${receiver}`).remove();
    } else {
      console.error('Push error:', err.message);
    }
  }
});

// Server start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 DUBU Push Server running on port ${PORT}`);
  console.log(`📡 Firebase listen kar raha hai naye messages ke liye...`);
});
