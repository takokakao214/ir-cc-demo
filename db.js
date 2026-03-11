// =====================================================
// db.js — Firestore データベース操作
// =====================================================

var USERS_COLLECTION = 'cc_users';
var db;

// -----------------------------------------------------
// Firebase 初期化（重複防止）
// -----------------------------------------------------
try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  db = firebase.firestore();
} catch (e) {
  console.error('Firebase 初期化エラー:', e);
}

// -----------------------------------------------------
// パスワードハッシュ（SHA-256）
// -----------------------------------------------------
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(function (b) { return b.toString(16).padStart(2, '0'); })
    .join('');
}

// -----------------------------------------------------
// ユーザー認証
// 戻り値: true（認証OK） / false（NG）
// -----------------------------------------------------
async function authenticateUser(username, password) {
  var hashedPw = await hashPassword(password);
  var snapshot = await db.collection(USERS_COLLECTION)
    .where('username', '==', username)
    .where('password', '==', hashedPw)
    .where('active',   '==', true)
    .get();
  return !snapshot.empty;
}

// -----------------------------------------------------
// ユーザー一覧取得
// -----------------------------------------------------
async function getUsers() {
  var snapshot = await db.collection(USERS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map(function (doc) {
    return Object.assign({ id: doc.id }, doc.data());
  });
}

// -----------------------------------------------------
// ユーザー追加（重複チェック付き）
// -----------------------------------------------------
async function addUser(username, password) {
  if (!username || !password) throw new Error('ユーザー名とパスワードを入力してください');

  var existing = await db.collection(USERS_COLLECTION)
    .where('username', '==', username)
    .get();
  if (!existing.empty) throw new Error('そのユーザー名は既に使用されています');

  var hashedPw = await hashPassword(password);
  await db.collection(USERS_COLLECTION).add({
    username:  username,
    password:  hashedPw,
    active:    true,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// -----------------------------------------------------
// ユーザー削除
// -----------------------------------------------------
async function deleteUser(docId) {
  await db.collection(USERS_COLLECTION).doc(docId).delete();
}

// -----------------------------------------------------
// 有効 / 無効 切り替え
// -----------------------------------------------------
async function toggleUserActive(docId, active) {
  await db.collection(USERS_COLLECTION).doc(docId).update({ active: active });
}

// -----------------------------------------------------
// パスワード変更
// -----------------------------------------------------
async function changePassword(docId, newPassword) {
  if (!newPassword) throw new Error('新しいパスワードを入力してください');
  var hashedPw = await hashPassword(newPassword);
  await db.collection(USERS_COLLECTION).doc(docId).update({ password: hashedPw });
}
