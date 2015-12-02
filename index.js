const urlBase64 = require('urlsafe-base64');
const crypto    = require('crypto');
const ece       = require('http_ece');
const url       = require('url');
const http      = require('http');
const https     = require('https');
var colors      = require('colors');

var gcmAPIKey = '';

function setGCMAPIKey(apiKey) {
  gcmAPIKey = apiKey;
}

function encrypt(userPublicKey, payload) {
  var localCurve = crypto.createECDH('prime256v1');

  var localPublicKey = localCurve.generateKeys();
  var localPrivateKey = localCurve.getPrivateKey();

  var sharedSecret = localCurve.computeSecret(userPublicKey);

  var salt = crypto.randomBytes(16);

  ece.saveKey('webpushKey', sharedSecret);

  var cipherText = ece.encrypt(payload, {
    keyid: 'webpushKey',
    salt: urlBase64.encode(salt),
  });

  return {
    localPublicKey: localPublicKey,
    salt: salt,
    cipherText: cipherText,
  };
}

function sendNotification(endpoint, TTL, userPublicKey, payload) {
  return new Promise(function(resolve, reject) {
    var urlParts = url.parse(endpoint);
    var options = {
      hostname: urlParts.hostname,
      port: urlParts.port,
      path: urlParts.pathname,
      method: 'POST',
      headers: {
        'Content-Length': 0,
      }
    };

    var encrypted;
    if (typeof payload !== 'undefined') {
      encrypted = encrypt(urlBase64.decode(userPublicKey), payload);
      options.headers = {
        'Content-Length': encrypted.cipherText.length,
        'Content-Type': 'application/octet-stream',
        'Encryption-Key': 'keyid=p256dh;dh=' + urlBase64.encode(encrypted.localPublicKey),
        'Encryption': 'keyid=p256dh;salt=' + urlBase64.encode(encrypted.salt),
        'Content-Encoding': 'aesgcm128',
      };
    }

    var gcmPayload;
    if (endpoint.indexOf('https://android.googleapis.com/gcm/send') === 0) {
      if (payload) {
        throw new Error('Payload not supported with GCM'.bold.red);
      }

      if (!gcmAPIKey) {
        console.warn('Attempt to send push notification to GCM endpoint, but no GCM key is defined'.bold.red);
      }

      var endpointSections = endpoint.split('/');
      var subscriptionId = endpointSections[endpointSections.length - 1];
      gcmPayload = JSON.stringify({
        registration_ids: [ subscriptionId ],
      });
      options.path = options.path.substring(0, options.path.length - subscriptionId.length - 1);

      options.headers['Authorization'] = 'key=' + gcmAPIKey;
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = gcmPayload.length;
    }

    if (typeof TTL !== 'undefined') {
      options.headers['TTL'] = TTL;
    }

    var expectedStatusCode = gcmPayload ? 200 : 201;
    var pushRequest = (urlParts.protocol.startsWith('https') ? https : http).request(options, function(pushResponse) {
      if (pushResponse.statusCode !== expectedStatusCode) {
        console.log('statusCode: ', pushResponse.statusCode);
        console.log('headers: ', pushResponse.headers);
        reject();
      } else {
        resolve();
      }
    });

    if (typeof payload !== 'undefined') {
      pushRequest.write(encrypted.cipherText);
    }
    if (gcmPayload) {
      pushRequest.write(gcmPayload);
    }
    pushRequest.end();

    pushRequest.on('error', function(e) {
      console.error(e);
      reject(e);
    });
  });
}

module.exports = {
  encrypt: encrypt,
  sendNotification: sendNotification,
  setGCMAPIKey: setGCMAPIKey,
}
