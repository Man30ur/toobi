import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : horton
// Nodes   : 4  |  Connections: 3
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// ChatWebhook                        webhook
// PrepareRequest                     code
// AskArvanAi                         httpRequest
// RespondToFrontend                  respondToWebhook
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// ChatWebhook
//    → PrepareRequest
//      → AskArvanAi
//        → RespondToFrontend
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: 'nrSySC6Z5fCtWZvB',
    name: 'horton',
    active: true,
    isArchived: false,
    settings: { executionOrder: 'v1' },
})
export class HortonWorkflow {
    // =====================================================================
    // CONFIGURATION DES NOEUDS
    // =====================================================================

    @node({
        id: 'dcaefaca-7b65-404c-84e4-796ee65e9e2b',
        webhookId: '06186a10-2b2d-477a-b1a3-96ed963b935d',
        name: 'Chat Webhook',
        type: 'n8n-nodes-base.webhook',
        version: 2.1,
        position: [160, 200],
    })
    ChatWebhook = {
        httpMethod: 'POST',
        path: 'horton-chat',
        authentication: 'none',
        responseMode: 'responseNode',
        responseCode: 200,
        responseBinaryPropertyName: 'data',
    };

    @node({
        id: 'aaf75f11-66bf-4f15-9381-c34d4252870e',
        name: 'Prepare Request',
        type: 'n8n-nodes-base.code',
        version: 2,
        position: [400, 200],
    })
    PrepareRequest = {
        mode: 'runOnceForAllItems',
        language: 'javaScript',
        jsCode: `const allowedOrigins = (process.env.HORTON_ALLOWED_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const item = items[0] || { json: {} };
const input = item.json || {};
const headers = input.headers || {};
const origin = headers.origin || headers.Origin || '';
const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0] || 'http://localhost:3000';
const message = String(input.body?.message ?? input.message ?? '').trim();

if (!message) {
  return [{
    json: {
      skipModel: true,
      statusCode: 400,
      response: {
        error: 'ورودی نامعتبر است. فیلد message الزامی است.',
      },
      corsOrigin,
    },
  }];
}

const apiKey = process.env.ARVAN_AI_API_KEY;
if (!apiKey) {
  return [{
    json: {
      skipModel: true,
      statusCode: 500,
      response: {
        error: 'کلید سرویس مدل روی سرور تنظیم نشده است.',
      },
      corsOrigin,
    },
  }];
}

return [{
  json: {
    skipModel: false,
    message,
    authorization: apiKey.startsWith('Bearer ') || apiKey.startsWith('apikey ') ? apiKey : 'Bearer ' + apiKey,
    corsOrigin,
  },
}];`,
    };

    @node({
        id: 'adaec5a7-dc2d-48a0-a573-d3df1140d524',
        name: 'Ask Arvan AI',
        type: 'n8n-nodes-base.httpRequest',
        version: 4.1,
        position: [640, 200],
    })
    AskArvanAi = {
        method: 'POST',
        url: 'https://arvancloudai.ir/gateway/models/Kimi-K2.5/v1/chat/completions',
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: 'Authorization',
                    value: '={{ $json.authorization }}',
                },
                {
                    name: 'Content-Type',
                    value: 'application/json',
                },
            ],
        },
        sendBody: true,
        specifyBody: 'json',
        jsonBody:
            "={{ $json.skipModel ? ({ skipped: true }) : ({ model: 'Kimi-K2.5', stream: false, messages: [{ role: 'user', content: $json.message }] }) }}",
        options: {
            response: {
                response: {
                    neverError: true,
                    responseFormat: 'json',
                },
            },
            timeout: 60000,
        },
    };

    @node({
        id: 'f79ae5ce-4974-4803-a03d-a8860c1f74cd',
        name: 'Respond to Frontend',
        type: 'n8n-nodes-base.respondToWebhook',
        version: 1.5,
        position: [880, 200],
    })
    RespondToFrontend = {
        respondWith: 'json',
        responseBody:
            "={{ (() => { const prepared = $('Prepare Request').item.json; if (prepared.skipModel) return prepared.response; const status = $json.statusCode || $json.status || 200; const content = $json.body?.choices?.[0]?.message?.content ?? $json.choices?.[0]?.message?.content ?? $json.answer; if (status >= 400) return { error: $json.body?.message || $json.message || $json.error || 'خطای سرویس مدل' }; if (!content) return { error: 'پاسخ معتبری از مدل دریافت نشد' }; return { reply: content, raw: $json.body ?? $json }; })() }}",
        options: {
            responseCode:
                "={{ $('Prepare Request').item.json.skipModel ? $('Prepare Request').item.json.statusCode : (($json.statusCode || $json.status || 200) >= 400 ? ($json.statusCode || $json.status || 502) : (($json.body?.choices?.[0]?.message?.content ?? $json.choices?.[0]?.message?.content ?? $json.answer) ? 200 : 502)) }}",
            responseHeaders: {
                entries: [
                    {
                        name: 'Access-Control-Allow-Origin',
                        value: "={{ $('Prepare Request').item.json.corsOrigin }}",
                    },
                    {
                        name: 'Access-Control-Allow-Headers',
                        value: 'Content-Type, Authorization',
                    },
                    {
                        name: 'Access-Control-Allow-Methods',
                        value: 'POST, OPTIONS',
                    },
                ],
            },
        },
    };

    // =====================================================================
    // ROUTAGE ET CONNEXIONS
    // =====================================================================

    @links()
    defineRouting() {
        this.ChatWebhook.out(0).to(this.PrepareRequest.in(0));
        this.PrepareRequest.out(0).to(this.AskArvanAi.in(0));
        this.AskArvanAi.out(0).to(this.RespondToFrontend.in(0));
    }
}
