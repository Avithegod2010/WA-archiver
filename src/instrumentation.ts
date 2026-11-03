/**
 * Next.js instrumentation hook — runtime dispatcher.
 *
 * Purpose (security fix, app-lock): see src/instrumentation-node.ts. The
 * actual http patch must live in a separate file because Next compiles
 * `instrumentation.ts` for BOTH runtimes; a direct `node:http` import
 * here fails the Edge bundle's static analysis. With the import hidden
 * behind the `NEXT_RUNTIME === 'nodejs'` guard in this file, the Edge
 * build eliminates the branch entirely (this is the pattern from the
 * Next.js instrumentation docs).
 *
 * Static export builds (CAP_EXPORT / PAGES_EXPORT) never boot a Node
 * server, so this hook simply never runs there; the device transport's
 * app lock is fully client-side and unaffected.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { activateSocketAddrHook } = await import('./instrumentation-node')
    activateSocketAddrHook()
  }
}
