// Cloud Functions entry — export Express app เป็น HTTPS function
// deploy ด้วย `firebase deploy` (functions.source = backend/ ใน firebase.json)
// เข้าถึงผ่าน Hosting rewrite: /api/** → function นี้ (same-origin ไม่ต้อง CORS)
const functions = require("firebase-functions");

const app = require("./app");

exports.api = functions.region("asia-southeast1").https.onRequest(app);
