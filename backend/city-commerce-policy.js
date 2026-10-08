'use strict';

/**
 * SchoolPark City commerce classification.
 * Pure server-side policy helper; this module does not process payments.
 * Caller MUST load the authoritative shop/product from the database.
 */
const SHOP_TYPES = Object.freeze({
  VIRTUAL: 'schoolpark_virtual',
  PARTNER: 'real_partner',
});
const PAYMENT_METHODS = Object.freeze({
  EMUER_LEDGER: 'emuer_ledger',
  EMUER_WALLET: 'emuer_wallet',
  JPY_CARD: 'jpy_card',
  JPY_CASH: 'jpy_cash',
  JPYC_REJI: 'jpyc_reji',
});
const allowed = Object.freeze({
  [SHOP_TYPES.VIRTUAL]: Object.freeze([PAYMENT_METHODS.EMUER_LEDGER, PAYMENT_METHODS.EMUER_WALLET]),
  [SHOP_TYPES.PARTNER]: Object.freeze([PAYMENT_METHODS.JPY_CARD, PAYMENT_METHODS.JPY_CASH, PAYMENT_METHODS.JPYC_REJI]),
});

function permittedMethods(shopType) {
  return allowed[shopType] ? [...allowed[shopType]] : [];
}

function assertPaymentAllowed({ shopType, paymentMethod }) {
  if (!Object.hasOwn(allowed, shopType)) {
    const error = new Error('CITY_SHOP_TYPE_UNSUPPORTED');
    error.code = 'CITY_SHOP_TYPE_UNSUPPORTED';
    throw error;
  }
  if (!allowed[shopType].includes(paymentMethod)) {
    const error = new Error('CITY_PAYMENT_METHOD_FORBIDDEN');
    error.code = 'CITY_PAYMENT_METHOD_FORBIDDEN';
    throw error;
  }
  return true;
}

/**
 * Reji is not integrated. Never interpret a checkout link as proof of payment.
 */
function isVerifiedPayment({ provider, verifiedByServer }) {
  if (provider === 'reji') return false;
  return verifiedByServer === true;
}

module.exports = { SHOP_TYPES, PAYMENT_METHODS, permittedMethods, assertPaymentAllowed, isVerifiedPayment };
