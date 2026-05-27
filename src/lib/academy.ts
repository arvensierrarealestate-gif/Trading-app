// Trading Academy content. Single source of truth for inline tooltips and the
// full Academy view. Plain English, no jargon for jargon's sake.

export type Term = {
  id: string;
  name: string;
  short: string;
  why: string;
  example: string;
  category: "indicator" | "concept" | "options" | "risk" | "regime";
};

export type Strategy = {
  id: string;
  name: string;
  summary: string;
  steps: string[];
};

export type Rule = {
  id: string;
  title: string;
  body: string;
};

export const TERMS: Term[] = [
  {
    id: "rsi",
    name: "RSI",
    short: "A 0–100 score that says whether a stock has been bought too hard or sold too hard recently.",
    why: "Above 70 the stock is hot and may pull back. Below 30 it's been hammered and may bounce. Useful as a sanity check, not a trigger on its own.",
    example: "TSLA's RSI is 82 after a 3-day rally — that's a yellow flag against chasing the breakout.",
    category: "indicator",
  },
  {
    id: "ema",
    name: "EMA",
    short: "A moving average that weights recent prices more than old ones, so it turns faster than a simple average.",
    why: "The 20-EMA acts as dynamic support in uptrends. Price crossing under a key EMA often marks a trend change.",
    example: "When QQQ closes below its 50-day EMA after months above it, swing traders treat that as a regime shift.",
    category: "indicator",
  },
  {
    id: "macd",
    name: "MACD",
    short: "A momentum gauge built from two moving averages. Crossing the zero line means momentum flipped direction.",
    why: "A MACD crossover with rising volume is a stronger entry signal than either alone.",
    example: "NVDA's MACD crosses above zero on a high-volume day — momentum confirmation for a long entry.",
    category: "indicator",
  },
  {
    id: "atr",
    name: "ATR",
    short: "Average True Range — the typical dollar move a stock makes in a day.",
    why: "Use ATR to size your stop loss. A stop tighter than 1 ATR usually gets shaken out by normal noise.",
    example: "AAPL's ATR is $3. Your stop should sit at least $3 below your entry to survive a normal day's swing.",
    category: "indicator",
  },
  {
    id: "volume",
    name: "Volume",
    short: "How many shares traded during a period. Higher volume means more conviction behind the move.",
    why: "Breakouts on heavy volume tend to stick. Breakouts on light volume tend to fail.",
    example: "SPY breaks resistance on 2x average volume — buyers are committed, the move has fuel.",
    category: "indicator",
  },
  {
    id: "support",
    name: "Support",
    short: "A price level where buyers have repeatedly stepped in, halting declines.",
    why: "Good stops sit just below support. Bounces from support are common low-risk entry points.",
    example: "SPY has bounced from $580 three times in two months — that's strong support.",
    category: "concept",
  },
  {
    id: "resistance",
    name: "Resistance",
    short: "A price level where sellers have repeatedly stepped in, halting rallies.",
    why: "Resistance is where breakouts happen. A clean break above resistance on volume is bullish.",
    example: "TSLA stalls at $420 four times — that's resistance. A close above on volume opens the next leg up.",
    category: "concept",
  },
  {
    id: "stop-loss",
    name: "Stop loss",
    short: "A pre-set price where you exit the trade because your thesis is wrong. Not a suggestion — a commitment.",
    why: "It caps each loss to a known amount. Without one, a small loss can become an account-ending loss.",
    example: "You buy AAPL at $190 and set a stop at $187. Max loss is $3 per share, period.",
    category: "risk",
  },
  {
    id: "take-profit",
    name: "Take profit",
    short: "A pre-set price where you exit the winning trade and lock in the gain.",
    why: "Without a target, hope replaces discipline and most winners turn into losers.",
    example: "Entry $190, stop $187, take profit $196 — a 2:1 reward-to-risk you committed to before the trade started.",
    category: "risk",
  },
  {
    id: "risk-reward",
    name: "Risk / Reward ratio",
    short: "How many dollars you stand to gain compared to dollars at risk.",
    why: "Even a 40%-win-rate trader is profitable at 1:2. At 1:1 you need 50%+ wins. Sets the math floor of your strategy.",
    example: "Risk $1 to make $2 = 1:2 reward-to-risk. You only need to win 4 out of 10 to break even.",
    category: "risk",
  },
  {
    id: "position-size",
    name: "Position size",
    short: "How many shares (or contracts) you buy, sized so the trade can't risk more than your rule allows.",
    why: "Position size — not entry price — controls how much you can lose. It's the most important risk lever you have.",
    example: "Account $10,000, 1% rule = $100 max risk. Stop $2 below entry = max 50 shares.",
    category: "risk",
  },
  {
    id: "iv-rank",
    name: "IV rank",
    short: "Where the stock's current implied volatility sits compared to its last year — on a 0 to 100 scale.",
    why: "Selling options is favorable when IV rank is high (above 30). Buying options is favorable when it's low.",
    example: "MSFT IV rank is 75 — options premiums are rich, good time to sell puts on stock you'd own.",
    category: "options",
  },
  {
    id: "delta",
    name: "Delta",
    short: "How much an option's price moves when the stock moves $1. Also a rough probability the option finishes in the money.",
    why: "Delta picks the option's character. 0.70+ delta acts like stock; 0.30 delta is a leveraged lottery ticket.",
    example: "0.70-delta NVDA call moves ~$0.70 for every $1 NVDA moves — and has ~70% odds of expiring in the money.",
    category: "options",
  },
  {
    id: "theta",
    name: "Theta",
    short: "How much an option loses per day just from time passing, all else equal.",
    why: "Theta works against option buyers and for option sellers. Time decay accelerates inside 45 days to expiry.",
    example: "A short put with 30 days left collecting $0.05 theta per day = $5 a day melting in your favor.",
    category: "options",
  },
  {
    id: "call-option",
    name: "Call option",
    short: "A contract giving you the right to buy 100 shares at a set price before a set date.",
    why: "A bullish bet with capped downside (the premium paid). Used for leverage or to define risk on a directional view.",
    example: "Buy AAPL $200 call expiring next month. If AAPL is $215 at expiry, you can buy at $200 and pocket the spread.",
    category: "options",
  },
  {
    id: "put-option",
    name: "Put option",
    short: "A contract giving you the right to sell 100 shares at a set price before a set date.",
    why: "Used to hedge longs or bet on a decline. Selling puts is a way to get paid for being willing to buy a stock cheaper.",
    example: "Sell an AAPL $180 put: collect premium now. If AAPL falls below $180, you're assigned 100 shares at $180.",
    category: "options",
  },
  {
    id: "leaps",
    name: "LEAPS",
    short: "Long-dated options — at least one year to expiry. Lets you control 100 shares for a fraction of the cost.",
    why: "LEAPS turn options into a substitute for owning stock long term, with less capital and capped downside.",
    example: "A $40 NVDA LEAPS call expiring 18 months out costs much less than 100 shares but moves with the stock.",
    category: "options",
  },
  {
    id: "covered-call",
    name: "Covered call",
    short: "Selling a call against 100 shares you already own. You collect premium; in exchange you cap your upside.",
    why: "Generates income on flat or slowly rising stock. Best on stocks you'd happily sell at the strike.",
    example: "Own 100 AAPL at $190. Sell a $200 call for $3. Either pocket $300, or pocket $300 + sell at $200 if called away.",
    category: "options",
  },
  {
    id: "cash-secured-put",
    name: "Cash-secured put",
    short: "Selling a put while holding enough cash to buy the shares if assigned.",
    why: "A way to get paid for placing a limit buy order on a stock you actually want. Worst case: you own the stock cheaper.",
    example: "Want AAPL at $180. Sell a $180 put for $2. Either keep the $200 premium, or buy AAPL at a net $178.",
    category: "options",
  },
  {
    id: "market-regime",
    name: "Market regime",
    short: "The current personality of the broad market — bull, neutral, bear, or crash. Affects every individual trade.",
    why: "Most strategies work in one regime and fail in another. Trading the wrong strategy for the regime is a top-three killer of accounts.",
    example: "Trend-following longs work in a bull regime. Same trades in a bear regime get chopped to pieces.",
    category: "regime",
  },
  {
    id: "bear-market",
    name: "Bear market",
    short: "A sustained decline of 20% or more in the broad market. Rallies inside one are typically short-lived.",
    why: "In a bear regime, defensive strategies (cash, puts, short positions) outperform; long-only strategies usually bleed.",
    example: "2022 SPY: down 25% over 9 months with multiple sharp rallies that all rolled over.",
    category: "regime",
  },
  {
    id: "bull-market",
    name: "Bull market",
    short: "A sustained rise in the broad market, where pullbacks tend to be bought.",
    why: "Buy-the-dip works; trend-following longs work; selling cash-secured puts on quality names works.",
    example: "2017 SPY: steady grind higher all year, every dip bought within days.",
    category: "regime",
  },
  {
    id: "drawdown",
    name: "Drawdown",
    short: "The peak-to-trough decline of your account. Measures how much you've given back from your high.",
    why: "Recovering from a 50% drawdown requires a 100% gain. Capping drawdown is more important than maximizing returns.",
    example: "Account peaks at $10,000, drops to $8,500 — a 15% drawdown. Needs a 17.6% gain just to recover.",
    category: "risk",
  },
  {
    id: "win-rate",
    name: "Win rate",
    short: "The percentage of your trades that finish profitable.",
    why: "Win rate alone is meaningless without reward-to-risk. A 30% win rate at 1:3 R/R is more profitable than 60% at 1:1.",
    example: "30 wins out of 50 trades = 60% win rate. Combine with your average win and loss to know if you're profitable.",
    category: "concept",
  },
  {
    id: "paper-trading",
    name: "Paper trading",
    short: "Trading with simulated money to practice your strategy without financial risk.",
    why: "Lets you test your SOP in real market conditions and surface execution bugs (hesitation, oversizing, skipping stops) before they cost real money.",
    example: "5 paper trades scored 70+ on the protection rubric is the minimum bar before this app unlocks Go Live.",
    category: "concept",
  },
];

export const STRATEGIES: Strategy[] = [
  {
    id: "premium-selling",
    name: "Premium selling",
    summary: "Selling cash-secured puts on stocks you'd want to own anyway, collecting premium while waiting for your price.",
    steps: [
      "Find a stock you would not mind owning at a discount.",
      "Check IV rank is above 30 — premiums need to be rich enough to justify the risk.",
      "Choose a strike price 1–2% below current price.",
      "Sell the put and collect the premium.",
      "Set a stop loss if the position doubles in loss.",
      "Close at 50% profit or 21 days before expiry, whichever comes first.",
      "Repeat on the same stock or a new one that fits the rules.",
    ],
  },
  {
    id: "leaps",
    name: "LEAPS",
    summary: "Long-term call options as a leveraged substitute for owning quality stock outright.",
    steps: [
      "Find a company you believe in for the long term.",
      "Wait for a pullback to weekly support — don't chase.",
      "Buy a call with delta 0.70 or higher so it behaves like stock.",
      "Choose expiry 12 months or more out to give the thesis time to play out.",
      "Risk no more than 2% of your account on the trade.",
      "Set an alert at 100% gain.",
      "Exit at 100% gain or 6 months before expiry, whichever comes first.",
    ],
  },
];

export const RULES: Rule[] = [
  {
    id: "stop-loss-mandatory",
    title: "Why stop loss is mandatory, not optional",
    body: "Every blown-up trading account in history has the same story: a losing position that 'just needed a little more time.' A pre-committed stop loss is what separates a trader from a gambler. It caps any single loss to a known dollar amount you decided when your judgment was clear, not in the panic of the moment.",
  },
  {
    id: "one-percent-rule",
    title: "Why 1% max risk per trade protects your account",
    body: "At 1% risk per trade, ten losses in a row only takes your account down ~10%. At 5% risk, the same streak wipes out 40%. Losing streaks are routine — the math has to survive them. The 1% rule lets you make a mistake and try again tomorrow instead of starting over.",
  },
  {
    id: "two-percent-daily",
    title: "Why 2% daily loss limit prevents catastrophic days",
    body: "Most blow-up days start with one bad trade and end with revenge trading. A hard 2% daily loss limit forces you to close the laptop after the system has spoken. Tomorrow is another day. The cap is what makes 'one bad day' instead of 'one career-ending day' the worst case.",
  },
  {
    id: "five-paper-trades",
    title: "Why you need 5 paper trades before going live",
    body: "Five trades isn't about proving you can trade — it's about catching the gap between your written SOP and your actual behavior. Almost every trader discovers their first paper trades violate their own rules (skipped stop, oversized, traded the wrong regime). Better to discover that with no money on the line.",
  },
  {
    id: "regime-matters",
    title: "Why market regime matters before entering any trade",
    body: "Strategies have a habitat. Trend-following longs thrive in bull regimes and die in chop. Premium selling works in calm markets and gets shredded in volatility spikes. Checking the regime is a 10-second filter that prevents 80% of unforced errors. Trade your strategy only when its habitat is active.",
  },
  {
    id: "common-blowup",
    title: "The most common pattern of traders who blow up",
    body: "It's almost always the same five-act play: (1) one trade goes against them, (2) they move the stop to 'give it room', (3) the loss grows past their rules, (4) they double down to recover faster, (5) the account is gone. Notice none of those steps require a market crash — only the trader's discipline breaking. The rules in this app exist to break that chain before step 2.",
  },
];

export function findTerm(id: string): Term | undefined {
  return TERMS.find((t) => t.id === id);
}
