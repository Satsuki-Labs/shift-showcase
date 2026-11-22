// Set Script Properties SHARED_TOKEN and MAIL_TO (one maintainer address).
// The added mail scope requires redeployment and renewed authorization.
// Deploy as a web app: execute as the
// deploying app account, with access for anyone (Cloudflare authenticates by token).
function doPost(event) {
  var answer;
  try {
    var text = event && event.postData && event.postData.contents;
    var request = typeof text === 'string' && text.length <= 40 * 1024 * 1024 ? JSON.parse(text) : null;
    answer = request && request.kind === 'backup' ? saveBackup(request)
      : request && request.kind === 'mail' ? sendMaintainerMail(request) : { ok: false, code: 'rejected' };
  } catch (error) { answer = backupException(error); }
  return ContentService.createTextOutput(JSON.stringify(answer)).setMimeType(ContentService.MimeType.JSON);
}
function sendMaintainerMail(request) {
  var keys = ['version', 'kind', 'token', 'subject', 'body'];
  if (!request || Array.isArray(request) || Object.keys(request).sort().join(',') !== keys.sort().join(',')
    || request.version !== 1 || request.kind !== 'mail'
    || typeof request.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.token)
    || typeof request.subject !== 'string' || request.subject.length < 1 || request.subject.length > 200
    || typeof request.body !== 'string' || request.body.length < 1 || request.body.length > 100000) return { ok: false, code: 'rejected' };
  var properties = PropertiesService.getScriptProperties();
  if (!backupSecretEqual(request.token, properties.getProperty('SHARED_TOKEN'))) return { ok: false, code: 'rejected' };
  var to = properties.getProperty('MAIL_TO');
  if (typeof to !== 'string' || !/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(to)) return { ok: false, code: 'rejected' };
  MailApp.sendEmail(to, request.subject, request.body);
  return { ok: true, status: 'sent' };
}
function saveBackup(request) {
  if (!request || typeof request.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.token)
    || !backupSecretEqual(request.token, PropertiesService.getScriptProperties().getProperty('SHARED_TOKEN'))) return { ok: false, code: 'rejected' };
  var keys = ['version', 'kind', 'token', 'key', 'createdAt', 'data'];
  if (!request || Array.isArray(request) || Object.keys(request).sort().join(',') !== keys.sort().join(',')
    || request.version !== 1 || request.kind !== 'backup'
    || typeof request.key !== 'string' || !/^[A-Za-z0-9-]+$/.test(request.key)
    || typeof request.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(request.createdAt)
    || !isFinite(new Date(request.createdAt).getTime()) || new Date(request.createdAt).toISOString() !== request.createdAt
    || typeof request.data !== 'string' || !request.data.length || request.data.length % 4 !== 0
    || /[^A-Za-z0-9+/=]/.test(request.data)
    || (request.data.indexOf('=') !== -1 && !/^[A-Za-z0-9+/]*(?:[A-Za-z0-9+/]=|==)$/.test(request.data.slice(-4)))
    || request.data.slice(0, -2).indexOf('=') !== -1) return { ok: false, code: 'rejected' };
  var bytes;
  try { bytes = Utilities.base64Decode(request.data); }
  catch (_) { return { ok: false, code: 'rejected' }; }
  if (bytes.length < 18 || (bytes[0] & 255) !== 31 || (bytes[1] & 255) !== 139 || bytes[2] !== 8) return { ok: false, code: 'rejected' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: false, code: 'temporary' };
  try {
    var folders = DriveApp.getRootFolder().getFoldersByName('シフトのバックアップ');
    var folder = folders.hasNext() ? folders.next() : DriveApp.getRootFolder().createFolder('シフトのバックアップ');
    var files = folder.getFiles(), backups = [], duplicate = false;
    var pattern = /^シフトのバックアップ_\d{4}-\d{2}-\d{2}_\d{4}_([A-Za-z0-9-]+)\.json\.gz$/;
    while (files.hasNext()) {
      var file = files.next(), match = pattern.exec(file.getName());
      if (!match) continue;
      backups.push(file);
      if (match[1] === request.key) duplicate = true;
    }
    if (!duplicate) {
      var name = 'シフトのバックアップ_' + Utilities.formatDate(new Date(request.createdAt), 'Asia/Tokyo', 'yyyy-MM-dd_HHmm') + '_' + request.key + '.json.gz';
      var saved = folder.createFile(Utilities.newBlob(bytes, 'application/gzip', name));
      if (!saved || saved.getName() !== name || saved.getSize() !== bytes.length) throw new Error('Backup not confirmed');
      backups.push(saved);
    }
    backups.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
    var monthlyBackups = {}, months = [];
    for (var i = 10; i < backups.length; i++) {
      var month = Utilities.formatDate(backups[i].getDateCreated(), 'Asia/Tokyo', 'yyyy-MM');
      if (!monthlyBackups[month]) months.push(month);
      monthlyBackups[month] = backups[i];
    }
    var keptMonthly = months.slice(0, 12).map(function (month) { return monthlyBackups[month]; });
    for (var i = 10; i < backups.length; i++) {
      if (keptMonthly.indexOf(backups[i]) === -1) backups[i].setTrashed(true);
    }
    return { ok: true, status: duplicate ? 'duplicate' : 'saved' };
  } finally { lock.releaseLock(); }
}
function backupException(error) {
  var message = String(error && error.message || error);
  if (/quota|limit exceeded|too many times|storage.*(?:full|exceeded)|not enough (?:storage|space)|Service using too much/i.test(message)) return { ok: false, code: 'quota' };
  if (/permission|authoriz|access denied|not have access|権限|承認/i.test(message)) return { ok: false, code: 'rejected' };
  if (error instanceof SyntaxError) return { ok: false, code: 'rejected' };
  return { ok: false, code: 'temporary' };
}
function backupSecretEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !right) return false;
  var different = left.length ^ right.length;
  for (var i = 0; i < Math.max(left.length, right.length); i++) different |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return different === 0;
}
