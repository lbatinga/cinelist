/**
 * CineList — Notificações Push via Firebase FCM v1
 * 
 * COMO CONFIGURAR:
 * 1. Abra script.google.com → crie/abra o projeto CineList
 * 2. Cole TODO este código (substituindo o que tinha antes)
 * 3. Preencha SUPABASE_KEY abaixo com a service_role key do Supabase
 * 4. Preencha SERVICE_ACCOUNT_KEY com a chave privada da conta de serviço do Firebase
 * 5. Publique: Implantar → Nova implantação → Tipo: App da Web
 *    - Executar como: Eu
 *    - Quem tem acesso: Qualquer pessoa
 * 6. IMPORTANTE: Cada vez que editar, publique uma NOVA implantação (não "editar existente")
 *    senão as mudanças não refletem!
 */

// ══════════════════════════════════════════
// CONFIGURAÇÕES — PREENCHA AQUI
// ══════════════════════════════════════════
const FCM_PROJECT_ID = "cinelist-new";
const SUPABASE_URL   = "https://gxwbxrnoqhkjwqfzmdpz.supabase.co";
const SUPABASE_KEY   = "COLE_SUA_SERVICE_ROLE_KEY_AQUI"; // ← Supabase → Settings → API → service_role (secret)

// Conta de serviço do Firebase (Firebase Console → Configurações → Contas de serviço → Gerar nova chave privada)
// Cole APENAS o campo "private_key" do JSON baixado (a string que começa com -----BEGIN PRIVATE KEY-----)
const SERVICE_ACCOUNT_EMAIL = "firebase-adminsdk-XXXXX@cinelist-new.iam.gserviceaccount.com"; // ← do JSON
const SERVICE_ACCOUNT_KEY   = "-----BEGIN PRIVATE KEY-----\nCOLE_SUA_CHAVE_AQUI\n-----END PRIVATE KEY-----\n"; // ← do JSON


// ══════════════════════════════════════════
// HANDLER PRINCIPAL (recebe chamadas GET)
// ══════════════════════════════════════════
function doGet(e) {
  try {
    const titulo = e.parameter.titulo || '🎬 CineList';
    const body   = e.parameter.body   || '';
    const isTest = e.parameter.test   === '1';

    Logger.log("doGet recebido — titulo: " + titulo + " | body: " + body + " | test: " + isTest);

    if (!body && !isTest) {
      return jsonResponse({ ok: false, error: "Parâmetro 'body' vazio" });
    }

    // Busca tokens FCM do Supabase
    const tokens = getFCMTokens();
    Logger.log("Tokens encontrados: " + tokens.length);

    if (tokens.length === 0) {
      return jsonResponse({ ok: true, status: "no_tokens", message: "Nenhum token FCM registrado no Supabase" });
    }

    // Obtém access token do Firebase
    const accessToken = getFirebaseAccessToken();
    Logger.log("Access token obtido: " + (accessToken ? "sim" : "NÃO"));

    let sent = 0, errors = [];
    tokens.forEach(function(tokenObj) {
      try {
        sendPush(accessToken, tokenObj.token, titulo, body);
        sent++;
      } catch(err) {
        Logger.log("Erro ao enviar para " + tokenObj.email + ": " + err);
        errors.push(tokenObj.email + ": " + String(err));
      }
    });

    Logger.log("Enviadas: " + sent + "/" + tokens.length);
    return jsonResponse({ ok: true, sent: sent, total: tokens.length, errors: errors });

  } catch(err) {
    Logger.log("ERRO doGet: " + err);
    return jsonResponse({ ok: false, error: String(err) });
  }
}

// Também suporta POST (caso use webhook do Supabase)
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    const record  = payload.record || {};
    const titulo  = '🎬 Novo filme adicionado!';
    const body    = '"' + (record.nome || 'Filme') + '" foi adicionado ao catálogo';

    Logger.log("doPost (webhook) — filme: " + record.nome);

    const tokens = getFCMTokens();
    const accessToken = getFirebaseAccessToken();
    let sent = 0;
    tokens.forEach(function(t) {
      try { sendPush(accessToken, t.token, titulo, body); sent++; } catch(err) { Logger.log("Erro: " + err); }
    });

    return jsonResponse({ ok: true, sent: sent });
  } catch(err) {
    Logger.log("ERRO doPost: " + err);
    return jsonResponse({ ok: false, error: String(err) });
  }
}


// ══════════════════════════════════════════
// BUSCA TOKENS FCM NO SUPABASE
// ══════════════════════════════════════════
function getFCMTokens() {
  try {
    var res = UrlFetchApp.fetch(
      SUPABASE_URL + "/rest/v1/fcm_tokens?select=email,token",
      {
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": "Bearer " + SUPABASE_KEY
        },
        muteHttpExceptions: true
      }
    );
    
    var code = res.getResponseCode();
    Logger.log("Supabase response code: " + code);
    
    if (code !== 200) {
      Logger.log("Supabase erro: " + res.getContentText());
      return [];
    }
    
    var data = JSON.parse(res.getContentText());
    Logger.log("Tokens retornados do Supabase: " + JSON.stringify(data));
    return data.filter(function(r) { return r.token; });
  } catch(e) {
    Logger.log("Erro ao buscar tokens: " + e);
    return [];
  }
}


// ══════════════════════════════════════════
// AUTENTICAÇÃO FIREBASE (OAuth2 via Service Account)
// ══════════════════════════════════════════
function getFirebaseAccessToken() {
  var now    = Math.floor(Date.now() / 1000);
  var header = Utilities.base64EncodeWebSafe(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  var claim  = Utilities.base64EncodeWebSafe(JSON.stringify({
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));

  var signatureInput = header + "." + claim;
  var signature = Utilities.base64EncodeWebSafe(
    Utilities.computeRsaSha256Signature(signatureInput, SERVICE_ACCOUNT_KEY)
  );
  var jwt = signatureInput + "." + signature;

  var tokenRes = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    },
    muteHttpExceptions: true
  });

  var tokenCode = tokenRes.getResponseCode();
  if (tokenCode !== 200) {
    Logger.log("Erro OAuth: " + tokenRes.getContentText());
    throw new Error("OAuth falhou: " + tokenCode);
  }

  var tokenData = JSON.parse(tokenRes.getContentText());
  return tokenData.access_token;
}


// ══════════════════════════════════════════
// ENVIA PUSH VIA FCM V1
// ══════════════════════════════════════════
function sendPush(accessToken, fcmToken, title, body) {
  var url = "https://fcm.googleapis.com/v1/projects/" + FCM_PROJECT_ID + "/messages:send";

  var payload = {
    message: {
      token: fcmToken,
      notification: {
        title: title,
        body: body
      },
      webpush: {
        fcm_options: {
          link: "https://lbatinga.github.io/cinelist/"
        }
      }
    }
  };

  var res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code !== 200) {
    var errText = res.getContentText();
    Logger.log("FCM erro (" + code + "): " + errText);
    // Token inválido/expirado → remove do Supabase
    if (errText.includes("UNREGISTERED") || errText.includes("INVALID_ARGUMENT")) {
      removeInvalidToken(fcmToken);
    }
    throw new Error("FCM " + code + ": " + errText);
  }
}


// ══════════════════════════════════════════
// LIMPA TOKENS INVÁLIDOS
// ══════════════════════════════════════════
function removeInvalidToken(fcmToken) {
  try {
    UrlFetchApp.fetch(
      SUPABASE_URL + "/rest/v1/fcm_tokens?token=eq." + encodeURIComponent(fcmToken),
      {
        method: "delete",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": "Bearer " + SUPABASE_KEY
        },
        muteHttpExceptions: true
      }
    );
    Logger.log("Token inválido removido: " + fcmToken.substring(0, 20) + "...");
  } catch(e) {
    Logger.log("Erro ao remover token: " + e);
  }
}


// ══════════════════════════════════════════
// HELPER
// ══════════════════════════════════════════
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ══════════════════════════════════════════
// TESTE MANUAL (rode esta função pelo editor do Apps Script)
// ══════════════════════════════════════════
function testeManual() {
  var tokens = getFCMTokens();
  Logger.log("=== TESTE ===");
  Logger.log("Tokens encontrados: " + tokens.length);
  tokens.forEach(function(t) {
    Logger.log("  → " + t.email + " | token: " + t.token.substring(0, 30) + "...");
  });

  if (tokens.length > 0) {
    try {
      var accessToken = getFirebaseAccessToken();
      Logger.log("Access token OK");
      sendPush(accessToken, tokens[0].token, "🎬 Teste CineList", "Se você viu isso, as notificações estão funcionando! 🎉");
      Logger.log("✅ Push enviado para " + tokens[0].email);
    } catch(e) {
      Logger.log("❌ Erro: " + e);
    }
  }
}
