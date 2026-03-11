// =====================================================
// db.js — Firestore データベース操作
// =====================================================

var USERS_COLLECTION     = 'cc_users';
var PRODUCTS_COLLECTION  = 'cc_products';
var LOCATIONS_COLLECTION = 'cc_locations';

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

// =====================================================
// パスワードハッシュ（SHA-256）
// =====================================================
async function hashPassword(password) {
  var encoder = new TextEncoder();
  var data = encoder.encode(password);
  var hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(function (b) { return b.toString(16).padStart(2, '0'); })
    .join('');
}

// =====================================================
// ユーザー認証
// =====================================================
async function authenticateUser(username, password) {
  var hashedPw = await hashPassword(password);
  var snapshot = await db.collection(USERS_COLLECTION)
    .where('username', '==', username)
    .where('password', '==', hashedPw)
    .where('active',   '==', true)
    .get();
  return !snapshot.empty;
}

// =====================================================
// ユーザー一覧取得
// =====================================================
async function getUsers() {
  var snapshot = await db.collection(USERS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .get();
  return snapshot.docs.map(function (doc) {
    return Object.assign({ id: doc.id }, doc.data());
  });
}

// =====================================================
// ユーザー追加（重複チェック付き）
// =====================================================
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

// =====================================================
// ユーザー削除
// =====================================================
async function deleteUser(docId) {
  await db.collection(USERS_COLLECTION).doc(docId).delete();
}

// =====================================================
// 有効 / 無効 切り替え
// =====================================================
async function toggleUserActive(docId, active) {
  await db.collection(USERS_COLLECTION).doc(docId).update({ active: active });
}

// =====================================================
// パスワード変更
// =====================================================
async function changePassword(docId, newPassword) {
  if (!newPassword) throw new Error('新しいパスワードを入力してください');
  var hashedPw = await hashPassword(newPassword);
  await db.collection(USERS_COLLECTION).doc(docId).update({ password: hashedPw });
}

// =====================================================
// 製品マスタ — 一覧取得
// =====================================================
async function getProducts() {
  var snapshot = await db.collection(PRODUCTS_COLLECTION)
    .orderBy('created_at', 'desc')
    .get();
  return snapshot.docs.map(function (doc) {
    return Object.assign({ id: doc.id }, doc.data());
  });
}

// =====================================================
// 製品マスタ — 追加
// =====================================================
async function addProduct(productCode, productName, description) {
  if (!productCode || !productName) throw new Error('製品コードと製品名は必須です');
  var existing = await db.collection(PRODUCTS_COLLECTION)
    .where('product_code', '==', productCode)
    .get();
  if (!existing.empty) throw new Error('製品コード「' + productCode + '」は既に存在します');
  await db.collection(PRODUCTS_COLLECTION).add({
    product_code:           productCode,
    product_name:           productName,
    description:            description || '',
    cc_id:                  null,
    current_location_id:    null,
    current_location_code:  null,
    current_location_name:  null,
    current_location_cc_id: null,
    created_at: firebase.firestore.FieldValue.serverTimestamp(),
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// =====================================================
// 製品マスタ — 更新
// =====================================================
async function updateProduct(docId, productCode, productName, description) {
  if (!productCode || !productName) throw new Error('製品コードと製品名は必須です');
  var existing = await db.collection(PRODUCTS_COLLECTION)
    .where('product_code', '==', productCode)
    .get();
  var conflict = existing.docs.find(function (doc) { return doc.id !== docId; });
  if (conflict) throw new Error('製品コード「' + productCode + '」は既に存在します');
  await db.collection(PRODUCTS_COLLECTION).doc(docId).update({
    product_code: productCode,
    product_name: productName,
    description:  description || '',
    updated_at:   firebase.firestore.FieldValue.serverTimestamp()
  });
}

// =====================================================
// 製品マスタ — 削除
// =====================================================
async function deleteProduct(docId) {
  await db.collection(PRODUCTS_COLLECTION).doc(docId).delete();
}

// =====================================================
// 製品マスタ — 製品コードで検索
// =====================================================
async function getProductByCode(code) {
  var snapshot = await db.collection(PRODUCTS_COLLECTION)
    .where('product_code', '==', code)
    .get();
  if (snapshot.empty) return null;
  return Object.assign({ id: snapshot.docs[0].id }, snapshot.docs[0].data());
}

// =====================================================
// 製品マスタ — CCID で検索
// =====================================================
async function getProductByCCId(ccId) {
  var snapshot = await db.collection(PRODUCTS_COLLECTION)
    .where('cc_id', '==', ccId)
    .get();
  if (snapshot.empty) return null;
  return Object.assign({ id: snapshot.docs[0].id }, snapshot.docs[0].data());
}

// =====================================================
// 製品紐付 — 製品とCCIDを紐づける
// =====================================================
async function bindProductCC(productDocId, ccId) {
  // 場所マスタで使用中のCCIDでないか確認
  var locCheck = await db.collection(LOCATIONS_COLLECTION)
    .where('cc_id', '==', ccId)
    .get();
  if (!locCheck.empty) {
    var ld = locCheck.docs[0].data();
    throw new Error('CCID「' + ccId + '」は場所「' + ld.location_name + '」（' + ld.location_code + '）に使用されています。場所用CCIDは製品に紐づけできません。');
  }
  // 他の製品にすでに紐づいていないか確認
  var existing = await db.collection(PRODUCTS_COLLECTION)
    .where('cc_id', '==', ccId)
    .get();
  var conflict = existing.docs.find(function (doc) { return doc.id !== productDocId; });
  if (conflict) {
    var cd = conflict.data();
    throw new Error('CCID「' + ccId + '」は既に製品「' + cd.product_name + '」に紐づいています');
  }
  await db.collection(PRODUCTS_COLLECTION).doc(productDocId).update({
    cc_id:      ccId,
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// =====================================================
// 製品紐付 — CC紐づけ解除
// =====================================================
async function unbindProductCC(productDocId) {
  await db.collection(PRODUCTS_COLLECTION).doc(productDocId).update({
    cc_id:      null,
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// =====================================================
// 場所マスタ — 一覧取得
// =====================================================
async function getLocations() {
  var snapshot = await db.collection(LOCATIONS_COLLECTION)
    .orderBy('created_at', 'desc')
    .get();
  return snapshot.docs.map(function (doc) {
    return Object.assign({ id: doc.id }, doc.data());
  });
}

// =====================================================
// 場所マスタ — 追加
// =====================================================
async function addLocation(locationCode, locationName, ccId, description) {
  if (!locationCode || !locationName || !ccId) throw new Error('場所コード・場所名・CCIDは必須です');
  var existingCode = await db.collection(LOCATIONS_COLLECTION)
    .where('location_code', '==', locationCode)
    .get();
  if (!existingCode.empty) throw new Error('場所コード「' + locationCode + '」は既に存在します');
  var existingCC = await db.collection(LOCATIONS_COLLECTION)
    .where('cc_id', '==', ccId)
    .get();
  if (!existingCC.empty) throw new Error('CCID「' + ccId + '」は既に別の場所に使用されています');
  await db.collection(LOCATIONS_COLLECTION).add({
    location_code: locationCode,
    location_name: locationName,
    cc_id:         ccId,
    description:   description || '',
    created_at: firebase.firestore.FieldValue.serverTimestamp(),
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// =====================================================
// 場所マスタ — 更新
// =====================================================
async function updateLocation(docId, locationCode, locationName, ccId, description) {
  if (!locationCode || !locationName || !ccId) throw new Error('場所コード・場所名・CCIDは必須です');
  var existingCode = await db.collection(LOCATIONS_COLLECTION)
    .where('location_code', '==', locationCode)
    .get();
  var codeConflict = existingCode.docs.find(function (doc) { return doc.id !== docId; });
  if (codeConflict) throw new Error('場所コード「' + locationCode + '」は既に存在します');
  var existingCC = await db.collection(LOCATIONS_COLLECTION)
    .where('cc_id', '==', ccId)
    .get();
  var ccConflict = existingCC.docs.find(function (doc) { return doc.id !== docId; });
  if (ccConflict) throw new Error('CCID「' + ccId + '」は既に別の場所に使用されています');
  await db.collection(LOCATIONS_COLLECTION).doc(docId).update({
    location_code: locationCode,
    location_name: locationName,
    cc_id:         ccId,
    description:   description || '',
    updated_at:    firebase.firestore.FieldValue.serverTimestamp()
  });
}

// =====================================================
// 場所マスタ — 削除
// =====================================================
async function deleteLocation(docId) {
  await db.collection(LOCATIONS_COLLECTION).doc(docId).delete();
}

// =====================================================
// 場所マスタ — CCID で検索
// =====================================================
async function getLocationByCCId(ccId) {
  var snapshot = await db.collection(LOCATIONS_COLLECTION)
    .where('cc_id', '==', ccId)
    .get();
  if (snapshot.empty) return null;
  return Object.assign({ id: snapshot.docs[0].id }, snapshot.docs[0].data());
}

// =====================================================
// ロケーション紐付 — 製品に場所を紐づける
// =====================================================
async function bindProductLocation(productDocId, locationDocId, locationCode, locationName, locationCCId) {
  await db.collection(PRODUCTS_COLLECTION).doc(productDocId).update({
    current_location_id:    locationDocId,
    current_location_code:  locationCode,
    current_location_name:  locationName,
    current_location_cc_id: locationCCId,
    updated_at: firebase.firestore.FieldValue.serverTimestamp()
  });
}
