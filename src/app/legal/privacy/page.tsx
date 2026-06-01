export const metadata = { title: "Privacy policy · TradeReady" };

export default function PrivacyPage() {
  return (
    <div className="legal-shell">
      <h1>Privacy policy</h1>
      <p className="legal-draft"><strong>Draft — review with a lawyer before launch.</strong></p>

      <h2>What we collect</h2>
      <ul>
        <li>Account: email, optional display name.</li>
        <li>Your SOP, paper-trade history, go-live checklist, theme preference, watchlist.</li>
        <li>Verified trader statistics you upload (broker statements / CSVs / screenshots).</li>
        <li>Per-user API-usage counts for rate limiting.</li>
        <li>Stripe customer ID and subscription status (no card numbers — Stripe holds those).</li>
      </ul>

      <h2>Where it lives</h2>
      <p>
        All user data is stored in Supabase. Row-level security restricts access so each user can only
        read or write their own rows. Broker credentials (Alpaca) are currently configured at the app
        level, not per-user.
      </p>

      <h2>Who we share with</h2>
      <p>
        We share data with the third-party services we depend on (Supabase, Stripe, Anthropic, Alpaca,
        Yahoo Finance) only as needed to make features work. We don't sell your data.
      </p>

      <h2>Your rights</h2>
      <p>
        You can request export or deletion of your account by emailing the address in the footer. Cancelling
        a subscription doesn't delete your data automatically.
      </p>
    </div>
  );
}
