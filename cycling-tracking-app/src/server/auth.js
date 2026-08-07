const crypto = require('crypto');

const verificationCodes = new Map();
const authSecret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function storeCode(phoneNumber, code) {
  verificationCodes.set(phoneNumber, { code, createdAt: Date.now() });
}

function verifyCode(phoneNumber, code) {
  const entry = verificationCodes.get(phoneNumber);
  if (!entry) return false;

  if (entry.code !== code) return false;

  verificationCodes.delete(phoneNumber);
  return true;
}

function sendCode(phoneNumber) {
  const code = generateCode();
  storeCode(phoneNumber, code);
  return code;
}

function createAuthToken(participantId) {
  const signature = crypto.createHmac('sha256', authSecret).update(participantId).digest('hex');
  return `${signature}:${participantId}`;
}

function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;

  const [signature, participantId] = token.split(':');
  if (!signature || !participantId) return null;

  const expected = crypto.createHmac('sha256', authSecret).update(participantId).digest('hex');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  return participantId;
}

module.exports = {
  sendCode,
  verifyCode,
  createAuthToken,
  verifyAuthToken,
};
