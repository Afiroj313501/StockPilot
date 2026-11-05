# AI Business Assistant

The assistant is optional. Every feature of StockPilot works without it, and it answers questions even
when no AI provider is configured.

## Modes

- **Built-in** (default, no key needed): a small keyword router picks a question type and builds the
  answer from the read-only lookups below.
- **AI** (optional): a language model decides which lookups to run and writes the answer.
  Its answer is shown only if it passes the checks below; otherwise the built-in answer is shown with a notice.

## Configuration (.env)

| Variable        | Meaning                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `AI_PROVIDER`   | `none` (default) or `openai-compatible` (any service with the OpenAI chat API)     |
| `AI_API_KEY`    | The provider key. Stays on the server and is never sent to the browser or logged   |
| `AI_MODEL`      | The model name. Required with the key; without both, the app runs in built-in mode |
| `AI_BASE_URL`   | Default `https://api.openai.com/v1`                                                |
| `AI_TIMEOUT_MS` | Per provider call, 1000..60000 (default 15000)                                     |

To support another provider, implement `AiProvider` (`provider.ts`): one `complete()` method.

## The approved lookups ("tools")

`getSalesSummary`, `getTopSellingProducts`, `getLowStockProducts`, `getInventoryValuation`,
`getCategoryPerformance`, `explainReorderRecommendation`, `getReorderRecommendations`, `searchProducts`.
Each one:

- checks the user's role itself (manager or owner),
- validates its parameters strictly (unknown keys such as `storeId` are rejected),
- uses the store of the logged-in user, never one named in a parameter,
- only reads, through the same functions as the reports and the reorder planner.
  There is no SQL access and no write access.

## Checks on every AI answer

1. The reply must be JSON `{status, answer, limitations?}`.
2. At least one lookup must have succeeded.
3. Every number in the answer must appear in the lookup results or in the question (whole numbers 0..10
   are allowed for counting list items). Digits inside identifiers do not count.
4. Evidence shown to the user is built by the server from the lookup results, never by the model.

## Limits

Question up to 500 characters; at most 4 provider calls and 6 lookups per question; lookup results over
12,000 characters are refused; 30 seconds overall; 20 questions per user per 15 minutes.

## Privacy

Without a provider nothing leaves the server. With a provider, it receives the question and the lookup
results (product names, SKUs, sales, stock and cost figures), plus today's date, currency and time zone.
It never receives emails, staff or customer names, the store name or any API key. Product names are
treated as untrusted text. The server logs the mode, status, lookup names and duration, never the
question text.

## Limits of the assistant

Keyword matching in built-in mode; no conversation memory; answers are not saved; a correct model answer
that rounds or sums numbers itself is rejected by check 3.
