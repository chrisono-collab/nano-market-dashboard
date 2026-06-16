import { login } from './actions'

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const error = searchParams.error

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0e1a] text-gray-100 p-6">
      <div className="w-full max-w-sm bg-[#111827] border border-[#1f2937] rounded-xl p-8">
        <div className="text-center mb-8">
          <p className="mono text-xs tracking-[0.2em] text-green-400 uppercase mb-1">
            Nano Market ATX
          </p>
          <h1 className="text-xl font-semibold text-white mb-1">Sales Dashboard</h1>
          <p className="mono text-xs text-gray-500">Sign in to continue</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-900/20 border border-red-500/30 rounded-lg p-3 mono text-xs text-red-400 text-center">
            ⚠ {error}
          </div>
        )}

        <form action={login} className="space-y-4">
          <div>
            <label htmlFor="email" className="block mono text-xs text-gray-500 mb-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full bg-[#0a0e1a] border border-[#1f2937] text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-green-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block mono text-xs text-gray-500 mb-1">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full bg-[#0a0e1a] border border-[#1f2937] text-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-green-500"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-green-500 text-black rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-green-400 transition-colors"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  )
}
