import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-navy-900">Page not found</h1>
        <Link
          to="/"
          className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline"
        >
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
