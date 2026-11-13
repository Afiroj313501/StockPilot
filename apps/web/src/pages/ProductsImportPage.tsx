import { ArrowLeft, Download } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { useImportProducts, usePreviewImport } from '../features/catalog/importHooks';
import { ApiError } from '../lib/api';
import type { ImportReport, ImportResult, ImportRow } from '../types/api';

const MAX_CHARS = 750_000;
const TEMPLATE =
  'sku,name,barcode,category,unit,description,costPrice,sellingPrice,reorderThreshold\r\n' +
  'COLA-500,Cola 500ml,5449000000996,Drinks,bottle,Soft drink,0.50,1.25,10\r\n';

const STATUS_STYLE: Record<ImportRow['status'], string> = {
  CREATE: 'bg-green-100 text-green-800',
  UPDATE: 'bg-blue-100 text-blue-800',
  SKIP: 'bg-slate-100 text-slate-700',
  ERROR: 'bg-red-100 text-red-800',
};
const STATUS_LABEL: Record<ImportRow['status'], string> = {
  CREATE: 'Create',
  UPDATE: 'Update',
  SKIP: 'Skip',
  ERROR: 'Problem',
};

function downloadTemplate() {
  const url = URL.createObjectURL(
    new Blob(['\uFEFF', TEMPLATE], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'products-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Please try again.';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-navy-900">{value}</p>
    </div>
  );
}

export function ProductsImportPage() {
  const check = usePreviewImport();
  const run = useImportProducts();
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string | null>(null);
  const [mode, setMode] = useState<'skip' | 'update'>('skip');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clear = () => {
    setReport(null);
    setResult(null);
    setError(null);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    clear();
    const file = e.target.files?.[0];
    if (!file) {
      setCsv(null);
      setFileName(null);
      return;
    }
    const text = await file.text();
    if (text.length > MAX_CHARS) {
      setCsv(null);
      setFileName(null);
      setError(
        'This file is too large. Split it into files of at most 750,000 characters (about 2,000 products).',
      );
      return;
    }
    setFileName(file.name);
    setCsv(text);
  };

  const onCheck = () => {
    if (!csv) return;
    clear();
    check.mutate(
      { csv, existing: mode },
      { onSuccess: setReport, onError: (err) => setError(message(err)) },
    );
  };

  const onImport = () => {
    if (!csv || !report?.canImport) return;
    setError(null);
    run.mutate(
      { csv, existing: mode },
      {
        onSuccess: (value) => {
          setResult(value);
          setReport(null);
        },
        onError: (err) => {
          setError(message(err));
          setReport(null);
        },
      },
    );
  };

  const total = report ? report.summary.create + report.summary.update : 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/products"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Products
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-navy-900">Import products from CSV</h1>
        <p className="mt-1 text-sm text-slate-600">
          First <strong>check</strong> your file: nothing is saved. Then import. If anything is
          wrong, nothing is imported. Stock is not part of an import: use{' '}
          <strong>Adjust stock</strong> afterwards.
        </p>
      </div>

      <section
        className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"
        aria-label="Choose a file"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-700">
            Needs a <strong>sku</strong> column. New products also need <strong>name</strong>,{' '}
            <strong>costPrice</strong> and <strong>sellingPrice</strong>. Optional: barcode,
            category, unit, description, reorderThreshold. Save the file as{' '}
            <strong>CSV UTF-8</strong>.
          </p>
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download className="h-4 w-4" aria-hidden="true" /> Download template
          </Button>
        </div>

        <div>
          <label htmlFor="csv-file" className="block text-sm font-medium text-navy-900">
            CSV file
          </label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e)}
            className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium"
          />
          {fileName && <p className="mt-1 text-xs text-slate-500">Selected: {fileName}</p>}
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-navy-900">If a SKU already exists</legend>
          <div className="mt-2 space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === 'skip'}
                onChange={() => {
                  setMode('skip');
                  clear();
                }}
                className="mt-0.5 h-4 w-4 text-blue-600"
              />
              <span>
                <span className="font-medium text-navy-900">Skip it</span>
                <span className="block text-slate-500">
                  Existing products stay exactly as they are.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="mode"
                checked={mode === 'update'}
                onChange={() => {
                  setMode('update');
                  clear();
                }}
                className="mt-0.5 h-4 w-4 text-blue-600"
              />
              <span>
                <span className="font-medium text-navy-900">Update it</span>
                <span className="block text-slate-500">
                  Only columns with a value are changed. Blank cells keep the current value.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <Button disabled={!csv} loading={check.isPending} onClick={onCheck}>
          Check file
        </Button>
      </section>

      {error && (
        <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && (
        <div
          role="status"
          className="rounded-2xl bg-green-50 p-5 text-sm text-green-900 ring-1 ring-green-200"
        >
          <p className="font-semibold">Import finished.</p>
          <p className="mt-1">
            {result.created} created, {result.updated} updated, {result.skipped} skipped
            {result.categoriesCreated > 0
              ? `, ${result.categoriesCreated} new categor${result.categoriesCreated === 1 ? 'y' : 'ies'}`
              : ''}
            .
          </p>
          <p className="mt-1">New products start with 0 in stock. Use Adjust stock to add stock.</p>
          <Link to="/products" className="mt-2 inline-block font-medium text-blue-700 underline">
            Go to products
          </Link>
        </div>
      )}

      {report && (
        <section aria-label="Check results" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Rows" value={report.summary.rows} />
            <Stat label="Will create" value={report.summary.create} />
            <Stat label="Will update" value={report.summary.update} />
            <Stat label="Skipped" value={report.summary.skip} />
            <Stat label="Problems" value={report.summary.errors} />
          </div>

          {report.summary.newCategories.length > 0 && (
            <p className="text-sm text-slate-700">
              New categories that will be created:{' '}
              <strong>{report.summary.newCategories.join(', ')}</strong>
            </p>
          )}

          {report.columns.ignored.length > 0 && (
            <div role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">These columns will be ignored:</p>
              <ul className="mt-1 list-disc pl-5">
                {report.columns.ignored.map((column) => (
                  <li key={column.column}>
                    {column.column}: {column.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.issues.length > 0 && (
            <div>
              <h2 className="mb-2 text-lg font-semibold text-navy-900">Problems to fix</h2>
              <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Line
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Column
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Problem
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.issues.map((issue, index) => (
                      <tr key={index}>
                        <td className="px-4 py-3">{issue.line}</td>
                        <td className="px-4 py-3">{issue.column ?? '—'}</td>
                        <td className="px-4 py-3 text-red-700">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.issuesTruncated && (
                <p className="mt-2 text-xs text-slate-500">
                  Only the first 200 problems are shown.
                </p>
              )}
            </div>
          )}

          {report.rows.length > 0 && (
            <div>
              <h2 className="mb-2 text-lg font-semibold text-navy-900">Preview</h2>
              <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Line
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        SKU
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Name
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.rows.slice(0, 50).map((row) => (
                      <tr key={row.line}>
                        <td className="px-4 py-3">{row.line}</td>
                        <td className="px-4 py-3">{row.sku || '—'}</td>
                        <td className="px-4 py-3">{row.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[row.status]}`}
                          >
                            {STATUS_LABEL[row.status]}
                          </span>
                          {row.messages.length > 0 && (
                            <span className="ml-2 text-xs text-slate-500">{row.messages[0]}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.summary.rows > 50 && (
                <p className="mt-2 text-xs text-slate-500">
                  Showing the first 50 of {report.summary.rows} rows. The whole file is checked.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!report.canImport} loading={run.isPending} onClick={onImport}>
              {total > 0 ? `Import ${total} product${total === 1 ? '' : 's'}` : 'Nothing to import'}
            </Button>
            {!report.canImport && report.issues.length > 0 && (
              <p className="text-sm text-slate-600">
                Fix the problems in your file, choose it again and check once more.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
