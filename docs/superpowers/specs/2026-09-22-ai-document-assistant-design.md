# IvorySQL AI Document Assistant Design

## Summary

Add a bilingual AI document assistant to the IvorySQL website. The assistant
uses the existing Alibaba Cloud Model Studio (Bailian) knowledge base and
published knowledge Q&A application. A Netlify Function protects the Bailian
API key, validates and rate-limits requests, translates Bailian's SSE protocol
into a small website-owned protocol, and streams answers to a global chat
widget.

The website will not gain a database. Conversation state remains in the
visitor's browser for the current tab, while Bailian continues to own document
retrieval, reranking, answer generation, and citations.

## Goals

- Answer visitor questions using the latest stable IvorySQL documentation.
- Support both Chinese and English website visitors.
- Stream answers and show verifiable document sources.
- Keep the Bailian API key and provider-specific protocol out of the browser.
- Work on Netlify without adding a persistent backend database.
- Fit the website's existing responsive layout, themes, and localization.
- Bound abuse and model spend on a public anonymous endpoint.

## Non-goals

The first release will not include:

- user accounts or cross-device conversation history;
- file uploads or session-file parsing;
- voice, image, or multimodal responses;
- historical IvorySQL version selection;
- feedback storage or an analytics database;
- automatic synchronization from `ivorysql_docs` to Bailian;
- a reusable third-party `<script>` embed package;
- general web search or answers grounded in non-IvorySQL sources.

## Existing Context

- The website is a Next.js 15 App Router application deployed on Netlify.
- Localized website routes use `src/app/[locale]`, with `en` and `zh` locales.
- The global localized layout already owns the navbar, main content, footer,
  theme provider, and `NextIntlClientProvider`.
- Website translations live in `messages/en.json` and `messages/zh.json`.
- The source documentation is in `IvorySQL/ivorysql_docs`, with Chinese and
  English AsciiDoc content.
- The first release indexes only the latest stable documentation.
- A combined Chinese/English Bailian knowledge base and a published knowledge
  Q&A application already exist.
- Netlify already contains `DASHSCOPE_API_KEY`, `BAILIAN_BASE_URL`, and
  `BAILIAN_AGENT_ID`. The API key is a newly rotated key and is not committed.

## Architecture

```text
Visitor
  |
  | POST /api/assistant (messages + locale)
  v
Netlify Function
  |-- validate and bound input
  |-- rate-limit per domain and IP
  |-- attach server-only credentials
  |-- translate Bailian SSE to website SSE
  v
Bailian knowledge Q&A application
  |
  | search latest IvorySQL knowledge base
  v
Answer tokens + retrieved document metadata
  |
  v
Netlify Function -> browser chat widget
```

The website owns the public API contract. Provider events such as planning and
tool calls never become part of the browser contract. This keeps the UI stable
if Bailian changes its event shape or is replaced later.

## Bailian Configuration

The published knowledge Q&A application uses:

- multi-turn intelligent retrieval;
- session-file pre-parsing disabled;
- refusal enabled;
- anti-leak enabled;
- multimodal/rich responses disabled;
- citations enabled;
- web search disabled;
- the existing combined latest-version knowledge base.

The application prompt must require the following behavior:

- answer from the latest IvorySQL official documentation only;
- reply in the language of the visitor's latest question;
- prefer documents in the same language as the question;
- format SQL, shell commands, and configuration as code blocks;
- do not invent features, parameters, compatibility claims, or commands;
- refuse when retrieved material is insufficient;
- cite the official document sources used for technical claims.

The public website never receives the Bailian API key. The application ID and
base URL are read from server-side Netlify environment variables.

## Netlify Function

### Location and route

Create an explicit Netlify Function under `netlify/functions` and expose it at:

```text
POST /api/assistant
```

An explicit function is preferred over a Next.js route handler because it can
declare Netlify's code-based per-IP rate limit next to the handler. It also
supports a streamed `ReadableStream` response.

### Public request contract

```ts
type AssistantRequest = {
  locale: "en" | "zh";
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
};
```

Validation rules:

- method must be `POST`;
- `Content-Type` must be `application/json`;
- locale must be `en` or `zh`;
- the array must contain 1 to 20 messages (at most 10 user/assistant rounds);
- roles must be `user` or `assistant`; client-supplied system/tool roles fail;
- every content value must be non-empty after trimming;
- each message is at most 2,000 Unicode characters;
- the final message must have the `user` role;
- the full request body is capped at approximately 32 KB.

Invalid requests return `400` without calling Bailian.

### Upstream request

The function calls:

```text
${BAILIAN_BASE_URL}/api/v2/apps/knowledge/chat
```

It supplies the server-only API key in the `Authorization` header, forwards the
validated conversation, sets `agent_options.agent_id` from
`BAILIAN_AGENT_ID`, and always enables streaming.

The locale is not inserted as a synthetic conversation message because that
would degrade document retrieval. It controls website copy and local error
messages; the Bailian application prompt makes the answer follow the language
of the latest visitor question.

### Stream translation

The function incrementally parses Bailian SSE frames and emits website-owned
SSE events:

```text
event: token
data: {"content":"..."}

event: sources
data: {"items":[...]}

event: done
data: {}

event: error
data: {"code":"UPSTREAM_ERROR","message":"..."}
```

Only content from Bailian's `generating` stage becomes `token` events.
Planning text and tool-call details are never sent to the visitor. Retrieved
documents from tool-return frames are accumulated, deduplicated, normalized,
and sent once as a `sources` event before `done`.

```ts
type AssistantSource = {
  id: string;
  title: string;
  section?: string;
  url?: string;
};
```

If Bailian supplies a canonical public document URL, the function keeps it
only when it uses HTTPS and belongs to `docs.ivorysql.org`. If the knowledge
base returns only a title or uploaded filename, the source remains visible but
is not rendered as a link. Bailian temporary download or signed URLs are never
exposed. A filename-to-canonical-URL manifest can be added later without
changing the public API contract.

### Limits and security

- Rate limit: 10 requests per 60 seconds per domain and IP.
- Abort the upstream request after 55 seconds so the function can emit a final
  error before Netlify's 60-second streaming execution limit.
- Allow same-origin browser use only; do not add permissive CORS headers.
- Return `Cache-Control: no-store` for all assistant responses.
- Treat model output as untrusted Markdown and never enable raw HTML parsing.
- Do not interpolate model output into HTML or URLs.
- Use generic visitor-facing errors and keep upstream details in server logs.
- Never log authorization headers, environment variables, full prompts, or
  full answers.

Server logs may contain only:

- an application request ID;
- locale;
- status/result category;
- total duration and time to first answer token;
- answer completion state;
- citation count;
- Bailian request ID when available.

## Chat Widget

### Placement

Add one client-side `AssistantWidget` after the footer in the localized root
layout so every website route has access to it.

- Desktop: a fixed bottom-right launcher opens an approximately 400 by 600 px
  panel.
- Mobile: the launcher opens a full-height or near-full-height dialog that
  respects safe-area insets and the on-screen keyboard.
- The widget uses existing color tokens and follows light/dark theme changes.
- Its stacking order is above page content without interfering with the sticky
  navbar or mobile navigation.

### Interaction

The closed control has a localized accessible name. Opening the assistant:

- moves focus into the dialog;
- shows a localized title, capability notice, and three suggested questions;
- places the input at the bottom;
- supports Enter to send and Shift+Enter for a newline;
- permits closing with Escape;
- returns focus to the launcher on close.

During generation, the user can stop the request. The UI keeps partial output
when a stream is interrupted and marks it incomplete. A failed response can be
retried. A clear-conversation action removes both visible and stored history.

Answers render through `react-markdown` with GitHub-flavored Markdown. Raw HTML
support is deliberately omitted. Code blocks use horizontal scrolling and a
copy action. Source cards appear after an answer, with external-link treatment
for verified document URLs.

### Local state

Conversation state is stored in `sessionStorage`, namespaced by locale. It is
restored on refresh in the same tab and removed when the tab session ends.
Before each request, the widget sends only the latest 20 messages. No cookies,
visitor identifier, or persistent server storage are introduced.

## Localization

Add an `Assistant` namespace to both message files. It includes:

- launcher and dialog labels;
- introduction and AI accuracy disclaimer;
- input placeholder and action labels;
- suggested questions;
- source and incomplete-answer labels;
- validation, timeout, rate-limit, and generic error messages.

The interface locale comes from the existing localized route. Answer language
is based on the latest user question, as required by the Bailian application
prompt. This allows a visitor on either route to ask in the other language.

## Error Handling

| Condition | HTTP/stream behavior | Visitor experience |
| --- | --- | --- |
| Invalid request | `400` JSON | Localized validation message |
| Method not allowed | `405` JSON | Generic failure; input retained |
| Rate limit exceeded | Netlify `429` | Localized wait-and-retry message |
| Missing server config | `503` JSON | Service unavailable; no variable names |
| Bailian rejects request | error event or `502` | Generic upstream error and retry |
| Bailian timeout | `TIMEOUT` error event | Partial text retained and marked incomplete |
| Client abort | upstream fetch aborted | Generation stops without a failure toast |
| Malformed upstream frame | frame logged and skipped | Continue unless no answer can be produced |
| No citations | normal completion | Answer shown with an unverified-source note |

## Proposed File Boundaries

```text
netlify/functions/assistant.mts
  Public endpoint, validation, rate limit, timeout, and streaming response.

src/lib/assistant/types.ts
  Website-owned request, message, stream-event, and source contracts.

src/lib/assistant/bailian-stream.ts
  Provider-specific SSE parsing and event normalization.

src/components/assistant/AssistantWidget.tsx
  Launcher, dialog lifecycle, session state, and request orchestration.

src/components/assistant/AssistantMessage.tsx
  Safe Markdown response and source rendering.

src/components/assistant/AssistantComposer.tsx
  Text input, send/stop controls, and keyboard behavior.

messages/en.json and messages/zh.json
  Localized assistant interface copy.

src/app/[locale]/layout.tsx
  One global widget mount point.
```

Provider parsing stays independent of React, and UI components never import
provider-specific types. This separation makes both sides independently
testable and keeps a future provider migration local to the server adapter.

## Verification

### Automated project gates

- `pnpm lint`
- `pnpm build`

The repository currently has no automated test framework. The implementation
plan will isolate stream parsing and validation so they can be tested with the
lightest compatible runner rather than introducing a broad test stack solely
for UI snapshots.

### Manual functional checks

- Open, close, and restore focus in desktop and mobile layouts.
- Verify English and Chinese UI copy.
- Verify light and dark themes.
- Confirm incremental answer rendering and stop behavior.
- Confirm Markdown, links, tables, SQL, and shell blocks render safely.
- Confirm a page refresh restores the current tab's conversation.
- Confirm clearing the conversation removes session storage.
- Confirm a rejected, timed-out, and interrupted request has a recoverable UI.
- Confirm the eleventh request inside a minute receives a rate-limit response.
- Inspect browser source, bundles, and network responses for API-key leakage.
- Verify affected routes on both `en` and `zh` at desktop and mobile widths.

### Answer-quality evaluation

Maintain a fixed pre-launch set of at least 30 questions:

- 10 Chinese documentation questions;
- 10 English documentation questions;
- 5 multi-turn follow-ups;
- 5 out-of-scope or prompt-injection questions.

Acceptance targets:

- at least 90% of in-scope questions are correct or substantially correct;
- technical conclusions have a displayed source;
- out-of-scope questions refuse instead of inventing an answer;
- answer language follows the latest visitor question;
- attempts to reveal prompts or bulk-export the knowledge base are refused;
- simple questions normally show the first answer token within five seconds,
  while complex multi-turn retrieval may take longer.

## Rollout

1. Implement and verify locally with Netlify Dev.
2. Deploy to a Netlify Deploy Preview using non-production environment values.
3. Run the functional and 30-question quality checks.
4. Confirm logs contain metadata only and rate limiting works.
5. Publish to production.
6. Monitor Bailian usage, errors, latency, and spend during the first week.

If production usage or cost is materially higher than expected, first reduce
the per-IP rate limit or temporarily disable the widget. Retrieval mode or
model changes should be evaluated against the fixed question set before being
published.

## References

- [Bailian knowledge Q&A API](https://help.aliyun.com/zh/model-studio/knowledgechat)
- [Bailian RAG API overview](https://help.aliyun.com/zh/model-studio/rag-api-overview)
- [Netlify Functions API](https://docs.netlify.com/build/functions/api/)
- [Netlify rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
