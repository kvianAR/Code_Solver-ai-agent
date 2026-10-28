(() => {
  function explain(message=''){
    const rules=[
      ['daily-priority',/reserved for.*daily/i,'Optional practice is waiting for the daily allotment.','Finish daily work first or raise the daily budget.'],
      ['quota',/quota|balance|billing/i,'Provider quota is exhausted.','Check provider billing or select the backup provider.'],
      ['budget',/budget|cost limit/i,'An AI spending limit was reached.','Check daily and session limits in Settings.'],
      ['connection',/connection token|token did not match|401/i,'The server connection needs attention.','Use Connect automatically to refresh local pairing.'],
      ['provider',/API key|model|provider rejected/i,'The AI provider rejected the request.','Check the saved key, endpoint and model, then test the provider.'],
      ['login',/login|sign in|session|csrf|account changed/i,'The LeetCode session needs attention.','Sign in to the original account in this browser profile.'],
      ['network',/network|fetch|429|rate limit|timed out|timeout|connection|unavailable|temporary/i,'A service could not be reached or is rate limited.','Keep the browser online. Wait for the next retry or check setup.'],
      ['solution',/wrong answer|testcase|examples|runtime error|compile|syntax/i,'The draft did not pass a correctness check.','Review the failing case, constraints and function signature.'],
      ['review',/uncertain|safety limit|repeats|review/i,'Automatic submissions are paused for review.','Check LeetCode submission history before retrying.'],
      ['contest',/contest.*live/i,'AI practice is paused during a live contest.','Resume practice after the contest ends.']
    ];
    const match=rules.find(([,pattern])=>pattern.test(message));
    return match?{kind:match[0],summary:match[2],action:match[3]}:{kind:'other',summary:'Check the latest run for details.',action:'Use Check setup or export a diagnostic report.'};
  }
  globalThis.failureGuide={explain};
})();
