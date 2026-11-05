import { useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { useAiStatus, useAsk } from '../features/assistant/hooks';
import { ApiError } from '../lib/api';
import type { AiAnswer, AiEvidence } from '../types/api';

interface Turn {
  id: number;
  question: string;
  result?: AiAnswer;
  error?: string;
}

function EvidenceList({ evidence }: { evidence: AiEvidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium text-blue-600">Data used for this answer</summary>
      <ul className="mt-2 space-y-3">
        {evidence.map((item, index) => (
          <li key={`${item.tool}-${index}`} className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium text-navy-900">{item.label}</p>
            {item.period && (
              <p className="text-xs text-slate-500">
                {item.period.from} to {item.period.to} ({item.period.timeZone})
              </p>
            )}
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {Object.entries(item.metrics).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="text-navy-900">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">
        These figures come straight from your store data, not from the AI.
      </p>
    </details>
  );
}

export function AssistantPage() {
  const status = useAiStatus();
  const ask = useAsk();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    const question = text.trim();
    if (question === '') {
      setFieldError('Type a question.');
      return;
    }
    if (question.length > 500) {
      setFieldError('Use at most 500 characters.');
      return;
    }
    setFieldError(null);
    const id = Date.now();
    ask.mutate(question, {
      onSuccess: (result) => setTurns((previous) => [{ id, question, result }, ...previous]),
      onError: (error) =>
        setTurns((previous) => [
          {
            id,
            question,
            error: error instanceof ApiError ? error.message : 'Something went wrong. Please try again.',
          },
          ...previous,
        ]),
    });
    setText('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Business assistant</h1>
        <p className="mt-1 text-sm text-slate-600">
          Ask about sales, profit, best sellers, stock, inventory value and reorders. Answers come from your own
          data. Nothing here changes any data, and answers are not saved.
        </p>
      </div>

      {status.data && (
        <div role="note" className="rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
          <p className="font-medium text-navy-900">
            {status.data.mode === 'AI'
              ? `AI mode is on (${status.data.providerName}). Built-in answers are used if the AI fails.`
              : 'Built-in mode: answers are built on this server from your data. No AI provider is used.'}
          </p>
          <p className="mt-1 text-slate-600">{status.data.privacy}</p>
        </div>
      )}
      {status.isError && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          Could not load the assistant settings.
        </div>
      )}

      <form onSubmit={send} noValidate className="space-y-3">
        <label htmlFor="question" className="block text-sm font-medium text-navy-900">
          Your question
        </label>
        <textarea
          id="question"
          ref={inputRef}
          rows={2}
          maxLength={500}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-navy-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">{text.length} / 500</p>
          <Button type="submit" loading={ask.isPending}>
            Ask
          </Button>
        </div>
        {fieldError && (
          <p role="alert" className="text-sm text-red-600">
            {fieldError}
          </p>
        )}
      </form>

      {status.data && (
        <div>
          <p className="text-sm font-medium text-navy-900">Try one of these</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {status.data.supportedQuestions.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => {
                  setText(question);
                  inputRef.current?.focus();
                }}
                className="rounded-full bg-white px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      {turns.length > 0 && (
        <ul className="space-y-4" aria-label="Answers">
          {turns.map((turn) => (
            <li key={turn.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm font-semibold text-navy-900">{turn.question}</p>
              {turn.error && (
                <p role="alert" className="mt-2 text-sm text-red-700">
                  {turn.error}
                </p>
              )}
              {turn.result && (
                <>
                  {turn.result.notice && (
                    <p role="status" className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                      {turn.result.notice}
                    </p>
                  )}
                  {turn.result.answer ? (
                    <p className="mt-2 whitespace-pre-line text-sm text-slate-800">{turn.result.answer}</p>
                  ) : (
                    turn.result.status !== 'ANSWERED' && (
                      <div className="mt-2 text-sm text-slate-700">
                        <p>I can&apos;t answer that from your store data.</p>
                        <p className="mt-1">I can help with questions like:</p>
                        <ul className="mt-1 list-disc pl-5">
                          {turn.result.supportedQuestions.map((question) => (
                            <li key={question}>{question}</li>
                          ))}
                        </ul>
                      </div>
                    )
                  )}
                  {turn.result.status === 'UNSUPPORTED' && turn.result.answer && (
                    <p className="mt-1 text-xs text-slate-500">Try one of the example questions above.</p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    {turn.result.mode === 'AI' ? 'AI answer, checked against your data' : 'Built-in answer'}
                  </p>
                  <EvidenceList evidence={turn.result.evidence} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
