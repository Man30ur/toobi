import { workflow, node, links } from '@n8n-as-code/transformer';

// <workflow-map>
// Workflow : Simple AI Chat Manual
// Nodes   : 3  |  Connections: 2
//
// NODE INDEX
// ──────────────────────────────────────────────────────────────────
// Property name                    Node type (short)         Flags
// WhenChatMessageReceived            chatTrigger                
// ArvanApi                           httpRequest                
// RespondToChat                      respondToChat              
//
// ROUTING MAP
// ──────────────────────────────────────────────────────────────────
// WhenChatMessageReceived
//    → ArvanApi
//      → RespondToChat
// </workflow-map>

// =====================================================================
// METADATA DU WORKFLOW
// =====================================================================

@workflow({
    id: "smjef6LuZU2LQBgs",
    name: "Simple AI Chat Manual",
    active: true,
    isArchived: false,
    projectId: "kQfoyngrr5e1rBQz",
    settings: { executionOrder: "v1", binaryMode: "separate" }
})
export class SimpleAiChatManualWorkflow {

    // =====================================================================
// CONFIGURATION DES NOEUDS
// =====================================================================

    @node({
        id: "dbe93e2f-bb84-4b57-9cae-5dc04bfcd54f",
        webhookId: "6a5bc33d-74a7-4872-a810-7ecbbf50a777",
        name: "When chat message received",
        type: "@n8n/n8n-nodes-langchain.chatTrigger",
        version: 1.1,
        position: [2112, 208]
    })
    WhenChatMessageReceived = {
        options: {
            responseMode: "responseNode"
        }
    };

    @node({
        id: "9dfd7b52-200f-456a-981e-4d8c711f0886",
        name: "Arvan API",
        type: "n8n-nodes-base.httpRequest",
        version: 4.1,
        position: [2336, 208]
    })
    ArvanApi = {
        method: "POST",
        url: "https://arvancloudai.ir/gateway/models/Kimi-K2.5/v1/chat/completions",
        sendHeaders: true,
        headerParameters: {
            parameters: [
                {
                    name: "Authorization",
                    value: "={{ (process.env.ARVAN_AI_API_KEY || '').startsWith('Bearer ') || (process.env.ARVAN_AI_API_KEY || '').startsWith('apikey ') ? process.env.ARVAN_AI_API_KEY : 'Bearer ' + (process.env.ARVAN_AI_API_KEY || '') }}"
                },
                {
                    name: "Content-Type",
                    value: "application/json"
                }
            ]
        },
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ ({ model: 'Kimi-K2.5', stream: false, messages: [{ role: 'user', content: $json.chatInput ?? $json.message ?? '' }] }) }}",
        options: {
            response: {
                response: {
                    responseFormat: "json"
                }
            },
            timeout: 60000
        }
    };

    @node({
        id: "f3d2f15a-a9d4-4f28-bbfb-2c5be7c6a1ce",
        name: "Respond to Chat",
        type: "@n8n/n8n-nodes-langchain.respondToChat",
        version: 1.3,
        position: [2576, 208]
    })
    RespondToChat = {
        respondWith: "text",
        responseBody: "={{ $json.choices?.[0]?.message?.content || $json.answer || \"\" }}",
        options: {}
    };


    // =====================================================================
// ROUTAGE ET CONNEXIONS
// =====================================================================

    @links()
    defineRouting() {
        this.WhenChatMessageReceived.out(0).to(this.ArvanApi.in(0));
        this.ArvanApi.out(0).to(this.RespondToChat.in(0));
    }
}