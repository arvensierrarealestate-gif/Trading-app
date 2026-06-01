export const metadata = { title: "Terms of service · TradeReady" };

export default function TermsPage() {
  return (
    <div className="legal-shell">
      <h1>Terms of service</h1>
      <p className="legal-draft"><strong>Draft — review with a lawyer before launch.</strong></p>

      <p>By creating an account and using TradeReady, you agree to these terms.</p>

      <h2>Service</h2>
      <p>
        TradeReady is an educational SaaS tool that helps traders build and follow a trading SOP. It connects
        to third-party services (Supabase for auth/data, Alpaca for brokerage, Anthropic for AI grading,
        Yahoo Finance for market data) on your behalf.
      </p>

      <h2>Subscription and billing</h2>
      <p>
        Paid plans are billed in advance on a recurring basis through Stripe. You may cancel at any time
        through the customer portal; access continues until the end of the current paid period. Refunds
        are at our discretion.
      </p>

      <h2>Acceptable use</h2>
      <p>
        Don't abuse the AI endpoints, reverse-engineer the service, or use it for illegal activity. Daily
        per-user rate limits apply to AI features.
      </p>

      <h2>No financial advice</h2>
      <p>
        See our <a href="/legal/risk">Risk disclaimer</a>. Nothing in the app is investment advice. You are
        solely responsible for your trades.
      </p>

      <h2>Liability</h2>
      <p>
        The service is provided "as is" without warranties. To the maximum extent allowed by law,
        TradeReady is not liable for any trading losses, missed signals, downtime, or data inaccuracies.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms; continued use after changes constitutes acceptance.</p>
    </div>
  );
}
