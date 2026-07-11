import { OperatorLoginForm } from "./login-form";

/**
 * Operator login page — Story: real operator auth.
 *
 * A minimal single-field form (a password input carrying the shared operator
 * key) that posts to the `loginOperator` server action via a client component
 * using `useActionState` (the Next 16 idiomatic way to surface a server
 * action's return value — a generic error message — back to the UI without a
 * full page-reload flash).
 *
 *   - force-dynamic so the route evaluates at request time (the action's env
 *     resolution must not be frozen at build).
 *   - No public navigation link to this page (operators know the URL). The
 *     middleware redirects unauthenticated /console/* traffic here.
 *   - Chinese copy (the operator console is an internal Chinese-language
 *     surface — matches /console's existing copy).
 */
export const dynamic = "force-dynamic";

export default function OperatorLoginPage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-20">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">运营台登录</h1>
          <p className="text-ink-secondary">请输入运营密钥以进入复核台。</p>
        </header>
        <OperatorLoginForm />
      </div>
    </main>
  );
}
